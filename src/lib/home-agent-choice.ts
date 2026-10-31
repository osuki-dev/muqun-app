/**
 * Which agent Home's dock starts work with on a computer: the reader's own
 * choice, per computer, or -- with nothing chosen -- the first agent that
 * computer says is ready.
 *
 * Two kinds of agent can be chosen. A session agent (OpenCode, DeepSeek, T3, Codex:
 * the gateway's agent plane, from discovery) gets an agent session, as Home
 * always did. A terminal agent (Codex, Claude Code: a CLI the gateway finds on
 * `PATH`, from `GET /api/agents/catalog`) is started in a pane with the goal
 * as its first prompt -- the Quick actions "New task" path.
 *
 * Pure, so the rule is pinned by Bun tests.
 */

import type { HomeAgentEntry, MirroredServerDiscovery } from '@/lib/agent-discovery';
import type { AgentProfile } from '@/lib/agent-spawn';
import { agentBrandName } from '@/lib/herdr-entity';
import {
  launchAgentCaption,
  partitionLaunchAgents,
  type LaunchAgentCaption,
} from '@/lib/home-launch-model';

export type HomeAgentOption =
  | {
      /** `session:<agentId>`; the stored choice. */
      key: string;
      kind: 'session';
      /** Absent on the fallback for a gateway that never listed its agents. */
      agentId?: string;
      agentKind: string;
      name: string;
      ready: boolean;
      caption: LaunchAgentCaption;
      /** Listed under "More agents" (`agentPickerPlacement`). */
      more?: boolean;
      /** Hidden by the reader on the host; More offers Show. */
      hidden?: boolean;
    }
  | {
      /** `terminal:<kind>`. */
      key: string;
      kind: 'terminal';
      /** What `agents/spawn` takes as `agent`. */
      agentKind: string;
      name: string;
      ready: boolean;
      /**
       * False until the computer's catalog confirms availability: the stored
       * choice is shown by name, and Send rechecks before starting.
       */
      confirmed: boolean;
    };

/** The agent an old gateway (no agent plane) has. */
const FALLBACK: HomeAgentOption = {
  key: 'session:opencode',
  kind: 'session',
  agentKind: 'opencode',
  name: 'OpenCode',
  ready: true,
  caption: 'new-session',
};

/** Listed first among a computer's terminal agents. */
const PREFERRED_TERMINAL_KINDS = ['codex', 'claude'];

export function sessionAgentKey(agentId: string): string {
  return `session:${agentId}`;
}

export function terminalAgentKey(kind: string): string {
  return `terminal:${kind}`;
}

function sessionOption(agent: HomeAgentEntry, more: boolean): HomeAgentOption {
  return {
    key: sessionAgentKey(agent.id),
    kind: 'session',
    agentId: agent.id,
    agentKind: agent.kind,
    name: agent.name,
    ready: agent.readiness === 'ready',
    caption: launchAgentCaption(agent),
    ...(more ? { more: true } : {}),
    ...(agent.visibility === 'hidden' ? { hidden: true } : {}),
  };
}

/**
 * Everything the computer offers, in its own order: the session agents of the
 * default group, then the terminal agents its catalog found installed, then the
 * session agents under "More agents". A terminal kind can also have a session
 * adapter: these are separate destinations, so neither discovery nor hiding the
 * session form removes an installed terminal choice.
 */
export function homeAgentOptions(
  discovery: MirroredServerDiscovery | null | undefined,
  terminal: readonly AgentProfile[] | null | undefined
): HomeAgentOption[] {
  const { offered, more } = partitionLaunchAgents(discovery);
  const sessions: HomeAgentOption[] = discovery?.agents?.agents
    ? offered.map((agent) => sessionOption(agent, false))
    : [FALLBACK];
  const terminals: HomeAgentOption[] = [];
  for (const profile of terminal ?? []) {
    const kind = profile.kind.trim();
    if (!kind || !profile.available) continue;
    terminals.push({
      key: terminalAgentKey(kind),
      kind: 'terminal',
      agentKind: kind,
      name: agentBrandName(kind),
      ready: true,
      confirmed: true,
    });
  }
  // A session provider whose ledger can also carry its goal into a terminal
  // pane is offered in both forms, so the delivery is the reader's pick and
  // never an app rule; the computer's own terminal launcher for that kind,
  // when it has one, is the terminal entry already. Hiding the session form
  // leaves the terminal form where it was; switching the agent off does not.
  for (const agent of [...offered, ...more]) {
    if (agent.readiness === 'unsupported' || !agent.ledgerDelivery?.includes('pane')) continue;
    const key = terminalAgentKey(agent.kind);
    if (terminals.some((entry) => entry.key === key)) continue;
    terminals.push({
      key,
      kind: 'terminal',
      agentKind: agent.kind,
      name: agent.name,
      ready: agent.readiness === 'ready',
      confirmed: true,
    });
  }
  // The two coding agents people pick first, then the rest in catalog order.
  const rank = (option: HomeAgentOption) => {
    const at = PREFERRED_TERMINAL_KINDS.indexOf(option.agentKind.toLowerCase());
    return at < 0 ? PREFERRED_TERMINAL_KINDS.length : at;
  };
  terminals.sort((a, b) => rank(a) - rank(b));
  return [...sessions, ...terminals, ...more.map((agent) => sessionOption(agent, true))];
}

/** Only duplicate provider names need a terminal suffix in the chooser and dock. */
export function homeAgentNeedsTerminalLabel(
  option: HomeAgentOption | null,
  options: readonly HomeAgentOption[]
): boolean {
  return Boolean(
    option?.kind === 'terminal' &&
    options.some((entry) => entry.kind === 'session' && entry.agentKind === option.agentKind)
  );
}

/**
 * The agent Send uses: the stored choice while the computer still offers it;
 * an unavailable terminal choice stays selected and must be rechecked before
 * sending. With no choice, use the first ready agent of the default group, then
 * its first agent, and only then anything under More.
 */
export function resolveHomeAgent(
  options: readonly HomeAgentOption[],
  chosenKey: string | undefined,
  /** Whether the computer's terminal catalog has been read this launch. */
  terminalCatalogKnown = true
): HomeAgentOption | null {
  if (chosenKey) {
    const chosen = options.find((option) => option.key === chosenKey);
    if (chosen) return chosen;
    // A missing terminal entry stays the reader's choice. Send rechecks the
    // catalog instead of silently dispatching to a different provider or plane.
    const kind = chosenKey.startsWith('terminal:') ? chosenKey.slice(9) : '';
    if (kind) {
      return {
        key: chosenKey,
        kind: 'terminal',
        agentKind: kind,
        name: agentBrandName(kind),
        ready: !terminalCatalogKnown,
        confirmed: false,
      };
    }
  }
  const listed = options.filter((option) => option.kind === 'terminal' || !option.more);
  return listed.find((option) => option.ready) ?? listed[0] ?? options[0] ?? null;
}

/** Stored as `{ [serverId]: key }`; anything else in storage is dropped. */
export function parseHomeAgentChoices(value: string | null | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [serverId, key] of Object.entries(parsed)) {
      if (typeof key === 'string' && /^(session|terminal):.+/.test(key)) out[serverId] = key;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * How long a failed terminal-catalog read waits before asking again while
 * someone is looking: 15 s, doubling to a 60 s ceiling.
 */
export function catalogRetryDelay(failures: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, failures - 1), 60_000);
}
