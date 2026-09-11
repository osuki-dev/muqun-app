import { gatewayTransport, type HealthResponse } from '@/lib/gateway-client';
import { resolveSessionId, sessionChoices, type SessionChoice } from '@/lib/session-switcher';
import { rememberWarmWorkspace, warmWorkspace, type WarmWorkspace } from '@/lib/server-warm-cache';

/**
 * Everything one screen of a gateway is made of, fetched once.
 *
 * This is the terminal workspace's own load, lifted out so the home screen can
 * run it too. Lifting rather than copying is the whole point: the session a
 * warmed snapshot describes has to be the session the workspace would land on,
 * and two implementations of "which session" would eventually disagree and
 * paint the wrong one.
 *
 * The caller supplies the preference. The workspace has a rule about not
 * pulling a reader off a live fallback when a backend returns, which needs
 * state only it has; that rule decides what preference to pass, and this
 * function honours whatever it is told. On a cold start there is nothing to be
 * pulled away from, so the remembered preference is the answer outright.
 */
export async function loadWorkspaceSnapshot(
  preference: string | undefined,
  /** Health already in hand. It costs a round trip and never changes mid-screen. */
  knownHealth?: HealthResponse | null
): Promise<{ snapshot: WarmWorkspace; choices: SessionChoice[] }> {
  const [health, sessions] = await Promise.all([
    knownHealth ? Promise.resolve(knownHealth) : gatewayTransport.loadHealth(),
    gatewayTransport.loadSessions(),
  ]);
  // The gateway's order is kept as it arrived, and a preference naming a
  // session that has since gone falls through to the first rather than
  // failing -- see `lib/session-switcher`.
  const choices = sessionChoices(sessions.sessions);
  const sessionId = resolveSessionId(
    choices.length ? choices : sessionChoices(sessions.sessions, true),
    preference
  );
  const [workspaces, tabs, panes, agents] = await Promise.all([
    gatewayTransport.loadWorkspaces(sessionId),
    gatewayTransport.loadTabs(sessionId),
    gatewayTransport.loadPanes(sessionId),
    gatewayTransport.loadAgents(sessionId),
  ]);
  return { snapshot: { health, sessionId, workspaces, tabs, panes, agents }, choices };
}

/**
 * Load the configured server's workspace ahead of anyone opening it.
 *
 * Only ever the server the app is already pointed at. The home screen now
 * probes up to `MAX_PROBED_SERVERS` for reachability, but warming is a
 * different weight of request -- a probe is one round trip and a warm is six --
 * so this stays at one. Warming four servers on every return to the list is the
 * launch cost that fan-out was bounded to avoid in the first place
 * (`stores/server-reachability.ts`, `lib/server-agents.ts`).
 *
 * A failure is not reported. The screen still connects exactly as it did
 * before; the only thing lost is the head start.
 */
export async function warmConfiguredWorkspace(
  serverId: string,
  preference: string | undefined
): Promise<void> {
  if (!serverId || warmWorkspace(serverId)) return;
  try {
    const { snapshot } = await loadWorkspaceSnapshot(preference);
    rememberWarmWorkspace(serverId, snapshot);
  } catch {
    // Deliberately silent: see above.
  }
}
