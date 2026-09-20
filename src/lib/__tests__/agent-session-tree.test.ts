import { describe, expect, test } from 'bun:test';

import type { AgentSessionInfo } from '../agent-protocol';
import {
  ancestorPath,
  buildSessionStrip,
  indexSessions,
  parentOf,
  rootOf,
  sessionsInWorkspace,
  SESSION_STRIP_MAX_NODES,
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
