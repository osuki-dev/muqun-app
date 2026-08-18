// The theme choice, on the round trip: that it is written where the rest of
// the settings live, that it comes back after a restart, and -- the part that
// decides whether a bad blob is a broken app or a plain one -- that anything
// unreadable lands on the default instead of on a theme id nothing answers to.
import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
// `mock` is missing from the bun:test typings this project resolves, but the
// runtime has it; the store talks to the Keychain, which does not exist here.
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

const STORAGE_KEY = 'muqun.settings.v1';
let vault: Record<string, string> = {};

mockModule('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: async (key: string) => vault[key] ?? null,
  setItemAsync: async (key: string, value: string) => {
    vault[key] = value;
  },
}));

const { useAppSettings } = await import('../app-settings');
const { DEFAULT_THEME_PACK_ID, THEME_PACK_IDS } = await import('@/constants/theme-packs');

const store = useAppSettings;
const initial = { ...store.getState() };

/** A fresh install: nothing stored, nothing hydrated. */
function reset(stored?: unknown) {
  vault = stored === undefined ? {} : { [STORAGE_KEY]: JSON.stringify(stored) };
  store.setState({ ...initial, hydrated: false });
}

beforeEach(() => reset());

describe('the default', () => {
  test('a fresh install is on the default pack', () => {
    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
  });

  test('hydrating with nothing stored leaves it there', async () => {
    await store.getState().hydrate();
    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
    expect(store.getState().hydrated).toBe(true);
  });
});

describe('persistence', () => {
  test('choosing a pack writes it into the settings blob', async () => {
    await store.getState().update({ themePack: 'catppuccin' });
    expect(store.getState().themePack).toBe('catppuccin');
    expect(JSON.parse(vault[STORAGE_KEY]).themePack).toBe('catppuccin');
  });

  test('the choice survives a restart', async () => {
    await store.getState().update({ themePack: 'everforest' });
    const persisted = vault[STORAGE_KEY];

    // A new launch: the store starts at its defaults and reads the vault back.
    store.setState({ ...initial, hydrated: false });
    vault = { [STORAGE_KEY]: persisted };
    await store.getState().hydrate();

    expect(store.getState().themePack).toBe('everforest');
  });

  test('the theme rides along with the settings it shares a blob with', async () => {
    // The blob is written whole on every update, so a later write of an
    // unrelated setting must not drop the theme -- which is exactly what a
    // forgotten line in `pickPersisted` would do.
    await store.getState().update({ themePack: 'tokyo-night' });
    await store.getState().update({ hapticsEnabled: false });

    const written = JSON.parse(vault[STORAGE_KEY]);
    expect(written.themePack).toBe('tokyo-night');
    expect(written.hapticsEnabled).toBe(false);
  });

  test.each([...THEME_PACK_IDS])('%s round-trips', async (id) => {
    await store.getState().update({ themePack: id });
    store.setState({ ...initial, hydrated: false });
    await store.getState().hydrate();
    expect(store.getState().themePack).toBe(id);
  });
});

describe('a stored value we cannot use', () => {
  const junk: [string, unknown][] = [
    ['a pack that no longer exists', 'nord'],
    ['an empty string', ''],
    ['the wrong type', 42],
    ['null', null],
    ['an object', { id: 'osuki' }],
  ];
  test.each(junk)('%s hydrates to the default', async (_label, stored) => {
    reset({ themePack: stored });
    await store.getState().hydrate();
    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
  });

  test('a corrupt blob does not take the rest of the settings down with it', async () => {
    vault = { [STORAGE_KEY]: '{not json at all' };
    store.setState({ ...initial, hydrated: false });
    await store.getState().hydrate();

    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
    expect(store.getState().hydrated).toBe(true);
  });

  test('a bad theme does not discard the settings stored beside it', async () => {
    reset({ themePack: 'not-a-pack', hapticsEnabled: false, serverCardPanes: 'agents' });
    await store.getState().hydrate();

    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
    expect(store.getState().hapticsEnabled).toBe(false);
    expect(store.getState().serverCardPanes).toBe('agents');
  });

  test('a blob written before themes existed hydrates without one', async () => {
    reset({ hapticsEnabled: false, terminalTextSize: 'large' });
    await store.getState().hydrate();

    expect(store.getState().themePack).toBe(DEFAULT_THEME_PACK_ID);
    expect(store.getState().terminalTextSize).toBe('large');
  });
});
