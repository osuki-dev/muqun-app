/** Agent kinds this build ships brand art for. Anything else gets the generic glyph. */
export type AgentMarkKind = 'opencode' | 'deepseek' | 't3';

const MARK_KINDS: ReadonlySet<string> = new Set<AgentMarkKind>(['opencode', 'deepseek', 't3']);

export function agentMarkKind(kind: string): AgentMarkKind | null {
  return MARK_KINDS.has(kind) ? (kind as AgentMarkKind) : null;
}
