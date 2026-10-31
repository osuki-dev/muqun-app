import { asRecord } from './record';

export interface AgentSessionRuntime {
  source: 'native' | 'terminal' | 'unobserved';
  interaction: 'native' | 'terminal' | 'unavailable';
  transcript?: 'live' | 'persisted' | 'snapshot';
  status?: 'idle' | 'working' | 'blocked' | 'starting' | 'completed' | 'unknown';
  terminal?: { session_id: string; pane_id: string; instance_id: string };
  reason?: 'not_loaded' | 'ambiguous_terminal' | 'terminal_unavailable';
}

const SOURCES = ['native', 'terminal', 'unobserved'] as const;
const INTERACTIONS = ['native', 'terminal', 'unavailable'] as const;
const STATUSES = ['idle', 'working', 'blocked', 'starting', 'completed', 'unknown'] as const;
const REASONS = ['not_loaded', 'ambiguous_terminal', 'terminal_unavailable'] as const;

function member<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : undefined;
}

/** A present but malformed provenance record must never unlock native control. */
export function parseAgentSessionRuntime(value: unknown): AgentSessionRuntime | undefined {
  if (value === undefined) return undefined;
  const record = asRecord(value);
  const knownSource = member(record?.source, SOURCES);
  const source = knownSource ?? 'unobserved';
  let interaction = member(record?.interaction, INTERACTIONS) ?? 'unavailable';
  const status = member(record?.status, STATUSES);
  const transcript = member(record?.transcript, ['live', 'persisted', 'snapshot'] as const);
  const reason = member(record?.reason, REASONS);
  const rawTerminal = asRecord(record?.terminal);
  const terminal =
    typeof rawTerminal?.session_id === 'string' &&
    rawTerminal.session_id.trim() &&
    typeof rawTerminal.pane_id === 'string' &&
    rawTerminal.pane_id.trim() &&
    typeof rawTerminal.instance_id === 'string' &&
    rawTerminal.instance_id.trim()
      ? {
          session_id: rawTerminal.session_id,
          pane_id: rawTerminal.pane_id,
          instance_id: rawTerminal.instance_id,
        }
      : undefined;
  if (
    !knownSource ||
    (interaction === 'terminal' && (source !== 'terminal' || !terminal)) ||
    (interaction === 'native' && source === 'terminal')
  )
    interaction = 'unavailable';
  return {
    source,
    interaction,
    ...(status ? { status } : {}),
    ...(transcript ? { transcript } : {}),
    ...(terminal ? { terminal } : {}),
    ...(reason ? { reason } : {}),
  };
}

export function nativeAgentInteraction(runtime: AgentSessionRuntime | undefined): boolean {
  return runtime === undefined || runtime.interaction === 'native';
}

/**
 * A conversation held by a terminal whose agent takes prompts from here: the
 * gateway types them into that terminal (`terminalInput`, Claude Code today).
 * Other native controls stay with the terminal.
 */
export function terminalPromptInput(
  runtime: AgentSessionRuntime | undefined,
  features: { extra: Record<string, unknown> }
): boolean {
  return (
    runtime?.interaction === 'terminal' &&
    runtime.terminal !== undefined &&
    features.extra.terminalInput === true
  );
}

/** Manual history stays frozen; subscribed live or persisted events retain normal viewport policy. */
export function replaceAgentTranscript(
  mode: 'enter' | 'silent' | 'refresh',
  runtime: AgentSessionRuntime | undefined
): boolean {
  if (mode !== 'silent' || runtime === undefined) return true;
  if (runtime.transcript) return runtime.transcript !== 'snapshot';
  return runtime.source === 'native';
}

export function agentSnapshotRefreshQuery(
  explicit: boolean,
  capabilities: readonly string[] | undefined
): string {
  return explicit && capabilities?.includes('agent_session_refresh_v1') ? '?refresh=true' : '';
}

/** The navigation target must still be the exact observed process instance. */
export function matchesRuntimeTerminal(
  terminal: NonNullable<AgentSessionRuntime['terminal']>,
  agents: readonly unknown[]
): boolean {
  const candidates = agents.map(asRecord).filter((agent) => agent?.pane_id === terminal.pane_id);
  return (
    candidates.length === 1 &&
    candidates[0]?.instance_id === terminal.instance_id &&
    (candidates[0].session_id === undefined || candidates[0].session_id === terminal.session_id)
  );
}
