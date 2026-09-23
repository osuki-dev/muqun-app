import { expect, test } from 'bun:test';
import { refreshHomeContinue } from '../home-continue-refresh';
import type { HomeRecentEntry } from '../home-recents';

const target = {
  kind: 'opencode-session' as const,
  serverId: 'chosen',
  sessionId: 'dev',
  directory: '/work',
  asid: 'agent-1',
};
const entries: HomeRecentEntry[] = [
  { key: 'chosen', target, title: 'Original', atMs: 1 },
  { key: 'other', target: { ...target, serverId: 'other' }, title: 'Other', atMs: 1 },
];
function setup(read: (path: string) => Promise<unknown>, isCurrent = () => true) {
  const writes: unknown[] = [];
  return {
    writes,
    run: () =>
      refreshHomeContinue({
        serverId: 'chosen',
        sessionId: 'dev',
        entries,
        read,
        isCurrent,
        recordPanes: async (value) => {
          writes.push(value);
        },
        observe: async (target, value) => {
          writes.push({ target, value });
        },
        updateTitle: async (target, title) => {
          writes.push({ target, title });
        },
      }),
  };
}

test('refreshes the selected inventory and observations without changing visits or other servers', async () => {
  const paths: string[] = [];
  const { writes, run } = setup(async (path) => {
    paths.push(path);
    if (path.includes('agent-sessions'))
      return { data: [{ asid: 'agent-1', title: 'Updated', status: 'busy', directory: '/work' }] };
    return { items: [] };
  });
  await run();
  expect(paths).toHaveLength(3);
  expect(paths.every((path) => path.startsWith('/api/sessions/dev/'))).toBe(true);
  expect(
    writes.some((value) => JSON.stringify(value) === JSON.stringify({ target, title: 'Updated' }))
  ).toBe(true);
  const observation = writes.find(
    (value) => typeof value === 'object' && value !== null && 'value' in value
  ) as { target: unknown; value: { status: string; observedAtMs: number } };
  expect(observation.target).toEqual(target);
  expect(observation.value.status).toBe('busy');
  expect(observation.value.observedAtMs).toBeGreaterThan(0);
  expect(entries[0].atMs).toBe(1);
  expect(writes.every((value) => !JSON.stringify(value).includes('other'))).toBe(true);
});

test('a late response after switching target publishes nothing', async () => {
  let current = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { writes, run } = setup(
    async () => {
      await gate;
      return { items: [] };
    },
    () => current
  );
  const pending = run();
  current = false;
  release();
  await pending;
  expect(writes).toEqual([]);
});

test('failed reads preserve stored observations instead of replacing them with empty success', async () => {
  const { writes, run } = setup(async () => {
    throw new Error('offline');
  });
  const results = await run();
  expect(results.every((result) => result.status === 'rejected')).toBe(true);
  expect(writes).toEqual([]);
});
