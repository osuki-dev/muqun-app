/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { setupI18n, type Messages } from '@lingui/core';

import { messages as enMessages } from '../locales/en/messages';
import { messages as zhTWMessages } from '../locales/zh-TW/messages';
import { messages as zhCNMessages } from '../locales/zh-CN/messages';
import { messages as jaMessages } from '../locales/ja/messages';
import { messages as koMessages } from '../locales/ko/messages';
import { messages as deMessages } from '../locales/de/messages';
import { messages as frMessages } from '../locales/fr/messages';
import { messages as esMessages } from '../locales/es/messages';
import { messages as ptMessages } from '../locales/pt/messages';
import { messages as ruMessages } from '../locales/ru/messages';
import { messages as thMessages } from '../locales/th/messages';
import { messages as viMessages } from '../locales/vi/messages';
import { APP_LOCALES, LOCALE_LABELS, type AppLocale } from '../locale';

type Catalog = Record<string, unknown>;

const catalogs: Record<AppLocale, Catalog> = {
  en: enMessages as Catalog,
  'zh-TW': zhTWMessages as Catalog,
  'zh-CN': zhCNMessages as Catalog,
  ja: jaMessages as Catalog,
  ko: koMessages as Catalog,
  de: deMessages as Catalog,
  fr: frMessages as Catalog,
  es: esMessages as Catalog,
  pt: ptMessages as Catalog,
  ru: ruMessages as Catalog,
  vi: viMessages as Catalog,
  th: thMessages as Catalog,
};

const TRANSLATED_LOCALES = APP_LOCALES.filter((locale) => locale !== 'en');

function blankEntries(catalog: Catalog): string[] {
  return Object.entries(catalog)
    .filter(([, value]) => {
      if (typeof value === 'string') return value.trim() === '';
      return Array.isArray(value) && value.length === 0;
    })
    .map(([id]) => id);
}

describe('the compiled catalogs', () => {
  test('every compiled catalog has exactly the English ids, none of them blank', () => {
    const english = Object.keys(enMessages).sort();
    expect(english.length).toBeGreaterThan(0);
    const off = APP_LOCALES.filter(
      (locale) =>
        Object.keys(catalogs[locale]).sort().join() !== english.join() ||
        blankEntries(catalogs[locale]).length > 0
    );
    expect(off).toEqual([]);
  });

  test('every message was actually translated in every language', () => {
    const untranslated = TRANSLATED_LOCALES.flatMap((locale) => {
      const po = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'locales', locale, 'messages.po'),
        'utf8'
      );
      return [...po.matchAll(/^msgid "(.+)"\nmsgstr ""\n(?:\n|$)/gm)].map(
        (match) => `${locale}: ${match[1]}`
      );
    });
    expect(untranslated).toEqual([]);
  });

  test('Thai renders translated text and preserves dynamic values', () => {
    const local = setupI18n();
    local.load('th', thMessages);
    local.activate('th');
    const id = (source: string) =>
      createHash('sha256').update(`${source}\u001f`).digest('base64').slice(0, 6);
    expect(local._(id('Settings'))).toBe('การตั้งค่า');
    expect(local._(id('Language, {languageName}'), { languageName: 'ไทย' })).toBe('ภาษา ไทย');
    expect(local._(id('{0, plural, one {# day} other {# days}}'), { 0: 0 })).toBe('0 วัน');
    expect(local._(id('{0, plural, one {# day} other {# days}}'), { 0: 12 })).toBe('12 วัน');
  });

  test('every language has its own label, and no two share one', () => {
    const labels = APP_LOCALES.map((locale) => LOCALE_LABELS[locale] ?? '');
    expect(labels.filter((label) => !label || label.trim() !== label)).toEqual([]);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('the home-screen widget copy', () => {
  const layoutSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'lib', 'agent-widget-layout.tsx'),
    'utf8'
  );

  function messageId(template: string): string {
    let positional = 0;
    return template.replace(/\$\{([^}]*)\}/g, (_match, expression: string) => {
      const trimmed = expression.trim();
      return /^[A-Za-z_$][\w$]*$/.test(trimmed) ? `{${trimmed}}` : `{${positional++}}`;
    });
  }

  const widgetMessages = [
    ...layoutSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .matchAll(/(?<![\w$.])msg`([^`\\]*)`/g),
  ].map((match) => messageId(match[1]));

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

  test('every widget message reached the English catalog that ships', () => {
    expect(widgetMessages.length).toBeGreaterThan(0);
    const missing = widgetMessages.filter((id) => !englishCatalog.has(id));
    expect(missing).toEqual([]);
  });
});

describe('the plural forms actually render', () => {
  const DAYS_SOURCE = '{0, plural, one {# day} other {# days}}';
  const DAYS_ID = createHash('sha256').update(`${DAYS_SOURCE}\u001f`).digest('base64').slice(0, 6);

  test('the derived id is the one the compiler wrote', () => {
    expect(DAYS_ID in catalogs.en).toBe(true);
    const local = setupI18n();
    local.load('en', catalogs.en as Messages);
    local.activate('en');
    expect(local._(DAYS_ID, { 0: 1 })).toBe('1 day');
    expect(local._(DAYS_ID, { 0: 2 })).toBe('2 days');
  });

  test('Russian renders all four plural categories from the shipped catalog', () => {
    const local = setupI18n();
    local.load('ru', catalogs.ru as Messages);
    local.activate('ru');
    expect(local._(DAYS_ID, { 0: 1 })).toBe('1 день');
    expect(local._(DAYS_ID, { 0: 2 })).toBe('2 дня');
    expect(local._(DAYS_ID, { 0: 5 })).toBe('5 дней');
    expect(local._(DAYS_ID, { 0: 11 })).toBe('11 дней');
    expect(local._(DAYS_ID, { 0: 21 })).toBe('21 день');
  });

  test('a single-category language renders its one plural form', () => {
    const local = setupI18n();
    local.load('vi', catalogs.vi as Messages);
    local.activate('vi');
    const one = local._(DAYS_ID, { 0: 1 });
    const many = local._(DAYS_ID, { 0: 7 });
    expect(one).toContain('1');
    expect(many).toContain('7');
    expect(one.replace('1', '')).toBe(many.replace('7', ''));
    expect(one).not.toContain('day');
  });
});

describe('the native locale files', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const nativeLocalesDir = join(root, 'native-locales');
  const appConfig = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
    expo: { locales?: Record<string, string>; ios?: { infoPlist?: Record<string, unknown> } };
  };

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

  test('every file names the app on both platforms and explains every permission', () => {
    const off: string[] = [];
    for (const locale of APP_LOCALES) {
      const file = nativeLocale(locale);
      if (
        Object.keys(file.ios ?? {})
          .sort()
          .join() !== ['CFBundleDisplayName', ...USAGE_KEYS].sort().join() ||
        Object.keys(file.android ?? {}).join() !== 'app_name'
      ) {
        off.push(`${locale}: keys`);
      }
      if (!file.ios?.CFBundleDisplayName?.trim() || !file.android?.app_name?.trim()) {
        off.push(`${locale}: name`);
      }
      for (const key of USAGE_KEYS) {
        const description = file.ios?.[key] ?? '';
        if (!description.trim()) off.push(`${locale}: ${key}`);
      }
    }
    expect(off).toEqual([]);
  });

  test('English matches app.json, which is what a phone in English reads', () => {
    const infoPlist = appConfig.expo.ios?.infoPlist ?? {};
    const en = nativeLocale('en').ios ?? {};
    for (const key of USAGE_KEYS) {
      expect(en[key]).toBe(infoPlist[key] as string);
    }
  });
});
