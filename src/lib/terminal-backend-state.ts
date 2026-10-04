import type { TerminalDiscovery } from '@/lib/agent-protocol';
import type { SessionsResponse } from '@/lib/gateway-client';
import { explainDisconnected } from '@/lib/herdr-compatibility';

/** One terminal backend the gateway is configured with, and whether it answers. */
export interface TerminalBackendRow {
  sessionId: string;
  label: string;
  /** `tmux`, `herdr`, ... An absent `backend` on a session means Herdr. */
  kind: string;
  connected: boolean;
}

/**
 * Whether the terminal plane has anything to draw.
 *
 *  * `pending`: nothing has been read yet; the loader is right.
 *  * `ready`: there are panes, or a reachable backend that will hold them.
 *  * `down`: the gateway answered, but no backend it is configured with is
 *    running -- a tmux with no server, a Herdr that is not started. A pane
 *    will never arrive on its own, so a loader would spin forever.
 *
 * The agents plane is independent of this: a `down` terminal plane says
 * nothing about whether agent sessions can be used.
 */
export type TerminalBackendState =
  | { kind: 'pending' }
  | { kind: 'ready' }
  | {
      kind: 'down';
      backends: TerminalBackendRow[];
      message: string;
      /** The backend that is down (`tmux`, `herdr`, ...), which decides the hint. */
      backend: string;
    };

type Session = NonNullable<SessionsResponse['sessions']>[number];

/**
 * The backends as `/api/sessions` lists them, with liveness from the same
 * answer. That answer is the gateway's own probe of the backend's server
 * (tmux's `list-sessions`), which discovery's `connected` is not: discovery
 * can say tmux is connected because the program runs while no tmux server
 * exists. A session that does not say falls back to discovery.
 */
export function terminalBackendRows(
  sessions: readonly Session[] | undefined,
  plane: TerminalDiscovery | null | undefined
): TerminalBackendRow[] {
  const discovered = plane?.backends ?? [];
  if (!sessions?.length) {
    return discovered.map(({ sessionId, label, kind, connected }) => ({
      sessionId,
      label,
      kind: kind || 'herdr',
      connected,
    }));
  }
  return sessions.map((session) => {
    const known = discovered.find((backend) => backend.sessionId === session.id);
    return {
      sessionId: session.id,
      label: session.label || known?.label || session.id,
      kind: session.backend || known?.kind || 'herdr',
      connected:
        typeof session.connected === 'boolean' ? session.connected : (known?.connected ?? true),
    };
  });
}

/**
 * Decide the terminal plane's state from what the workspace has loaded.
 *
 * Panes always win: a pane on screen is proof enough, whatever a probe says.
 * Without panes, the plane is down when discovery says the terminal plane is
 * not supported at all or that every backend is disconnected, or when every
 * configured session reports itself unreachable.
 */
export function terminalBackendState(input: {
  loaded: boolean;
  paneCount: number;
  backends: readonly TerminalBackendRow[];
  plane?: TerminalDiscovery | null;
  /** The session the workspace resolved to, whose backend the message names. */
  sessionId?: string;
  /**
   * The workspace's own load was refused because the backend is down
   * (`TerminalBackendUnavailableError`), with the backend it named. That
   * refusal comes before anything is loaded -- `/health` says the primary
   * backend is not connected -- so without this the plane stayed `pending`
   * and the loader spun under a banner explaining why.
   */
  unreachable?: { backend?: string } | null;
}): TerminalBackendState {
  if (!input.loaded) {
    if (!input.unreachable) return { kind: 'pending' };
    return down(input, input.unreachable.backend);
  }
  if (input.paneCount > 0) return { kind: 'ready' };
  const unsupported =
    input.plane?.supported === false ||
    input.plane?.degradedReason === 'all_terminal_backends_disconnected';
  const allDown =
    input.backends.length > 0 && input.backends.every((backend) => !backend.connected);
  if (!unsupported && !allDown) return { kind: 'ready' };
  return down(input);
}

function down(
  input: {
    backends: readonly TerminalBackendRow[];
    plane?: TerminalDiscovery | null;
    sessionId?: string;
  },
  named?: string
): Extract<TerminalBackendState, { kind: 'down' }> {
  const subject =
    input.backends.find((backend) => backend.sessionId === input.sessionId) ?? input.backends[0];
  const backend = named ?? subject?.kind ?? input.plane?.activeBackend ?? 'herdr';
  return {
    kind: 'down',
    backends: [...input.backends],
    message: explainDisconnected(backend),
    backend,
  };
}
