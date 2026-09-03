import type { GatewayEntity } from '@/lib/gateway-entities';
import { asAgentStatus, field, type AgentStatus } from '@/lib/herdr-entity';

/**
 * What is inside a workspace, counted from the session the sheet already holds.
 *
 * The panels sheet used to read both of these straight off the workspace record
 * -- `pane_count` for the number, `agent_status` for the dot -- and on a tmux
 * session both are absent, so every chip in the rail said `0` beside a grey
 * dot no matter what was running in it. That is not a gateway bug to fix
 * upstream: `tmux list-sessions` reports `#{session_windows}` and has no
 * per-session pane count at all, so `TmuxBackend::list_workspaces` sends
 * `pane_count: null` because there is nothing truthful to send. Herdr may or
 * may not fill it depending on the version behind the socket.
 *
 * The client is the one place that can always answer, because the sheet loads
 * every tab, pane and agent in the session before it draws anything. Counting
 * them here costs no request and cannot go stale against the rows underneath.
 */
export type WorkspaceInventory = {
  panels: number;
  /**
   * The most urgent thing running in the workspace, or `unknown` when nothing
   * is. This is the summary of the same statuses the panel rows draw, so the
   * chip's dot and the dots in the list below it can never disagree.
   */
  status: AgentStatus;
};

export const EMPTY_WORKSPACE_INVENTORY: WorkspaceInventory = { panels: 0, status: 'unknown' };

/**
 * Blocked first, because it is the only status that is asking for a person.
 * Then working (something is happening), then done (something finished and is
 * worth a look), then idle (a prompt waiting to be told what to do). `unknown`
 * ranks last and is what an empty workspace reports, which is what paints the
 * dot grey.
 */
const STATUS_PRECEDENCE: readonly AgentStatus[] = ['blocked', 'working', 'done', 'idle', 'unknown'];

/**
 * One pass over the session, keyed by workspace id.
 *
 * A map rather than a per-workspace call, because the rail renders every
 * workspace and re-filtering every pane inside that loop would walk the pane
 * list once per chip.
 *
 * Membership runs pane -> tab -> workspace and deliberately ignores the pane's
 * own `workspace_id`. The sheet groups its rows by exactly that path, so
 * sharing it is what guarantees a chip reading `8 panels` has eight rows under
 * it when you select it. A pane whose tab is missing from the tab list is not
 * drawn by the sheet either, and a count that included it would be a number the
 * reader cannot reconcile with what is on screen.
 */
export function workspaceInventories(
  tabs: GatewayEntity[],
  panes: GatewayEntity[],
  agents: GatewayEntity[]
): Map<string, WorkspaceInventory> {
  const workspaceOfTab = new Map<string, string>();
  for (const tab of tabs) {
    const workspaceId = field(tab, 'workspace_id');
    if (workspaceId) workspaceOfTab.set(tab.id, workspaceId);
  }

  const statusOfPane = new Map<string, string | undefined>();
  for (const agent of agents) {
    const paneId = field(agent, 'pane_id');
    if (paneId) statusOfPane.set(paneId, agent.status);
  }

  // Seeded from the tabs, so a workspace that has tabs but nothing running in
  // them reports `0 panels` rather than being absent from the map and having to
  // be recognised as empty by the caller.
  const inventories = new Map<string, WorkspaceInventory>();
  for (const workspaceId of workspaceOfTab.values()) {
    if (!inventories.has(workspaceId))
      inventories.set(workspaceId, { ...EMPTY_WORKSPACE_INVENTORY });
  }

  for (const pane of panes) {
    const workspaceId = workspaceOfTab.get(field(pane, 'tab_id'));
    if (!workspaceId) continue;
    const inventory = inventories.get(workspaceId);
    if (!inventory) continue;
    inventory.panels += 1;
    // An agent's own status wins over the pane's, the same precedence the panel
    // rows use: a pane keeps reporting the status it was last seen with, and
    // the agent record is the live one.
    inventory.status = moreUrgent(
      inventory.status,
      asAgentStatus(statusOfPane.get(pane.id) ?? pane.status)
    );
  }

  return inventories;
}

function moreUrgent(current: AgentStatus, next: AgentStatus): AgentStatus {
  return STATUS_PRECEDENCE.indexOf(next) < STATUS_PRECEDENCE.indexOf(current) ? next : current;
}
