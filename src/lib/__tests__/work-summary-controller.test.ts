import { expect, test } from 'bun:test';
import { createWorkApi } from '../work-api';
import { WorkController } from '../work-controller';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const summary = {
  task_id: id(1),
  session_id: 'session',
  parent_task_id: null,
  task_revision: 1,
  title: 'Task',
  repo_path: '/repo',
  paused: false,
  last_activity: null,
  reserved_attempts: 0,
  unresolved_native_operations: 0,
  unreviewed_results: 0,
  latest_result: null,
};
const task = {
  id: id(1),
  session_id: 'session',
  parent_task_id: null,
  revision: 1,
  title: 'Task',
  repo_path: '/repo',
  paused: false,
  brief: 'Goal',
  policy: { allowed_agents: ['codex'], max_workers: 0 },
  created_at_ms: 1,
  updated_at_ms: 1,
};
function fixture(summaries: boolean) {
  const calls: string[] = [];
  let conflict = false;
  const api = createWorkApi(
    {
      serverId: 'gateway',
      label: 'Gateway',
      url: 'https://example.invalid',
      token: 'paired',
      pairedAt: 1,
    },
    'session',
    async (_record, path, request) => {
      expect(request.method).toBe('GET');
      calls.push(path);
      if (path.includes('/changes?'))
        return { status: 200, body: { changes: [], cursor: 10, reset_required: true } };
      if (path.includes('/task-summaries?')) {
        if (conflict)
          return {
            status: 409,
            body: { error: { code: 'revision_conflict', message: 'New task activity' } },
          };
        const next = path.includes('after_id=');
        return {
          status: 200,
          body: {
            items: [{ ...summary, task_id: next ? id(2) : id(1) }],
            snapshot_cursor: 9,
            next_after_id: next ? null : id(1),
          },
        };
      }
      if (path.includes('/tasks?'))
        return { status: 200, body: { tasks: [task], next_after_id: null } };
      if (path === `/api/sessions/session/work/tasks/${id(1)}`)
        return {
          status: 200,
          body: { task, attempts: [], operations: [], results: [], reviews: [], cursor: 8 },
        };
      throw new Error('List must not request per-task detail');
    }
  );
  const controller = new WorkController(
    api,
    async () => ({
      connected: true,
      records: true,
      execution: false,
      ...(summaries ? { summaries: true } : {}),
    }),
    () => {
      throw new Error('No mutation key');
    }
  );
  controller.activate();
  return {
    controller,
    calls,
    change: () => {
      conflict = true;
    },
  };
}
test('summary controller reads one compact page without per-row details and notifications only mark updates', async () => {
  const value = fixture(true);
  await value.controller.refresh();
  const pinned = value.controller.getSnapshot().tasks;
  expect(value.calls).toHaveLength(1);
  expect(pinned[0].summary?.task_id).toBe(id(1));
  value.controller.notifyUpdates();
  expect(value.controller.getSnapshot().tasks).toBe(pinned);
  expect(value.controller.getSnapshot().hasUpdates).toBe(true);
  expect(value.calls).toHaveLength(1);
  await value.controller.loadMore();
  expect(value.calls).toHaveLength(2);
  expect(value.calls.every((path) => path.includes('/task-summaries?'))).toBe(true);
  expect(value.controller.getSnapshot().tasks.map((row) => row.id)).toEqual([id(1), id(2)]);
});
test('summary cursor conflicts preserve displayed rows and continuation until explicit refresh', async () => {
  const value = fixture(true);
  await value.controller.refresh();
  const pinned = value.controller.getSnapshot().tasks;
  value.change();
  await value.controller.loadMore();
  expect(value.controller.getSnapshot().tasks).toBe(pinned);
  expect(value.controller.getSnapshot().nextAfterId).toBe(id(1));
  expect(value.controller.getSnapshot().error).toBe('conflict');
  expect(value.controller.getSnapshot().hasUpdates).toBe(true);
  expect(value.calls).toHaveLength(2);
});
test('old Gateway uses one legacy list request and neutral rows without guessed status', async () => {
  const value = fixture(false);
  await value.controller.refresh();
  expect(value.calls).toEqual(['/api/sessions/session/work/tasks?limit=50']);
  expect(value.controller.getSnapshot().tasks[0].summary).toBeUndefined();
  expect(value.controller.getSnapshot().tasks[0].title).toBe('Task');
});
test('summary-only list polls its snapshot cursor and retains the displayed page', async () => {
  const value = fixture(true);
  await value.controller.refresh();
  const pinned = value.controller.getSnapshot().tasks;
  await value.controller.checkUpdates();
  expect(value.calls[1]).toBe('/api/sessions/session/work/changes?after=9');
  expect(value.controller.getSnapshot().tasks).toBe(pinned);
  expect(value.controller.getSnapshot().summaryCursor).toBe(9);
  expect(value.controller.getSnapshot().detail).toBeNull();
  expect(value.controller.getSnapshot().hasUpdates).toBe(true);
});
test('explicit list refresh keeps remembered detail and uses the list cursor without a detail request', async () => {
  const value = fixture(true);
  await value.controller.refresh();
  await value.controller.selectTask(id(1));
  value.controller.setDraft('Keep this instruction');
  const pinned = value.controller.getSnapshot().detail;
  value.controller.showList();
  value.calls.length = 0;
  await value.controller.refresh();
  expect(value.calls).toEqual(['/api/sessions/session/work/task-summaries?limit=20']);
  expect(value.controller.getSnapshot().view).toBe('list');
  expect(value.controller.getSnapshot().detail).toBe(pinned);
  expect(value.controller.getSnapshot().draft).toBe('Keep this instruction');
  await value.controller.checkUpdates();
  expect(value.calls[1]).toBe('/api/sessions/session/work/changes?after=9');
  expect(value.controller.getSnapshot().detail).toBe(pinned);
});
