import { describe, expect, test } from 'bun:test';

import type { AgentSessionInfo } from '../agent-protocol';
import {
  ancestorPath,
  activeFirstSessionChildren,
  buildRootSessionStrip,
  buildSessionStrip,
  flattenSessionTree,
  indexSessions,
  parentOf,
  rootOf,
  sessionsInWorkspace,
  SESSION_STRIP_MAX_NODES,
  loadSessionDescendants,
  mergeSessionChildren,
  type ChildrenByParent,
} from '../agent-session-tree';

function session(asid: string, extra: Partial<AgentSessionInfo> = {}): AgentSessionInfo {
  return {
    asid,
    backend_session_id: asid,
    title: asid,
    model: null,
    status: 'idle',
    updated_ms: 0,
    ...extra,
  };
}

const ROOT_A = session('ses_a', { directory: '/w/app' });
const ROOT_B = session('ses_b', { directory: '/w/app' });
const CHILD_A1 = session('ses_a1', { parent_id: 'ses_a', status: 'busy' });
const CHILD_A2 = session('ses_a2', { parent_id: 'ses_a' });
const GRANDCHILD = session('ses_a1x', { parent_id: 'ses_a1' });
const GREAT_GRANDCHILD = session('ses_a1xy', { parent_id: 'ses_a1x' });

const CHILDREN = {
  ses_a: [CHILD_A1, CHILD_A2],
  ses_a1: [GRANDCHILD],
  ses_a1x: [GREAT_GRANDCHILD],
};

describe('root-only strip and uncapped sheet projection', () => {
  test('a delayed inventory cannot erase a child announced while the request was in flight', async () => {
    const observed: ChildrenByParent = { ses_a: [CHILD_A2] };
    let current = observed;
    await loadSessionDescendants({
      rootAsid: ROOT_A.asid,
      known: observed,
      isCurrent: () => true,
      listChildren: async () => {
        // The stream announces a background child after the GET took its snapshot.
        current = { ses_a: [CHILD_A2, CHILD_A1], ses_a1: [GRANDCHILD] };
        return { children: [], authoritative: true };
      },
      onChildren: (parent, inventory) => {
        current = mergeSessionChildren(
          current,
          parent,
          inventory.children,
          inventory.authoritative,
          observed[parent] ?? []
        );
      },
    });
    expect(flattenSessionTree(ROOT_A, current).map((node) => node.session.asid)).toEqual([
      ROOT_A.asid,
      CHILD_A1.asid,
      GRANDCHILD.asid,
    ]);
    // A later inventory may remove the child normally; this is not an immortal cache.
    expect(mergeSessionChildren(current, ROOT_A.asid, [], true, current.ses_a).ses_a).toEqual([]);
  });

  test('stream updates beat stale inventory fields, but explicit deletion still wins', () => {
    const updated = { ...CHILD_A1, title: 'Background reviewer', status: 'retry' as const };
    const current = { ses_a: [updated] };
    expect(mergeSessionChildren(current, 'ses_a', [CHILD_A1], true, [CHILD_A1]).ses_a).toEqual([
      updated,
    ]);
    expect(
      mergeSessionChildren(current, 'ses_a', [{ ...CHILD_A1, deleted: true }], true, [CHILD_A1])
        .ses_a
    ).toEqual([]);
  });

  test('mixed inventory never renders children horizontally and selects their root', () => {
    const strip = buildRootSessionStrip(
      [ROOT_A, CHILD_A1, ROOT_B, ROOT_A],
      CHILDREN,
      GREAT_GRANDCHILD.asid
    );
    expect(strip.nodes.map((node) => [node.session.asid, node.depth, node.hasChildren])).toEqual([
      ['ses_a', 0, true],
      ['ses_b', 0, false],
    ]);
    expect(strip.selectedRootAsid).toBe(ROOT_A.asid);
    const mixed = buildRootSessionStrip([ROOT_A, CHILD_A1], {}, CHILD_A1.asid);
    expect(mixed.nodes).toHaveLength(1);
    expect(mixed.nodes[0]?.hasChildren).toBe(true);
    expect(mixed.selectedRootAsid).toBe(ROOT_A.asid);
    expect(buildRootSessionStrip([ROOT_A], CHILDREN, 'missing').selectedRootAsid).toBeUndefined();
  });

  test('preorder preserves arbitrary depth, sibling order and live session metadata', () => {
    const nodes = flattenSessionTree(ROOT_A, CHILDREN);
    expect(nodes.map((node) => [node.session.asid, node.depth])).toEqual([
      ['ses_a', 0],
      ['ses_a1', 1],
      ['ses_a1x', 2],
      ['ses_a1xy', 3],
      ['ses_a2', 1],
    ]);
    expect(nodes[1]?.session).toBe(CHILD_A1);
  });

  test('running descendants sort ahead of history, preserving Gateway order within each group', () => {
    const idleFirst = session('idle-first', { parent_id: ROOT_A.asid, status: 'idle' });
    const runningFirst = session('running-first', { parent_id: ROOT_A.asid, status: 'busy' });
    const completed = session('completed', { parent_id: ROOT_A.asid, status: 'failed' });
    const retrying = session('retrying', { parent_id: ROOT_A.asid, status: 'retry' });
    const idleLast = session('idle-last', { parent_id: ROOT_A.asid, status: 'idle' });
    const children = [idleFirst, runningFirst, completed, retrying, idleLast];

    const ordered = activeFirstSessionChildren(children);
    expect(ordered.map((child) => child.asid)).toEqual([
      'running-first',
      'retrying',
      'idle-first',
      'completed',
      'idle-last',
    ]);
    expect(ordered[0]).toBe(runningFirst);
    expect(ordered[1]).toBe(retrying);
    expect(
      flattenSessionTree(ROOT_A, { [ROOT_A.asid]: children }).map((node) => node.session.asid)
    ).toEqual([ROOT_A.asid, 'running-first', 'retrying', 'idle-first', 'completed', 'idle-last']);
  });

  test('more than 60 nodes and more than two levels are never truncated', () => {
    const children: Record<string, AgentSessionInfo[]> = {};
    for (let i = 0; i < 1000; i++) {
      const parent = i === 0 ? ROOT_A.asid : `deep-${i - 1}`;
      children[parent] = [session(`deep-${i}`, { parent_id: parent })];
    }
    const nodes = flattenSessionTree(ROOT_A, children);
    expect(nodes).toHaveLength(1001);
    expect(nodes.at(-1)?.depth).toBe(1000);
    expect(buildSessionStrip([ROOT_A], children, ROOT_A.asid)).toHaveLength(3);
  });

  test('cycles and duplicate children terminate with unique stable identities', () => {
    const children = { ...CHILDREN, ses_a: [CHILD_A1, CHILD_A1, ROOT_A], ses_a1xy: [CHILD_A1] };
    expect(flattenSessionTree(ROOT_A, children).map((node) => node.session.asid)).toEqual([
      'ses_a',
      'ses_a1',
      'ses_a1x',
      'ses_a1xy',
    ]);
    const cycle = session('cycle', { parent_id: 'cycle' });
    expect(
      buildRootSessionStrip([ROOT_A, cycle], { cycle: [cycle] }, 'cycle').selectedRootAsid
    ).toBeUndefined();
    expect(flattenSessionTree(undefined, children)).toEqual([]);
  });
});

