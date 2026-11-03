import { homeAgentHref } from './pad-detail';

export type NotificationRoute =
  | {
      pathname: '/servers/[serverId]';
      params: {
        serverId: string;
        sessionId?: string;
        paneId?: string;
        notificationId?: string;
        asid?: string;
        agentId?: string;
        directory?: string;
      };
    }
  | {
      pathname: '/agent';
      params: { server: string; asid?: string; agentId?: string; sessionId?: string };
    };

export type NotificationRouteOptions = {
  /** Whether the workspace is in its Pad layout, which owns agent detail itself. */
  isPad?: boolean;
};

/**
 * Where a tapped notification goes.
 *
 * A push about an agent session (a finished turn, an approval or a question,
 * all carrying `asid`) opens that session: on a Pad the workspace route with the agent named, on a
 * phone the `/agent` screen. A push about a terminal pane opens the server's
 * workspace on that pane. Anything else follows a safe in-app `url`, or
 * nowhere -- the caller then leaves the app on Home.
 */
export function notificationRoute(
  data: Record<string, unknown> | undefined,
  notificationId?: string,
  options: NotificationRouteOptions = {}
): NotificationRoute | string | null {
  const serverId = stringField(data, 'server_id', 'serverId');
  if (serverId) {
    const sessionId = stringField(data, 'session_id', 'sessionId');
    const asid = stringField(data, 'asid');
    if (asid) {
      const agentId = stringField(data, 'agent_id', 'agentId');
      return homeAgentHref(
        {
          kind: 'agent-session',
          serverId,
          asid,
          ...(sessionId ? { sessionId } : {}),
          ...(agentId ? { agentId } : {}),
        },
        'existing',
        options.isPad === true
      ) as NotificationRoute;
    }
    const paneId = stringField(data, 'pane_id', 'paneId');
    return {
      pathname: '/servers/[serverId]',
      params: {
        serverId,
        ...(sessionId ? { sessionId } : {}),
        ...(paneId ? { paneId } : {}),
        ...(notificationId ? { notificationId } : {}),
      },
    };
  }

  const url = data?.url;
  return isInternalRoute(url) ? url : null;
}

/** The server a route opens, for warming its workspace before navigation. */
export function notificationRouteServer(route: NotificationRoute): {
  serverId: string;
  sessionId?: string;
} {
  if (route.pathname === '/agent')
    return { serverId: route.params.server, sessionId: route.params.sessionId };
  return { serverId: route.params.serverId, sessionId: route.params.sessionId };
}

function stringField(data: Record<string, unknown> | undefined, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = data?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function isInternalRoute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('://')
  );
}

/**
 * What tapping a notification opens, once the paired computers are known.
 *
 * A push names its computer by `server_id`. A computer that is no longer
 * paired has no workspace to open -- the agent screen would wait on a
 * connection that can never be made -- so such a push opens Home and says
 * why. `isPaired` is undefined when the paired list could not be read, and a
 * push is then trusted rather than refused.
 */
export type NotificationOpening =
  | { kind: 'open'; route: NotificationRoute | string }
  | { kind: 'unpaired'; serverId: string };

export function notificationOpening(
  data: Record<string, unknown> | undefined,
  notificationId: string | undefined,
  options: NotificationRouteOptions & { isPaired?: (serverId: string) => boolean }
): NotificationOpening | null {
  const route = notificationRoute(data, notificationId, options);
  if (!route) return null;
  if (typeof route === 'object' && options.isPaired) {
    const { serverId } = notificationRouteServer(route);
    if (!options.isPaired(serverId)) return { kind: 'unpaired', serverId };
  }
  return { kind: 'open', route };
}

/**
 * Whether a notification response is new.
 *
 * A cold start hands the tap that launched the app to both
 * `getLastNotificationResponse` and, on some platforms, the response listener;
 * and the root layout can remount (an error boundary's retry) while the last
 * response is still on record. Either way one tap must open one screen. Keyed
 * by request identifier and action, so the same notification's "Approve" and
 * a later plain tap on it are still two responses.
 */
export function createResponseGate(capacity = 32): (key: string) => boolean {
  const seen: string[] = [];
  return (key) => {
    if (seen.includes(key)) return false;
    seen.push(key);
    if (seen.length > capacity) seen.shift();
    return true;
  };
}
