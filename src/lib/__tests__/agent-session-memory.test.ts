import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

/** A map stands in for MMKV, exactly as `agent-model-memory.test.ts` does. */
const stored = new Map<string, string>();
mockModule('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
  }),
}));

const { loadRememberedAgentSession, rememberOpenedAgentSession } =
  await import('../agent-session-memory');

const KEY = 'muqun.agent-session.v1:herdr';

beforeEach(() => stored.clear());

describe('round trip', () => {
  test('nothing is remembered until a session is opened', () => {
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBeUndefined();
  });

  test('a session opened in a workspace comes back for that workspace', () => {
    rememberOpenedAgentSession('herdr', '/work/app', 'asid-b');
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBe('asid-b');
  });

  test('each workspace remembers its own', () => {
    rememberOpenedAgentSession('herdr', '/work/app', 'asid-b');
    rememberOpenedAgentSession('herdr', '/work/notes', 'asid-n');
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBe('asid-b');
    expect(loadRememberedAgentSession('herdr', '/work/notes')).toBe('asid-n');
  });

  test('a workspace with none of its own falls back to the last on this server', () => {
    rememberOpenedAgentSession('herdr', '/work/app', 'asid-b');
    expect(loadRememberedAgentSession('herdr', '/work/never-opened')).toBe('asid-b');
    expect(loadRememberedAgentSession('herdr')).toBe('asid-b');
  });

  test('two servers do not share a memory', () => {
    rememberOpenedAgentSession('herdr', '/work/app', 'asid-b');
    expect(loadRememberedAgentSession('other', '/work/app')).toBeUndefined();
  });

  test('a session opened with no workspace named is still the server-wide last', () => {
    rememberOpenedAgentSession('herdr', undefined, 'asid-x');
    expect(loadRememberedAgentSession('herdr')).toBe('asid-x');
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBe('asid-x');
  });
});

describe('what is not written', () => {
  test('no server and no session are both nothing to remember', () => {
    rememberOpenedAgentSession('', '/work/app', 'asid-b');
    rememberOpenedAgentSession('herdr', '/work/app', '');
    expect(stored.size).toBe(0);
    expect(loadRememberedAgentSession('', '/work/app')).toBeUndefined();
  });
});

describe('stored bytes this build did not write', () => {
  test('an unreadable payload is the same as an unwritten one', () => {
    stored.set(KEY, '{not json');
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBeUndefined();
  });

  test('a row with no asid is dropped rather than opened', () => {
    stored.set(KEY, JSON.stringify({ workspaces: { '/work/app': { at: 1 } } }));
    expect(loadRememberedAgentSession('herdr', '/work/app')).toBeUndefined();
  });
});

describe('the cap', () => {
  test('one server cannot grow past twenty-four workspaces', () => {
    for (let i = 0; i < 30; i++) {
      rememberOpenedAgentSession('herdr', `/work/${i}`, `asid-${i}`, 1000 + i);
    }
    const saved = JSON.parse(stored.get(KEY) ?? '{}') as {
      workspaces: Record<string, unknown>;
    };
    expect(Object.keys(saved.workspaces)).toHaveLength(24);
    // The oldest is what goes, so the most recent workspaces are all kept.
    expect(loadRememberedAgentSession('herdr', '/work/29')).toBe('asid-29');
    expect(loadRememberedAgentSession('herdr', '/work/0')).toBe('asid-29');
  });
});
