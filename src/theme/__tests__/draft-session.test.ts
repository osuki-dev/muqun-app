import { expect, test } from 'bun:test';
import { createThemeStarter } from '../authoring';
import { createThemeDraftSessions } from '../draft-session';

test('editor handoffs retain original draft without placing content in route parameters', () => {
  const sessions = createThemeDraftSessions();
  const draft = { manifest: createThemeStarter() };
  sessions.put('opaque-token', draft);
  expect(sessions.get('opaque-token')).toBe(draft);
  expect(sessions.get('unknown')).toBeUndefined();
  sessions.release('opaque-token');
  expect(sessions.get('opaque-token')).toBeUndefined();
  sessions.release('opaque-token');
});

test('draft storage is bounded and never evicts an active editor to admit another', () => {
  const sessions = createThemeDraftSessions();
  const draft = { manifest: createThemeStarter() };
  for (let index = 0; index < 4; index++) sessions.put(String(index), draft);
  expect(() => sessions.put('4', draft)).toThrow('Too many');
  expect(() => sessions.put('0', draft)).toThrow('Too many');
  expect(sessions.get('0')).toBe(draft);
  sessions.release('0');
  sessions.put('4', draft);
  expect(sessions.get('4')).toBe(draft);
});

test('prepared assets survive effect replay and are disposed once after the final route owner', async () => {
  const sessions = createThemeDraftSessions();
  let disposed = 0;
  const draft = {
    manifest: createThemeStarter(),
    prepared: {
      assets: {},
      install: async () => ({}),
      dispose: () => {
        disposed++;
      },
    },
  };
  sessions.put('route', draft);
  const first = sessions.hold('route');
  first();
  const replay = sessions.hold('route');
  await Promise.resolve();
  expect(disposed).toBe(0);
  expect(sessions.get('route')).toBe(draft);
  replay();
  replay();
  await Promise.resolve();
  expect(disposed).toBe(1);
  expect(sessions.get('route')).toBeUndefined();
});
