import { expect, test } from 'bun:test';
import {
  applyHomeFrame,
  collectorOrder,
  parseHomeFrame,
  projectHomeTasks,
  type HomeSummaryFrame,
  type HomeSummaryConfig,
} from '../home-summary';
import { startHomeSummary, type SummaryControllerOptions } from '../home-summary-controller';
import { stageProgressLines } from '../stage-overlay';
import { homeWaitingTasks } from '../home-in-progress';

const wire = {
  t: 'home',
  source_id: 'a',
  generation: 'g1',
  revision: 1,
  snapshot: true,
  tasks: [
    { task_id: 'task', state: 'working', kind: 'delegation', title: 'Review', updated_ms: 10 },
  ],
  removed: [],
};
function snapshot(sourceId = 'a'): HomeSummaryFrame {
  const frame = parseHomeFrame({ ...wire, source_id: sourceId });
  if (!frame || frame.t !== 'home') throw new Error('fixture');
  return frame;
}

test('summary decoding refuses invalid ordering metadata and duplicate entities', () => {
  expect(parseHomeFrame({ ...wire, revision: 0 })).toBeNull();
  expect(parseHomeFrame({ ...wire, tasks: [wire.tasks[0], wire.tasks[0]] })).toBeNull();
  expect(parseHomeFrame({ ...wire, tasks: [{ task_id: 'task', state: 'invented' }] })).toBeNull();
});

test('snapshot, delta, deletion, duplicate delivery and restart have explicit semantics', () => {
  const first = applyHomeFrame(undefined, snapshot(), 100)!;
  expect(applyHomeFrame(first, snapshot(), 200)).toBe(first);
  expect(applyHomeFrame(first, { ...snapshot(), snapshot: false, revision: 3 }, 200)).toBeNull();
  expect(
    applyHomeFrame(first, { ...snapshot(), snapshot: false, generation: 'g2', revision: 2 }, 200)
  ).toBeNull();
  const unchanged = applyHomeFrame(first, { ...snapshot(), snapshot: false, revision: 2 }, 200)!;
  expect(unchanged.tasks).toBe(first.tasks);
  const removed = applyHomeFrame(
    unchanged,
    { ...snapshot(), snapshot: false, revision: 3, tasks: [], removed: ['task'] },
    300
  )!;
  expect(removed.tasks).toEqual([]);
  expect(applyHomeFrame(first, { ...snapshot(), generation: 'g2', tasks: [] }, 400)?.tasks).toEqual(
    []
  );
});

test('Home projections preserve full task details and no-op references without mutating the ledger', () => {
  const summary = applyHomeFrame(undefined, snapshot(), 100)!;
  const full = { ...summary.tasks[0]!, goal: 'The full private goal', updatedMs: 9 };
  const direct = { a: { tasks: [full], fetchedAt: 1 } };
  const projection = projectHomeTasks(direct, { a: summary }, { a: true }, direct);
  expect(projection.a?.tasks[0]?.goal).toBe(full.goal);
  expect(projection.a?.tasks[0]?.updatedMs).toBe(10);
  expect(direct.a.tasks[0]).toBe(full);
  const unchanged = projectHomeTasks(
    direct,
    { a: { ...summary, receivedAtMs: 200 } },
    { a: true },
    projection
  );
  expect(unchanged).toBe(projection);
  expect(projectHomeTasks(direct, { a: summary }, {}, projection).a).toBe(projection.a);
});

test('collector loss retains newer completion until direct data catches up', () => {
  const frame = snapshot();
  const task = frame.tasks[0]!;
  const direct = { a: { tasks: [{ ...task, receivedAtMs: 50 }], fetchedAt: 50 } };
  const summary = applyHomeFrame(
    undefined,
    {
      ...frame,
      tasks: [{ ...task, state: 'done', updatedMs: 2 }],
    },
    100
  )!;
  const projected = projectHomeTasks(direct, { a: summary }, {}, {});
  expect(projected.a?.tasks[0]?.state).toBe('done');
  const refreshed = { a: { tasks: [{ ...task, receivedAtMs: 200 }], fetchedAt: 200 } };
  expect(projectHomeTasks(refreshed, { a: summary }, {}, projected).a).toBe(refreshed.a);
});

