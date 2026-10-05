import { expect, test } from 'bun:test';
import { refreshHomeContinue } from '../home-continue-refresh';
import type { HomeRecentEntry } from '../home-recents';

const target = {
  kind: 'agent-session' as const,
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

test('multi-gateway refresh prioritizes selection and never exceeds two active gateways', async () => {
  const { refreshHomeGateways } = await import('../home-continue-refresh');
  const started: string[] = [];
  const finish: (() => void)[] = [];
  let active = 0;
  let peak = 0;
  const run = refreshHomeGateways({
    records: ['a', 'b', 'c', 'b'].map((serverId) => ({ serverId })),
    selectedServerId: 'c',
    isCurrent: () => true,
    refresh: async ({ serverId }) => {
      started.push(serverId);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => finish.push(resolve));
      active--;
    },
  });
  expect(started).toEqual(['c', 'a']);
  finish.shift()!();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toEqual(['c', 'a', 'b']);
  finish.forEach((resolve) => resolve());
  await run;
  expect(peak).toBe(2);
});

test('one failed gateway does not stop others, and leaving Home stops queued reads', async () => {
  const { refreshHomeGateways } = await import('../home-continue-refresh');
  const started: string[] = [];
  await refreshHomeGateways({
    records: ['a', 'b', 'c'].map((serverId) => ({ serverId })),
    isCurrent: () => true,
    refresh: async ({ serverId }) => {
      started.push(serverId);
      if (serverId === 'a') throw new Error('offline');
    },
  });
  expect(started).toEqual(['a', 'b', 'c']);
  let current = true;
  const stopped: string[] = [];
  await refreshHomeGateways({
    records: ['a', 'b', 'c'].map((serverId) => ({ serverId })),
    isCurrent: () => current,
    refresh: async ({ serverId }) => {
      stopped.push(serverId);
      current = false;
    },
  });
  expect(stopped).toEqual(['a']);
});

test("the selected gateway's merged agent sessions are recorded and repair a recent's agent", async () => {
  const paths: string[] = [];
  const recorded: unknown[] = [];
  const repaired: unknown[] = [];
  await refreshHomeContinue({
    serverId: 'chosen',
    sessionId: 'dev',
    entries,
    read: async (path) => {
      paths.push(path);
      if (path.startsWith('/api/agent-sessions'))
        return {
          data: [
            {
              asid: 'agent-1',
              agent_id: 't3',
              title: 'Pong Response',
              status: 'idle',
              updated_ms: 5,
            },
            {
              asid: 'agent-2',
              agent_id: 'deepseek',
              title: 'Other',
              status: 'busy',
              updated_ms: 9,
            },
          ],
        };
      if (path.includes('agent-sessions'))
        return { data: [{ asid: 'agent-1', agent_id: 't3', title: 'Pong Response' }] };
      return { items: [] };
    },
    isCurrent: () => true,
    recordPanes: async () => {},
    observe: async () => {},
    updateTitle: async () => {},
    repairAgent: async (target, agentId) => {
      repaired.push({ asid: target.kind === 'agent-session' ? target.asid : '', agentId });
    },
    recordAgentSessions: (snapshot) => recorded.push(snapshot),
  });
  expect(paths).toContain('/api/agent-sessions?roots=true&limit=8&order=desc');
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({
    serverId: 'chosen',
    sessionId: 'dev',
    sessions: [
      { asid: 'agent-2', agentId: 'deepseek' },
      { asid: 'agent-1', agentId: 't3' },
    ],
  });
  expect(JSON.stringify(repaired)).toContain('{"asid":"agent-1","agentId":"t3"}');
  expect(repaired.every((value) => (value as { agentId: string }).agentId === 't3')).toBe(true);
});

test('a gateway that is not selected lists no agent sessions', async () => {
  const paths: string[] = [];
  const { run } = setup(async (path) => {
    paths.push(path);
    return { items: [] };
  });
  await run();
  expect(paths.some((path) => path.startsWith('/api/agent-sessions'))).toBe(false);
});
