import { describe, expect, it } from 'vitest';
import { analyze, MAX_CUTSETS_PER_GATE } from './engine';
import { parseEvents, parseGates, parseModel, parseTop } from './parser';
import { audit } from './pipeline';
import type { ParsedModel } from './types';
import { findCycles, validate } from './validate';

function model(events: string[], lines: string[], top: string): ParsedModel {
  const gates = lines.map((line, i) => {
    const [name, type, ...inputs] = line.trim().split(/\s+/);
    return { name, type: type as 'AND' | 'OR', inputs, line: i + 1 };
  });
  return { events, gates, top };
}

const ids = (cuts: string[][]): string[] => cuts.map((c) => c.join('·'));

describe('parse', () => {
  it('接受注释、空行并保留非法行', () => {
    const { events, issues } = parseEvents('# c\n\nA\n1BAD\nA\n');
    expect(events).toEqual(['A']);
    expect(issues.map((i) => i.code)).toEqual(['bad_identifier', 'duplicate_event']);
    expect(issues[0].location.line).toBe(4);
  });

  it('事件数量边界 2–30', () => {
    expect(parseEvents('A\nB\n').issues).toHaveLength(0);
    expect(parseEvents('A\n').issues[0].code).toBe('event_count');
    expect(parseEvents(Array.from({ length: 31 }, (_, i) => `E${i}`).join('\n')).issues[0].code).toBe('event_count');
  });

  it('门解析：格式、类型、数量', () => {
    expect(parseGates('G AND A B').gates[0]).toMatchObject({ name: 'G', type: 'AND', inputs: ['A', 'B'], line: 1 });
    expect(parseGates('G XOR A').issues[0].code).toBe('unknown_gate_type');
    expect(parseGates('G AND').issues[0].code).toBe('malformed_gate_line');
    expect(parseGates('G AND 9X').issues[0].code).toBe('bad_identifier');
    expect(parseGates('G AND A B\nG OR B').issues[0].code).toBe('duplicate_gate');
    expect(parseGates(Array.from({ length: 81 }, (_, i) => `G${i} OR A`).join('\n')).issues[0].code).toBe('gate_count');
  });

  it('顶事件必须是单个合法标识', () => {
    expect(parseTop('TOP').issues).toHaveLength(0);
    expect(parseTop('').issues[0].code).toBe('top_invalid');
    expect(parseTop('A B').issues[0].code).toBe('top_invalid');
  });
});

describe('validate', () => {
  it('定位缺失引用', () => {
    const issues = validate(model(['A'], ['G AND A MISSING'], 'G'));
    expect(issues.map((i) => i.code)).toEqual(['missing_reference']);
    expect(issues[0].location).toMatchObject({ area: 'gates', line: 1, token: 'MISSING' });
  });

  it('定位自引用', () => {
    const issues = validate(model(['A'], ['G OR A G'], 'G'));
    expect(issues.map((i) => i.code)).toEqual(['self_reference']);
  });

  it('顶事件必须是门', () => {
    const issues = validate(model(['A'], ['G OR A'], 'A'));
    expect(issues.map((i) => i.code)).toEqual(['top_not_gate']);
  });

  it('门名与事件冲突', () => {
    const issues = validate(model(['G'], ['G OR G'], 'G'));
    expect(issues.some((i) => i.code === 'name_collision')).toBe(true);
  });

  it('检测 2 环、3 环与任意长度环并给出路径', () => {
    const two = new Map([
      ['A', ['B']],
      ['B', ['A']]
    ]);
    expect(findCycles(two)).toEqual([['A', 'B']]);

    const three = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', ['A']]
    ]);
    expect(findCycles(three)[0]).toHaveLength(3);

    const issues = validate(model(['X'], ['A AND B X', 'B OR C', 'C OR A'], 'A'));
    expect(issues.some((i) => i.code === 'cycle')).toBe(true);
    expect(issues.find((i) => i.code === 'cycle')!.message).toContain('→');
  });

  it('共享 DAG（菱形）合法', () => {
    expect(validate(model(['A', 'B'], ['S OR A B', 'L AND S A', 'R AND S B', 'T OR L R'], 'T'))).toHaveLength(0);
  });
});

