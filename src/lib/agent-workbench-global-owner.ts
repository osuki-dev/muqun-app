/**
 * Process-local ownership for the singleton bridges that sit beside an agent
 * workbench. A hidden retained workbench keeps its local transcript and stream,
 * but it must not publish into a bridge owned by the focused screen.
 */
export interface AgentWorkbenchGlobalOwnerScope {
  serverId: string;
  sessionId: string;
}

export interface AgentWorkbenchGlobalOwner extends AgentWorkbenchGlobalOwnerScope {
  id: number;
}

let nextOwnerId = 1;
let activeOwner: AgentWorkbenchGlobalOwner | null = null;

const AGENT_WORKBENCH_OVERLAYS = new Set([
  'agent-sessions',
  'agent-model',
  'agent-mode',
  'agent-workspace',
  'agent-worktree',
  'agent-context',
  'agent-vcs-diff',
  'agent-tasks',
  'agent-shells',
]);

/**
 * Decide what the root navigator says about a workbench during a focus
 * transition. The root route is authoritative when it is available: a stale
 * pathname from a frozen screen must not retain a bridge after Settings (or a
 * different page) has become the active destination.
 */
export function agentWorkbenchNavigationScope(input: {
  pathname: string;
  rootRouteName?: string;
  routeFocused: boolean;
  visible: boolean;
}): 'focused' | 'owned-overlay' | 'release' {
  // `visible` is an explicit lifecycle signal for embedded workbenches. A
  // route-owned workbench computes it from the same root route below, so a
  // focus transition cannot be mistaken for an intentional hide.
  if (!input.visible) return 'release';
  if (input.routeFocused && input.visible) return 'focused';
  if (input.rootRouteName !== undefined) {
    if (isAgentWorkbenchOwnedRootRoute(input.rootRouteName)) return 'owned-overlay';
    if (!input.routeFocused) return 'release';
  }
  if (input.visible && isAgentWorkbenchOwnedOverlayPath(input.pathname)) {
    return 'owned-overlay';
  }
  return 'release';
}

/** Whether a root-stack route is one of the sheets owned by an agent screen. */
export function isAgentWorkbenchOwnedRootRoute(routeName: string | undefined): boolean {
  return routeName !== undefined && AGENT_WORKBENCH_OVERLAYS.has(routeName);
}

/** Native sheets that are allowed to keep the underlying workbench owner. */
export function isAgentWorkbenchOwnedOverlayPath(pathname: string): boolean {
  const segment = pathname.split('/').filter(Boolean).at(-1);
  return segment ? AGENT_WORKBENCH_OVERLAYS.has(segment) : false;
}

export function claimAgentWorkbenchGlobalOwner(
  scope: AgentWorkbenchGlobalOwnerScope
): AgentWorkbenchGlobalOwner | null {
  const owner = { ...scope, id: nextOwnerId++ };
  activeOwner = owner;
  return owner;
}

export function ownsAgentWorkbenchGlobalOwner(owner: AgentWorkbenchGlobalOwner | null): boolean {
  return owner !== null && activeOwner === owner;
}

/** Returns true only when this exact owner released the singleton slot. */
export function releaseAgentWorkbenchGlobalOwner(owner: AgentWorkbenchGlobalOwner | null): boolean {
  if (!owner || activeOwner !== owner) return false;
  activeOwner = null;
  return true;
}
