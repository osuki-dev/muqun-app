import {
  gatewayTransport,
  readPaneOutput,
  INITIAL_PANE_OUTPUT_LINES,
  type HealthResponse,
  type HerdrEntity,
  type PaneOutputSource,
  type SessionSnapshot,
} from '@/lib/gateway-client';
import { initialSelection, reconcileSelection } from '@/lib/workspace-selection';

import { resolveSessionId, sessionChoices, type SessionChoice } from '@/lib/session-switcher';
import { snapshotServesAgents } from '@/lib/session-snapshot';
import { rememberWarmWorkspace, warmWorkspace, type WarmWorkspace } from '@/lib/server-warm-cache';

/**
 * The one shape this prefetch reads. A pane that turns out to be read another
 * way -- an editor owning the screen, an agent rendered as prose -- is refused
 * by the screen on arrival, which costs the head start and nothing else.
 */
const WARM_PANE_FORMAT = 'ansi' as const;
const WARM_PANE_SOURCE: PaneOutputSource = 'recent-unwrapped';

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
type WorkspaceSnapshotResult = { snapshot: WarmWorkspace; choices: SessionChoice[] };

export function loadWorkspaceSnapshot(
  preference: string | undefined,
  knownHealth?: HealthResponse | null
): Promise<WorkspaceSnapshotResult>;
export function loadWorkspaceSnapshot(
  preference: string | undefined,
  knownHealth: HealthResponse | null | undefined,
  isCurrent: () => boolean
): Promise<WorkspaceSnapshotResult | null>;
export async function loadWorkspaceSnapshot(
  preference: string | undefined,
  /** Health already in hand. It costs a round trip and never changes mid-screen. */
  knownHealth?: HealthResponse | null,
  isCurrent: () => boolean = () => true
): Promise<WorkspaceSnapshotResult | null> {
  if (!isCurrent()) return null;
  const [health, sessions] = await Promise.all([
    knownHealth ? Promise.resolve(knownHealth) : gatewayTransport.loadHealth(),
    gatewayTransport.loadSessions(),
  ]);
  if (!isCurrent()) return null;
  // The gateway's order is kept as it arrived, and a preference naming a
  // session that has since gone falls through to the first rather than
  // failing -- see `lib/session-switcher`.
  const choices = sessionChoices(sessions.sessions);
  const sessionId = resolveSessionId(
    choices.length ? choices : sessionChoices(sessions.sessions, true),
    preference
  );
  const { workspaces, tabs, panes, agents } = await sessionEntities(sessionId, health);
  if (!isCurrent()) return null;
  return { snapshot: { health, sessionId, workspaces, tabs, panes, agents }, choices };
}

/** Every list the snapshot needs, with the agents settled one way or another. */
type SessionEntities = Omit<SessionSnapshot, 'agents'> & { agents: HerdrEntity[] };

/**
 * The session's shape, batched as far as this gateway can batch it.
 *
 * Three shapes, and no caller can tell which one it got:
 *
 *  * **One request.** A gateway announcing `session_snapshot` answers the four
 *    lists at once, agents included and complete, so nothing else is asked.
 *  * **Two.** A gateway with the route but no announcement derives its agents
 *    from the panes, so `/agents` is asked beside it -- started together, not
 *    after, because neither answer depends on the other.
 *  * **Four.** A gateway with no batched route at all: the original three, plus
 *    agents, all in parallel.
 *
 * The one-request path is the only one that has to be sequential, and it is not
 * really: there is simply nothing to run beside it.
 *
 * A null from `loadSessionSnapshot` is "no such route", never "the read
 * failed" -- a real failure is raised from in there rather than retried as
 * three more requests. An announcement that does not hold lands here as a null
 * too, and falls through to the four-request path, which is the honest answer
 * to a gateway whose `/health` and whose router disagree.
 */
async function sessionEntities(
  sessionId: string,
  health: HealthResponse | null
): Promise<SessionEntities> {
  if (snapshotServesAgents(health)) {
    const batched = await gatewayTransport.loadSessionSnapshot(sessionId, health);
    // Announced, so `agents` is an array whenever the answer came back at all.
    if (batched) return { ...batched, agents: batched.agents ?? [] };
    // The announcement did not hold. Whatever is in front of this gateway does
    // not serve the route, so the three separate reads are taken directly --
    // asking `/snapshot` a second time here would only collect a second 404.
    return withAgents(sessionId, separateSessionShape(sessionId));
  }
  // No announcement: the route is probed alongside the agents call, because
  // neither answer depends on the other and a gateway that has the route still
  // saves two requests by it.
  return withAgents(sessionId, probedSessionShape(sessionId, health));
}

async function withAgents(
  sessionId: string,
  shape: Promise<Omit<SessionSnapshot, 'agents'>>
): Promise<SessionEntities> {
  const [entities, agents] = await Promise.all([shape, gatewayTransport.loadAgents(sessionId)]);
  return { ...entities, agents };
}

/** Try the batched route once; fall back to the three reads if it is not there. */
async function probedSessionShape(
  sessionId: string,
  health: HealthResponse | null
): Promise<Omit<SessionSnapshot, 'agents'>> {
  return (
    (await gatewayTransport.loadSessionSnapshot(sessionId, health)) ??
    separateSessionShape(sessionId)
  );
}

/** Workspaces, tabs and panes the original way, with no batched route involved. */
async function separateSessionShape(sessionId: string): Promise<Omit<SessionSnapshot, 'agents'>> {
  const [workspaces, tabs, panes] = await Promise.all([
    gatewayTransport.loadWorkspaces(sessionId),
    gatewayTransport.loadTabs(sessionId),
    gatewayTransport.loadPanes(sessionId),
  ]);
  return { workspaces, tabs, panes };
}