describe('minimal cutsets', () => {
  it('AND/OR 基本语义', () => {
    const r = analyze(model(['A', 'B'], ['T AND A B'], 'T'));
    expect(r.status).toBe('complete');
    if (r.status === 'complete') expect(ids(r.cutsets)).toEqual(['A·B']);

    const r2 = analyze(model(['A', 'B'], ['T OR A B'], 'T'));
    if (r2.status === 'complete') expect(ids(r2.cutsets)).toEqual(['A', 'B']);
  });

  it('吸收律：A∨(A∧B) 仅得 {A},{B} 场景的完整族', () => {
    // TOP = G1 ∨ G2，G1=A∨B，G2=A∧B —— {A,B} 必须被吸收。
    const r = audit('A\nB\n', 'G1 OR A B\nG2 AND A B\nTOP OR G1 G2\n', 'TOP');
    expect(r.status).toBe('complete');
    if (r.status === 'complete') {
      expect(ids(r.cutsets)).toEqual(['A', 'B']);
    }
  });

  it('跨门吸收：与单事件割集重复的组合全部消去', () => {
    // T = C ∨ (A∧B∧C)：{A,B,C} 被 {C} 吸收
    const r = analyze(model(['A', 'B', 'C'], ['X AND A B C', 'T OR C X'], 'T'));
    if (r.status === 'complete') expect(ids(r.cutsets)).toEqual(['C']);
  });

  it('共享子门只计算一次且结果正确（菱形）', () => {
    const m = model(['A', 'B'], ['S OR A B', 'L AND S A', 'R AND S B', 'T OR L R'], 'T');
    const r = analyze(m);
    // L: {A}（S∧A 中 {A,A}={A} 吸收 {A,B}）；R: {B}；T: {A},{B}
    if (r.status === 'complete') {
      expect(ids(r.cutsets)).toEqual(['A', 'B']);
      expect(r.gateCounts).toMatchObject({ S: 2, L: 1, R: 1, T: 2 });
    }
  });

  it('重复割集合并（同一共享门被多路径引用）', () => {
    // T = S ∨ S 等价单门被重复输入
    const r = analyze(model(['A', 'B'], ['S OR A B', 'T OR S S'], 'T'));
    if (r.status === 'complete') expect(ids(r.cutsets)).toEqual(['A', 'B']);
  });

  it('集合内与集合间按事件标识排序', () => {
    const r = analyze(model(['Z', 'A', 'M'], ['X OR Z A', 'T AND X M'], 'T'));
    if (r.status === 'complete') {
      expect(r.cutsets).toEqual([
        ['A', 'M'],
        ['M', 'Z']
      ]);
    }
  });
});

describe('event classification', () => {
  it('必现/可选/无关三类正确，且基于顶事件而非被共享子门局部', () => {
    // S 被 L、R 共享：在 S 内 A、B 都“可选”，但顶 T=(S∧A)∨(S∧B) 下：
    // 割集 {A},{B} —— A、B 可选；加入永不接入的 X 为无关。
    const r = audit(
      'A\nB\nX\n',
      'S OR A B\nL AND S A\nR AND S B\nT OR L R\n',
      'T'
    );
    expect(r.status).toBe('complete');
    if (r.status === 'complete') {
      expect(r.classification).toMatchObject({ A: 'optional', B: 'optional', X: 'irrelevant' });
    }
  });

  it('必现事件：出现在每个割集中', () => {
    // T = (A∨B) ∧ C → {A,C},{B,C}
    const r = analyze(model(['A', 'B', 'C'], ['S OR A B', 'T AND S C'], 'T'));
    if (r.status === 'complete') {
      expect(r.classification).toMatchObject({ C: 'mandatory', A: 'optional', B: 'optional' });
      expect(ids(r.cutsets)).toEqual(['A·C', 'B·C']);
    }
  });
});

