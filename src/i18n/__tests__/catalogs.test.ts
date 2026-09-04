// The catalogs as they will actually ship.
//
// `bun run i18n:compile` writes these from the .po files, and the compiled
// output is what the bundle imports. A translation that was never written, or a
// compile that was never re-run after an extract, is invisible in review and
// obvious here.
//
// Deliberately reads the compiled `.ts` rather than the `.po`: the `.po` is the
// source a translator edits, but the `.ts` is what the app renders, and the gap
// between the two is exactly the mistake worth catching.
//
// Every assertion below is written over `APP_LOCALES` rather than over a list of
// its own. Eight languages is enough that a hand-maintained second list would
// drift, and a drift test that has drifted is worse than no test: it passes.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupI18n, type Messages } from '@lingui/core';

import { messages as enMessages } from '../locales/en/messages';
import { messages as zhTWMessages } from '../locales/zh-TW/messages';
import { messages as jaMessages } from '../locales/ja/messages';
import { messages as koMessages } from '../locales/ko/messages';
import { messages as deMessages } from '../locales/de/messages';
import { messages as frMessages } from '../locales/fr/messages';
import { messages as esMessages } from '../locales/es/messages';
import { messages as ptMessages } from '../locales/pt/messages';
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from '../locale';
import { EDITOR_ACTIONS } from '@/lib/terminal-keys';

type Catalog = Record<string, unknown>;

const catalogs: Record<AppLocale, Catalog> = {
  en: enMessages as Catalog,
  'zh-TW': zhTWMessages as Catalog,
  ja: jaMessages as Catalog,
  ko: koMessages as Catalog,
  de: deMessages as Catalog,
  fr: frMessages as Catalog,
  es: esMessages as Catalog,
  pt: ptMessages as Catalog,
};

/** Every locale but the source one -- the ones that have something to translate. */
const TRANSLATED_LOCALES = APP_LOCALES.filter((locale) => locale !== 'en');

// Every character here exists only in the Simplified set. Shared characters
// (three common CJK characters) are deliberately absent -- one of them in the list makes the
// whole assertion cry wolf. Module-level because two suites hold zh-TW text to
// it: the compiled catalog, and the native locale files prebuild reads.
const SIMPLIFIED_ONLY =
  /[设备终码复关闭连线务应确认输报书间华语开个门问题这们时网络显项启动组统释译验]/u;

function blankEntries(catalog: Catalog): string[] {
  return Object.entries(catalog)
    .filter(([, value]) => {
      if (typeof value === 'string') return value.trim() === '';
      return Array.isArray(value) && value.length === 0;
    })
    .map(([id]) => id);
}

