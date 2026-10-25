import { expect, test } from 'bun:test';
import { parseHomeOverview, type HomeOverview } from '../home-overview';
import { applyHomeOverview, parseHomeFrame, type HomeOverviewFrame } from '../home-summary';

const overview: HomeOverview = {
  workspaces: [
    {
      sessionId: 'work',
      agents: [{ id: 'p1', paneId: 'p1', name: 'Same name', status: 'working', hasAgent: true }],
    },
  ],
  sessions: [
    {
      asid: 'same-id',
      agentId: 'codex',
      title: 'Same name',
      status: 'busy',
      directory: '/work',
      updatedMs: 1,
    },
  ],
};
function frame(
  sourceId = 'a',
  revision = 1,
  extra: Record<string, unknown> = {}
): HomeOverviewFrame {
  const result = parseHomeFrame({
    t: 'home_overview',
    source_id: sourceId,
    generation: 'g1',
    revision,
    snapshot: revision === 1,
    tasks: [],
    removed: [],
    overview,
    fresh: true,
    ...extra,
  });
  if (!result || result.t !== 'home_overview') throw new Error('Invalid fixture');
  return result;
}

test('ready-to-display overview preserves Gateway ordering and refuses ambiguous identities', () => {
  expect(parseHomeOverview(overview)).toBe(overview);
  expect(
    parseHomeOverview({ ...overview, workspaces: [...overview.workspaces, ...overview.workspaces] })
  ).toBeNull();
  expect(
    parseHomeOverview({ ...overview, sessions: [...overview.sessions, ...overview.sessions] })
  ).toBeNull();
  expect(
    parseHomeOverview({ ...overview, sessions: [{ ...overview.sessions[0], agentId: '' }] })
  ).toBeNull();
  expect(
    parseHomeOverview({
      ...overview,
      sessions: [{ ...overview.sessions[0], terminal: { sessionId: 'work', paneId: '' } }],
    })
  ).toBeNull();
  expect(
    parseHomeOverview({
      ...overview,
      sessions: Array.from({ length: 51 }, (_, i) => ({
        ...overview.sessions[0],
        asid: String(i),
      })),
    })
  ).toBeNull();
});

test('separate source partitions retain colliding session and pane IDs independently', () => {
  const index = {
    a: applyHomeOverview(undefined, frame('a'), 100)!,
    b: applyHomeOverview(undefined, frame('b'), 100)!,
  };
  const changed = {
    ...overview,
    sessions: [{ ...overview.sessions[0], title: 'Changed only on B' }],
  };
  const next = {
    ...index,
    b: applyHomeOverview(index.b, frame('b', 2, { overview: changed }), 200)!,
  };
  expect(next.a).toBe(index.a);
  expect(next.a.overview?.sessions[0]?.title).toBe('Same name');
  expect(next.b.overview?.sessions[0]?.title).toBe('Changed only on B');
});

test('freshness updates retain entity references; failure and generation change clear coverage', () => {
  const first = applyHomeOverview(undefined, frame(), 100)!;
  const fresh = applyHomeOverview(first, frame('a', 2), 200)!;
  expect(fresh.overview).toBe(first.overview);
  expect(fresh.overviewAtMs).toBe(200);
  expect(applyHomeOverview(fresh, frame('a', 2), 300)).toBe(fresh);
  expect(applyHomeOverview(fresh, frame('a', 4), 300)).toBeNull();
  const failed = applyHomeOverview(fresh, frame('a', 3, { overview: null, fresh: false }), 300)!;
  expect(failed.overview).toBeNull();
  expect(failed.overviewAtMs).toBe(0);
  const restarted = applyHomeOverview(
    fresh,
    frame('a', 1, { generation: 'g2', overview: null, fresh: false }),
    400
  )!;
  expect(restarted.overview).toBeNull();
});
