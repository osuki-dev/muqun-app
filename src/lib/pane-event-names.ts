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
 *    renamed or moved, an agent attached, or a pane's size changed
 *    (`layout.updated`: tmux reports it when a pane's width or height changes,
 *    so a resized pane is re-fitted at once rather than at the next 12 s poll).
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
  'layout.updated',
];

/** Every name the stream subscribes to, as the `types` parameter takes them. */
export const SUBSCRIBED_EVENTS = [...OUTPUT_EVENTS, ...STRUCTURE_EVENTS, ...APPROVAL_EVENTS];

const normalize = (name: string) => name.trim().replace(/\./g, '_');
const OUTPUT_NAMES = new Set(OUTPUT_EVENTS.map(normalize));
const STRUCTURE_NAMES = new Set(STRUCTURE_EVENTS.map(normalize));

/** What a forwarded backend event is to the workspace; `null` for one it did not ask for. */
export function paneEventRole(name: string): 'output' | 'structure' | null {
  const normalized = normalize(name);
  if (OUTPUT_NAMES.has(normalized)) return 'output';
  return STRUCTURE_NAMES.has(normalized) ? 'structure' : null;
}
