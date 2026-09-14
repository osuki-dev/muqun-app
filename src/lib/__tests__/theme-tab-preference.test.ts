import * as bunTest from 'bun:test';

const { beforeEach, expect, test } = bunTest;
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

/**
 * A map stands in for MMKV, which is a native module and does not exist here.
 * The fake is writable from the test, which is the only way to ask what the app
 * does with a stored value it does not recognise -- the real store can only
 * ever be given one of the two tabs by `saveThemeTab`.
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

const { loadThemeTab, saveThemeTab } = await import('../theme-tab-preference');

beforeEach(() => stored.clear());

test('nothing is remembered until a tab is chosen', () => {
  expect(loadThemeTab()).toBeNull();
});

test('both tabs round-trip', () => {
  saveThemeTab('mine');
  expect(loadThemeTab()).toBe('mine');
  saveThemeTab('builtin');
  expect(loadThemeTab()).toBe('builtin');
});

test('a value this build does not have is unset, not a stranding', () => {
  // A future third tab that is later removed must not leave a reader pointed at
  // a screen that no longer exists.
  stored.set('muqun.theme-tab.v1', 'downloads');
  expect(loadThemeTab()).toBeNull();
  stored.set('muqun.theme-tab.v1', '');
  expect(loadThemeTab()).toBeNull();
});