describe('the compiled catalogs', () => {
  test('there is exactly one per locale we claim to speak', () => {
    expect(Object.keys(catalogs).sort()).toEqual([...APP_LOCALES].sort());
  });

  test('English is not empty, which would mean an extract never ran', () => {
    expect(Object.keys(enMessages).length).toBeGreaterThan(100);
  });

  // The point of the eight-language expansion, asserted once per language. A
  // locale added to `APP_LOCALES` with nothing behind it fails here rather than
  // shipping a screen that is half English.
  test.each(TRANSLATED_LOCALES)('%s covers every message English has', (locale) => {
    const untranslated = Object.keys(enMessages).filter((id) => !(id in catalogs[locale]));
    expect(untranslated).toEqual([]);
  });

  test.each(TRANSLATED_LOCALES)('%s is not empty', (locale) => {
    // Distinct from the coverage check above. A catalog whose compile failed
    // silently is an empty object, and every message it is missing then reports
    // as one indistinguishable blob; this says which catalog it was.
    expect(Object.keys(catalogs[locale]).length).toBe(Object.keys(enMessages).length);
  });

  test.each(TRANSLATED_LOCALES)('no %s entry was left as an empty string', (locale) => {
    expect(blankEntries(catalogs[locale])).toEqual([]);
  });

  // The hole the three assertions above cannot see, and it was open.
  //
  // `lingui compile` writes the English source into the compiled catalog when a
  // `msgstr` is empty. So a message nobody ever translated is *present* (the
  // coverage check passes), is *not blank* (the emptiness check passes), and is
  // English. Every gate in this file went green over `Insert {0} {1}`, which sat
  // untranslated in all seven languages and rendered English in every one.
  //
  // The `.po` is the only artefact where "translated" and "fell back to English"
  // are still distinguishable, so this reads it. Two suites below already do
  // exactly this for their own vocabularies -- the editor key row and the widget
  // -- which is how those two were kept honest while the other five hundred
  // messages were not. This generalises it to the whole catalog and leaves those
  // two as the specific cases they should always have been.
  //
  // A translation that is legitimately identical to the English -- a brand name,
  // a loanword all seven keep -- is a *filled in* `msgstr` and passes. Only an
  // empty one fails, and that can only mean nobody wrote it.
  test.each(TRANSLATED_LOCALES)('every %s message was actually translated', (locale) => {
    const po = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', locale, 'messages.po'),
      'utf8'
    );
    // The header is the one legitimate `msgid ""`; its `msgstr` is a multi-line
    // block rather than `""`, so it never matches. Multi-line message bodies are
    // likewise written as `msgstr ""` followed by continuation lines, so the
    // pattern requires the empty string to be the end of the entry.
    const untranslated = [...po.matchAll(/^msgid "(.+)"\nmsgstr ""\n(?:\n|$)/gm)].map(
      (match) => match[1]
    );
    expect(untranslated).toEqual([]);
  });

  test.each(APP_LOCALES)('%s carries no message the source no longer has', (locale) => {
    // `lingui extract --clean` is what enforces this; the assertion is here so
    // that skipping the flag shows up as a failing test rather than as dead
    // weight in the bundle.
    const orphaned = Object.keys(catalogs[locale]).filter((id) => !(id in enMessages));
    expect(orphaned).toEqual([]);
  });

  // A cheap, high-signal check on the thing a review cannot eyeball: that the
  // "Traditional" catalog is actually Traditional. These characters exist only
  // in the Simplified set, so a single hit means Simplified copy was pasted in.
  //
  // There is deliberately no equivalent for the six Latin-script languages. No
  // cheap character test distinguishes Spanish from Portuguese, and one that
  // almost does would fail on the loanwords all six keep in English. Those are
  // held to coverage and non-emptiness here, and to a human reading the
  // screenshots.
  test('the Traditional catalog contains no Simplified-only characters', () => {
    const offenders = Object.entries(zhTWMessages)
      .filter(([, value]) => SIMPLIFIED_ONLY.test(JSON.stringify(value)))
      .map(([id, value]) => `${id}: ${JSON.stringify(value)}`);
    expect(offenders).toEqual([]);
  });

  // The picker labels each language in its own language, so a locale added
  // without a label renders an empty option rather than throwing.
  test.each(APP_LOCALES)('%s has a label written in its own language', (locale) => {
    const label = LOCALE_LABELS[locale] ?? '';
    expect(label.length).toBeGreaterThan(0);
    expect(label.trim()).toBe(label);
  });

  test('no two languages are labelled the same way', () => {
    const labels = APP_LOCALES.map((locale) => LOCALE_LABELS[locale]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// The editor key row's own vocabulary, held to a bar the tests above cannot set.
//
// `lingui compile` falls back to the English source when a `msgstr` is empty, so
// an untranslated message is present in the compiled catalog, is not blank, and
// is English. Coverage and non-emptiness both pass. That is how the ten editor
// commands sat in six catalogs reading "Write the file" -- and it is a row where
// the cap is vim's vocabulary in every language, so the description beside it is
// the only thing carrying meaning.
//
// Reads the `.po` deliberately, which is the one place the difference between
// "translated" and "fell back" still exists.
describe('the editor key-row descriptions', () => {
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
  const labelsSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'labels.ts'),
    'utf8'
  );

  /** `'nvim:w': msg\`Write the file\`` -> `{ 'nvim:w': 'Write the file' }`. */
  const described = new Map(
    [...labelsSource.matchAll(/'(nvim:[^']+)':\s*msg`([^`]+)`/g)].map(
      (match) => [match[1], match[2]] as const
    )
  );

  function translationIn(locale: AppLocale, english: string): string | null {
    const po = readFileSync(join(localesDir, locale, 'messages.po'), 'utf8');
    const escaped = english.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = po.match(new RegExp(`^msgid "${escaped}"\\nmsgstr "(.*)"$`, 'm'));
    return found ? found[1] : null;
  }

  test('every action on the row says what it does', () => {
    // Including the leader combos, where the cap is `␣sg` and nothing about it
    // suggests "search the project".
    const undescribed = EDITOR_ACTIONS.map((item) => item.key).filter((key) => !described.has(key));
    expect(undescribed).toEqual([]);
    expect(described.size).toBe(EDITOR_ACTIONS.length);
  });

  test.each(TRANSLATED_LOCALES)('%s translates all of them rather than falling back', (locale) => {
    const untranslated = [...described.values()].filter(
      (english) => !translationIn(locale, english)
    );
    expect(untranslated).toEqual([]);
  });
});

// The Android home-screen tile, held to the same bar for a different reason.
//
// The widget is drawn from a headless task with no provider above it, so its
// copy goes through `i18n._(msg`...`)` on the global instance rather than a
// hook. Nothing about that shape is checked by a compiler or a linter: a string
// left as a bare literal there renders English on a Japanese phone and every
// test above still passes, because the string simply is not in the catalog to
// be counted. So the source is read and each message is followed all the way
// through -- into the English catalog, which proves the macro expanded and an
// extract was re-run, and then into each `.po`, which is the only place a
// translation that was written can be told from one that fell back to English.
//
// The tile is also the surface with the least room to explain itself, which is
// exactly why it must not be the one surface still speaking English.
describe('the home-screen widget copy', () => {
  const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'locales');
  const layoutSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'agent-widget-layout.tsx'),
    'utf8'
  );
  const labelsSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'labels.ts'),
    'utf8'
  );

  /**
   * Source text -> the id the extractor wrote.
   *
   * The macro names a placeholder after the expression inside it when that
   * expression is a plain identifier, and numbers it from zero otherwise --
   * which is why `${parts.value}m ago` in the widget lands on the very
   * `{0}m ago` the rest of the app already says, and `${overflow}` keeps its
   * name. Reimplemented here rather than assumed, because getting it wrong
   * would silently look for ids that do not exist; the English-catalog
   * assertion below is what stops that from passing quietly.
   */
  function messageId(template: string): string {
    let positional = 0;
    return template.replace(/\$\{([^}]*)\}/g, (_match, expression: string) => {
      const trimmed = expression.trim();
      return /^[A-Za-z_$][\w$]*$/.test(trimmed) ? `{${trimmed}}` : `{${positional++}}`;
    });
  }

  /** Every `` msg`...` `` the tile builds, comments stripped first. */
  const widgetMessages = [
    ...layoutSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .matchAll(/(?<![\w$.])msg`([^`\\]*)`/g),
  ].map((match) => messageId(match[1]));

  function translationIn(locale: AppLocale, id: string): string | null {
    const po = readFileSync(join(localesDir, locale, 'messages.po'), 'utf8');
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = po.match(new RegExp(`^msgid "${escaped}"\\nmsgstr "(.*)"$`, 'm'));
    return found ? found[1] : null;
  }

  test('the tile has copy, and it goes through the macro', () => {
    // Both halves of the tile draw an empty state, a freshness line, an
    // overflow count and a label for the screen reader; a scan that finds
    // almost nothing means the regex stopped matching, not that the widget
    // stopped talking.
    expect(widgetMessages.length).toBeGreaterThanOrEqual(8);
    expect(new Set(widgetMessages).size).toBeGreaterThanOrEqual(8);
  });

  /**
   * A compiled entry turned back into the text it was written as.
   *
   * The compiled catalogs are keyed by hash, not by source, so a message cannot
   * simply be looked up by the words in it. What it can be matched against is
   * the compiled *value*: a message with no placeholders compiles to a
   * one-element array of the string, and one with placeholders to the tokens
   * around them, each placeholder itself an array holding its name. Rejoining
   * those gives back exactly the id the extractor wrote.
   */
  function rebuilt(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (!Array.isArray(value)) return null;
    const parts = value.map((token) => {
      if (typeof token === 'string') return token;
      if (Array.isArray(token) && typeof token[0] === 'string') return `{${token[0]}}`;
      return null;
    });
    return parts.every((part) => part !== null) ? parts.join('') : null;
  }

  const englishCatalog = new Set(
    Object.values(enMessages as Record<string, unknown>)
      .map(rebuilt)
      .filter((value): value is string => value !== null)
  );

  test('every one of them reached the English catalog that ships', () => {
    const missing = widgetMessages.filter((id) => !englishCatalog.has(id));
    expect(missing).toEqual([]);
  });

  // The other direction, and the one the assertions above cannot see: a phrase
  // written straight into the tile as a literal is not missing from the catalog,
  // it was never offered to it, and every count still adds up.
  //
  // What makes this file testable that way is that its two vocabularies do not
  // overlap. RemoteViews style tokens and the library's own enums are single
  // words -- `match_parent`, `OPEN_URI`, `column`, `END` -- and English copy is
  // not. So a quoted literal with a space in it is copy that got past the macro.
  // `'Muqun'` is a single word and stays English on purpose; `'use no memo'` is
  // the compiler directive at the top of the file.
  test('no phrase is written into the tile as a literal', () => {
    const stripped = layoutSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const phrases = [...stripped.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"/g)]
      .map((match) => match[1] ?? match[2])
      .filter((literal) => literal.includes(' ') && literal !== 'use no memo');
    expect(phrases).toEqual([]);
  });

  // The status word beside each dot is not written here: the tile reads it from
  // `agentStatusWord`, which is what stops the home screen and the server card
  // calling the same state different things. Held to the same bar all the same,
  // because the tile is now a place it renders.
  const statusWordBlock = labelsSource.match(/export const agentStatusWord[^{]*\{([\s\S]*?)\n\};/);
  const statusWords = [...(statusWordBlock?.[1] ?? '').matchAll(/msg`([^`]+)`/g)].map(
    (match) => match[1]
  );

  test('the five status words are all of them', () => {
    expect(statusWords).toEqual(['Working', 'Blocked', 'Done', 'Idle', 'Unknown']);
  });

  test.each(TRANSLATED_LOCALES)('%s says all of it rather than falling back', (locale) => {
    const untranslated = [...new Set([...widgetMessages, ...statusWords])].filter(
      (id) => !translationIn(locale, id)
    );
    expect(untranslated).toEqual([]);
  });
});