describe('all-depth child loading', () => {
  test('visits each discovered parent once with bounded concurrency, preserving other roots', async () => {
    const tree: Record<string, AgentSessionInfo[]> = {
      ...CHILDREN,
      ses_a: [
        ...CHILDREN.ses_a,
        ...Array.from({ length: 12 }, (_, i) => session(`wide-${i}`, { parent_id: 'ses_a' })),
      ],
      ses_a1xy: [CHILD_A1],
    };
    let merged: ChildrenByParent = { ses_b: [session('other-child', { parent_id: 'ses_b' })] };
    const visited: string[] = [];
    let running = 0;
    let peak = 0;
    await loadSessionDescendants({
      rootAsid: 'ses_a',
      known: merged,
      isCurrent: () => true,
      listChildren: async (asid) => {
        visited.push(asid);
        peak = Math.max(peak, ++running);
        await Promise.resolve();
        running--;
        return { children: tree[asid] ?? [], authoritative: true };
      },
      onChildren: (parent, inventory) => {
        merged = mergeSessionChildren(merged, parent, inventory.children, inventory.authoritative);
      },
    });
    expect(visited).toContain('ses_a1xy');
    expect(new Set(visited).size).toBe(visited.length);
    expect(peak).toBe(4);
    expect(merged.ses_b?.[0]?.asid).toBe('other-child');
  });

  test('failed replies retain known branches and continue walking them', async () => {
    let merged: ChildrenByParent = CHILDREN;
    const visited: string[] = [];
    await loadSessionDescendants({
      rootAsid: ROOT_A.asid,
      known: CHILDREN,
      isCurrent: () => true,
      listChildren: async (asid) => {
        visited.push(asid);
        throw new Error(`offline: ${asid}`);
      },
      onChildren: (parent, inventory) => {
        merged = mergeSessionChildren(merged, parent, inventory.children, inventory.authoritative);
      },
    });
    expect(merged).toBe(CHILDREN);
    expect(visited).toContain(GREAT_GRANDCHILD.asid);
  });

  test('a successful inactive-root inventory removes missing children and their branches', async () => {
    const oldChild = session('old-child', { parent_id: ROOT_B.asid });
    const oldGrandchild = session('old-grandchild', { parent_id: oldChild.asid });
    let merged: ChildrenByParent = {
      ...CHILDREN,
      [ROOT_B.asid]: [oldChild],
      [oldChild.asid]: [oldGrandchild],
    };
    const visited: string[] = [];
    await loadSessionDescendants({
      rootAsid: ROOT_B.asid,
      known: merged,
      isCurrent: () => true,
      listChildren: async (asid) => {
        visited.push(asid);
        return { children: [], authoritative: true };
      },
      onChildren: (parent, inventory) => {
        merged = mergeSessionChildren(merged, parent, inventory.children, inventory.authoritative);
      },
    });

    expect(visited).toEqual([ROOT_B.asid]);
    expect(merged[ROOT_B.asid]).toEqual([]);
    expect(merged[oldChild.asid]).toBeUndefined();
    expect(flattenSessionTree(ROOT_B, merged).map((node) => node.session.asid)).toEqual([
      ROOT_B.asid,
    ]);
  });

  test('an authoritative self-edge is ignored without deleting legitimate children', () => {
    const legitimate = session('legitimate', { parent_id: ROOT_A.asid });
    const reconciled = mergeSessionChildren(
      { [ROOT_A.asid]: [CHILD_A1] },
      ROOT_A.asid,
      [ROOT_A, legitimate],
      true
    );

    expect(reconciled[ROOT_A.asid]?.map((child) => child.asid)).toEqual([legitimate.asid]);
  });

  test('superseded or owner-lost requests neither publish nor discover further nodes', async () => {
    let current = true;
    let published = false;
    const visited: string[] = [];
    await loadSessionDescendants({
      rootAsid: ROOT_A.asid,
      known: CHILDREN,
      isCurrent: () => current,
      listChildren: async (asid) => {
        visited.push(asid);
        current = false;
        return { children: CHILDREN.ses_a, authoritative: true };
      },
      onChildren: () => {
        published = true;
      },
    });
    expect(visited).toEqual([ROOT_A.asid]);
    expect(published).toBe(false);
  });
});

