/**
 * The session events the app asks the gateway for (`types=` on
 * `/api/sessions/{id}/events`), and what each one means to the workspace.
 * Kept apart from `use-pane-events` so the rule can be tested without the
 * native stream modules.
 *
 * Left raw, the stream is dominated by focus and layout churn a phone has no
 * use for, so only the names that change what is on screen are asked for:
 *
 *  - `pane.updated` -- a pane printed something (output).
 *  - approvals -- an agent started or stopped waiting on a permission menu.
 *  - structural events -- a workspace, tab or pane appeared, vanished, was
 *    renamed or moved, or an agent attached.
 *  - `layout.updated` -- tmux's topology fingerprint moved. It is tmux's only
 *    activity event, so it carries every window and pane created, closed or
 *    moved -- but it also moves on every title or command change of any pane
 *    on the host (a working agent's spinner title flips it every 500 ms). So
 *    it is answered with one pane-list read, at most every 2 s, and the
 *    workspace is read again only when that list shows a change that matters
 *    ({@link layoutNeedsRefresh}).
 *
 * The gateway accepts both spellings (`pane.updated`, `pane_updated`) and
 * sends the underscore one; `paneEventRole` reads either.
 */
export const OUTPUT_EVENTS = ['pane.updated'];

/**
 * An agent blocking on a permission menu is the one thing a client cannot
 * discover by watching output go by, so the gateway publishes it as its own
 * event rather than as pane churn. A gateway that has never heard of these
 * names simply never matches them, which is what makes asking for them safe.
 */
export const APPROVAL_EVENTS = ['approval.pending', 'approval.resolved'] as const;

export type ApprovalEventName = (typeof APPROVAL_EVENTS)[number];

export const STRUCTURE_EVENTS = [
  'pane.created',
  'pane.closed',
  'pane.moved',
  'pane.exited',
  'pane.agent_detected',
  'pane.agent_status_changed',
  'tab.created',
  'tab.closed',
  'tab.renamed',
  'tab.moved',
  'workspace.created',
  'workspace.closed',
  'workspace.renamed',
  'workspace.focused',
];

export const LAYOUT_EVENTS = ['layout.updated'];

/** Every name the stream subscribes to, as the `types` parameter takes them. */
export const SUBSCRIBED_EVENTS = [
  ...OUTPUT_EVENTS,
  ...STRUCTURE_EVENTS,
  ...LAYOUT_EVENTS,
  ...APPROVAL_EVENTS,
];

const normalize = (name: string) => name.trim().replace(/\./g, '_');
const OUTPUT_NAMES = new Set(OUTPUT_EVENTS.map(normalize));
const STRUCTURE_NAMES = new Set(STRUCTURE_EVENTS.map(normalize));
const LAYOUT_NAMES = new Set(LAYOUT_EVENTS.map(normalize));

/** What a forwarded backend event is to the workspace; `null` for one it did not ask for. */
export function paneEventRole(name: string): 'output' | 'structure' | 'layout' | null {
  const normalized = normalize(name);
  if (OUTPUT_NAMES.has(normalized)) return 'output';
  if (LAYOUT_NAMES.has(normalized)) return 'layout';
  return STRUCTURE_NAMES.has(normalized) ? 'structure' : null;
}

/** One pane as a layout check compares it; 0 where the gateway did not give a size. */
export type PaneLayout = {
  id: string;
  tab: string;
  workspace: string;
  width: number;
  height: number;
};

/**
 * Whether a pane-list read after `layout.updated` is news for the workspace:
 * a pane appeared, closed or moved to another tab or workspace, or the open
 * pane's grid changed size. Title, command and path churn never count, and a
 * size the read does not report (0) says nothing either way.
 */
export function layoutNeedsRefresh(
  held: readonly PaneLayout[],
  fresh: readonly PaneLayout[],
  openPaneId: string | null
): boolean {
  const place = (pane: PaneLayout) => `${pane.id}\u0000${pane.tab}\u0000${pane.workspace}`;
  const heldPlaces = new Set(held.map(place));
  if (held.length !== fresh.length || fresh.some((pane) => !heldPlaces.has(place(pane)))) {
    return true;
  }
  const before = held.find((pane) => pane.id === openPaneId);
  const after = fresh.find((pane) => pane.id === openPaneId);
  if (!before || !after) return false;
  return (
    (after.width > 0 && after.width !== before.width) ||
    (after.height > 0 && after.height !== before.height)
  );
}
