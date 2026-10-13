import type { ToolPart } from './agent-protocol';
import { asRecord } from './record';

/** Require qualified identity; another server's tasks.complete is real work. */
function isInternalCall(name: string, input: unknown): boolean {
  if (/^(?:mcp__muqun__|muqun__|muqun_|muqun\.)\S+$/u.test(name)) return true;
  // Code Mode's built-in discovery call has no server-qualified tool name.
  // Its structured namespace is authoritative; query text is not.
  if (name === 'search' && asRecord(input)?.namespace === 'muqun') return true;
  return (
    /^(?:opencode\.)?list_mcp_(?:resources|resource_templates)$/u.test(name) &&
    asRecord(input)?.server === 'muqun'
  );
}

/**
 * Accept data literals only. Quoting object keys and plain single-quoted
 * strings makes the common Code Mode spelling JSON without evaluating JS.
 * Expressions, spreads, comments, templates and escaped single-quoted strings
 * still fail JSON parsing and keep the wrapper visible.
 */
function literalInput(source: string): unknown {
  const json = source.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|,\s*(?=[}\]])/gu,
    (token: string, offset: number) => {
      if (token.startsWith(',')) return '';
      if (token.startsWith('"')) return token;
      if (token.startsWith("'"))
        return token.includes('\\') ? token : JSON.stringify(token.slice(1, -1));
      return /^\s*:/u.test(source.slice(offset + token.length)) ? JSON.stringify(token) : token;
    }
  );
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Internal identity is independent of progress or failure state. */
export function isHiddenMuqunExecuteCall(value: unknown): boolean {
  if (typeof value === 'string') return isInternalCall(value, undefined);
  const call = asRecord(value);
  return !!(
    call &&
    typeof call.tool === 'string' &&
    !call.background &&
    !call.child_session_id &&
    isInternalCall(call.tool, call.input)
  );
}

/**
 * Recognize just one literal call, never execute code or infer its purpose from
 * a substring. Literal discovery arguments are enough to identify the
 * namespace; variables, expressions, comments and extra statements
 * stay visible even when their recorded children happen to be internal.
 */
function isSingleInternalCall(code: unknown): boolean {
  if (typeof code !== 'string' || code.length > 16_384) return false;
  const match =
    /^\s*(?:return[ \t]+)?(?:await\s+)?(?:tools\.)?([\w.]+)\s*\(([\s\S]*)\)\s*;?\s*$/u.exec(code);
  if (!match) return false;
  const [, name, argument] = match;
  const input = literalInput(argument);
  return input !== undefined && isInternalCall(name, input);
}

/** Display-only counterpart to the Gateway's internal Muqun tool policy. */
export function isHiddenMuqunTool(part: ToolPart): boolean {
  // Keep actionable process/session entry points, not ordinary internal logs.
  // Approval and question parts use their own presentation path.
  if (part.background || part.child_session_id) return false;
  if (isInternalCall(part.name, part.input)) return true;
  if (part.name !== 'execute' || !isSingleInternalCall(asRecord(part.input)?.code)) return false;
  // Children alone cannot prove the whole execution was internal: code can
  // also print useful output or perform work outside the tool bridge.
  const calls = part.metadata.toolCalls ?? part.metadata.tool_calls;
  // The literal code already proves identity before child progress arrives.
  // Once present, contradictory or unknown children keep the wrapper visible.
  return calls === undefined || (Array.isArray(calls) && calls.every(isHiddenMuqunExecuteCall));
}
