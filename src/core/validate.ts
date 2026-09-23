import type { Issue, ParsedModel } from './types';

/**
 * 结构性校验：
 * - 门名不得与基本事件冲突
 * - 顶事件必须引用一个已定义的门
 * - 门输入必须解析到基本事件或门（缺失引用）
 * - 自引用单独定位
 * - 门间引用不得含环（Tarjan SCC，支持任意长度的环）
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
 * Tarjan 强连通分量（有向）。门数量上限 80，递归安全。
 * 彼此独立的环属于不同 SCC，必须分别报告；每个非平凡 SCC 返回一条
 * 由真实引用组成且闭合的具体环路径（任意长度均可）。
 *
 * 注意不能用“忽略方向的连通块”近似 SCC：上游环单向引用下游环时
 * （A2 → B1），无向连通会把两个独立环合并成一个分量，漏报下游环。
 */
export function findCycles(adjacency: Map<string, string[]>): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const onStack = new Set<string>();
  const tarjanStack: string[] = [];
  const components: Set<string>[] = [];

  const strongConnect = (v: string): void => {
    indices.set(v, nextIndex);
    lowlinks.set(v, nextIndex);
    nextIndex += 1;
    tarjanStack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      // 仅门节点参与环搜索；缺失引用对应的目标不在邻接表中。
      if (!adjacency.has(w)) continue;
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v)!, lowlinks.get(w)!));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v)!, indices.get(w)!));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const component = new Set<string>();
      let w: string;
      do {
        w = tarjanStack.pop()!;
        onStack.delete(w);
        component.add(w);
      } while (w !== v);
      // 多节点 SCC 必含有向环；单节点仅在存在自环时成环
      // （validate 流程中自环由 self_reference 另行报告，不进入邻接表）。
      if (component.size > 1 || adjacency.get(v)!.includes(v)) {
        components.push(component);
      }
    }
  };

  for (const v of adjacency.keys()) {
    if (!indices.has(v)) strongConnect(v);
  }

  return components
    .map((component) => cycleInComponent(component, adjacency))
    .sort((a, b) => a.join('~').localeCompare(b.join('~')));
}

/**
 * 在一个非平凡 SCC 的受限子图中找一条经过字典序最小节点、由真实边
 * 组成且闭合的具体环。SCC 保证该节点必在某条环上；用 BFS 求回到起点
 * 的最短路径（邻居按字典序展开，结果确定且与门定义顺序无关）。
 */
function cycleInComponent(nodes: Set<string>, adjacency: Map<string, string[]>): string[] {
  const start = [...nodes].sort()[0];
  if (nodes.size === 1) return [start];

  const predecessor = new Map<string, string>();
  const frontier: string[] = [];
  // 初始化起点的一层后继（排除起点自身的自环），保证环长度 ≥ 2。
  for (const w of (adjacency.get(start) ?? []).filter((n) => nodes.has(n) && n !== start).sort()) {
    if (!predecessor.has(w)) {
      predecessor.set(w, start);
      frontier.push(w);
    }
  }

  let cursor = 0;
  while (cursor < frontier.length) {
    const v = frontier[cursor];
    cursor += 1;
    const neighbors = (adjacency.get(v) ?? []).filter((n) => nodes.has(n)).sort();
    if (neighbors.includes(start)) {
      // 回到起点的闭合边已确认；返回不含重复起点的节点序列，
      // 由调用方在消息中补 “→ 起点” 形成闭合见证。
      const path = [start];
      const reversed: string[] = [v];
      let node = v;
      while (node !== start) {
        node = predecessor.get(node)!;
        if (node !== start) reversed.push(node);
      }
      path.push(...reversed.reverse());
      return path;
    }
    for (const w of neighbors) {
      if (!predecessor.has(w)) {
        predecessor.set(w, v);
        frontier.push(w);
      }
    }
  }
  // 非平凡 SCC 数学上必含回到起点的环，不可达仅可能是构图错误。
  return [start];
}
