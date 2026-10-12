// What language the app speaks, as assertions.
//
// The rules worth pinning are the ones that fail quietly: a code that drifts
// from the one the gateway and the website use, a Simplified-Chinese device
// silently served Traditional characters, and a manual choice being overruled
// by the system it was made to overrule.
import { describe, expect, test } from 'bun:test';

import {
  isAppLocale,
  isLocalePreference,
  localeHeaders,
  matchLocale,
  negotiateLocale,
  resolveLocale,
} from '../locale';

describe('the codes themselves', () => {
  test('the guards accept what we ship and nothing else', () => {
    expect(isAppLocale('zh-TW')).toBe(true);
    expect(isAppLocale('zh-Hant')).toBe(false);
    expect(isAppLocale('pt-BR')).toBe(false);
    expect(isAppLocale('')).toBe(false);
    // `null` is a preference -- "follow the system" -- but not a locale.
    expect(isAppLocale(null)).toBe(false);
    expect(isLocalePreference(null)).toBe(true);
    expect(isLocalePreference('fr')).toBe(true);
    expect(isLocalePreference('ar')).toBe(false);
  });
});

describe('folding a device tag onto a catalog', () => {
  // One row per rule. Serving Traditional characters to someone who reads
  // Simplified, or the reverse, is a worse answer than English; a regional
  // variant folds onto the one catalog we ship for its language; a language we
  // do not have -- or a neighbour of one we do -- is a miss, not a guess.
  const ROWS: [string, string | null | undefined, string | null][] = [
    ['exact tag, any case', 'zh-tw', 'zh-TW'],
    ['underscore is a hyphen', 'zh_TW', 'zh-TW'],
    ['Traditional by script, any region', 'zh-Hant-HK', 'zh-TW'],
    ['Traditional-writing region without a script', 'zh-HK', 'zh-TW'],
    ['Simplified by script', 'zh-Hans', 'zh-CN'],
    ['Simplified region', 'zh-SG', 'zh-CN'],
    ['bare zh is Simplified', 'zh', 'zh-CN'],
    ['script beats region', 'zh-Hans-TW', 'zh-CN'],
    ['script beats region, the other way', 'zh-Hant-CN', 'zh-TW'],
    ['English variant', 'en-GB', 'en'],
    ['regional variant', 'pt-BR', 'pt'],
    ['regional variant with extensions', 'th-TH-u-nu-thai', 'th'],
    ['bare language, upper case', 'PT', 'pt'],
    ['a language we do not ship', 'it', null],
    ['a neighbouring language', 'gl', null],
    ['a neighbouring language with region', 'uk-UA', null],
    ['blank', '   ', null],
    ['undefined', undefined, null],
  ];

  test('every rule, one row each', () => {
    const wrong = ROWS.filter(([, tag, want]) => matchLocale(tag) !== want).map(
      ([label, tag]) => `${label}: ${String(tag)} -> ${matchLocale(tag)}`
    );
    expect(wrong).toEqual([]);
  });
});

describe('negotiating against the device preference list', () => {
  test('the first tag we can serve wins, in the user order', () => {
    expect(negotiateLocale(['it-IT', 'zh-Hant-TW', 'en-US'])).toBe('zh-TW');
    expect(negotiateLocale(['en-US', 'zh-TW'])).toBe('en');
    expect(negotiateLocale(['zh-Hans-CN', 'zh-Hant-TW'])).toBe('zh-CN');
    expect(negotiateLocale(['zh-Hant-TW', 'zh-Hans-CN'])).toBe('zh-TW');
  });

  test('a device that wants nothing we have gets the source locale', () => {
    expect(negotiateLocale(['it-IT', 'ar-EG'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

describe('resolving what to actually render', () => {
  test('no preference means follow the system', () => {
    expect(resolveLocale(null, ['zh-Hans-CN'])).toBe('zh-CN');
    expect(resolveLocale(null, ['it-IT'])).toBe('en');
  });

  test('an explicit choice overrules the system, which is the point of it', () => {
    expect(resolveLocale('en', ['zh-TW'])).toBe('en');
    expect(resolveLocale('zh-TW', ['zh-Hans-CN'])).toBe('zh-TW');
  });
});

describe('what every gateway request carries', () => {
  test('both headers, the catalog code character for character, no q-values', () => {
    expect(localeHeaders('zh-TW')).toEqual({
      'X-Muqun-Locale': 'zh-TW',
      'Accept-Language': 'zh-TW',
    });
  });
});
