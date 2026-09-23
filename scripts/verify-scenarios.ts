/**
 * verify 一次性服务的规定场景断言（由 esbuild 打包为 Node ESM 后执行）。
 * 覆盖：
 *   1. 吸收律场景的最小割集；
 *   2. 共享子门的事件归属；
 *   3. 任一门规范化后超过 2000 个割集的超限场景。
 * 任一断言失败即以非零退出码结束进程。
 */
import { analyze } from '../src/core/engine';
import { audit } from '../src/core/pipeline';
import type { ParsedModel } from '../src/core/types';

let failures = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}`, detail ?? '');
  }
}

function buildModel(events: string[], lines: string[], top: string): ParsedModel {
  const gates = lines.map((line, i) => {
    const [name, type, ...inputs] = line.trim().split(/\s+/);
    return { name, type: type as 'AND' | 'OR', inputs, line: i + 1 };
  });
  return { events, gates, top };
}

const names = (cuts: string[][]): string[] => cuts.map((c) => [...c].sort().join('*'));

// ---- 场景 1：吸收律 ----
// TOP = G1 OR G2，G1=A OR B，G2=A AND B；{A,B} 是 {A}、{B} 的真超集，必须被吸收。
console.log('[scenario 1] absorption: A∨B∨(A∧B) => {A},{B}');
{
  const r = audit('A\nB\n', 'G1 OR A B\nG2 AND A B\nTOP OR G1 G2\n', 'TOP');
  check('状态为 complete', r.status === 'complete', r);
  if (r.status === 'complete') {
    check('最小割集恰为 {A},{B}', JSON.stringify(names(r.cutsets)) === JSON.stringify(['A', 'B']), names(r.cutsets));
  }
}

// ---- 场景 2：共享子门的事件归属 ----
// S 被 L、R 共享；T=(S∧A)∨(S∧B)。割集 {A},{B}，X 未接入任何门。
console.log('[scenario 2] shared sub-gate classification');
{
  const r = analyze(
    buildModel(
      ['A', 'B', 'X'],
      ['S OR A B', 'L AND S A', 'R AND S B', 'T OR L R'],
      'T'
    )
  );
  check('状态为 complete', r.status === 'complete', r);
  if (r.status === 'complete') {
    check('A=可选', r.classification.A === 'optional', r.classification);
    check('B=可选', r.classification.B === 'optional', r.classification);
    check('X=无关', r.classification.X === 'irrelevant', r.classification);
    check('割集为 {A},{B}', JSON.stringify(names(r.cutsets)) === JSON.stringify(['A', 'B']), names(r.cutsets));
    check('共享门 S 仅规范化一次（计数=2）', r.gateCounts.S === 2, r.gateCounts);
  }
}

// ---- 场景 3：complexity_limit ----
// 7 个三选一组相与 => 3^7 = 2187 > 2000；必须报告 complexity_limit 且不得产出完整结论。
console.log('[scenario 3] complexity_limit at 3^7=2187 > 2000');
{
  const events: string[] = [];
  const lines: string[] = [];
  for (let g = 0; g < 7; g += 1) {
    const members = [`e${g}_0`, `e${g}_1`, `e${g}_2`];
    events.push(...members);
    lines.push(`GRP${g} OR ${members.join(' ')}`);
  }
  lines.push('BIG AND GRP0 GRP1 GRP2 GRP3 GRP4 GRP5 GRP6');
  const r = analyze(buildModel(events, lines, 'BIG'));
  check('状态为 complexity_limit', r.status === 'complexity_limit', r);
  if (r.status === 'complexity_limit') {
    check('定位到超限门 BIG', r.gate === 'BIG', r);
    check('上限为 2000', r.limit === 2000, r);
    check('未输出任何割集（不冒充完整结论）', !('cutsets' in r), r);
  }
  // 边界：恰好 2000（4*5*10*10）必须完整
  const sizes = [4, 5, 10, 10];
  const ev2: string[] = [];
  const ln2: string[] = [];
  sizes.forEach((s, gi) => {
    const members = Array.from({ length: s }, (_, k) => `h${gi}_${k}`);
    ev2.push(...members);
    ln2.push(`GRP${gi} OR ${members.join(' ')}`);
  });
  ln2.push('BIG AND GRP0 GRP1 GRP2 GRP3');
  const r2 = analyze(buildModel(ev2, ln2, 'BIG'));
  check('恰好 2000 时完整输出 2000 个割集', r2.status === 'complete' && r2.cutsets.length === 2000, r2.status);
}

if (failures > 0) {
  console.error(`\nVERIFY SCENARIOS FAILED: ${failures}`);
  process.exit(1);
}
console.log('\nALL VERIFY SCENARIOS PASSED');