describe('complexity limit', () => {
  function exploding(groups: number): { events: string; gates: string } {
    const eventNames: string[] = [];
    const lines: string[] = [];
    for (let g = 0; g < groups; g += 1) {
      const members = [`e${g}_0`, `e${g}_1`, `e${g}_2`];
      eventNames.push(...members);
      lines.push(`GRP${g} OR ${members.join(' ')}`);
    }
    lines.push(`BIG AND ${Array.from({ length: groups }, (_, g) => `GRP${g}`).join(' ')}`);
    return { events: eventNames.join('\n') + '\n', gates: lines.join('\n') + '\n' };
  }

  it('恰好 2000 个割集时完整输出', () => {
    // 4×5×10×10 = 2000，使用 29 个事件
    const sizes = [4, 5, 10, 10];
    const ev: string[] = [];
    const lines: string[] = [];
    sizes.forEach((s, gi) => {
      const members = Array.from({ length: s }, (_, k) => `g${gi}_e${k}`);
      ev.push(...members);
      lines.push(`GRP${gi} OR ${members.join(' ')}`);
    });
    lines.push(`BIG AND ${sizes.map((_, gi) => `GRP${gi}`).join(' ')}`);
    const r = audit(ev.join('\n') + '\n', lines.join('\n') + '\n', 'BIG');
    expect(r.status).toBe('complete');
    if (r.status === 'complete') expect(r.cutsets).toHaveLength(MAX_CUTSETS_PER_GATE);
  });

  it('超过 2000（3^7=2187）时返回 complexity_limit 且不冒充完整结论', () => {
    const { events, gates } = exploding(7);
    const r = audit(events, gates, 'BIG');
    expect(r.status).toBe('complexity_limit');
    if (r.status === 'complexity_limit') {
      expect(r.gate).toBe('BIG');
      expect(r.limit).toBe(2000);
      expect(r.line).toBe(8);
      expect(r.partialGateCounts['GRP0']).toBe(3);
    }
  });

  it('子门超限向上报告为该子门而非父门', () => {
    const { events, gates } = exploding(7);
    const withParent = gates + 'TOP OR BIG\n';
    const r = audit(events, withParent, 'TOP');
    expect(r.status).toBe('complexity_limit');
    if (r.status === 'complexity_limit') expect(r.gate).toBe('BIG');
  });

  it('中间组合爆炸但最终族收缩时不得误报超限（禁止在折叠中途判定）', () => {
    // 顶门 T 直接 AND 7 个三选一组与 Z（Z 为全部 21 事件的单割集门）。
    // 逐输入折叠会在中途达到 3^7=2187，但最终每个组合并上全集后只剩 1 个割集。
    const { events } = exploding(7);
    const allEvents = events.trim().split('\n');
    const lines: string[] = [];
    for (let g = 0; g < 7; g += 1) {
      lines.push(`GRP${g} OR e${g}_0 e${g}_1 e${g}_2`);
    }
    lines.push(`Z AND ${allEvents.join(' ')}`);
    lines.push(`T AND ${Array.from({ length: 7 }, (_, g) => `GRP${g}`).join(' ')} Z`);
    const r = audit(events, lines.join('\n') + '\n', 'T');
    expect(r.status).toBe('complete');
    if (r.status === 'complete') {
      expect(r.cutsets).toHaveLength(1);
      expect(r.cutsets[0].sort()).toEqual([...allEvents].sort());
    }
  });

  it('子门均不超限但最终 AND 族超限时如实报告（上限判定基于最终族）', () => {
    // A = 4 组二元(2^4) ∧ 3 组五元(5^3) = 16*125 = 2000（23 个事件）；
    // B = x OR y（2 个割集，2 个额外事件）；TOP = A ∧ B => 2000*2 = 4000 > 2000。
    const ev: string[] = [];
    const lines: string[] = [];
    const groupSizes = [2, 2, 2, 2, 5, 5, 5];
    groupSizes.forEach((s, gi) => {
      const members = Array.from({ length: s }, (_, k) => `a${gi}_${k}`);
      ev.push(...members);
      lines.push(`GA${gi} OR ${members.join(' ')}`);
    });
    lines.push(`A AND ${groupSizes.map((_, gi) => `GA${gi}`).join(' ')}`);
    lines.push('B OR X Y');
    lines.push('TOP AND A B');
    ev.push('X', 'Y');
    const r = audit(ev.join('\n') + '\n', lines.join('\n') + '\n', 'TOP');
    expect(r.status).toBe('complexity_limit');
    if (r.status === 'complexity_limit') {
      expect(r.gate).toBe('TOP');
      expect(r.partialGateCounts.A).toBe(2000);
      expect(r.partialGateCounts.B).toBe(2);
    }
  });
});

