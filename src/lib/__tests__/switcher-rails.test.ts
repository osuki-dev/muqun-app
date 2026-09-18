// The four rungs of the one switcher sheet: machines, the backends on one of
// them, the workspaces in one backend, and the panels in one workspace.
//
// What is checked here is that they are one chain and not four lists that
// happen to share a sheet -- the session rail belongs to the machine the reader
// tapped, the workspace chips count the rows the groups below them draw, and
// nothing below the machine rail changes until the machine actually switches.
import { describe, expect, test } from 'bun:test';

import type { GatewayEntity } from '../gateway-entities';
import { switcherRails, type MachineChoice, type SwitcherRailsInput } from '../switcher-rails';

function entity(id: string, raw: Record<string, unknown> = {}, extra: Partial<GatewayEntity> = {}) {
  return {
    id,
    title: id,
    subtitle: id,
    raw: { id, ...raw },
    ...extra,
  } satisfies GatewayEntity;
}

const workspaces = [entity('w1', {}, { title: 'main' }), entity('w2', {}, { title: 'spare' })];
const tabs = [
  entity('t1', { workspace_id: 'w1' }, { title: 'editor' }),
  entity('t2', { workspace_id: 'w1' }, { title: 'logs' }),
  entity('t3', { workspace_id: 'w2' }, { title: 'away' }),
];
const panes = [
  entity('p1', { tab_id: 't1' }, { title: 'nvim', cwd: '/w/app' }),
  entity('p2', { tab_id: 't1' }, { title: 'zsh', cwd: '/w/app' }),
  entity('p3', { tab_id: 't3' }, { title: 'htop', cwd: '/w' }),
];
const agents = [entity('a1', { pane_id: 'p1' }, { title: 'opencode', status: 'working' })];

const herdr = { id: 'default', label: 'Herdr', kind: 'herdr' };
const tmux = { id: 'shell', label: 'Shell', kind: 'tmux' };

const osk: MachineChoice = { id: 'osk', label: 'osk', sessions: [herdr, tmux] };
const mini: MachineChoice = { id: 'mini', label: 'mini', sessions: [herdr] };
const unseen: MachineChoice = { id: 'pad', label: 'pad' };

function rails(input: Partial<SwitcherRailsInput> = {}) {
  return switcherRails({
    machines: [osk, mini, unseen],
    serverId: 'osk',
    sessionId: 'default',
    workspaces,
    workspaceId: 'w1',
    tabs,
    panes,
    agents,
    activePaneId: 'p2',
    ...input,
  });
}

describe('the machines rail', () => {
  test('the machine you are on leads it, however the records are ordered', () => {
    expect(rails({ serverId: 'mini' }).machines.map((machine) => machine.id)).toEqual([
      'mini',
      'osk',
      'pad',
    ]);
  });

  test('four states, because there are four things to do next', () => {
    const reach = Object.fromEntries(
      rails().machines.map((machine) => [machine.id, machine.reach])
    );
    expect(reach).toEqual({ osk: 'current', mini: 'connected', pad: 'unreached' });
  });

  test('a machine that stopped answering is unreachable, not still connected', () => {
    const stale: MachineChoice = { ...mini, error: 'Could not connect' };
    const [, second] = rails({ machines: [osk, stale] }).machines;
    expect({ reach: second.reach, error: second.error }).toEqual({
      reach: 'unreachable',
      error: 'Could not connect',
    });
  });

  test('connecting to one machine freezes every chip, and marks only that one busy', () => {
    const busy = rails({ pendingId: 'pad' }).machines;
    expect(busy.every((machine) => machine.disabled)).toBe(true);
    expect(busy.filter((machine) => machine.busy).map((machine) => machine.id)).toEqual(['pad']);
  });
});

describe('the sessions rail', () => {
  test('one backend is not a choice, so there is no rail', () => {
    const one = rails({ machines: [mini], serverId: 'mini' });
    expect(one.sessions).toEqual([]);
    expect(one.sessionsOn).toBeUndefined();
  });

  test('it belongs to the machine that was tapped, and says which', () => {
    const asked = rails({ serverId: 'mini', focusedId: 'osk', machines: [mini, osk] });
    expect(asked.sessions.map((session) => session.id)).toEqual(['default', 'shell']);
    expect(asked.sessionsOn).toBe('osk');
    // Nothing is selected on a machine the terminal is not reading: the ids are
    // server-scoped, and `default` on `mini` is not `default` on `osk`.
    expect(asked.sessions.some((session) => session.selected)).toBe(false);
  });

  test('on the machine you are on, the backend you are reading is marked', () => {
    expect(
      rails({ sessionId: 'shell' })
        .sessions.filter((session) => session.selected)
        .map((session) => session.id)
    ).toEqual(['shell']);
  });

  test('a machine the records do not have cannot focus the rail', () => {
    expect(rails({ focusedId: 'gone' }).sessions.map((session) => session.id)).toEqual([
      'default',
      'shell',
    ]);
  });

  test('it is named only when it is somewhere else', () => {
    // The caption at the top of the sheet already says which machine you are
    // on, one heading above the rail.
    expect(rails().sessionsOn).toBeUndefined();
    expect(rails({ serverId: 'mini', focusedId: 'osk', machines: [mini, osk] }).sessionsOn).toBe(
      'osk'
    );
  });
});

describe('the workspaces rail and the groups under it', () => {
  test('the workspace you are in leads, and only its groups are drawn', () => {
    const { workspaces: rail, groups } = rails();
    expect(rail.map((workspace) => workspace.id)).toEqual(['w1', 'w2']);
    expect(rail[0].selected).toBe(true);
    expect(groups.map((group) => group.tab.id)).toEqual(['t1', 't2']);
  });

  test('a chip counts exactly the rows tapping it produces', () => {
    const here = rails();
    const away = rails({ workspaceId: 'w2' });
    const count = (list: typeof here.workspaces, id: string) =>
      list.find((workspace) => workspace.id === id)?.panels;
    expect(count(here.workspaces, 'w2')).toBe(
      away.groups.reduce((total, group) => total + group.panes.length, 0)
    );
    expect(count(here.workspaces, 'w1')).toBe(2);
  });

  test("the chip's dot is the most urgent status among the rows it counts", () => {
    expect(rails().workspaces[0].status).toBe('working');
    expect(rails({ workspaceId: 'w2' }).workspaces[0].status).toBe('unknown');
  });

  test('an empty group is still a group', () => {
    expect(rails().groups.find((group) => group.tab.id === 't2')?.panes).toEqual([]);
  });
});

describe('the panels', () => {
  test('a panel with an agent takes both names and the agent status', () => {
    const [first] = rails().groups[0].panes;
    expect({ title: first.title, status: first.status, detail: first.detail }).toEqual({
      title: 'opencode · nvim',
      status: 'working',
      detail: '/w/app',
    });
  });

  test('the panel the terminal is showing is the only selected one', () => {
    expect(
      rails()
        .groups.flatMap((group) => group.panes)
        .filter((pane) => pane.selected)
        .map((pane) => pane.pane.id)
    ).toEqual(['p2']);
  });

  test('no active panel selects nothing, rather than every panel without an id', () => {
    expect(
      rails({ activePaneId: undefined })
        .groups.flatMap((group) => group.panes)
        .some((pane) => pane.selected)
    ).toBe(false);
  });
});
