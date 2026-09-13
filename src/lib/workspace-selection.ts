import type { WarmWorkspace } from '@/lib/server-warm-cache';
import { field } from '@/lib/herdr-entity';

/** Which workspace, tab and pane the reader is looking at. */
export type Selection = {
  workspaceId: string;
  tabId: string;
  paneId: string;
};

export const initialSelection: Selection = { workspaceId: '', tabId: '', paneId: '' };

/**
 * The pane a workspace lands on, given what the gateway just said and where the
 * reader was.
 *
 * It lives here rather than in the screen because the warm cache needs the same
 * answer: to have a terminal *painted* on arrival rather than merely connected,
 * the prefetch has to read the output of the pane the screen is about to
 * choose, and two implementations of "which pane" would eventually choose
 * differently -- which is the same reason `loadWorkspaceSnapshot` was lifted out
 * of the screen in the first place.
 *
 * Preference order, at every level: what the reader already had, then what the
 * gateway says is focused, then the first one. A pane running an agent wins over
 * a plain shell when nothing else has decided, because that is what someone
 * opening a machine has come to look at.
 */
export function reconcileSelection(data: WarmWorkspace, current: Selection): Selection {
  const workspace =
    data.workspaces.find((item) => item.id === current.workspaceId) ??
    data.workspaces.find((item) => Boolean(item.raw.focused)) ??
    data.workspaces[0];
  if (!workspace) return initialSelection;

  const tabs = data.tabs.filter((item) => field(item, 'workspace_id') === workspace.id);
  const activeTabId = field(workspace, 'active_tab_id');
  const tab =
    tabs.find((item) => item.id === current.tabId) ??
    tabs.find((item) => item.id === activeTabId) ??
    tabs.find((item) => Boolean(item.raw.focused)) ??
    tabs[0];
  if (!tab) return { workspaceId: workspace.id, tabId: '', paneId: '' };

  const panes = data.panes.filter((item) => field(item, 'tab_id') === tab.id);
  const pane =
    panes.find((item) => item.id === current.paneId) ??
    panes.find((item) => Boolean(item.raw.focused)) ??
    panes.find((item) => field(item, 'agent').length > 0) ??
    panes[0];
  return { workspaceId: workspace.id, tabId: tab.id, paneId: pane?.id ?? '' };
}
