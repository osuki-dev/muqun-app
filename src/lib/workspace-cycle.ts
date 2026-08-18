/**
 * Cycling between the workspaces of one session, as pure functions.
 *
 * The screen owns the selection and the gesture; everything here is the part
 * that can be reasoned about without a device: where a direction lands, what
 * the position indicator should read, and which tab/pane a workspace was last
 * left on. Kept apart from the screen so wrap-around and the single-workspace
 * case are covered by tests rather than by swiping.
 *
 * The index arithmetic itself is shared with the tab swipe, which cycles the
 * same way one level down; see `@/lib/cycle-ring`. What stays here is what only
 * a workspace has -- that it remembers a tab *and* a pane, and the thresholds
 * of the gesture that drives it.
 */
import {
  canCycle,
  cycleDirectionBetween,
  ringPosition,
  stepRing,
  stepRingFrom,
  type CycleDirection,
  type CycleTarget,
  type RingItem,
} from '@/lib/cycle-ring';

export type WorkspaceCycleDirection = CycleDirection;

/** Only what cycling reads, so tests need no gateway entity. */
export type CyclableWorkspace = RingItem;

export type WorkspaceCycleTarget = {
  workspaceId: string;
  title: string;
  /** 1-based place in the ring. Read by the screen; not drawn on its own. */
  position: number;
  total: number;
};

/** What a workspace was last left on, keyed by workspace id. */
export type WorkspaceMemory = Record<string, { tabId: string; paneId: string }>;

function asWorkspaceTarget(target: CycleTarget | null): WorkspaceCycleTarget | null {
  if (!target) return null;
  return {
    workspaceId: target.id,
    title: target.title,
    position: target.position,
    total: target.total,
  };
}

/**
 * A session with one workspace has nowhere to go, and a swipe that quietly did
 * nothing would read as a dropped gesture -- so the gesture is switched off
 * entirely in that case rather than made a no-op.
 */
export function canCycleWorkspaces(workspaces: CyclableWorkspace[]): boolean {
  return canCycle(workspaces);
}

/**
 * Where the current workspace sits, for the indicator. `null` when the
 * selection names a workspace this session no longer has, which is the same
 * answer as "nothing to show".
 */
export function workspacePosition(
  workspaces: CyclableWorkspace[],
  workspaceId: string
): WorkspaceCycleTarget | null {
  return asWorkspaceTarget(ringPosition(workspaces, workspaceId));
}

/**
 * The workspace one step in `direction`, wrapping at either end.
 *
 * An unknown current workspace is not an error: a swipe then lands on the first
 * one going forward and the last one going back, which is what a user who just
 * had a workspace closed under them expects from the next swipe.
 */
export function cycleWorkspace(
  workspaces: CyclableWorkspace[],
  workspaceId: string,
  direction: WorkspaceCycleDirection
): WorkspaceCycleTarget | null {
  return asWorkspaceTarget(stepRing(workspaces, workspaceId, direction));
}

/**
 * Where the *next* swipe of a burst lands.
 *
 * A swipe is felt immediately but applied a beat later, so during fast swiping
 * the workspace the screen is showing (`committedId`) lags behind the one the
 * finger has already reached (`pendingId`). Stepping from the screen's workspace
 * in that window makes every swipe after the first recompute the same target:
 * five flicks left move one workspace, not five. Stepping from the pending one
 * makes a burst travel as far as the fingers asked.
 *
 * `pendingId` is dropped when it names a workspace this session no longer has,
 * which is the same fallback a stale selection already gets.
 */
export function cycleWorkspaceFrom(
  workspaces: CyclableWorkspace[],
  committedId: string,
  pendingId: string | null,
  direction: WorkspaceCycleDirection
): WorkspaceCycleTarget | null {
  return asWorkspaceTarget(stepRingFrom(workspaces, committedId, pendingId, direction));
}

/**
 * Which way a workspace change that this pill did not make went, so the
 * carousel can be played for it too.
 *
 * The panel picker, an approval notification's deep link and the gateway
 * reconciling its own focus all switch workspace without a swipe, and a title
 * that only animates for one of the routes into it is a title that sometimes
 * animates.
 */
export function workspaceSwitchDirection(
  workspaces: CyclableWorkspace[],
  fromId: string,
  toId: string
): WorkspaceCycleDirection | null {
  return cycleDirectionBetween(workspaces, fromId, toId);
}

/** Past this much horizontal travel a drag on the title is a switch. */
export const SWIPE_DISTANCE = 44;
/** ...or this much speed, for a flick that never travelled that far. */
export const SWIPE_VELOCITY = 420;
/** A drag has to be this much more horizontal than vertical to count. */
export const SWIPE_AXIS_BIAS = 1;

/**
 * The direction a finished drag means, or `null` when it was not a horizontal
 * swipe at all. A worklet: this is called from the gesture's `onEnd` on the UI
 * thread.
 *
 * The thresholds above it are declared first on purpose. A worklet's closure is
 * captured when the module is evaluated, so a constant declared after this
 * function reaches the UI thread as `undefined` -- every comparison then reads
 * false and the swipe silently does nothing, which is exactly what it did.
 * Tests cannot see this: on the JS runtime the same code resolves the constants
 * at call time and passes.
 *
 * Distance or a flick either one counts -- a quick short swipe is the common
 * shape on a pill this small -- but a drag that travelled further vertically is
 * never a workspace switch, whatever its horizontal velocity was.
 */
export function swipeDirection(
  translationX: number,
  translationY: number,
  velocityX: number
): WorkspaceCycleDirection | null {
  'worklet';
  const travelled = Math.abs(translationX) >= SWIPE_DISTANCE;
  const flicked = Math.abs(velocityX) >= SWIPE_VELOCITY && Math.abs(translationX) >= 12;
  if (!travelled && !flicked) return null;
  if (Math.abs(translationX) < Math.abs(translationY) * SWIPE_AXIS_BIAS) return null;
  return translationX < 0 ? 'next' : 'previous';
}

/**
 * Record where a workspace is being left, so cycling back returns to the same
 * pane rather than to whatever the gateway considers focused. A selection with
 * no pane is not worth remembering -- it would overwrite a good entry with the
 * blank moment between two loads.
 */
export function rememberWorkspaceSelection(
  memory: WorkspaceMemory,
  selection: { workspaceId: string; tabId: string; paneId: string }
): WorkspaceMemory {
  if (!selection.workspaceId || !selection.paneId) return memory;
  const current = memory[selection.workspaceId];
  if (current && current.tabId === selection.tabId && current.paneId === selection.paneId) {
    return memory;
  }
  return {
    ...memory,
    [selection.workspaceId]: { tabId: selection.tabId, paneId: selection.paneId },
  };
}

/**
 * What that workspace was last left on, as a selection candidate. Empty ids
 * where nothing is remembered, which the screen's own reconcile step then fills
 * in from the session -- so a remembered pane that has since been closed falls
 * back exactly the way a fresh visit would.
 */
export function recallWorkspaceSelection(
  memory: WorkspaceMemory,
  workspaceId: string
): { workspaceId: string; tabId: string; paneId: string } {
  const remembered = memory[workspaceId];
  return {
    workspaceId,
    tabId: remembered?.tabId ?? '',
    paneId: remembered?.paneId ?? '',
  };
}