describe('indexSessions and the walk upwards', () => {
  const index = indexSessions([ROOT_A, ROOT_B], CHILDREN);

  test('every session in hand is in the index', () => {
    expect([...index.keys()].sort()).toEqual([
      'ses_a',
      'ses_a1',
      'ses_a1x',
      'ses_a1xy',
      'ses_a2',
      'ses_b',
    ]);
  });

  test('the chain runs nearest first, up to the root', () => {
    expect(ancestorPath('ses_a1x', index).map((s) => s.asid)).toEqual([
      'ses_a1x',
      'ses_a1',
      'ses_a',
    ]);
    expect(ancestorPath('ses_a', index).map((s) => s.asid)).toEqual(['ses_a']);
    expect(ancestorPath(undefined, index)).toEqual([]);
    expect(ancestorPath('ses_unknown', index)).toEqual([]);
  });

  test('root and parent read off that chain', () => {
    expect(rootOf('ses_a1x', index)?.asid).toBe('ses_a');
    expect(rootOf('ses_b', index)?.asid).toBe('ses_b');
    expect(rootOf(undefined, index)).toBeUndefined();
    expect(parentOf('ses_a1x', index)?.asid).toBe('ses_a1');
    expect(parentOf('ses_a', index)).toBeUndefined();
  });

  test('a parent cycle is bounded rather than hung on', () => {
    // A `parent_id` loop is a thing a remote program can send.
    const loopA = session('ses_x', { parent_id: 'ses_y' });
    const loopB = session('ses_y', { parent_id: 'ses_x' });
    const looped = indexSessions([loopA], { ses_x: [loopB] });
    expect(ancestorPath('ses_x', looped).map((s) => s.asid)).toEqual(['ses_x', 'ses_y']);
    expect(rootOf('ses_x', looped)?.asid).toBe('ses_y');
  });
});