function harness(ids = ['a', 'b'], useCollector = true) {
  const calls: {
    id: string;
    sources: unknown;
    receive: Parameters<SummaryControllerOptions['connect']>[2];
    lost: () => void;
    closed: boolean;
  }[] = [];
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
  const accepted: string[] = [];
  const selected: (string | null)[] = [];
  const config: HomeSummaryConfig = {
    preferred: 'a',
    collectors: [
      { serverId: 'a', sources: { b: { peer_id: 'ab', grant_id: 'gab' } } },
      { serverId: 'b', sources: { a: { peer_id: 'ba', grant_id: 'gba' } } },
    ],
  };
  const stop = startHomeSummary({
    pairedIds: ids,
    summaryIds: ids,
    config: useCollector ? config : { preferred: null, collectors: [] },
    connect(id, sources, receive, lost) {
      const call = { id, sources, receive, lost, closed: false };
      calls.push(call);
      return {
        close: () => {
          call.closed = true;
        },
      };
    },
    accept: (frame) => {
      accepted.push(frame.sourceId);
      return true;
    },
    clear: () => {},
    selected: (id) => selected.push(id),
    schedule(run, ms) {
      const timer = { run, ms, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const tick = (ms: number) => {
    const timer = timers.find((timer) => !timer.cancelled && timer.ms === ms);
    if (!timer) throw new Error('missing timer');
    timer.cancelled = true;
    timer.run();
  };
  return { stop, calls, timers, accepted, selected, tick, config };
}

test('one computer stays direct with no peer subscription or backup timer', () => {
  const h = harness(['a']);
  expect(h.calls.map((call) => [call.id, call.sources])).toEqual([['a', []]]);
  expect(h.timers).toEqual([]);
  expect(collectorOrder(h.config, ['a'])).toEqual([]);
  h.stop();
  expect(h.calls[0]?.closed).toBe(true);
});

test('collector failure selects a backup and fences late old-producer frames', () => {
  const h = harness();
  h.calls[0]!.receive(snapshot('a'));
  h.calls[0]!.receive(snapshot('b'));
  expect(h.selected.at(-1)).toBe('a');
  h.calls[0]!.lost();
  h.tick(0);
  expect(h.calls[0]?.closed).toBe(true);
  expect(h.calls[1]?.id).toBe('b');
  const count = h.accepted.length;
  h.calls[0]!.receive(snapshot('a'));
  expect(h.accepted.length).toBe(count);
  h.calls[1]!.receive(snapshot('b'));
  h.calls[1]!.receive(snapshot('a'));
  expect(h.selected.at(-1)).toBe('b');
  h.stop();
});

test('missing initial snapshots time out through backups into direct fallback', () => {
  const h = harness();
  h.tick(8000);
  h.tick(0);
  h.tick(8000);
  h.tick(0);
  expect(h.calls.slice(-2).map((call) => [call.id, call.sources])).toEqual([
    ['a', []],
    ['b', []],
  ]);
  expect(h.selected.at(-1)).toBeNull();
  h.stop();
  expect(h.calls.every((call) => call.closed)).toBe(true);
  expect(h.timers.every((timer) => timer.cancelled)).toBe(true);
});

test('a collector cannot inject a source the App did not request', () => {
  const h = harness();
  h.calls[0]!.receive(snapshot('unpaired'));
  expect(h.accepted).toEqual([]);
  h.stop();
});

test('a restarted source is retried without immediately dropping the healthy collector', () => {
  const h = harness();
  h.calls[0]!.receive(snapshot('a'));
  h.calls[0]!.receive(snapshot('b'));
  h.calls[0]!.receive({ t: 'home_status', sourceId: 'b', status: 'unavailable' });
  expect(h.calls[0]!.closed).toBe(false);
  h.calls[0]!.receive(snapshot('a'));
  h.tick(30_000);
  expect(h.calls[0]!.closed).toBe(true);
  expect(h.calls[1]!.id).toBe('a');
  h.calls[1]!.receive(snapshot('a'));
  h.calls[1]!.receive({ t: 'home_status', sourceId: 'b', status: 'unavailable' });
  expect(h.timers.some((timer) => !timer.cancelled && timer.ms === 60_000)).toBe(true);
  h.calls[1]!.receive(snapshot('b'));
  expect(h.timers.every((timer) => timer.cancelled)).toBe(true);
  h.stop();
});

test('Stage subtitles retire finished summary tasks and waiting never fabricates an approval', () => {
  const frame = snapshot();
  const working = {
    ...frame.tasks[0]!,
    progress: 'Reading the tests',
    binding: { kind: 'pane' as const, sessionId: 'terminal', paneId: 'pane', agentId: 'codex' },
  };
  const summary = applyHomeFrame(undefined, { ...frame, tasks: [working] }, 100)!;
  const index = projectHomeTasks({}, { a: summary }, { a: true }, {});
  const lines = stageProgressLines({ serverId: 'a', tasks: index.a!.tasks, nowMs: 100 });
  expect(lines.map((line) => line.text)).toEqual(['Reading the tests']);
  const done = applyHomeFrame(
    summary,
    {
      ...frame,
      snapshot: false,
      revision: 2,
      tasks: [{ ...working, state: 'done', updatedMs: 20, progress: undefined }],
    },
    200
  )!;
  const finished = projectHomeTasks({}, { a: done }, { a: true }, index);
  expect(stageProgressLines({ serverId: 'a', tasks: finished.a!.tasks, nowMs: 200 })).toEqual([]);
  const waiting = applyHomeFrame(
    done,
    {
      ...frame,
      snapshot: false,
      revision: 3,
      tasks: [{ ...working, state: 'waiting', updatedMs: 30 }],
    },
    300
  )!;
  const blocked = projectHomeTasks({}, { a: waiting }, { a: true }, finished);
  expect(homeWaitingTasks(blocked, ['a'], [], { nowMs: 300 })).toEqual([]);
});
