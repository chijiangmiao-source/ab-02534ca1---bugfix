import type { Gate, Issue, ParseResult } from './types';

export const MIN_EVENTS = 2;
export const MAX_EVENTS = 30;
export const MIN_GATES = 1;
export const MAX_GATES = 80;

// 唯一 ASCII 标识：字母/下划线开头，后接字母数字下划线；'#' 起始为注释。
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidIdentifier(token: string): boolean {
  return IDENTIFIER.test(token);
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  return hash >= 0 ? line.slice(0, hash) : line;
}

/**
 * 解析基本事件文本：每行一个标识，空行/注释允许。
 * 保留非法行与重复行用于错误定位，不抛异常。
 */
export function parseEvents(text: string): { events: string[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  const events: string[] = [];

  text.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const token = stripComment(raw).trim();
    if (!token) return;

    if (!isValidIdentifier(token)) {
      issues.push({
        code: 'bad_identifier',
        message: `“${raw.trim()}” 不是合法 ASCII 标识（字母/下划线开头，仅含字母数字下划线）`,
        location: { area: 'events', line: lineNo, token: raw.trim() }
      });
      return;
    }
    if (seen.has(token)) {
      issues.push({
        code: 'duplicate_event',
        message: `基本事件 ${token} 重复定义（首次出现于第 ${seen.get(token)} 行）`,
        location: { area: 'events', line: lineNo, token }
      });
      return;
    }
    seen.set(token, lineNo);
    events.push(token);
  });

  if (issues.length === 0 && (events.length < MIN_EVENTS || events.length > MAX_EVENTS)) {
    issues.push({
      code: 'event_count',
      message: `基本事件数量须为 ${MIN_EVENTS}–${MAX_EVENTS}，当前为 ${events.length}`,
      location: { area: 'events' }
    });
  }
  return { events, issues };
}

/**
 * 解析门定义文本：每行 `名称 类型 输入1 输入2 ...`，以空白分隔，支持注释。
 * 即使部分行非法也继续解析其余行，以便一次报告尽可能多的问题。
 */
export function parseGates(text: string): { gates: Gate[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const gates: Gate[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, idx) => {
    const lineNo = idx + 1;
    const line = stripComment(raw).trim();
    if (!line) return;

    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      issues.push({
        code: 'malformed_gate_line',
        message: `门定义格式应为 “名称 AND|OR 输入...”，第 ${lineNo} 行字段不足`,
        location: { area: 'gates', line: lineNo, token: raw.trim() }
      });
      return;
    }

    const [name, typeToken, ...inputs] = parts;
    if (!isValidIdentifier(name)) {
      issues.push({
        code: 'bad_identifier',
        message: `门名称 “${name}” 不是合法 ASCII 标识`,
        location: { area: 'gates', line: lineNo, token: name }
      });
      return;
    }
    if (typeToken !== 'AND' && typeToken !== 'OR') {
      issues.push({
        code: 'unknown_gate_type',
        message: `门 ${name} 的类型 “${typeToken}” 非法，仅允许 AND 或 OR`,
        location: { area: 'gates', line: lineNo, token: typeToken }
      });
      return;
    }

    const badInput = inputs.find((t) => !isValidIdentifier(t));
    if (badInput) {
      issues.push({
        code: 'bad_identifier',
        message: `门 ${name} 的输入 “${badInput}” 不是合法 ASCII 标识`,
        location: { area: 'gates', line: lineNo, token: badInput }
      });
      return;
    }
    if (inputs.length === 0) {
      // 语法上 parts.length>=3 时不会发生，保留防御分支。
      issues.push({
        code: 'empty_inputs',
        message: `门 ${name} 至少需要一个输入`,
        location: { area: 'gates', line: lineNo, token: name }
      });
      return;
    }

    if (seen.has(name)) {
      issues.push({
        code: 'duplicate_gate',
        message: `门 ${name} 重复定义（首次出现于第 ${seen.get(name)} 行）`,
        location: { area: 'gates', line: lineNo, token: name }
      });
      return;
    }
    seen.set(name, lineNo);
    gates.push({ name, type: typeToken, inputs, line: lineNo });
  });

  if (issues.length === 0 && (gates.length < MIN_GATES || gates.length > MAX_GATES)) {
    issues.push({
      code: 'gate_count',
      message: `门数量须为 ${MIN_GATES}–${MAX_GATES}，当前为 ${gates.length}`,
      location: { area: 'gates' }
    });
  }
  return { gates, issues };
}

export function parseTop(text: string): { top: string; issues: Issue[] } {
  const issues: Issue[] = [];
  const token = stripComment(text).trim();
  if (!token) {
    issues.push({
      code: 'top_invalid',
      message: '必须指定一个顶事件（门名称）',
      location: { area: 'top' }
    });
  } else if (token.split(/\s+/).length > 1 || !isValidIdentifier(token)) {
    issues.push({
      code: 'top_invalid',
      message: `顶事件必须是单个合法 ASCII 标识，当前为 “${token}”`,
      location: { area: 'top', token }
    });
  }
  return { top: token, issues };
}

export function parseModel(eventsText: string, gatesText: string, topText: string): ParseResult {
  const { events, issues: eIssues } = parseEvents(eventsText);
  const { gates, issues: gIssues } = parseGates(gatesText);
  const { top, issues: tIssues } = parseTop(topText);
  return { model: { events, gates, top }, issues: [...eIssues, ...gIssues, ...tIssues] };
}
