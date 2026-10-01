import type { HomeAgentEntry } from '@/lib/home-commands';

export type PadDetail =
  | { kind: 'pane' }
  | {
      kind: 'agent';
      serverId: string;
      sessionId: string;
      asid?: string;
      directory?: string;
      agentId?: string;
      intent?: 'new';
      /**
       * Set on every `new` request so a second request for the same directory
       * is a different detail: a fresh workbench, and a fresh release of the
       * Home command's new-session claim.
       */
      nonce?: number;
    };

export type PadShellState = { detail: PadDetail; overviewVisible: boolean };

export type PadRouteParams = {
  asid?: string;
  sessionId?: string;
  directory?: string;
  agentId?: string;
  intent?: string;
  overview?: string;
};

export type PadShellEvent =
  | { type: 'open-agent'; target: HomeAgentEntry; intent: 'existing' | 'new' }
  | { type: 'open-pane' }
  | { type: 'show-home' }
  | { type: 'hide-home' }
  | { type: 'route'; params: PadRouteParams; serverId: string };

export const initialPadShellState: PadShellState = {
  detail: { kind: 'pane' },
  overviewVisible: false,
};

/** One more than the current detail's nonce, so consecutive `new` requests differ. */
function nextNonce(detail: PadDetail): number {
  return (detail.kind === 'agent' ? (detail.nonce ?? 0) : 0) + 1;
}

export function padShellReducer(state: PadShellState, event: PadShellEvent): PadShellState {
  switch (event.type) {
    case 'open-agent': {
      const t = event.target;
      return {
        detail: {
          kind: 'agent',
          serverId: t.serverId,
          sessionId: t.sessionId || 'herdr',
          asid: event.intent === 'new' ? undefined : t.asid,
          directory: t.directory,
          agentId: t.agentId,
          intent: event.intent === 'new' ? 'new' : undefined,
          nonce: event.intent === 'new' ? nextNonce(state.detail) : undefined,
        },
        overviewVisible: false,
      };
    }
    case 'open-pane':
      return { detail: { kind: 'pane' }, overviewVisible: false };
    case 'show-home':
      return state.overviewVisible ? state : { ...state, overviewVisible: true };
    case 'hide-home':
      return state.overviewVisible ? { ...state, overviewVisible: false } : state;
    case 'route': {
      const p = event.params;
      if (p.overview === 'home')
        return state.overviewVisible ? state : { ...state, overviewVisible: true };
      if (!p.asid && p.intent !== 'new') return state;
      return {
        detail: {
          kind: 'agent',
          serverId: event.serverId,
          sessionId: p.sessionId || 'herdr',
          asid: p.intent === 'new' ? undefined : p.asid,
          directory: p.directory,
          agentId: p.agentId,
          intent: p.intent === 'new' ? 'new' : undefined,
          nonce: p.intent === 'new' ? nextNonce(state.detail) : undefined,
        },
        overviewVisible: false,
      };
    }
  }
}

/** Identity of a route landing: params that select what the detail shows. */
export function padRouteKey(serverId: string, params: PadRouteParams): string {
  return [
    serverId,
    params.asid ?? '',
    params.sessionId ?? '',
    params.directory ?? '',
    params.agentId ?? '',
    params.intent ?? '',
    params.overview ?? '',
  ].join('\u0000');
}

/** A route is applied once per distinct key. */
export function shouldApplyRoute(appliedKey: string | null, nextKey: string): boolean {
  return appliedKey !== nextKey;
}

/** Params a legacy `/agent` URL carries into the Pad workspace route, empties dropped. */
export function padAgentRedirectParams(params: {
  server?: string;
  sessionId?: string;
  asid?: string;
  directory?: string;
  agentId?: string;
  intent?: string;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (params.server) out.serverId = params.server;
  if (params.sessionId) out.sessionId = params.sessionId;
  if (params.asid) out.asid = params.asid;
  if (params.directory) out.directory = params.directory;
  if (params.agentId) out.agentId = params.agentId;
  if (params.intent === 'new') out.intent = 'new';
  return out;
}
