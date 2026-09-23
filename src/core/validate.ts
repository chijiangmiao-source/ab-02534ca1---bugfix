import type { Issue, ParsedModel } from './types';

/**
 * 结构性校验：
 * - 门名不得与基本事件冲突
 * - 顶事件必须引用一个已定义的门
 * - 门输入必须解析到基本事件或门（缺失引用）
 * - 自引用单独定位
 * - 门间引用不得含环（Tarjan 强连通分量，支持任意长度的环）
 * 彼此独立的多个环分别报告：即使一个闭环还单向引用另一个闭环（跨 SCC 的桥接
 * 边），两个环也必须各自给出一条闭合见证，门定义换序不影响检出与定位。
 * 返回的问题列表按定位区域/行号排序，非法输入原样保留在 UI 中。
 */
export function validate(model: ParsedModel): Issue[] {
  const issues: Issue[] = [];
  const eventSet = new Set(model.events);
  const gateByName = new Map<string, number>();
  model.gates.forEach((g, i) => gateByName.set(g.name, i));

  for (const g of model.gates) {
    if (eventSet.has(g.name)) {
      issues.push({
        code: 'name_collision',
        message: `门 ${g.name} 与基本事件同名，事件与门必须共享同一命名空间且唯一`,
        location: { area: 'gates', line: g.line, token: g.name }
      });
    }
  }

  if (model.top && !gateByName.has(model.top)) {
    issues.push({
      code: 'top_not_gate',
      message: `顶事件 ${model.top} 不是已定义的门`,
      location: { area: 'top', token: model.top }
    });
  }

  for (const g of model.gates) {
    const uniqueInputs = new Set<string>();
    for (const input of g.inputs) {
      uniqueInputs.add(input);
      if (input === g.name) {
        issues.push({
          code: 'self_reference',
          message: `门 ${g.name} 第 ${g.line} 行直接引用自身`,
          location: { area: 'gates', line: g.line, token: g.name }
        });
      } else if (!eventSet.has(input) && !gateByName.has(input)) {
        issues.push({
          code: 'missing_reference',
          message: `门 ${g.name} 引用的 “${input}” 既不是基本事件也不是已定义的门`,
          location: { area: 'gates', line: g.line, token: input }
        });
      }
    }
  }

  // 门级图：缺失目标不是门，自环由 self_reference 负责，二者都不进入环搜索。
  const adjacency = new Map<string, string[]>();
  for (const g of model.gates) {
    const next = g.inputs.filter((i) => i !== g.name && gateByName.has(i));
    adjacency.set(g.name, [...new Set(next)]);
  }

  for (const cycle of findCycles(adjacency)) {
    issues.push({
      code: 'cycle',
      message: `门引用存在环：${cycle.join(' → ')} → ${cycle[0]}（共享 DAG 不允许环路）`,
      location: { area: 'gates', line: gateLine(model, cycle[0]), token: cycle[0] }
    });
  }

  issues.sort((a, b) => {
    const areaOrder = { events: 0, gates: 1, top: 2 } as const;
    if (areaOrder[a.location.area] !== areaOrder[b.location.area]) {
      return areaOrder[a.location.area] - areaOrder[b.location.area];
    }
    return (a.location.line ?? 0) - (b.location.line ?? 0);
  });
  return issues;
}

function gateLine(model: ParsedModel, name: string): number | undefined {
  return model.gates.find((g) => g.name === name)?.line;
}

/**
 * Tarjan 强连通分量。门数量上限 80，递归安全。
 * 返回每个非平凡 SCC 内的一条具体环路径（用于定位，任意长度均可）。
 *
 * 不做“零入度/零出度剥叶”预剪枝：剥叶会删除跨 SCC 的桥接边（例如上游闭环
 * 单向引用下游闭环），导致尚未处理的独立闭环被一并消去。SCC 本身即可判环，
 * 无需也无法用剥叶替代。
 */
export function findCycles(adjacency: Map<string, string[]>): string[][] {
  const indexOf = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const strongConnect = (root: string): void => {
    indexOf.set(root, nextIndex);
    lowlink.set(root, nextIndex);
    nextIndex += 1;
    stack.push(root);
    onStack.add(root);

    for (const target of adjacency.get(root) ?? []) {
      if (!indexOf.has(target)) {
        strongConnect(target);
        lowlink.set(root, Math.min(lowlink.get(root)!, lowlink.get(target)!));
      } else if (onStack.has(target)) {
        lowlink.set(root, Math.min(lowlink.get(root)!, indexOf.get(target)!));
      }
    }

    if (lowlink.get(root) === indexOf.get(root)) {
      const component: string[] = [];
      let member = '';
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== root);
      // 自环（大小为 1 且引用自身）由 self_reference 单独负责，不在此报告。
      if (component.length > 1) components.push(component);
    }
  };

  for (const name of [...adjacency.keys()].sort()) {
    if (!indexOf.has(name)) strongConnect(name);
  }

  return components
    .map((component) => cycleInComponent(new Set(component), adjacency))
    .sort((a, b) => a.join('~').localeCompare(b.join('~')));
}

/**
 * 在一个非平凡 SCC 的受限子图中走出一条具体环。
 * 沿确定性最小的出边前进，首次重访即闭合——SCC 内任意节点都能回到自身，
 * 因此必然在有限步内闭合，且见证完全由真实引用边组成。
 */
function cycleInComponent(nodes: Set<string>, adjacency: Map<string, string[]>): string[] {
  const start = [...nodes].sort()[0];
  const path: string[] = [];
  const pos = new Map<string, number>();
  let current = start;

  while (!pos.has(current)) {
    pos.set(current, path.length);
    path.push(current);
    const next = (adjacency.get(current) ?? []).filter((n) => nodes.has(n)).sort()[0];
    if (next === undefined) return path; // 非平凡 SCC 不会触发，防御性返回
    current = next;
  }
  return path.slice(pos.get(current)!);
}