/**
 * Load the configured server's workspace ahead of anyone opening it.
 *
 * Only ever the server the app is already pointed at. The home screen probes up
 * to `MAX_PROBED_SERVERS` for reachability, but warming is a different weight
 * of request, so this stays at one server. Warming four on every return to the
 * list is the launch cost that fan-out was bounded to avoid in the first place
 * (`stores/server-reachability.ts`, `lib/server-agents.ts`).
 *
 * A probe is one round trip. A warm used to be seven on top of it -- health,
 * sessions, workspaces, tabs, panes, agents, and the landing pane's screen read
 * below. Against a current gateway it is now three:
 *
 *  * health is the probe's own answer, handed over rather than asked for again
 *    (`knownHealth`);
 *  * workspaces, tabs, panes *and* agents are one batched request, on a gateway
 *    announcing `session_snapshot` (`lib/session-snapshot`);
 *  * sessions and the landing pane's screen are unchanged, and the ordering
 *    between the three is inherent: the session has to be resolved before
 *    anything can be asked about it, and the landing pane is not known until
 *    the panes are.
 *
 * Four against a gateway that has the batched route but does not announce it,
 * whose batched agents are derived from panes and so cannot be used. Six
 * against one with no batched route at all, which is the original shape minus
 * the shared health. One more than any of those against a gateway whose
 * `/api/sessions` omits `connected`, because `loadSessions` then asks
 * `/health` a second time to fill it in.
 *
 * A failure is not reported. The screen still connects exactly as it did
 * before; the only thing lost is the head start.
 */
export async function warmConfiguredWorkspace(
  serverId: string,
  preference: string | undefined,
  isCurrent: () => boolean = () => true,
  /**
   * `/health` the caller already has, when it has one worth reusing.
   *
   * The home screen's status dot asks this very gateway for `/health` on the
   * same focus that starts this warm, and used to throw the body away -- so the
   * warm's first act was to ask again, and the reader paid for the same answer
   * twice. Passing it here is the whole of that fix. Undefined is still valid
   * and still correct: it means nobody has an answer to share, and the warm
   * fetches its own exactly as before.
   *
   * It must already have passed `assertSupportedHerdr`, because skipping
   * `loadHealth` skips that check too. `stores/server-reachability` is the one
   * producer and applies it there; nothing else may hand a body in here.
   */
  knownHealth?: HealthResponse | null
): Promise<void> {
  if (!serverId || !isCurrent() || warmWorkspace(serverId)) return;
  try {
    const result = await loadWorkspaceSnapshot(preference, knownHealth, isCurrent);
    if (!result || !isCurrent()) return;
    const { snapshot } = result;
    const firstPane = await firstPaneScreen(snapshot);
    if (!isCurrent()) return;
    // A terminal mounted during this prefetch may already have fresher data.
    if (warmWorkspace(serverId)) return;
    rememberWarmWorkspace(serverId, { ...snapshot, firstPane });
  } catch {
    // Deliberately silent: see above.
  }
}

/**
 * The screen of the pane the workspace will land on, read here so it is painted
 * on the first frame instead of after a round trip.
 *
 * The pane is chosen with `reconcileSelection` -- the screen's own rule, shared
 * rather than restated, because two answers to "which pane" would eventually
 * differ and the reader would watch one terminal be replaced by another.
 *
 * `shape` travels with it for the same reason the pane cache records one: a
 * pane can hand its tty to an editor while nobody is looking, and a window read
 * one way must not be handed back for a pane now read another. It is in
 * `PaneWindow.shape` terms, and the screen seeds its terminal only when it
 * matches the shape that pane will now be read under -- `paneReading` in
 * `components/server-terminal-workspace`, the same comparison
 * `recallPaneWindow` makes of a cached window. The pane id alone is not that
 * test: the pane a warm read is by definition the pane the screen lands on, so
 * an id check passes for the very pane that turned.
 *
 * A failure here costs the head start and nothing else -- the caller has
 * already caught, and the screen reads for itself regardless.
 */
async function firstPaneScreen(snapshot: WarmWorkspace): Promise<WarmWorkspace['firstPane']> {
  const { paneId } = reconcileSelection(snapshot, initialSelection);
  if (!paneId) return undefined;
  const output = await readPaneOutput(
    snapshot.sessionId,
    paneId,
    WARM_PANE_FORMAT,
    INITIAL_PANE_OUTPUT_LINES,
    WARM_PANE_SOURCE
  );
  return { paneId, output, shape: `${WARM_PANE_FORMAT}:${WARM_PANE_SOURCE}:main` };
}

/**
 * The head start for a tapped notification.
 *
 * Same warm as a home-screen tap, with one difference it has to handle: the
 * notification names a server that may not be the one the app is connected to,
 * and the transport is scoped to the selected record. Warming the wrong server
 * would put a request on the wire against another machine's base URL, so this
 * only runs once that server is the selected one -- which the workspace screen
 * does on mount. Until then it is a no-op, and the screen's own load is the
 * whole trip, exactly as before.
 */
export async function warmNotificationTarget(
  serverId: string,
  sessionPreference?: string
): Promise<void> {
  const { useGatewayConnectionStore } = await import('@/stores/gateway-connection');
  const record = useGatewayConnectionStore.getState().record;
  if (record?.serverId !== serverId) return;
  await warmConfiguredWorkspace(
    serverId,
    sessionPreference,
    () => useGatewayConnectionStore.getState().record === record
  );
}
