// The batched session read, held to one promise: an entity that came from
// `/snapshot` is the same entity that would have come from `/workspaces`,
// `/tabs` or `/panes`, and no caller can tell which route answered.
//
// The other half is the refusal that means "this gateway build has no such
// route". Getting that wrong in either direction is expensive: too narrow and
// an old gateway pays a 404 on every warm; too wide and one bad minute
// downgrades the app to the three-request path for the rest of the launch.
import { describe, expect, test } from 'bun:test';

import {
  endpointIsAbsent,
  SESSION_SNAPSHOT_CAPABILITY,
  sessionSnapshotFromAnswer,
  snapshotServesAgents,
} from '../session-snapshot';

/** What the gateway actually writes -- `backend/compat.rs`, `fn snapshot`. */
const answer = {
  result: {
    type: 'session_snapshot',
    workspaces: [{ workspace_id: '$0', name: 'main' }],
    tabs: [{ tab_id: '@2', workspace_id: '$0' }],
    panes: [{ pane_id: '%9', tab_id: '@2', agent: 'claude', agent_status: 'idle' }],
    agents: [
      {
        pane_id: '%9',
        agent: 'claude',
        agent_status: 'idle',
        instance_id: 'inst-1',
        target: 'opaque-target',
        state_change_seq: 7,
      },
    ],
  },
};

describe('reading the batched answer', () => {
  test('each list is taken from its own key, through the envelope', () => {
    const snapshot = sessionSnapshotFromAnswer(answer, false);
    expect(snapshot.workspaces.map((item) => item.id)).toEqual(['$0']);
    expect(snapshot.tabs.map((item) => item.id)).toEqual(['@2']);
    expect(snapshot.panes.map((item) => item.id)).toEqual(['%9']);
  });

  test('a pane keeps its raw fields, so the screen reads it exactly as before', () => {
    // `reconcileSelection`, the pane chips and `paneReading` all go through
    // `raw`. A batched pane that lost it would paint a different terminal from
    // the one `/panes` would have produced.
    const [pane] = sessionSnapshotFromAnswer(answer, false).panes;
    expect(pane.raw.tab_id).toBe('@2');
    expect(pane.raw.agent).toBe('claude');
    expect(pane.status).toBe('idle');
  });

  test('a gateway that does not announce the capability has its agents refused', () => {
    // Those agents are derived from the panes and carry no `instance_id` and no
    // `target`, so they are not a substitute for `/agents`. Null, not empty:
    // the caller has to be able to tell "ask elsewhere" from "none here".
    expect(sessionSnapshotFromAnswer(answer, false).agents).toBeNull();
  });

  test('a gateway that announces it has its agents taken as the agent list', () => {
    const agents = sessionSnapshotFromAnswer(answer, true).agents;
    expect(agents?.map((item) => item.id)).toEqual(['%9']);
    // The fields the derived shape used to omit, which are the whole reason the
    // separate call existed.
    expect(agents?.[0]?.raw.instance_id).toBe('inst-1');
    expect(agents?.[0]?.raw.target).toBe('opaque-target');
  });

  test('an announced gateway with no agents says empty, which is not null', () => {
    const none = { result: { type: 'session_snapshot', panes: [], agents: [] } };
    expect(sessionSnapshotFromAnswer(none, true).agents).toEqual([]);
  });

  test('an empty session reads as empty lists, not as a failure', () => {
    const empty = { result: { type: 'session_snapshot', workspaces: [], tabs: [], panes: [] } };
    expect(sessionSnapshotFromAnswer(empty, false)).toEqual({
      workspaces: [],
      tabs: [],
      panes: [],
      agents: null,
    });
  });

  test('nothing recognisable reads as empty rather than throwing', () => {
    const nothing = { workspaces: [], tabs: [], panes: [], agents: null };
    expect(sessionSnapshotFromAnswer(null, false)).toEqual(nothing);
    expect(sessionSnapshotFromAnswer('nonsense', false)).toEqual(nothing);
  });
});

describe('telling a missing route from a bad minute', () => {
  test('the statuses a router emits for a path it does not know', () => {
    for (const status of [404, 405, 501])
      expect(endpointIsAbsent(new Error(`HTTP ${status}: Not Found`))).toBe(true);
  });

  test('a gateway that has the route and could not serve it is not absent', () => {
    // Falling back on these would swap the batched path for three requests for
    // the rest of the launch, over one transient failure.
    for (const status of [400, 401, 403, 429, 500, 502, 503])
      expect(endpointIsAbsent(new Error(`HTTP ${status}: nope`))).toBe(false);
  });

  test('a timeout or a thrown non-error is not a missing route', () => {
    expect(endpointIsAbsent(new Error('Timed out waiting for the server.'))).toBe(false);
    expect(endpointIsAbsent('HTTP 404')).toBe(false);
    expect(endpointIsAbsent(undefined)).toBe(false);
  });

  test('a 404 mentioned inside a body does not count; only the status does', () => {
    expect(endpointIsAbsent(new Error('HTTP 500: upstream returned 404'))).toBe(false);
  });

  test('a longer status starting with 404 is not a 404', () => {
    expect(endpointIsAbsent(new Error('HTTP 4040: what'))).toBe(false);
  });
});

describe('whose agents may be believed', () => {
  // Both gateways answer 200 with an `agents` array, so the reply alone cannot
  // tell them apart -- a derived agent and a real one differ by an absent
  // field, and "no instance_id anywhere" is also what a current gateway says
  // about a session of plain shells. And AGENTS.md forbids guessing from the
  // version. The capability is the gateway's own answer, so it is the one read.
  test('the announced capability is what says yes', () => {
    expect(snapshotServesAgents({ capabilities: ['session_snapshot'] })).toBe(true);
    expect(SESSION_SNAPSHOT_CAPABILITY).toBe('session_snapshot');
  });

  test('a gateway announcing other things, but not this one, says no', () => {
    expect(snapshotServesAgents({ capabilities: ['agent_collaboration', 'tasks'] })).toBe(false);
  });

  test('a health with no capability list at all says no', () => {
    // A gateway old enough to omit the field has told us nothing, and nothing
    // is not permission.
    expect(snapshotServesAgents({})).toBe(false);
    expect(snapshotServesAgents(null)).toBe(false);
    expect(snapshotServesAgents(undefined)).toBe(false);
  });

  test('a capability list that is not a list says no', () => {
    expect(snapshotServesAgents({ capabilities: 'session_snapshot' })).toBe(false);
    expect(snapshotServesAgents({ capabilities: { session_snapshot: true } })).toBe(false);
  });

  test('a near miss is not a match', () => {
    expect(snapshotServesAgents({ capabilities: ['session_snapshots'] })).toBe(false);
    expect(snapshotServesAgents({ capabilities: ['snapshot'] })).toBe(false);
  });
});
