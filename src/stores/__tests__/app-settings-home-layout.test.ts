import * as bunTest from 'bun:test';

const { beforeEach, describe, expect, test } = bunTest;
// `mock` is missing from the bun:test typings this project resolves, but the
// runtime has it; the store talks to the Keychain, which does not exist here.
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

const STORAGE_KEY = 'muqun.settings.v1';
let vault: Record<string, string> = {};
let readGate: Promise<void> | null = null;
let readFailure: Error | null = null;
let writeValues: string[] = [];
let writeGate: Promise<void> | null = null;
let writeFailure: Error | null = null;

mockModule('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly',
  getItemAsync: async (key: string) => {
    if (readGate) await readGate;
    if (readFailure) throw readFailure;
    return vault[key] ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    writeValues.push(value);
    if (writeValues.length === 1 && writeGate) await writeGate;
    if (writeFailure) {
      const failure = writeFailure;
      writeFailure = null;
      throw failure;
    }
    vault[key] = value;
  },
  deleteItemAsync: async (key: string) => {
    delete vault[key];
  },
}));

const { useAppSettings } = await import('../app-settings');
const { DEFAULT_HOME_LAYOUT } = await import('@/lib/home-layout');

const store = useAppSettings;
const initial = { ...store.getState() };

function reset(stored?: unknown) {
  vault = stored === undefined ? {} : { [STORAGE_KEY]: JSON.stringify(stored) };
  readGate = null;
  readFailure = null;
  writeValues = [];
  writeGate = null;
  writeFailure = null;
  store.setState({ ...initial, hydrated: false });
}

beforeEach(() => reset());

describe('home layout persistence', () => {
  test('Mechanical survives hydration and theme changes without a second appearance key', async () => {
    await store.getState().setHomeLayout('mechanical');
    await store.getState().update({ themePack: 'catppuccin' });
    store.setState({ ...initial, hydrated: false });
    await store.getState().hydrate();
    expect(store.getState().homeLayout).toBe('mechanical');
    expect(store.getState().themePack).toBe('catppuccin');
    expect(JSON.parse(vault[STORAGE_KEY]).appearanceProfile).toBeUndefined();
  });
  test('uses classic when nothing is stored', async () => {
    await store.getState().hydrate();
    expect(store.getState().homeLayout).toBe(DEFAULT_HOME_LAYOUT);
  });

  test('persists editorial through the existing settings patch API', async () => {
    await store.getState().setHomeLayout('editorial');

    expect(store.getState().homeLayout).toBe('editorial');
    expect(JSON.parse(vault[STORAGE_KEY]).homeLayout).toBe('editorial');
  });

  test('an unknown stored layout falls back without dropping other preferences', async () => {
    reset({ homeLayout: 'studio', themePack: 'catppuccin', hapticsEnabled: false });
    await store.getState().hydrate();

    expect(store.getState().homeLayout).toBe(DEFAULT_HOME_LAYOUT);
    expect(store.getState().themePack).toBe('catppuccin');
    expect(store.getState().hapticsEnabled).toBe(false);
  });

  test('a layout choice survives a restart and an unrelated settings write', async () => {
    await store.getState().setHomeLayout('editorial');
    await store.getState().update({ hapticsEnabled: false });

    store.setState({ ...initial, hydrated: false });
    await store.getState().hydrate();

    expect(store.getState().homeLayout).toBe('editorial');
    expect(store.getState().hapticsEnabled).toBe(false);
  });
});

describe('settings hydration and writes', () => {
  test('shares one read and preserves a patch made while it is pending', async () => {
    let releaseRead!: () => void;
    readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    vault = {
      [STORAGE_KEY]: JSON.stringify({ themePack: 'catppuccin', hapticsEnabled: false }),
    };

    const firstHydration = store.getState().hydrate();
    const secondHydration = store.getState().hydrate();
    await Promise.resolve();
    expect(firstHydration).toBe(secondHydration);

    const update = store.getState().update({ homeLayout: 'editorial' });
    releaseRead();
    await Promise.all([firstHydration, secondHydration, update]);

    expect(store.getState().homeLayout).toBe('editorial');
    expect(store.getState().themePack).toBe('catppuccin');
    expect(store.getState().hapticsEnabled).toBe(false);
    expect(JSON.parse(vault[STORAGE_KEY])).toMatchObject({
      homeLayout: 'editorial',
      themePack: 'catppuccin',
      hapticsEnabled: false,
    });
  });

  test('serializes concurrent writes so an older write cannot win last', async () => {
    await store.getState().hydrate();
    let releaseWrite!: () => void;
    writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const firstWrite = store.getState().update({ homeLayout: 'editorial' });
    const secondWrite = store.getState().update({ hapticsEnabled: false });
    await Promise.resolve();
    expect(writeValues).toHaveLength(1);

    // Resolve the first write's gate, then let the queued second write finish.
    releaseWrite();
    writeGate = null;
    await Promise.all([firstWrite, secondWrite]);

    expect(JSON.parse(vault[STORAGE_KEY])).toMatchObject({
      homeLayout: 'editorial',
      hapticsEnabled: false,
    });
  });

  test('recovers the save queue after one write fails', async () => {
    await store.getState().hydrate();
    writeFailure = new Error('disk full');

    await expect(store.getState().update({ homeLayout: 'editorial' })).rejects.toThrow('disk full');
    await store.getState().update({ hapticsEnabled: false });

    expect(JSON.parse(vault[STORAGE_KEY])).toMatchObject({
      homeLayout: 'editorial',
      hapticsEnabled: false,
    });
  });

  test('persists an update made while a read fails', async () => {
    let releaseRead!: () => void;
    readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    readFailure = new Error('keychain unavailable');

    const hydration = store.getState().hydrate();
    await Promise.resolve();
    const update = store.getState().update({ homeLayout: 'editorial' });
    releaseRead();
    await Promise.all([hydration, update]);

    expect(store.getState().homeLayout).toBe('editorial');
    expect(JSON.parse(vault[STORAGE_KEY])).toMatchObject({ homeLayout: 'editorial' });
  });
});
