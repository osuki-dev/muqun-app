// The locale for code that runs with no app on screen.
//
// `AppI18nProvider` is how every screen gets a language: it reads the persisted
// preference out of the settings store, falls back to `expo-localization`'s
// ordered device list, and calls `activateLocale`. None of that happens in the
// Android widget's headless task. Android starts that task with no activity, so
// nothing under `src/app` mounts, the provider module is never imported, and the
// global `i18n` has no catalog and no active locale at all -- which is not a
// silent English fallback but a throw, because `i18n._` refuses to translate
// before `activate`. The widget rendered English only because every string in it
// was a literal.
//
// So this is the provider's job, written for a context with no React in it. It
// deliberately resolves through exactly the same two inputs in exactly the same
// order -- persisted override first, device negotiation second -- by calling the
// same `resolveLocale` the hook calls, over the same settings store. Reading the
// store rather than the storage key directly is the point: the key, the JSON
// shape and the "is this still a locale we ship?" guard all live in one place,
// and a widget that quietly disagreed with the app about which language the user
// picked would be worse than one that stayed English.
//
// **What it costs.** Importing `./index` pulls the three `@formatjs` polyfills,
// their eight plural-rules data files, `@lingui/core` and all eight compiled
// catalogs into the headless task's module graph. In bundle terms that is zero:
// Metro ships one bundle, the app already imports every one of these modules,
// and the widget task runs inside that same bundle. What is paid is *evaluation*
// -- module factories that a headless wake used to skip now run. Measured under
// Bun on this machine (`Intl` polyfills ~21ms, `@lingui/core` ~4.7ms, the eight
// catalogs ~3.75ms, ~0.5ms each) that is roughly 30ms, and the polyfills, not
// the catalogs, are almost all of it. Loading one catalog instead of eight would
// save ~3ms, and it would cost a second hand-maintained list of eight locales in
// a codebase that has already decided such lists drift; it is not worth it. The
// whole ~30ms also sits against a headless wake that boots the entire JS bundle
// -- React Native, `expo-router/entry`, the Expo modules -- which is an order of
// magnitude more, and against a task that Android runs at most every 30 minutes
// (`updatePeriodMillis`), on add, and on resize.
import { getLocales } from 'expo-localization';

import { useAppSettings } from '@/stores/app-settings';

import { activateLocale, i18n } from './index';
import { resolveLocale, SOURCE_LOCALE, type AppLocale } from './locale';

/**
 * Make the global `i18n` ready to translate, and answer with the language it
 * settled on.
 *
 * Safe to call from either side of the widget: from the headless task, where it
 * does the whole job, and from the app's own push path, where the settings store
 * is already hydrated and the locale is already active, so it reads two values
 * and returns.
 *
 * The activation is guarded on a real change because `i18n.activate` notifies
 * Lingui's provider unconditionally. Android can raise `WIDGET_ADDED` while the
 * app is in the foreground, and re-activating the language it is already showing
 * would re-render the whole tree to arrive at the same pixels.
 */
export async function activateWidgetLocale(): Promise<AppLocale> {
  const locale = await resolveWidgetLocale();
  if (i18n.locale !== locale) activateLocale(locale);
  return locale;
}

/**
 * Never throws, and never answers with something that is not a locale we ship.
 *
 * A widget has no surface to report an error on, and the caller's next move is
 * to translate: an exception here would take the tile's whole render with it and
 * leave the home screen showing whatever it drew last. English is a worse answer
 * than the user's language and a much better one than a blank tile.
 */
async function resolveWidgetLocale(): Promise<AppLocale> {
  try {
    // A no-op once the app has run; a keychain read in the headless task. The
    // store owns the storage key, the parse and the guard, so this cannot drift
    // away from what the Settings screen wrote.
    await useAppSettings.getState().hydrate();
    return resolveLocale(useAppSettings.getState().language, deviceLocaleTags());
  } catch {
    return SOURCE_LOCALE;
  }
}

/**
 * The device's languages, most-wanted first -- `useLocales()` without the hook.
 *
 * `getLocales()` is synchronous and reads a value the OS has already resolved,
 * which is what makes it usable here at all. An empty list negotiates to the
 * source locale rather than to `undefined`.
 */
function deviceLocaleTags(): string[] {
  try {
    return getLocales().map((locale) => locale.languageTag);
  } catch {
    return [];
  }
}