describe('pipeline 集成（航天器供电示例）', () => {
  const EVENTS = `BUS_FAULT\nMAIN_SRC\nMAIN_SW\nBK_SRC\nBK_SW\nCOMMON_CTRL\nCOSMIC\n`;
  const GATES =
    'LOSS OR COMMON_CTRL BUS_FAULT\n' +
    'OR_MAIN OR MAIN_SRC MAIN_SW\n' +
    'MAINF AND OR_MAIN LOSS\n' +
    'OR_BK OR BK_SRC BK_SW\n' +
    'BKF AND OR_BK LOSS\n' +
    'TOP AND MAINF BKF\n';

  it('共享 LOSS 子门仅规范化一次，主备组合形成 8 个三元割集', () => {
    const r = audit(EVENTS, GATES, 'TOP');
    expect(r.status).toBe('complete');
    if (r.status !== 'complete') return;
    expect(ids(r.cutsets)).toEqual([
      'BK_SRC·BUS_FAULT·MAIN_SRC',
      'BK_SRC·BUS_FAULT·MAIN_SW',
      'BK_SRC·COMMON_CTRL·MAIN_SRC',
      'BK_SRC·COMMON_CTRL·MAIN_SW',
      'BK_SW·BUS_FAULT·MAIN_SRC',
      'BK_SW·BUS_FAULT·MAIN_SW',
      'BK_SW·COMMON_CTRL·MAIN_SRC',
      'BK_SW·COMMON_CTRL·MAIN_SW'
    ]);
    expect(r.classification).toMatchObject({
      COMMON_CTRL: 'optional',
      BUS_FAULT: 'optional',
      MAIN_SRC: 'optional',
      MAIN_SW: 'optional',
      BK_SRC: 'optional',
      BK_SW: 'optional',
      COSMIC: 'irrelevant'
    });
    // 共享门 LOSS 仅规范化一次
    expect(r.gateCounts.LOSS).toBe(2);
  });

  it('非法输入原样保留并同时报出多个定位问题', () => {
    const r = audit('A\n1bad\n', 'G AND A NOPE\nG2 OR G2\n', 'NOPE');
    expect(r.status).toBe('invalid');
    if (r.status === 'invalid') {
      const codes = r.issues.map((i) => i.code);
      expect(codes).toContain('bad_identifier');
      expect(codes).toContain('missing_reference');
      expect(codes).toContain('self_reference');
      expect(codes).toContain('top_not_gate');
    }
  });

  it('parseModel 往返不丢字段', () => {
    const parsed = parseModel('A\nB\n', 'T AND A B # x\n', 'T');
    expect(parsed.issues).toHaveLength(0);
    expect(parsed.model.gates[0].line).toBe(1);
  });
});
