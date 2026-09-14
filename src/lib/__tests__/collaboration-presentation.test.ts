import { describe, expect, test } from 'bun:test';
import {
  parseCollaborationTasks,
  partitionCollaborationTasks,
  recordCollaborationTask,
  type CollaborationTask,
} from '../agent-collaboration';
import {
  observeCollaborationOutput,
  createCollaborationRequestGuard,
  retainCollaborationSnapshots,
  selectedCollaborationTask,
} from '../collaboration-presentation';

const task: CollaborationTask = {
  id: 'dispatch-1',
  serverId: 'server',
  sessionId: 'session',
  sourcePaneId: 'source',
  paneId: 'pane',
  agentName: 'Assistant',
  agentInstanceId: 'instance-1',
  prompt: 'First instruction',
  createdAt: 1,
};
const agent = {
  id: 'pane',
  title: 'Assistant',
  subtitle: '',
  raw: { pane_id: 'pane', instance_id: 'instance-1' },
};

describe('collaboration reading selection', () => {
  test('every concurrent current assignment remains explicitly selectable', () => {
    const second = { ...task, id: 'dispatch-2', paneId: 'pane-2', agentInstanceId: 'instance-2' };
    const groups = partitionCollaborationTasks(
      [second, task],
      [
        agent,
        {
          id: 'pane-2',
          title: 'Second',
          subtitle: '',
          raw: { pane_id: 'pane-2', instance_id: 'instance-2' },
        },
      ]
    );
    expect(groups.current).toHaveLength(2);
    expect(selectedCollaborationTask(groups.current, task.id)).toBe(task);
    expect(selectedCollaborationTask(groups.current, second.id)).toBe(second);
  });

  test('offline restored reviewed, superseded and departed records remain reachable', () => {
    const reviewed = { ...task, id: 'reviewed', reviewed: true };
    const superseded = { ...task, id: 'superseded', superseded: true };
    const restored = parseCollaborationTasks(JSON.stringify([reviewed, superseded, task]));
    const { current, history } = partitionCollaborationTasks(restored, []);
    expect(current).toHaveLength(0);
    expect(history).toHaveLength(3);
    expect(selectedCollaborationTask(history, 'reviewed')?.reviewed).toBe(true);
    const locallyReviewed = history.map((item) =>
      item.id === task.id ? { ...item, reviewed: true } : item
    );
    const locallyRemoved = locallyReviewed.filter((item) => item.id !== 'superseded');
    expect(selectedCollaborationTask(locallyRemoved, task.id)?.reviewed).toBe(true);
    expect(selectedCollaborationTask(locallyRemoved, 'superseded')).toBeUndefined();
  });

  test('new dispatch and current-to-history transitions do not redirect selection', () => {
    const updated = recordCollaborationTask([task], { ...task, id: 'new', createdAt: 2 });
    expect(selectedCollaborationTask(updated, task.id)?.superseded).toBe(true);
    expect(
      selectedCollaborationTask(
        updated.filter((item) => item.id !== task.id),
        task.id
      )
    ).toBeUndefined();
  });
});

describe('pinned output lifecycle', () => {
  test('resumed observation preserves text and signature until explicit refresh', () => {
    const initial = observeCollaborationOutput(undefined, {
      text: 'Read this',
      signature: 'frame-1',
    });
    const reconnect = observeCollaborationOutput(initial, {
      text: 'New answer',
      signature: 'frame-2',
    });
    expect(reconnect).toEqual({ text: 'Read this', signature: 'frame-1', hasNewOutput: true });
    const backgroundResume = observeCollaborationOutput(reconnect, {
      text: 'Newest answer',
      signature: 'frame-3',
    });
    expect(backgroundResume.text).toBe('Read this');
    expect(
      observeCollaborationOutput(
        backgroundResume,
        { text: 'Newest answer', signature: 'frame-3' },
        true
      )
    ).toEqual({ text: 'Newest answer', signature: 'frame-3', hasNewOutput: false });
  });

  test('empty snapshots are initialized snapshots and other task refreshes do not change them', () => {
    const first = observeCollaborationOutput(undefined, { text: '', signature: '' });
    const second = observeCollaborationOutput(
      undefined,
      { text: 'Other task', signature: 'other' },
      true
    );
    expect(observeCollaborationOutput(first, { text: 'Later', signature: 'later' })).toEqual({
      text: '',
      signature: '',
      hasNewOutput: true,
    });
    expect(second.text).toBe('Other task');
  });
});

describe('collaboration async lifetime and retention', () => {
  test('removed and capacity-evicted snapshots are dropped while retained history stays pinned', () => {
    const pinned = { text: 'Private output', signature: 'frame', hasNewOutput: false };
    const cache = { removed: pinned, evicted: pinned, retained: pinned };
    const pruned = retainCollaborationSnapshots(cache, new Set(['retained']));
    expect(Object.keys(pruned)).toEqual(['retained']);
    expect(pruned.retained).toBe(pinned);
    expect(retainCollaborationSnapshots(pruned, new Set(['retained']))).toBe(pruned);
    expect(retainCollaborationSnapshots(pruned, new Set())).toEqual({});
  });

  test('session and selection invalidation prevent a delayed navigation from publishing', async () => {
    const guard = createCollaborationRequestGuard();
    const mayNavigate = guard.capture();
    let navigated = false;
    const completion = Promise.resolve().then(() => {
      if (mayNavigate()) navigated = true;
    });
    guard.invalidate();
    await completion;
    expect(navigated).toBe(false);
    expect(guard.capture()()).toBe(true);
  });

  test('returning to foreground cannot revive a pre-background refresh lease', () => {
    const activity = createCollaborationRequestGuard();
    const mayRefresh = activity.capture();
    activity.invalidate();
    const resumedObservation = activity.capture();
    expect(mayRefresh()).toBe(false);
    expect(resumedObservation()).toBe(true);
    activity.invalidate();
    expect(resumedObservation()).toBe(false);
  });
});
