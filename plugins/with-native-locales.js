// Which languages the *system* is told this app speaks, taken from the same
// place the strings themselves come from.
//
// `native-locales/<tag>.json` is already the source for the app name and the
// permission sentences: prebuild turns each file into an iOS
// `<tag>.lproj/InfoPlist.strings` and an Android `values-b+<tag>/strings.xml`.
// But two things the OS reads are not written from those files, and without
// them the translations are invisible outside the app:
//
//   * `CFBundleLocalizations` -- what the App Store lists under Languages.
//   * `android:localeConfig` -- without it Muqun does not appear in Android
//     13's per-app language picker at all.
//
// expo-localization's plugin writes both, given the list. Reading the list off
// the directory rather than restating it means adding a language is still one
// file: drop `it.json` in and the strings, the store listing and the system
// picker all follow. A second copy of the list is how this comes apart.
const fs = require('fs');
const path = require('path');

const withExpoLocalization = require('expo-localization/plugin/build/withExpoLocalization').default;

const LOCALES_DIR = path.join(__dirname, '..', 'native-locales');

module.exports = function withNativeLocales(config) {
  const supportedLocales = fs
    .readdirSync(LOCALES_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.basename(file, '.json'))
    // English first: it is the development region, and the rest is alphabetical
    // so a diff of this list is readable when a language is added.
    .sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));

  if (supportedLocales.length === 0) {
    throw new Error('native-locales/ is empty: the app would ship with no declared languages.');
  }

  return withExpoLocalization(config, { supportedLocales });
};
