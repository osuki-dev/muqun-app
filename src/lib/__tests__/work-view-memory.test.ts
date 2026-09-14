import { expect, test } from 'bun:test';
import { WorkViewMemory, type WorkTaskView } from '../work-view-memory';

function view(id: string, text = ''): WorkTaskView {
  return {
    detail: {
      task: {
        id,
        session_id: 'session',
        repo_path: '/repo',
        title: id,
        brief: text,
        revision: 1,
        parent_task_id: null,
        policy: { allowed_agents: ['codex'], max_workers: 1 },
        created_at_ms: 1,
        updated_at_ms: 1,
        paused: false,
      },
      attempts: [],
      operations: [],
      results: [],
      reviews: [],
      cursor: 1,
    },
    selectedAttemptId: 'historical-attempt',
    selectedResultId: 'older-result',
    recipientId: 'current-recipient',
    requiresRefresh: true,
    hasUpdates: true,
    lifecycleObservation: null,
  };
}
test('returning recalls exact selected history and pinned output without selecting newer facts', () => {
  const memory = new WorkViewMemory();
  const old = view('task');
  memory.remember(old);
  const snapshot = { text: 'old output', signature: 'old output', hasNewOutput: true };
  memory.rememberOutput('task', 'historical-attempt', 'native-generation', snapshot);
  memory.saveAnchor(
    'detail',
    { itemId: 'result:older-result', relativeOffset: 15, rawOffset: 450 },
    'task'
  );
  expect(memory.recall('task')).toBe(old);
  expect(memory.output('task', 'historical-attempt', 'native-generation')).toBe(snapshot);
  expect(memory.output('task', 'historical-attempt', 'replacement-generation')).toBeUndefined();
  expect(memory.anchor('detail', 'task')?.itemId).toBe('result:older-result');
});
test('task LRU eviction preserves protected active and unresolved task snapshots', () => {
  const memory = new WorkViewMemory(3);
  memory.remember(view('pending'));
  memory.remember(view('old'));
  memory.remember(view('active'));
  memory.protect(['pending', 'active']);
  memory.remember(view('new'));
  expect(memory.recall('old')).toBeUndefined();
  expect(memory.recall('pending')).toBeDefined();
  expect(memory.recall('active')).toBeDefined();
  memory.protect(['pending', 'active', 'new']);
  expect(memory.remember(view('refused-cache'))).toBe(false);
  expect(memory.usage.tasks).toBe(3);
});
test('byte cap counts output text and signature and refuses growth without discarding protected data', () => {
  const memory = new WorkViewMemory(20, 6000);
  memory.remember(view('active'));
  memory.protect(['active']);
  const pinned = { text: 'small', signature: 'small', hasNewOutput: false };
  expect(memory.rememberOutput('active', 'attempt', 'generation', pinned)).toBe(true);
  expect(
    memory.rememberOutput('active', 'attempt', 'generation', {
      text: 'x'.repeat(3000),
      signature: 'x'.repeat(3000),
      hasNewOutput: false,
    })
  ).toBe(false);
  expect(memory.output('active', 'attempt', 'generation')).toBe(pinned);
  expect(memory.usage.bytes).toBeLessThanOrEqual(6000);
  expect(memory.remember(view('oversized', '界'.repeat(4000)))).toBe(false);
});
test('invalid anchors do not replace valid positions and reset drops all presentation content', () => {
  const memory = new WorkViewMemory();
  memory.remember(view('task'));
  memory.saveAnchor('list', { itemId: 'task', relativeOffset: 4, rawOffset: 90 });
  memory.saveAnchor('list', { itemId: 'bad', relativeOffset: NaN, rawOffset: 0 });
  expect(memory.anchor('list')?.itemId).toBe('task');
  memory.saveAnchor(
    'output',
    { itemId: 'line', relativeOffset: 0, rawOffset: -100, snapshotId: 'snapshot' },
    'task'
  );
  expect(memory.anchor('output', 'task')?.rawOffset).toBe(0);
  memory.clear();
  expect(memory.usage).toEqual({ tasks: 0, bytes: 0 });
  expect(memory.anchor('list')).toBeUndefined();
  expect(memory.recall('task')).toBeUndefined();
});
test('notices retain output anchor identity while explicit replacement changes it', () => {
  const memory = new WorkViewMemory();
  memory.remember(view('task'));
  memory.rememberOutput('task', 'attempt', 'native', {
    text: 'one',
    signature: 'one',
    hasNewOutput: false,
  });
  const pinned = memory.outputIdentity('task', 'attempt', 'native');
  memory.rememberOutput('task', 'attempt', 'native', {
    text: 'one',
    signature: 'one',
    hasNewOutput: true,
  });
  expect(memory.outputIdentity('task', 'attempt', 'native')).toBe(pinned);
  memory.rememberOutput('task', 'attempt', 'native', {
    text: 'two',
    signature: 'two',
    hasNewOutput: false,
  });
  expect(memory.outputIdentity('task', 'attempt', 'native')).not.toBe(pinned);
});
test('an uncached oversized refresh cannot resurrect the superseded reading revision', () => {
  const memory = new WorkViewMemory(20, 6000);
  memory.remember(view('task'));
  memory.protect(['task']);
  expect(memory.remember(view('task', 'large'.repeat(3000)))).toBe(false);
  expect(memory.recall('task')).toBeUndefined();
});
