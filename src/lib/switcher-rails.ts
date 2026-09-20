import type { GatewayEntity } from '@/lib/gateway-entities';
import { field, panelTitle } from '@/lib/herdr-entity';
import type { SessionChoice } from '@/lib/session-switcher';
import {
  EMPTY_WORKSPACE_INVENTORY,
  workspaceInventories,
  type WorkspaceInventory,
} from '@/lib/workspace-inventory';

/**
 * One address, read from the outside in: machine, session, workspace, panel.
 *
 * The app used to ask that question through two buttons in the same corner of
 * the same header. The monitor glyph opened "Machines and sessions" -- which
 * knew every machine this phone is paired with and every backend on them, and
 * nothing at all about what was running inside one -- and the panels glyph
 * opened "What is running", which knew the workspaces, the groups and the
 * panels of whichever session the first sheet had already chosen. Two buttons,
 * two sheets, and one chain cut in half: a reader looking for a terminal had to
 * know which half of the address it was in before they could start looking.
 *
 * They are one sheet now, and this module is the one sheet's model. Each rung
 * of the ladder is a list of what the next rung can be chosen from, and every
 * one of them is derived from the same four inputs, so a chip in the machines
 * rail and a row at the bottom of the sheet can never be describing two
 * different sessions.
 *
 * Pure, and free of the kit and of Lingui, so all four rungs can be tested
 * without a gateway or a renderer -- the pattern `session-switcher.ts` and
 * `workspace-inventory.ts` already set. Copy lives at the call site, because
 * the Lingui macro only rewrites a template it can walk back to the
 * `useLingui()` that produced its `t`; what leaves here is the *state* a chip
 * is in, never the sentence it says.
 */

/** A machine this phone is paired with, and what is known about it so far. */
export type MachineChoice = {
  id: string;
  label: string;
  /**
   * The backends on it, once they have been asked for. `undefined` is "not
   * asked yet", which is a different answer from `[]` and reads differently on
   * the chip.
   */
  sessions?: SessionChoice[];
  /** Why the last attempt to reach it failed, already in the reader's language. */
  error?: string;
};

/**
 * How far this phone has got with a machine.
 *
 * Four states rather than a boolean, because "the one you are on", "reachable,
 * you have its backends", "never asked" and "asked and it did not answer" are
 * four different things to do next, and the chip's dot is the only place the
 * difference is reported.
 */
export type MachineReach = 'current' | 'connected' | 'unreached' | 'unreachable';

export type MachineRailItem = {
  id: string;
  label: string;
  reach: MachineReach;
  /** The machine the terminal underneath the sheet is actually reading. */
  current: boolean;
  /** The machine whose backends the session rail is showing. */
  focused: boolean;
  /** This machine is the one being connected to right now. */
  busy: boolean;
  /** Some machine is being connected to, so no chip may be tapped. */
  disabled: boolean;
  error?: string;
  sessions: SessionChoice[];
};

export type SessionRailItem = SessionChoice & {
  /** The backend the terminal is reading, which only the current machine has. */
  selected: boolean;
  disabled: boolean;
};

export type WorkspaceRailItem = WorkspaceInventory & {
  id: string;
  title: string;
  selected: boolean;
};

export type PaneRailItem = {
  pane: GatewayEntity;
  agent?: GatewayEntity;
  /** What the row is called: the pane's name, the agent's, or both. */
  title: string;
  /** Where it is, for the row's second line. */
  detail: string;
  /** The agent's status where there is one, else the pane's. */
  status?: string;
  selected: boolean;
};

export type PaneGroup = {
  tab: GatewayEntity;
  panes: PaneRailItem[];
};

export type SwitcherRails = {
  machines: MachineRailItem[];
  /** Empty unless the focused machine has a genuine choice of backend. */
  sessions: SessionRailItem[];
  /**
   * The focused machine's name, and only when it is not the machine you are
   * on. On your own machine the sheet's caption has already said which machine
   * this is, one heading above; repeating it there is furniture. It earns its
   * place exactly when the rail is about somewhere else.
   */
  sessionsOn?: string;
  workspaces: WorkspaceRailItem[];
  groups: PaneGroup[];
};

export type SwitcherRailsInput = {
  machines: readonly MachineChoice[];
  /** The machine the terminal is on. */
  serverId: string;
  /** The backend the terminal is reading on that machine. */
  sessionId: string;
  /**
   * The machine the reader last tapped, which is the one the session rail is
   * about. It is the current machine until they tap another: tapping a machine
   * with two backends cannot switch on its own, so the rail is how it asks.
   */
  focusedId?: string;
  /** The machine being connected to, which freezes every chip while it runs. */
  pendingId?: string | null;
  workspaces: readonly GatewayEntity[];
  workspaceId: string;
  tabs: readonly GatewayEntity[];
  panes: readonly GatewayEntity[];
  agents: readonly GatewayEntity[];
  /** The panel the terminal is showing, so the sheet opens on "where am I". */
  activePaneId?: string;
};

