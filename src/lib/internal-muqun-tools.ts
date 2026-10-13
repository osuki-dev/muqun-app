import type { ToolPart } from './agent-protocol';
import { asRecord } from './record';

/** Server-qualified names only; another server's tasks.complete is real work. */
function isInternalCall(name: string, input: unknown): boolean {
  if (/^(?:mcp__muqun__|muqun__|muqun_|muqun\.)\S+$/u.test(name)) return true;
  return (
    /^(?:opencode\.)?list_mcp_(?:resources|resource_templates)$/u.test(name) &&
    asRecord(input)?.server === 'muqun'
  );
}

/** Keep failures and unknown/in-flight states, including MCP error results. */
export function isHiddenMuqunExecuteCall(value: unknown): boolean {
  const call = asRecord(value);
  return !!(
    call &&
    typeof call.tool === 'string' &&
    call.status === 'completed' &&
    !call.error &&
    asRecord(call.output)?.isError !== true &&
    asRecord(call.result)?.isError !== true &&
    isInternalCall(call.tool, call.input)
  );
}

/**
 * Recognize just one literal call, never execute code or infer its purpose from
 * a substring. JSON arguments and the common {server: "muqun"} spelling are
 * enough for discovery; variables, expressions, comments and extra statements
 * stay visible even when their recorded children happen to be internal.
 */
function isSingleInternalCall(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  const match = /^\s*(?:return[ \t]+)?(?:await\s+)?tools\.([\w.]+)\s*\(([\s\S]*)\)\s*;?\s*$/u.exec(
    code
  );
  if (!match) return false;
  const [, name, argument] = match;
  if (
    /^\s*\{\s*(?:server|"server"|'server')\s*:\s*(?:"muqun"|'muqun')\s*,?\s*\}\s*$/u.test(argument)
  )
    return isInternalCall(name, { server: 'muqun' });
  try {
    return isInternalCall(name, JSON.parse(argument));
  } catch {
    return false;
  }
}

/** Display-only counterpart to the Gateway's internal Muqun tool policy. */
export function isHiddenMuqunTool(part: ToolPart): boolean {
  if (
    part.state !== 'completed' ||
    part.error ||
    part.metadata.error ||
    part.background ||
    part.child_session_id ||
    part.truncated ||
    asRecord(part.output)?.isError === true
  )
    return false;
  if (isInternalCall(part.name, part.input)) return true;
  if (part.name !== 'execute' || !isSingleInternalCall(asRecord(part.input)?.code)) return false;
  // Children alone cannot prove the whole execution was internal: code can
  // also print useful output or perform work outside the tool bridge.
  const calls = part.metadata.toolCalls ?? part.metadata.tool_calls;
  return Array.isArray(calls) && calls.length > 0 && calls.every(isHiddenMuqunExecuteCall);
}
