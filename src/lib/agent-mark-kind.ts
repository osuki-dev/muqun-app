/** Agent kinds this build ships brand art for. Anything else gets the generic glyph. */
export type AgentMarkKind = 'opencode' | 'deepseek' | 't3' | 'codex' | 'pi' | 'fx' | 'qoder';

const MARK_KINDS: ReadonlySet<string> = new Set<AgentMarkKind>([
  'opencode',
  'deepseek',
  't3',
  'codex',
  'pi',
  'fx',
  'qoder',
]);

export function agentMarkKind(kind: string): AgentMarkKind | null {
  if (kind === 'qodercli' || kind === 'qoder-cli') return 'qoder';
  return MARK_KINDS.has(kind) ? (kind as AgentMarkKind) : null;
}
