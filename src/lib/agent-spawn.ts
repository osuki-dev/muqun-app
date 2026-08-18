/**
 * Starting an agent from the phone, and stopping one that is running.
 *
 * Until now the app could only talk to an agent someone had already started at
 * a desk. The gateway grew three endpoints that close that gap, and this module
 * is everything about them that is not transport:
 *
 * - `POST /api/sessions/{id}/agents/spawn` -- `{agent, cwd?, tab_id?, prompt?}`
 *   in, the new pane out.
 * - `GET /api/sessions/{id}/recent-cwds` -- the directories this session has
 *   actually worked in, so the common case is a tap rather than typing a path
 *   on a phone keyboard.
 * - `POST /api/sessions/{id}/agents/{target}/interrupt` -- stop what this one
 *   is doing.
 *
 * Three rules shape the whole thing:
 *
 * 1. **A gateway that cannot do this is never asked.** Spawning arrived behind
 *    the `agent_spawn` capability. Against anything older the New Task entries
 *    do not render at all -- no greyed row, no error, nothing to explain. That
 *    is the same silent degradation approvals and parts already get.
 * 2. **The agent is the gateway's word, not ours.** The catalog names the
 *    kinds this host will accept; the app sends one back verbatim. It never
 *    invents a kind, and `available: false` is drawn as a hint rather than
 *    obeyed as a veto, because Herdr can still resolve a kind the gateway could
 *    not find on `PATH`.
 * 3. **A refusal is shown, not swallowed.** An unknown agent or an unreachable
 *    directory is a 4xx whose message is the only thing that tells the user
 *    which of the three fields was wrong.
 *
 * Kept free of React and of transport so the parsing, the gate and the field
 * rules are pure functions of one JSON envelope.
 */

/** The gateway capability that gates every part of this feature. */
export const AGENT_SPAWN_CAPABILITY = 'agent_spawn';

/**
 * A gateway that predates spawning never gets asked to spawn. The capability
 * list is the gateway's own answer; guessing from a version string would make
 * every future build a special case.
 */
/**
 * Held back from 1.2.0 (Ellen, 2026-07-29). The feature works -- the last
 * defect in it, a path both halves spelled differently, was found and fixed
 * the night before submission -- but a store debut is the wrong place to
 * discover the next one. Flip this to restore every entry point at once: the
 * sheet, the quick-actions row, the home menu and the Stop control are all
 * gated on the capability answer below.
 */
export const AGENT_SPAWN_SHIPPED = false;

export function gatewaySupportsAgentSpawn(capabilities: string[] | undefined | null): boolean {
  if (!AGENT_SPAWN_SHIPPED) return false;
  return Array.isArray(capabilities) && capabilities.includes(AGENT_SPAWN_CAPABILITY);
}

/** One agent kind this host will accept as the `agent` field of a spawn. */
export interface AgentProfile {
  /** What to send back as `agent`. The gateway's own word for this agent. */
  kind: string;
  /** The executable it looks for on `PATH`. Equal to `kind` unless remapped. */
  command: string;
  /**
   * Whether that executable was found. Drawn as a hint and never as a veto:
   * Herdr resolves a kind to its canonical executable itself, so a profile the
   * gateway could not see on `PATH` may still start.
   */
  available: boolean;
}

/** What a spawn answers with: the pane the new agent is living in. */
export interface SpawnedAgent {
  paneId: string;
  /** Absent from an answer that only names the pane. */
  tabId: string | null;
  workspaceId: string | null;
}

/** What a spawn asks for. `agent` is the only required field. */
export interface AgentSpawnRequest {
  agent: string;
  cwd?: string;
  tab_id?: string;
  prompt?: string;
}

/**
 * The agent catalog, as `GET /api/agents/catalog` answers it.
 *
 * Anything unrecognisable is dropped rather than guessed at: a picker with a
 * blank row in it offers a choice that cannot be made. A kind is the one field
 * with no fallback, since it is what the spawn sends back.
 */
