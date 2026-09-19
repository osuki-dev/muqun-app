/**
 * The route and source identity an async workbench request captured before its
 * first await. The component adds mounted and gateway-selection checks around
 * this pure comparison.
 */
export interface AgentWorkbenchOwner {
  serverId: string;
  sessionId: string;
  generation: number;
  asid: string | undefined;
  directory: string | undefined;
  /** Set false for a list request whose result is valid across source changes. */
  matchAsid?: boolean;
  /** Set false for a route-only request that intentionally spans workspace changes. */
  matchDirectory?: boolean;
}

/**
 * A Home "new" route is an unsent draft until its first prompt creates an
 * agent session. Choosing a directory during that window changes only the
 * draft's working directory; it must not resolve or create another session.
 */
export function shouldPreserveNewSessionDraft(
  initialIntent: 'new' | undefined,
  activeAsid: string | undefined
): boolean {
  return initialIntent === 'new' && activeAsid === undefined;
}

/**
 * A request may update the workbench only while the route and every identity it
 * captured still name the same source. A captured `undefined` is exact when the
 * corresponding match flag is enabled, so a new-session request cannot cross
 * into an asid selected while its create call was in flight.
 */
export function agentWorkbenchOwnerMatches(
  captured: AgentWorkbenchOwner,
  current: AgentWorkbenchOwner
): boolean {
  return (
    agentWorkbenchRouteMatches(captured, current) &&
    (captured.matchAsid === false || captured.asid === current.asid)
  );
}

/**
 * Match the mounted gateway route and workspace without binding a request to
 * one session Asid. Prompt dispatch uses this while a create result advances
 * the source identity, then checks the target Asid separately.
 */
export function agentWorkbenchRouteMatches(
  captured: AgentWorkbenchOwner,
  current: AgentWorkbenchOwner
): boolean {
  return (
    captured.serverId === current.serverId &&
    captured.sessionId === current.sessionId &&
    captured.generation === current.generation &&
    (captured.matchDirectory === false || captured.directory === current.directory)
  );
}

/**
 * Accept a session created for an owner whose source Asid was empty. The
 * create result advances that same request to its known Asid only when the
 * route and the empty source are still current; a later selection cannot be
 * mistaken for the session the request created.
 */
export function advanceAgentWorkbenchOwnerAfterCreate(
  captured: AgentWorkbenchOwner,
  current: AgentWorkbenchOwner,
  createdAsid: string
): AgentWorkbenchOwner | null {
  if (!agentWorkbenchOwnerMatches(captured, current)) return null;
  return { ...captured, asid: createdAsid };
}
