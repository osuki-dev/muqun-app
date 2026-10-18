/**
 * Which agent Home's dock starts work with on a computer: the reader's own
 * choice, per computer, or -- with nothing chosen -- the first agent that
 * computer says is ready.
 *
 * Two kinds of agent can be chosen. A session agent (OpenCode, DeepSeek, T3:
 * the gateway's agent plane, from discovery) gets an agent session, as Home
 * always did. A terminal agent (Codex, Claude Code: a CLI the gateway finds on
 * `PATH`, from `GET /api/agents/catalog`) is started in a pane with the goal
 * as its first prompt -- the Quick actions "New task" path.
 *
 * Pure, so the rule is pinned by Bun tests.
 */

import type { MirroredServerDiscovery } from '@/lib/agent-discovery';
import type { AgentProfile } from '@/lib/agent-spawn';
import { agentBrandName } from '@/lib/herdr-entity';
import {
  launchAgentCaption,
  projectLaunchAgents,
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
       * False while the computer's catalog has not been read: the stored
       * choice is shown by name, and Send reads the catalog before starting.
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

/**
 * Everything the computer offers, in its own order: the session agents
 * discovery lists, then the terminal agents its catalog found installed. A
 * terminal kind that is also a session agent (OpenCode's TUI) is left out --
 * the session is the better way to drive it from a phone.
 */
export function homeAgentOptions(
  discovery: MirroredServerDiscovery | null | undefined,
  terminal: readonly AgentProfile[] | null | undefined
): HomeAgentOption[] {
  const listed = projectLaunchAgents(discovery);
  const sessions: HomeAgentOption[] = discovery?.agents?.agents
    ? listed.map((agent) => ({
        key: sessionAgentKey(agent.id),
        kind: 'session' as const,
        agentId: agent.id,
        agentKind: agent.kind,
        name: agent.name,
        ready: agent.readiness === 'ready',
        caption: launchAgentCaption(agent),
      }))
    : [FALLBACK];
  const sessionKinds = new Set(
    sessions.flatMap((option) => [
      option.agentKind.toLowerCase(),
      option.key.slice(8).toLowerCase(),
    ])
  );
  const terminals: HomeAgentOption[] = [];
  for (const profile of terminal ?? []) {
    const kind = profile.kind.trim();
    if (!kind || !profile.available || sessionKinds.has(kind.toLowerCase())) continue;
    terminals.push({
      key: terminalAgentKey(kind),
      kind: 'terminal',
      agentKind: kind,
      name: agentBrandName(kind),
      ready: true,
      confirmed: true,
    });
  }
  // The two coding agents people pick first, then the rest in catalog order.
  const rank = (option: HomeAgentOption) => {
    const at = PREFERRED_TERMINAL_KINDS.indexOf(option.agentKind.toLowerCase());
    return at < 0 ? PREFERRED_TERMINAL_KINDS.length : at;
  };
  terminals.sort((a, b) => rank(a) - rank(b));
  return [...sessions, ...terminals];
}

/**
 * The agent Send uses: the stored choice while the computer still offers it;
 * otherwise the first ready agent; otherwise the first listed one.
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
    // A terminal agent cannot be confirmed until the catalog is read; until
    // then it is still the reader's choice, never silently another agent.
    const kind = chosenKey.startsWith('terminal:') ? chosenKey.slice(9) : '';
    if (kind && !terminalCatalogKnown) {
      return {
        key: chosenKey,
        kind: 'terminal',
        agentKind: kind,
        name: agentBrandName(kind),
        ready: true,
        confirmed: false,
      };
    }
  }
  return options.find((option) => option.ready) ?? options[0] ?? null;
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