describe('buildSessionStrip', () => {
  test('with nothing active, every root is one chip', () => {
    const strip = buildSessionStrip([ROOT_A, ROOT_B], CHILDREN, undefined);
    expect(strip.map((node) => [node.session.asid, node.depth])).toEqual([
      ['ses_a', 0],
      ['ses_b', 0],
    ]);
  });

  test('the active root opens; the others stay one chip each', () => {
    const strip = buildSessionStrip([ROOT_A, ROOT_B], CHILDREN, 'ses_a');
    expect(strip.map((node) => [node.session.asid, node.depth])).toEqual([
      ['ses_a', 0],
      ['ses_a1', 1],
      ['ses_a1x', 2],
      ['ses_a2', 1],
      ['ses_b', 0],
    ]);
  });

  test('a child being active opens its own root, not a second tree', () => {
    const strip = buildSessionStrip([ROOT_A, ROOT_B], CHILDREN, 'ses_a1x');
    expect(strip.map((node) => node.session.asid)).toEqual([
      'ses_a',
      'ses_a1',
      'ses_a1x',
      'ses_a2',
      'ses_b',
    ]);
  });

  test('it stops two levels under a root', () => {
    const strip = buildSessionStrip([ROOT_A], CHILDREN, 'ses_a');
    expect(strip.some((node) => node.session.asid === 'ses_a1xy')).toBe(false);
    expect(Math.max(...strip.map((node) => node.depth))).toBe(2);
  });

  test('a node says whether anything is drawn under it', () => {
    const strip = buildSessionStrip([ROOT_A, ROOT_B], CHILDREN, 'ses_a');
    const byId = Object.fromEntries(strip.map((node) => [node.session.asid, node]));
    expect(byId.ses_a.hasChildren).toBe(true);
    expect(byId.ses_a1.hasChildren).toBe(true);
    expect(byId.ses_a2.hasChildren).toBe(false);
    expect(byId.ses_b.hasChildren).toBe(false);
  });

  test('a runaway fan-out is capped rather than rendered', () => {
    const many = Array.from({ length: 500 }, (_, i) =>
      session(`ses_c${i}`, { parent_id: 'ses_a' })
    );
    const strip = buildSessionStrip([ROOT_A], { ses_a: many }, 'ses_a');
    expect(strip).toHaveLength(SESSION_STRIP_MAX_NODES);
    expect(buildSessionStrip([ROOT_A], { ses_a: many }, 'ses_a', 5)).toHaveLength(5);
  });

  test('no roots is no chips', () => {
    expect(buildSessionStrip([], {}, 'ses_a')).toEqual([]);
  });

  test('the live status travels with the session, so a chip can show it', () => {
    const strip = buildSessionStrip([ROOT_A], CHILDREN, 'ses_a');
    expect(strip.find((node) => node.session.asid === 'ses_a1')?.session.status).toBe('busy');
  });
});

describe('sessionsInWorkspace', () => {
  const sessions = [
    session('ses_1', { directory: '/w/app' }),
    session('ses_2', { directory: '/w/app/packages/ui' }),
    session('ses_3', { directory: '/w/other' }),
    session('ses_4', { project_id: 'proj' }),
    session('ses_5'),
    session('ses_6', { directory: '/w/apple' }),
  ];

  test('the directory, its children, and a matching project', () => {
    expect(
      sessionsInWorkspace(sessions, { directory: '/w/app', projectId: 'proj' }).map((s) => s.asid)
    ).toEqual(['ses_1', 'ses_2', 'ses_4']);
  });

  test('a sibling directory with a shared prefix is not inside it', () => {
    // `/w/apple` starts with `/w/app`, and is a different workspace.
    expect(sessionsInWorkspace(sessions, { directory: '/w/app' }).map((s) => s.asid)).toEqual([
      'ses_1',
      'ses_2',
    ]);
  });

  test('a trailing slash does not change the answer', () => {
    expect(sessionsInWorkspace(sessions, { directory: '/w/app/' }).map((s) => s.asid)).toEqual([
      'ses_1',
      'ses_2',
    ]);
  });

  test('the project canonical is a second directory to match against', () => {
    expect(sessionsInWorkspace(sessions, { canonical: '/w/other' }).map((s) => s.asid)).toEqual([
      'ses_3',
    ]);
  });

  test('with no workspace at all nothing matches, rather than everything', () => {
    expect(sessionsInWorkspace(sessions, {})).toEqual([]);
  });
});
