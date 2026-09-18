import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

/**
 * A map stands in for MMKV, which is a native module and does not exist here.
 * The fake is writable from the test, which is the only way to ask what the app
 * does with stored bytes it did not write -- a half-upgraded payload, or a
 * model ref missing its provider.
 */
const stored = new Map<string, string>();
mockModule('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (key: string) => stored.get(key),
    set: (key: string, value: string) => {
      stored.set(key, value);
    },
  }),
}));

const { loadRememberedAgentDefaults, rememberAgentChoice, rememberAgentMode, rememberAgentModel } =
  await import('../agent-model-memory');

const alpha = { provider_id: 'opencode', model_id: 'union-alpha' };
const nemotron = { provider_id: 'deepseek', model_id: 'nemotron-3.5' };
const KEY = 'muqun.agent-model.v1:herdr';

beforeEach(() => stored.clear());

describe('round trip', () => {
  test('nothing is remembered until the reader picks something', () => {
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({});
  });

  test('a model picked in a workspace comes back for that workspace and for the server', () => {
    rememberAgentModel('herdr', '/work/app', alpha);
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({
      workspace: { model: alpha },
      server: { model: alpha },
    });
  });

  test('a variant survives the trip', () => {
    rememberAgentModel('herdr', '/work/app', { ...alpha, variant: 'thinking' });
    expect(loadRememberedAgentDefaults('herdr', '/work/app').workspace?.model).toEqual({
      ...alpha,
      variant: 'thinking',
    });
  });

  test('the agent is remembered beside the model, and neither erases the other', () => {
    rememberAgentModel('herdr', '/work/app', alpha);
    rememberAgentMode('herdr', '/work/app', 'plan');
    expect(loadRememberedAgentDefaults('herdr', '/work/app').workspace).toEqual({
      model: alpha,
      agent: 'plan',
    });
  });

  test('the last pick wins', () => {
    rememberAgentModel('herdr', '/work/app', alpha);
    rememberAgentModel('herdr', '/work/app', nemotron);
    expect(loadRememberedAgentDefaults('herdr', '/work/app').workspace?.model).toEqual(nemotron);
  });
});

describe('scope', () => {
  test('one workspace does not answer for another, but the server still does', () => {
    rememberAgentModel('herdr', '/work/app', alpha);
    expect(loadRememberedAgentDefaults('herdr', '/work/notes')).toEqual({
      server: { model: alpha },
    });
  });

  test('servers are kept apart', () => {
    rememberAgentModel('herdr', '/work/app', alpha);
    rememberAgentModel('other', '/work/app', nemotron);
    expect(loadRememberedAgentDefaults('herdr', '/work/app').workspace?.model).toEqual(alpha);
    expect(loadRememberedAgentDefaults('other', '/work/app').workspace?.model).toEqual(nemotron);
  });

  test('a pick made with no workspace on screen is still the server-wide fallback', () => {
    rememberAgentModel('herdr', undefined, alpha);
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({ server: { model: alpha } });
  });

  test('a server with no id is not a scope', () => {
    rememberAgentModel('', '/work/app', alpha);
    expect(stored.size).toBe(0);
    expect(loadRememberedAgentDefaults('', '/work/app')).toEqual({});
  });
});

describe('what was stored is not trusted', () => {
  test('bytes that are not JSON are the same as nothing', () => {
    stored.set(KEY, 'not json');
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({});
  });

  test('a model ref missing its provider is dropped, not half-read', () => {
    stored.set(
      KEY,
      JSON.stringify({
        last: { model: { model_id: 'union-alpha' }, at: 1 },
        workspaces: { '/work/app': { model: { model_id: 'union-alpha' }, agent: 'plan', at: 1 } },
      })
    );
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({
      workspace: { agent: 'plan' },
    });
  });

  test('a payload shaped some other way does not throw', () => {
    stored.set(KEY, JSON.stringify({ workspaces: 'all of them' }));
    expect(loadRememberedAgentDefaults('herdr', '/work/app')).toEqual({});
  });
});

describe('bounds', () => {
  test('one server remembers a bounded number of workspaces, the newest ones', () => {
    for (let i = 0; i < 30; i++) {
      rememberAgentChoice('herdr', `/work/dir-${i}`, { model: alpha }, 1000 + i);
    }
    const memory = JSON.parse(stored.get(KEY) ?? '{}') as {
      workspaces: Record<string, unknown>;
    };
    expect(Object.keys(memory.workspaces)).toHaveLength(24);
    expect(loadRememberedAgentDefaults('herdr', '/work/dir-29').workspace?.model).toEqual(alpha);
    // The oldest is the one nobody is coming back for; it keeps the
    // server-wide fallback and loses only its own row.
    expect(loadRememberedAgentDefaults('herdr', '/work/dir-0')).toEqual({
      server: { model: alpha },
    });
  });
});
