import { useMemo, useRef, useState } from 'react';
import { audit } from './core/pipeline';
import type { EventRole, Issue } from './core/types';
import { SAMPLE_EVENTS, SAMPLE_GATES, SAMPLE_TOP } from './sample';

type AreaKey = 'events' | 'gates' | 'top';

interface EditorRefs {
  events: React.RefObject<HTMLTextAreaElement>;
  gates: React.RefObject<HTMLTextAreaElement>;
  top: React.RefObject<HTMLInputElement>;
}

const ROLE_LABEL: Record<EventRole, string> = {
  mandatory: '必现',
  optional: '可选',
  irrelevant: '无关'
};

const ROLE_HINT: Record<EventRole, string> = {
  mandatory: '出现在顶事件的每一个最小割集中（顶事件发生的必要贡献者）',
  optional: '出现在部分最小割集中',
  irrelevant: '不出现在任何最小割集中（对顶事件无贡献）'
};

export function App(): JSX.Element {
  const [eventsText, setEventsText] = useState(SAMPLE_EVENTS);
  const [gatesText, setGatesText] = useState(SAMPLE_GATES);
  const [topText, setTopText] = useState(SAMPLE_TOP);

  const eventsRef = useRef<HTMLTextAreaElement>(null);
  const gatesRef = useRef<HTMLTextAreaElement>(null);
  const topRef = useRef<HTMLInputElement>(null);
  const refs: EditorRefs = { events: eventsRef, gates: gatesRef, top: topRef };

  const result = useMemo(() => audit(eventsText, gatesText, topText), [eventsText, gatesText, topText]);

  const issueLines = useMemo(() => {
    const map: Record<AreaKey, Set<number>> = { events: new Set(), gates: new Set(), top: new Set() };
    if (result.status === 'invalid') {
      for (const issue of result.issues) {
        if (issue.location.line !== undefined) map[issue.location.area as AreaKey].add(issue.location.line);
      }
    }
    return map;
  }, [result]);

  const locate = (issue: Issue): void => {
    const target = refs[issue.location.area as AreaKey].current;
    if (!target) return;
    target.focus();
    if (issue.location.area === 'top' || issue.location.line === undefined) {
      (target as HTMLInputElement).select?.();
      return;
    }
    const textarea = target as HTMLTextAreaElement;
    const lines = textarea.value.split(/\r?\n/);
    let start = 0;
    for (let i = 0; i < issue.location.line - 1 && i < lines.length; i += 1) {
      start += lines[i].length + 1;
    }
    const end = start + (lines[issue.location.line - 1]?.length ?? 0);
    textarea.setSelectionRange(start, end);
    // 估算滚动位置（约 18px/行）并将问题行置于可视区上部
    const approxLineHeight = 18;
    textarea.scrollTop = Math.max(0, (issue.location.line - 3) * approxLineHeight);
  };

  const eventCount = eventsText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;
  const gateCount = gatesText.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#')).length;

  return (
    <div className="page">
      <header className="topbar">
        <h1>航天器供电故障树 · 最小割集审计</h1>
        <p className="subtitle">
          全部计算在浏览器本地完成 · 无业务后端、无在线调用 · 共享有向无环图精确展开 ·
          单门规范化割集上限 2000
        </p>
      </header>

      <div className="layout">
        <section className="editors">
          <EditorPanel
            title="基本事件"
            counter={`${eventCount} 个（允许 2–30）`}
            errorLines={issueLines.events}
          >
            <textarea
              ref={eventsRef}
              value={eventsText}
              spellCheck={false}
              onChange={(e) => setEventsText(e.target.value)}
              aria-label="基本事件编辑区，每行一个 ASCII 标识"
            />
          </EditorPanel>

          <EditorPanel
            title="门定义"
            counter={`${gateCount} 个（允许 1–80），语法：名称 AND|OR 输入...`}
            errorLines={issueLines.gates}
          >
            <textarea
              ref={gatesRef}
              value={gatesText}
              spellCheck={false}
              onChange={(e) => setGatesText(e.target.value)}
              aria-label="门定义编辑区，每行 名称 类型 输入列表"
            />
          </EditorPanel>

          <EditorPanel title="顶事件" counter="单个门名称" errorLines={issueLines.top}>
            <input
              ref={topRef}
              value={topText}
              spellCheck={false}
              onChange={(e) => setTopText(e.target.value)}
              aria-label="顶事件门名称"
            />
          </EditorPanel>

          <div className="actions">
            <button type="button" onClick={() => { setEventsText(SAMPLE_EVENTS); setGatesText(SAMPLE_GATES); setTopText(SAMPLE_TOP); }}>
              载入示例
            </button>
            <button type="button" onClick={() => { setEventsText(''); setGatesText(''); setTopText(''); }}>
              全部清空
            </button>
          </div>
        </section>

        <section className="results">
          {result.status === 'invalid' && <InvalidPanel issues={result.issues} onLocate={locate} />}
          {result.status === 'complexity_limit' && <LimitPanel gate={result.gate} line={result.line} limit={result.limit} partial={result.partialGateCounts} />}
          {result.status === 'complete' && <CompletePanel result={result} />}
        </section>
      </div>
    </div>
  );
}

