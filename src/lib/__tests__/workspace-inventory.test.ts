// The workspace rail's two facts, neither of which the gateway can be relied on
// to send (card #830).
//
// The chip read `pane_count` and `agent_status` off the workspace record. On a
// tmux session `TmuxBackend::list_workspaces` sets both to nothing -- tmux has
// no per-session pane count to report -- so `numberField` mapped `null` to `0`
// and every chip in the rail said `0` beside a grey dot forever. What is tested
// here is that the count comes from the panes instead, that it is reached by
// the same pane -> tab -> workspace path the sheet groups its rows by, and that
// a workspace record's own `pane_count` cannot influence it either way.
import { describe, expect, test } from 'bun:test';

import type { GatewayEntity } from '../gateway-entities';
import {
  EMPTY_WORKSPACE_INVENTORY,
  workspaceInventories,
  type WorkspaceInventory,
} from '../workspace-inventory';

function entity(id: string, raw: Record<string, unknown>, status?: string): GatewayEntity {
  return {
    id,
    title: id,
    subtitle: id,
    status,
    raw: { id, ...raw, ...(status ? { status } : {}) },
  };
}

function tab(id: string, workspaceId: string): GatewayEntity {
  return entity(id, { workspace_id: workspaceId });
}

function pane(id: string, tabId: string, status?: string): GatewayEntity {
  return entity(id, { tab_id: tabId }, status);
}

function agent(paneId: string, status: string): GatewayEntity {
  return entity(`agent-${paneId}`, { pane_id: paneId }, status);
}

function inventoryOf(
  map: Map<string, WorkspaceInventory>,
  workspaceId: string
): WorkspaceInventory {
  return map.get(workspaceId) ?? EMPTY_WORKSPACE_INVENTORY;
}

describe('workspaceInventories', () => {
  test('counts a workspace’s panes through the tabs that belong to it', () => {
    const map = workspaceInventories(
      [tab('t1', 'ws-1'), tab('t2', 'ws-1')],
      [pane('p1', 't1'), pane('p2', 't1'), pane('p3', 't2')],
      []
    );

    expect(inventoryOf(map, 'ws-1').panels).toBe(3);
  });

  test('keeps each workspace’s panes to itself', () => {
    const map = workspaceInventories(
      [tab('t1', 'ws-1'), tab('t2', 'ws-2')],
      [pane('p1', 't1'), pane('p2', 't2'), pane('p3', 't2')],
      []
    );

    expect(inventoryOf(map, 'ws-1').panels).toBe(1);
    expect(inventoryOf(map, 'ws-2').panels).toBe(2);
  });

  // The defect as reported: the gateway sends a workspace record with no usable
  // count, and the rail has to be right anyway.
  test('ignores the workspace record’s own pane_count, absent or null', () => {
    const withoutCount = entity('ws-1', {});
    const withNullCount = entity('ws-2', { pane_count: null });
    const withStaleCount = entity('ws-3', { pane_count: 99 });
    expect(withoutCount.raw.pane_count).toBeUndefined();
    expect(withNullCount.raw.pane_count).toBeNull();

    const map = workspaceInventories(
      [tab('t1', 'ws-1'), tab('t2', 'ws-2'), tab('t3', 'ws-3')],
      [pane('p1', 't1'), pane('p2', 't2'), pane('p3', 't3'), pane('p4', 't3')],
      []
    );

    expect(inventoryOf(map, 'ws-1').panels).toBe(1);
    expect(inventoryOf(map, 'ws-2').panels).toBe(1);
    expect(inventoryOf(map, 'ws-3').panels).toBe(2);
    expect(withStaleCount.raw.pane_count).toBe(99);
  });

  // A count the reader can reconcile with the rows on screen: the sheet draws a
  // pane under the tab that owns it, so a pane whose tab is not in the session
  // is drawn nowhere and counted nowhere.
  test('does not count a pane whose tab is missing from the session', () => {
    const map = workspaceInventories(
      [tab('t1', 'ws-1')],
      [pane('p1', 't1'), pane('p2', 'closed-tab')],
      []
    );

    expect(inventoryOf(map, 'ws-1').panels).toBe(1);
  });

  test('a workspace whose tabs are all empty reads zero rather than going missing', () => {
    const map = workspaceInventories([tab('t1', 'ws-1')], [], []);

    expect(map.has('ws-1')).toBe(true);
    expect(inventoryOf(map, 'ws-1')).toEqual({ panels: 0, status: 'unknown' });
  });

  test('a workspace with no tabs at all falls back to the empty inventory', () => {
    const map = workspaceInventories([], [], []);

    expect(inventoryOf(map, 'ws-1')).toEqual(EMPTY_WORKSPACE_INVENTORY);
  });

  describe('status', () => {
    test('summarises the agents attached to the workspace’s panes', () => {
      const map = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1'), pane('p2', 't1')],
        [agent('p1', 'working')]
      );

      expect(inventoryOf(map, 'ws-1').status).toBe('working');
    });

    // Blocked is the only status asking for a person, so it has to survive a
    // workspace full of louder-looking activity.
    test('blocked outranks working, done and idle', () => {
      const map = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1'), pane('p2', 't1'), pane('p3', 't1'), pane('p4', 't1')],
        [agent('p1', 'idle'), agent('p2', 'working'), agent('p3', 'done'), agent('p4', 'blocked')]
      );

      expect(inventoryOf(map, 'ws-1').status).toBe('blocked');
    });

    test('working outranks done, and done outranks idle', () => {
      const working = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1'), pane('p2', 't1')],
        [agent('p1', 'done'), agent('p2', 'working')]
      );
      const done = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1'), pane('p2', 't1')],
        [agent('p1', 'idle'), agent('p2', 'done')]
      );

      expect(inventoryOf(working, 'ws-1').status).toBe('working');
      expect(inventoryOf(done, 'ws-1').status).toBe('done');
    });

    test('a workspace of plain shells reports nothing to worry about', () => {
      const map = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1'), pane('p2', 't1')],
        []
      );

      expect(inventoryOf(map, 'ws-1').status).toBe('unknown');
    });

    // A pane keeps the status it was last seen with; the agent record is live.
    test('an agent’s status wins over the pane’s', () => {
      const map = workspaceInventories(
        [tab('t1', 'ws-1')],
        [pane('p1', 't1', 'idle')],
        [agent('p1', 'blocked')]
      );

      expect(inventoryOf(map, 'ws-1').status).toBe('blocked');
    });

    test('falls back to the pane’s own status when no agent record names it', () => {
      const map = workspaceInventories([tab('t1', 'ws-1')], [pane('p1', 't1', 'working')], []);

      expect(inventoryOf(map, 'ws-1').status).toBe('working');
    });

    // `starting` is on the wire but is not one of the five the app draws, and
    // narrowing it here is what keeps the chip's dot and the row's dot the same
    // colour for the same pane.
    test('narrows a status the app does not draw to unknown', () => {
      const map = workspaceInventories([tab('t1', 'ws-1')], [pane('p1', 't1', 'starting')], []);

      expect(inventoryOf(map, 'ws-1').status).toBe('unknown');
    });
  });
});