// Plurals, rendered rather than inspected.
//
// Japanese and Korean have one plural category, so their catalogs carry
// `{0, plural, other {…}}` with no `one` branch, against English's two and
// German's, French's, Spanish's and Portuguese's two. That collapse is correct
// CLDR and it is also the one edit in this change that could go wrong silently:
// a formatter that wanted a `one` branch and did not find it would not throw,
// it would render the raw ICU string or an empty one, and only at the count
// that hit the missing branch.
//
// So this asks the real formatter for real numbers. `i18n.load` + `_` here
// rather than the app's `activateLocale`, deliberately: that function pulls in
// the `@formatjs` polyfills, which exist for Hermes and would only mask what
// Bun's own complete `Intl` can tell us.
describe('the plural forms actually render', () => {
  const PLURAL_ID = '{0, plural, one {# panel} other {# panels}}';

  test.each(APP_LOCALES)('%s renders 0, 1 and 2 without falling back', (locale) => {
    const local = setupI18n();
    local.load(locale, catalogs[locale] as Messages);
    local.activate(locale);

    for (const count of [0, 1, 2]) {
      const rendered = local._(PLURAL_ID, { 0: count });
      // The count reached the output, so `#` was substituted rather than left
      // standing or dropped along with its branch.
      expect(rendered).toContain(String(count));
      // And what came back is a sentence, not the ICU source echoed back.
      expect(rendered).not.toContain('plural,');
      expect(rendered.trim().length).toBeGreaterThan(1);
    }
  });

  test('English still inflects, so the assertion above is not vacuous', () => {
    const local = setupI18n();
    local.load('en', catalogs.en as Messages);
    local.activate('en');
    expect(local._(PLURAL_ID, { 0: 1 })).toBe('1 panel');
    expect(local._(PLURAL_ID, { 0: 2 })).toBe('2 panels');
  });
});

