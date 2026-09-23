import { analyze } from './engine';
import { parseModel } from './parser';
import type { Analysis } from './types';
import { validate } from './validate';

/** 总入口：解析 → 结构校验（缺失引用/自引用/环）→ 精确割集分析。 */
export function audit(eventsText: string, gatesText: string, topText: string): Analysis {
  const { model, issues: parseIssues } = parseModel(eventsText, gatesText, topText);
  // 即使存在解析问题，也基于已成功解析的部分继续做结构诊断，
  // 从而一次性定位尽可能多的问题；非法原文仍保留在编辑器中。
  const structuralIssues = validate(model);
  const allIssues = [...parseIssues, ...structuralIssues].sort((a, b) => {
    const areaOrder = { events: 0, gates: 1, top: 2 } as const;
    if (areaOrder[a.location.area] !== areaOrder[b.location.area]) {
      return areaOrder[a.location.area] - areaOrder[b.location.area];
    }
    return (a.location.line ?? 0) - (b.location.line ?? 0);
  });
  if (allIssues.length > 0) {
    return { status: 'invalid', issues: allIssues };
  }
  return analyze(model);
}