function EditorPanel(props: {
  title: string;
  counter: string;
  errorLines: Set<number>;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={`panel ${props.errorLines.size > 0 ? 'panel-error' : ''}`}>
      <div className="panel-head">
        <h2>{props.title}</h2>
        <span className="counter">{props.counter}</span>
      </div>
      {props.errorLines.size > 0 && (
        <div className="line-tags">
          问题行：{[...props.errorLines].sort((a, b) => a - b).map((n) => (
            <span key={n} className="line-tag">第 {n} 行</span>
          ))}
        </div>
      )}
      {props.children}
    </div>
  );
}

function InvalidPanel(props: { issues: Issue[]; onLocate: (i: Issue) => void }): JSX.Element {
  return (
    <div className="panel result-panel">
      <div className="panel-head">
        <h2 className="status-bad">输入非法（{props.issues.length} 项）</h2>
      </div>
      <p className="note">原始输入已保留，点击任一问题可定位到对应编辑位置。修复前不会给出割集结论。</p>
      <ul className="issue-list">
        {props.issues.map((issue, idx) => (
          <li key={`${issue.code}-${idx}`}>
            <button type="button" className="issue-btn" onClick={() => props.onLocate(issue)}>
              <span className="issue-code">{issue.code}</span>
              <span className="issue-msg">{issue.message}</span>
              <span className="issue-loc">
                {areaLabel(issue.location.area)}
                {issue.location.line !== undefined ? ` 第 ${issue.location.line} 行` : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LimitPanel(props: { gate: string; line: number; limit: number; partial: Record<string, number> }): JSX.Element {
  const completed = Object.entries(props.partial).sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="panel result-panel">
      <div className="panel-head">
        <h2 className="status-limit">complexity_limit</h2>
      </div>
      <div className="limit-banner">
        <strong>结论不完整，不得作为完整最小割集结论使用。</strong>
        <p>
          门 <code>{props.gate}</code>（门定义第 {props.line} 行）规范化后的最小割集数量超过上限{' '}
          {props.limit} 个，展开已在该门处中止。顶事件割集与事件归属均未给出，
          因为截断结果可能遗漏更小的解释（吸收律消去尚未完成）。
        </p>
        <p className="note">
          请拆分该门、引入中间层或重新建模以降低组合复杂度后重试。
        </p>
      </div>
      <h3>已完成规范化的门（仅供排障参考，非完整结果）</h3>
      <table className="data-table">
        <thead><tr><th>门</th><th>割集数</th></tr></thead>
        <tbody>
          {completed.map(([name, n]) => (
            <tr key={name} className={name === props.gate ? 'row-hit' : ''}>
              <td>{name}</td><td>{n}</td>
            </tr>
          ))}
          <tr className="row-hit"><td>{props.gate}</td><td>&gt; {props.limit}（中止）</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function CompletePanel(props: { result: Extract<ReturnType<typeof audit>, { status: 'complete' }> }): JSX.Element {
  const { result } = props;
  const groups: { role: EventRole; events: string[] }[] = [
    { role: 'mandatory', events: [] },
    { role: 'optional', events: [] },
    { role: 'irrelevant', events: [] }
  ];
  for (const [name, role] of Object.entries(result.classification)) {
    groups.find((g) => g.role === role)!.events.push(name);
  }
  groups.forEach((g) => g.events.sort((a, b) => a.localeCompare(b)));

  const gateEntries = Object.entries(result.gateCounts).sort((a, b) => a[0].localeCompare(b[0]));

  return (
    <>
      <div className="panel result-panel">
        <div className="panel-head">
          <h2 className="status-ok">顶事件 {result.top} 的最小割集（{result.cutsets.length} 个）</h2>
        </div>
        {result.cutsets.length === 0 ? (
          <p className="note">顶事件不存在任何割集——按当前模型顶事件不可能发生。</p>
        ) : (
          <ol className="cutset-list">
            {result.cutsets.map((cs, i) => (
              <li key={i} className="cutset">
                <span className="cutset-index">{i + 1}.</span>
                {cs.map((e, j) => (
                  <span key={e} className="cutset-events">
                    <code>{e}</code>{j < cs.length - 1 ? ' ∧ ' : ''}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="panel result-panel">
        <div className="panel-head"><h2>基本事件归属</h2></div>
        <table className="data-table classification">
          <thead><tr><th>类别</th><th>含义</th><th>事件</th></tr></thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.role}>
                <td><span className={`badge badge-${g.role}`}>{ROLE_LABEL[g.role]}</span></td>
                <td className="hint">{ROLE_HINT[g.role]}</td>
                <td>{g.events.length ? g.events.map((e) => <code key={e} className="event-chip">{e}</code>) : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel result-panel">
        <div className="panel-head"><h2>各门规范化割集数（共享子门仅计算一次）</h2></div>
        <table className="data-table compact">
          <thead><tr><th>门</th><th>最小割集数</th></tr></thead>
          <tbody>
            {gateEntries.map(([name, n]) => (
              <tr key={name}><td><code>{name}</code></td><td>{n}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function areaLabel(area: string): string {
  return area === 'events' ? '基本事件' : area === 'gates' ? '门定义' : '顶事件';
}
