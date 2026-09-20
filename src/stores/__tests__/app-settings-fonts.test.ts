// The two font slots, on the round trip: that a reader's choice is written
// beside the rest of the settings, that it comes back after a restart, and --
// the part that decides whether a hand-edited blob is a path traversal or a
// plain app -- that anything the guard does not recognise lands on the system
// font with every other setting intact.
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
  deleteItemAsync: async (key: string) => {
    delete vault[key];
  },
}));

const { useAppSettings } = await import('../app-settings');
const { SYSTEM_FONT_SLOT } = await import('@/theme/user-font-file');
type FontSlot = import('@/theme/user-font-file').FontSlot;

const store = useAppSettings;
const initial = { ...store.getState() };

const INSTALLED: FontSlot = {
  kind: 'file',
  source: 'https://fonts.example/LXGWWenKaiMono.ttf',
  file: 'fonts/mono-a1b2c3d4e5f6.ttf',
  label: 'LXGWWenKaiMono',
  advanceRatio: 0.5,
  isMonospace: true,
};

function reset(stored?: unknown) {
  vault = stored === undefined ? {} : { [STORAGE_KEY]: JSON.stringify(stored) };
  store.setState({ ...initial, hydrated: false });
}

beforeEach(() => reset());

describe('the default', () => {
  test('a fresh install is on the system font in both slots', async () => {
    await store.getState().hydrate();
    expect(store.getState().interfaceFont).toEqual(SYSTEM_FONT_SLOT);
    expect(store.getState().monoFont).toEqual(SYSTEM_FONT_SLOT);
  });
});

describe('persistence', () => {
  test('an installed font is written into the settings blob', async () => {
    await store.getState().update({ monoFont: INSTALLED });
    expect(JSON.parse(vault[STORAGE_KEY]).monoFont).toEqual(INSTALLED);
  });

  test('the choice survives a restart, path and measurement together', async () => {
    await store.getState().update({ monoFont: INSTALLED });
    const persisted = vault[STORAGE_KEY];

    store.setState({ ...initial, hydrated: false });
    vault = { [STORAGE_KEY]: persisted };
    await store.getState().hydrate();

    // The measured advance is the half that matters most on a cold start: it
    // is what sizes the PTY on the first frame, before the canvas has loaded
    // the font and measured a real cell.
    expect(store.getState().monoFont).toEqual(INSTALLED);
  });

  test('the two slots are independent', async () => {
    await store.getState().update({ monoFont: INSTALLED });
    expect(store.getState().interfaceFont).toEqual(SYSTEM_FONT_SLOT);

    const serif: FontSlot = {
      kind: 'file',
      source: 'Source Han Serif.otf',
      file: 'fonts/interface-9f9f.otf',
      label: 'Source Han Serif',
    };
    await store.getState().update({ interfaceFont: serif });
    expect(store.getState().monoFont).toEqual(INSTALLED);
    expect(store.getState().interfaceFont).toEqual(serif);
  });

  test('a font rides along with the settings it shares a blob with', async () => {
    // The blob is written whole on every update, so a later write of an
    // unrelated setting must not drop the font -- which is exactly what a
    // forgotten line in `pickPersisted` would do.
    await store.getState().update({ monoFont: INSTALLED });
    await store.getState().update({ hapticsEnabled: false });

    const written = JSON.parse(vault[STORAGE_KEY]);
    expect(written.monoFont).toEqual(INSTALLED);
    expect(written.hapticsEnabled).toBe(false);
  });

  test('going back to the system font clears the slot rather than emptying it', async () => {
    await store.getState().update({ monoFont: INSTALLED });
    await store.getState().update({ monoFont: SYSTEM_FONT_SLOT });

    store.setState({ ...initial, hydrated: false });
    await store.getState().hydrate();
    expect(store.getState().monoFont).toEqual(SYSTEM_FONT_SLOT);
  });
});

describe('a stored slot we cannot use', () => {
  const junk: [string, unknown][] = [
    ['a path climbing out of the fonts directory', { ...INSTALLED, file: '../../../etc/passwd' }],
    ['an absolute path from a build that stored one', { ...INSTALLED, file: '/var/fonts/x.ttf' }],
    ['a file URI', { ...INSTALLED, file: 'file:///data/fonts/x.ttf' }],
    ['a path outside the fonts directory', { ...INSTALLED, file: 'themes/x.ttf' }],
    ['no label', { ...INSTALLED, label: '' }],
    ['no source', { ...INSTALLED, source: null }],
    ['a kind this build does not know', { kind: 'bundled', id: 'inter' }],
    ['a string', 'fonts/mono.ttf'],
    ['null', null],
    ['a number', 42],
  ];
  test.each(junk)('%s hydrates to the system font', async (_label, stored) => {
    reset({ monoFont: stored });
    await store.getState().hydrate();
    expect(store.getState().monoFont).toEqual(SYSTEM_FONT_SLOT);
  });

  test('a bad font does not discard the settings stored beside it', async () => {
    reset({
      monoFont: { kind: 'file', file: '../escape' },
      hapticsEnabled: false,
      themePack: 'catppuccin',
    });
    await store.getState().hydrate();

    expect(store.getState().monoFont).toEqual(SYSTEM_FONT_SLOT);
    expect(store.getState().hapticsEnabled).toBe(false);
    expect(store.getState().themePack).toBe('catppuccin');
  });

  test('a blob written before fonts existed hydrates without them', async () => {
    reset({ hapticsEnabled: false, terminalTextSize: 'large' });
    await store.getState().hydrate();

    expect(store.getState().interfaceFont).toEqual(SYSTEM_FONT_SLOT);
    expect(store.getState().monoFont).toEqual(SYSTEM_FONT_SLOT);
    expect(store.getState().terminalTextSize).toBe('large');
  });

  test('a nonsense measurement is dropped without dropping the font', async () => {
    // The file is still good; only the number is not. The slot survives and
    // the terminal falls back to the bundled face's own advance.
    reset({ monoFont: { ...INSTALLED, advanceRatio: 0 } });
    await store.getState().hydrate();

    const slot = store.getState().monoFont;
    expect(slot.kind).toBe('file');
    expect(slot.kind === 'file' ? slot.file : null).toBe(INSTALLED.file);
    expect(slot.kind === 'file' ? slot.advanceRatio : 'x').toBeUndefined();
  });
});