/**
 * The whole sheet, in one pass.
 *
 * One function rather than four, because the rungs are not independent: the
 * session rail is a property of the focused machine, the workspace rail counts
 * what the groups below it contain, and a pane's row is the same reading of
 * the same agent list that its workspace's dot is. Computing them together is
 * what makes "the number on that chip is the number of rows you get when you
 * tap it" true by construction rather than by review.
 */
export function switcherRails({
  machines,
  serverId,
  sessionId,
  focusedId,
  pendingId = null,
  workspaces,
  workspaceId,
  tabs,
  panes,
  agents,
  activePaneId,
}: SwitcherRailsInput): SwitcherRails {
  const focused = machines.some((machine) => machine.id === focusedId) ? focusedId : serverId;
  const frozen = pendingId !== null;

  // The machine you are on leads, the way the workspace rail puts the workspace
  // you are in first: a rail is read from its left edge, and the left edge is
  // where "you are here" belongs.
  const railMachines: MachineRailItem[] = [
    ...machines.filter((machine) => machine.id === serverId),
    ...machines.filter((machine) => machine.id !== serverId),
  ].map((machine) => ({
    id: machine.id,
    label: machine.label,
    reach: machineReach(machine, machine.id === serverId),
    current: machine.id === serverId,
    focused: machine.id === focused,
    busy: machine.id === pendingId,
    disabled: frozen,
    ...(machine.error ? { error: machine.error } : {}),
    sessions: machine.sessions ?? [],
  }));

  const focusedSessions = machines.find((machine) => machine.id === focused)?.sessions ?? [];
  // One backend is not a choice. A rail of a single chip asks the reader to
  // decide something that has already been decided, and it costs the sheet a
  // row of its height to do it.
  const railSessions: SessionRailItem[] =
    focusedSessions.length > 1
      ? focusedSessions.map((session) => ({
          ...session,
          selected: focused === serverId && session.id === sessionId,
          disabled: frozen,
        }))
      : [];

  const inventories = workspaceInventories([...tabs], [...panes], [...agents]);
  const railWorkspaces: WorkspaceRailItem[] = [
    ...workspaces.filter((workspace) => workspace.id === workspaceId),
    ...workspaces.filter((workspace) => workspace.id !== workspaceId),
  ].map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    selected: workspace.id === workspaceId,
    ...(inventories.get(workspace.id) ?? EMPTY_WORKSPACE_INVENTORY),
  }));

  // Paired once here rather than searched for per row: the rows and the chips
  // above them read the same agent list, and a find() inside the render walked
  // it again for every pane on the sheet.
  const agentOfPane = new Map<string, GatewayEntity>();
  for (const agent of agents) {
    const paneId = field(agent, 'pane_id');
    if (paneId && !agentOfPane.has(paneId)) agentOfPane.set(paneId, agent);
  }

  const groups: PaneGroup[] = tabs
    .filter((tab) => field(tab, 'workspace_id') === workspaceId)
    .map((tab) => ({
      tab,
      panes: panes
        .filter((pane) => field(pane, 'tab_id') === tab.id)
        .map((pane) => {
          const agent = agentOfPane.get(pane.id);
          return {
            pane,
            ...(agent ? { agent } : {}),
            title: panelTitle(pane, agent),
            detail: pane.cwd ?? pane.id,
            status: agent?.status ?? pane.status,
            selected: Boolean(activePaneId) && pane.id === activePaneId,
          };
        }),
    }));

  return {
    machines: railMachines,
    sessions: railSessions,
    ...(railSessions.length && focused !== serverId
      ? { sessionsOn: machines.find((machine) => machine.id === focused)?.label ?? focused }
      : {}),
    workspaces: railWorkspaces,
    groups,
  };
}

/**
 * An error outranks a loaded backend list.
 *
 * A machine that answered once and has since stopped answering keeps the
 * sessions it reported, and a chip that went on reading "connected" because of
 * them would be reporting the memory rather than the machine.
 */
function machineReach(machine: MachineChoice, current: boolean): MachineReach {
  if (current) return 'current';
  if (machine.error) return 'unreachable';
  return machine.sessions?.length ? 'connected' : 'unreached';
}