// The other half of "what ships": the name under the icon, and the sentences
// in the system's own permission dialogs.
//
// These files are not imported by anything. `expo prebuild` reads them through
// `expo.locales` in `app.json` and writes `<code>.lproj/InfoPlist.strings`
// (`CFBundleDisplayName` and the `NS*UsageDescription` keys) and
// `res/values-b+<code>/strings.xml` (`app_name`) from them. No type checks
// that path, so nothing but this notices a language added to `APP_LOCALES` and
// left behind on the native side -- and that failure is invisible until
// someone installs the build on a phone set to it.
describe('the native locale files', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const nativeLocalesDir = join(root, 'native-locales');
  const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
    expo: { locales?: Record<string, string>; ios?: { infoPlist?: Record<string, unknown> } };
  };

  // The dialogs iOS raises on the app's behalf. `NSPhotoLibraryUsageDescription`
  // is here although the card that added the rest named only three: it is in
  // `ios.infoPlist` like the others, and a photo picker asking in English on a
  // Japanese phone is the same bug. Android has no equivalent -- its runtime
  // permission dialogs are the system's own strings.
  const USAGE_KEYS = [
    'NSCameraUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSFaceIDUsageDescription',
    'NSLocalNetworkUsageDescription',
  ] as const;

  function nativeLocale(locale: AppLocale): {
    ios?: Record<string, string>;
    android?: Record<string, string>;
  } {
    return JSON.parse(readFileSync(join(nativeLocalesDir, `${locale}.json`), 'utf8')) as {
      ios?: Record<string, string>;
      android?: Record<string, string>;
    };
  }

  test('there is one file per locale we claim to speak, and no more', () => {
    const files = readdirSync(nativeLocalesDir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''));
    expect(files.sort()).toEqual([...APP_LOCALES].sort());
  });

  test('app.json points at every one of them, by the same code', () => {
    const configured = appConfig.expo.locales ?? {};
    expect(Object.keys(configured).sort()).toEqual([...APP_LOCALES].sort());
    for (const locale of APP_LOCALES) {
      expect(configured[locale]).toBe(`./native-locales/${locale}.json`);
    }
  });

  test.each(APP_LOCALES)('%s names the app on both platforms', (locale) => {
    const file = nativeLocale(locale);

    // These keys are spelled by the platforms, not by us, and a typo in one is
    // a file `expo prebuild` writes out and no phone reads.
    expect(Object.keys(file.ios ?? {}).sort()).toEqual(
      ['CFBundleDisplayName', ...USAGE_KEYS].sort()
    );
    expect(Object.keys(file.android ?? {})).toEqual(['app_name']);

    // Muqun is a brand name, so it is the same word in most locales. That is a
    // decision rather than an oversight, and asserting it is what makes it one.
    // zh-TW and ja are the exception: the app carries its native CJK name there, matching the
    // localisation already published on osuki.dev -- the app must not invent
    // its own convention for its own name where one already exists.
    const localName: Partial<Record<AppLocale, string>> = { 'zh-TW': '牧群', ja: '牧群' };
    const expectedName = localName[locale] ?? 'Muqun';
    expect(file.ios?.CFBundleDisplayName).toBe(expectedName);
    expect(file.android?.app_name).toBe(expectedName);
  });

  test.each(APP_LOCALES)('%s explains every permission, in a real sentence', (locale) => {
    const ios = nativeLocale(locale).ios ?? {};
    const localName: Partial<Record<AppLocale, string>> = { 'zh-TW': '牧群', ja: '牧群' };
    const brandName = localName[locale] ?? 'Muqun';
    for (const key of USAGE_KEYS) {
      const description = ios[key] ?? '';
      // Long enough to be a sentence rather than a placeholder, and it says
      // who is asking: every description leads with the brand name.
      expect(description.length).toBeGreaterThan(20);
      expect(description).toContain(brandName);
    }
  });

  test('English matches app.json, which is what a phone in English reads', () => {
    // The base Info.plist values come from `ios.infoPlist`; `en.lproj` from
    // `native-locales/en.json`. iOS shows one or the other depending on the
    // phone's language ranking, so the two must never drift apart.
    const infoPlist = appConfig.expo.ios?.infoPlist ?? {};
    const en = nativeLocale('en').ios ?? {};
    for (const key of USAGE_KEYS) {
      expect(en[key]).toBe(infoPlist[key] as string);
    }
  });

  test('the Traditional file contains no Simplified-only characters', () => {
    const file = nativeLocale('zh-TW');
    expect(SIMPLIFIED_ONLY.test(JSON.stringify(file))).toBe(false);
  });
});
