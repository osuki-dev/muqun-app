// The batched session read, held to one promise: an entity that came from
// `/snapshot` is the same entity that would have come from `/workspaces`,
// `/tabs` or `/panes`, and no caller can tell which route answered.
//
// The other half is the refusal that means "this gateway build has no such
// route". Getting that wrong in either direction is expensive: too narrow and
// an old gateway pays a 404 on every warm; too wide and one bad minute
// downgrades the app to the three-request path for the rest of the launch.
import { describe, expect, test } from 'bun:test';

import { endpointIsAbsent, sessionSnapshotFromAnswer } from '../session-snapshot';

/** What the gateway actually writes -- `backend/compat.rs`, `fn snapshot`. */
const answer = {
  result: {
    type: 'session_snapshot',
    workspaces: [{ workspace_id: '$0', name: 'main' }],
    tabs: [{ tab_id: '@2', workspace_id: '$0' }],
    panes: [{ pane_id: '%9', tab_id: '@2', agent: 'claude', agent_status: 'idle' }],
    agents: [{ pane_id: '%9', agent: 'claude', agent_status: 'idle' }],
  },
};

describe('reading the batched answer', () => {
  test('each list is taken from its own key, through the envelope', () => {
    const snapshot = sessionSnapshotFromAnswer(answer);
    expect(snapshot.workspaces.map((item) => item.id)).toEqual(['$0']);
    expect(snapshot.tabs.map((item) => item.id)).toEqual(['@2']);
    expect(snapshot.panes.map((item) => item.id)).toEqual(['%9']);
  });

  test('a pane keeps its raw fields, so the screen reads it exactly as before', () => {
    // `reconcileSelection`, the pane chips and `paneReading` all go through
    // `raw`. A batched pane that lost it would paint a different terminal from
    // the one `/panes` would have produced.
    const [pane] = sessionSnapshotFromAnswer(answer).panes;
    expect(pane.raw.tab_id).toBe('@2');
    expect(pane.raw.agent).toBe('claude');
    expect(pane.status).toBe('idle');
  });

  test('the answer is read for its three lists and never for its agents', () => {
    // The batched agents are derived from panes and carry no `instance_id` or
    // `target`, so they are not a substitute for `/agents`. Nothing here may
    // quietly start returning them.
    expect(Object.keys(sessionSnapshotFromAnswer(answer))).toEqual(['workspaces', 'tabs', 'panes']);
  });

  test('an empty session reads as three empty lists, not as a failure', () => {
    const empty = { result: { type: 'session_snapshot', workspaces: [], tabs: [], panes: [] } };
    expect(sessionSnapshotFromAnswer(empty)).toEqual({ workspaces: [], tabs: [], panes: [] });
  });

  test('nothing recognisable reads as empty rather than throwing', () => {
    expect(sessionSnapshotFromAnswer(null)).toEqual({ workspaces: [], tabs: [], panes: [] });
    expect(sessionSnapshotFromAnswer('nonsense')).toEqual({ workspaces: [], tabs: [], panes: [] });
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