export function agentProfilesFromResponse(value: unknown): AgentProfile[] {
  const entries = arrayField(value, 'agents') ?? arrayField(value, 'items');
  if (!entries) return [];

  const profiles: AgentProfile[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const kind = stringField(raw.kind) ?? stringField(raw.agent) ?? stringField(raw.id);
    if (!kind || seen.has(kind)) continue;
    seen.add(kind);
    profiles.push({
      kind,
      command: stringField(raw.command) ?? kind,
      // Absent means "the gateway did not probe", which is not the same as "not
      // there". Only an explicit `false` dims a row.
      available: raw.available === undefined ? true : raw.available === true,
    });
  }
  return profiles;
}

/**
 * The directories this session has worked in, newest first.
 *
 * Deduplicated and trimmed here rather than trusted, because these become the
 * one-tap answers to the field most likely to be typed wrong.
 */
export function recentCwdsFromResponse(value: unknown): string[] {
  const entries = arrayField(value, 'cwds') ?? arrayField(value, 'items');
  if (!entries) return [];

  const cwds: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const path =
      typeof entry === 'string'
        ? normalizeCwd(entry)
        : normalizeCwd(stringField((entry as Record<string, unknown>)?.cwd) ?? '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    cwds.push(path);
  }
  return cwds;
}

/**
 * The pane a spawn made.
 *
 * Null for an answer that does not name one -- which the caller must treat as a
 * failure and say so, because navigating to an empty pane id clears the
 * terminal instead of opening anything. The same shapes `createdPaneTarget`
 * accepts are accepted here: the id may sit at the root, under `result`, or on
 * a nested pane object.
 */
export function spawnedAgentFromResponse(value: unknown): SpawnedAgent | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, unknown>;
  const result = objectField(envelope.result) ?? objectField(envelope.data) ?? envelope;
  const pane = objectField(result.pane) ?? objectField(result.root_pane) ?? result;

  const paneId = stringField(pane.pane_id) ?? stringField(result.pane_id);
  if (!paneId) return null;

  return {
    paneId,
    tabId: stringField(pane.tab_id) ?? stringField(result.tab_id) ?? null,
    workspaceId: stringField(pane.workspace_id) ?? stringField(result.workspace_id) ?? null,
  };
}

/**
 * Whether a pane's agent is doing something an interrupt would stop.
 *
 * Only `working`. An agent that is blocked is waiting for an answer, not
 * running, and offering to stop it there would compete with the approval banner
 * for the same tap; an idle or finished one has nothing to interrupt.
 */
export function agentIsInterruptible(status: string | undefined | null): boolean {
  return status === 'working';
}

/**
 * One typed or tapped directory, as the request should carry it.
 *
 * Whitespace only -- no expansion, no resolution, no rejection of `~` or of a
 * relative path. Where a path may point is the gateway's judgement to make
 * against the workspaces it actually has open, and a phone that second-guessed
 * it would refuse paths that work and bless paths that do not.
 */
export function normalizeCwd(value: string): string {
  return value.trim();
}

/**
 * Whether these three fields make a spawn worth sending.
 *
 * Only the agent is required. An empty directory means "wherever the session
 * would have started it", and an empty prompt means "start it and leave it at
 * its own prompt" -- both are answers, so neither blocks Go.
 */
export function canSpawnAgent(request: { agent: string }): boolean {
  return request.agent.trim().length > 0;
}

/** Drops the optional fields nobody filled in, so the body says what it means. */
export function agentSpawnRequest(fields: {
  agent: string;
  cwd?: string;
  tabId?: string;
  prompt?: string;
}): AgentSpawnRequest {
  const cwd = normalizeCwd(fields.cwd ?? '');
  const prompt = fields.prompt?.trim() ?? '';
  return {
    agent: fields.agent.trim(),
    ...(cwd ? { cwd } : {}),
    ...(fields.tabId ? { tab_id: fields.tabId } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayField(value: unknown, key: string): unknown[] | null {
  if (Array.isArray(value)) return value;
  const container = objectField(value);
  if (!container) return null;
  const nested = container[key] ?? objectField(container.data)?.[key];
  return Array.isArray(nested) ? nested : null;
}
