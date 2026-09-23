// 故障树核心数据模型 —— 全部为纯数据结构，计算仅发生在浏览器内。

export type GateType = 'AND' | 'OR';

export interface Gate {
  name: string;
  type: GateType;
  /** 输入标识（基本事件或其他门），保留重复值由分析阶段去重 */
  inputs: string[];
  /** 在门定义文本中的行号（1 起） */
  line: number;
}

export type Area = 'events' | 'gates' | 'top';

export interface IssueLocation {
  area: Area;
  /** 文本域内行号（1 起，top 无行号） */
  line?: number;
  /** 相关标识，便于定位 */
  token?: string;
}

export interface Issue {
  code:
    | 'bad_identifier'
    | 'duplicate_event'
    | 'event_count'
    | 'duplicate_gate'
    | 'gate_count'
    | 'malformed_gate_line'
    | 'unknown_gate_type'
    | 'empty_inputs'
    | 'name_collision'
    | 'missing_reference'
    | 'self_reference'
    | 'cycle'
    | 'top_invalid'
    | 'top_not_gate';
  message: string;
  location: IssueLocation;
}

export interface ParsedModel {
  events: string[];
  gates: Gate[];
  top: string;
}

export interface ParseResult {
  model: ParsedModel;
  issues: Issue[];
}

export type EventRole = 'mandatory' | 'optional' | 'irrelevant';

export interface CompleteAnalysis {
  status: 'complete';
  top: string;
  /** 顶事件最小割集，集合内与集合间均按事件标识排序 */
  cutsets: string[][];
  /** 基本事件归属：必现 / 可选 / 无关 */
  classification: Record<string, EventRole>;
  /** 每个门规范化后的割集数量（审计用） */
  gateCounts: Record<string, number>;
}

export interface LimitedAnalysis {
  status: 'complexity_limit';
  /** 首个越过限制的门 */
  gate: string;
  line: number;
  limit: number;
  /** 触发限制前已完成的门计数，仅供参考，严禁作为完整结论 */
  partialGateCounts: Record<string, number>;
}

export interface InvalidAnalysis {
  status: 'invalid';
  issues: Issue[];
}

export type Analysis = CompleteAnalysis | LimitedAnalysis | InvalidAnalysis;
