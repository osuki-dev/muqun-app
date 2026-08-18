// The language the home-screen tile speaks, decided with no app on screen.
//
// The failure this file guards is a disagreement, not a crash: the widget task
// resolving one locale while the app resolves another, from the same persisted
// preference and the same device list. So the assertions are all about *order*
// -- an explicit choice in Settings beats the system, including when it agrees
// with it; a `null` preference hands the decision back to the device; a device
// asking for something we do not ship falls through to the next tag it named.
//
// `activateLocale` and the eight catalogs are behind a mock deliberately. That
// module pulls the `@formatjs` polyfills, which are published for a bundler's
// resolution rules rather than Bun's and do not import here at all -- and what
// is worth proving is that the right locale reaches `activate`, not that Lingui
// can load a catalog, which `catalogs.test.ts` already renders for real.
import * as bunTest from 'bun:test';

import type { AppLocale } from '../locale';

const { beforeEach, describe, expect, test } = bunTest;
// `mock` is missing from the bun:test typings this project resolves, but the
// runtime has it; both the keychain and the device's language list are native.
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

/** What the OS says the user's languages are, most-wanted first. */
let deviceTags: string[] = ['en-US'];
/** Set when `getLocales()` is meant to be unavailable rather than empty. */
let deviceThrows = false;

mockModule('expo-localization', () => ({
  getLocales: () => {
    if (deviceThrows) throw new Error('no localization module in this binary');
    return deviceTags.map((languageTag) => ({ languageTag }));
  },
}));

/** Every `activateLocale` call the module made, in order. */
const activated: string[] = [];
/** Stands in for the global Lingui instance's currently active locale. */
const fakeI18n = { locale: '' };

mockModule('../index', () => ({
  activateLocale: (locale: string) => {
    activated.push(locale);
    fakeI18n.locale = locale;
  },
  i18n: fakeI18n,
}));

const { activateWidgetLocale } = await import('../headless');
const { useAppSettings } = await import('@/stores/app-settings');

const initialSettings = { ...useAppSettings.getState() };

/**
 * A cold headless wake: nothing hydrated, nothing activated, and whatever the
 * Settings screen last wrote sitting in the keychain.
 */
function coldStart(stored?: Record<string, unknown>) {
  vault = stored === undefined ? {} : { [STORAGE_KEY]: JSON.stringify(stored) };
  useAppSettings.setState({ ...initialSettings, hydrated: false });
  activated.length = 0;
  fakeI18n.locale = '';
  deviceTags = ['en-US'];
  deviceThrows = false;
}

beforeEach(() => coldStart());

describe('the persisted override', () => {
  const overrides: [AppLocale, string[]][] = [
    ['zh-TW', ['en-US']],
    ['ja', ['de-DE', 'en-US']],
    ['pt', ['ko-KR']],
  ];
  test.each(overrides)('a stored %s wins over a device asking for something else', async (language, tags) => {
    coldStart({ language });
    deviceTags = tags;

    expect(await activateWidgetLocale()).toBe(language);
    expect(activated).toEqual([language]);
  });

  test('it wins even when it agrees with the device, which is the point of it', async () => {
    // The distinction that matters later: a user who pinned German and then
    // switches their phone to French should stay on German.
    coldStart({ language: 'de' });
    deviceTags = ['de-DE'];
    expect(await activateWidgetLocale()).toBe('de');

    coldStart({ language: 'de' });
    deviceTags = ['fr-FR'];
    expect(await activateWidgetLocale()).toBe('de');
  });

  test('a language the app no longer ships is not a language', async () => {
    // The store's own guard, reached through the widget: `it` is not in
    // `APP_LOCALES`, so it is discarded on hydrate and the device decides.
    coldStart({ language: 'it' });
    deviceTags = ['ko-KR'];
    expect(await activateWidgetLocale()).toBe('ko');
  });
});

describe('following the system', () => {
  test('no stored preference hands the decision to the device', async () => {
    deviceTags = ['fr-CA', 'en-US'];
    expect(await activateWidgetLocale()).toBe('fr');
  });

  test('an explicit null is the same as never having chosen', async () => {
    coldStart({ language: null });
    deviceTags = ['ja-JP'];
    expect(await activateWidgetLocale()).toBe('ja');
  });

  test('the first tag we ship wins, not the first tag', async () => {
    deviceTags = ['it-IT', 'nl-NL', 'es-MX', 'en-US'];
    expect(await activateWidgetLocale()).toBe('es');
  });

  test('Traditional Chinese is matched by script and by region', async () => {
    deviceTags = ['zh-Hant-HK'];
    expect(await activateWidgetLocale()).toBe('zh-TW');
  });

  test('Simplified Chinese deliberately reaches English, not the Traditional catalog', async () => {
    deviceTags = ['zh-Hans-CN'];
    expect(await activateWidgetLocale()).toBe('en');
  });
});

describe('when there is nothing to read', () => {
  test('an empty keychain and an English device is English', async () => {
    expect(await activateWidgetLocale()).toBe('en');
    expect(activated).toEqual(['en']);
  });

  test('a corrupt settings blob still leaves the tile with a language', async () => {
    vault = { [STORAGE_KEY]: '{not json at all' };
    useAppSettings.setState({ ...initialSettings, hydrated: false });
    deviceTags = ['ja-JP'];

    // The store swallows the parse failure and keeps its defaults, so the
    // device is still asked -- which is better than falling to English.
    expect(await activateWidgetLocale()).toBe('ja');
  });

  test('a device that lists no language at all is English rather than a throw', async () => {
    deviceTags = [];
    expect(await activateWidgetLocale()).toBe('en');
  });

  test('a localization module that throws does not take the render with it', async () => {
    deviceThrows = true;
    expect(await activateWidgetLocale()).toBe('en');
    expect(activated).toEqual(['en']);
  });

  test('a stored override survives a device that cannot be asked', async () => {
    coldStart({ language: 'ko' });
    deviceThrows = true;
    expect(await activateWidgetLocale()).toBe('ko');
  });
});

describe('activation is not repeated for its own sake', () => {
  // `i18n.activate` notifies Lingui's provider whether or not the locale moved,
  // and Android can raise WIDGET_ADDED while the app is in the foreground. A
  // second activation there re-renders the entire app to reach the same pixels.
  test('a redraw in the language already showing activates nothing', async () => {
    coldStart({ language: 'fr' });
    expect(await activateWidgetLocale()).toBe('fr');
    expect(activated).toEqual(['fr']);

    expect(await activateWidgetLocale()).toBe('fr');
    expect(activated).toEqual(['fr']);
  });

  test('a language the user changed under a live context is picked up', async () => {
    coldStart({ language: 'fr' });
    expect(await activateWidgetLocale()).toBe('fr');

    // The app wrote a new choice; the store is the same instance the app holds.
    await useAppSettings.getState().update({ language: 'ko' });
    expect(await activateWidgetLocale()).toBe('ko');
    expect(activated).toEqual(['fr', 'ko']);
  });
});
