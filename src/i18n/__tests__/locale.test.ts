// What language the app speaks, as assertions.
//
// The rules worth pinning are the ones that fail quietly: a code that drifts
// from the one the gateway and the website use, a Simplified-Chinese device
// silently served Traditional characters, and a manual choice being overruled
// by the system it was made to overrule.
import { describe, expect, test } from 'bun:test';

import {
  APP_LOCALES,
  LOCALE_LABELS,
  SOURCE_LOCALE,
  isAppLocale,
  isLocalePreference,
  localeHeaders,
  matchLocale,
  negotiateLocale,
  resolveLocale,
} from '../locale';

describe('the codes themselves', () => {
  // This is the whole contract with the other two surfaces. The app's catalog
  // directory, the persisted setting, the request header and the gateway's
  // language table are all this literal string; if this test is ever "fixed" by
  // changing the expectation, every one of them has to move with it.
  test('the eight codes are the eight the website spells, in its order', () => {
    expect(APP_LOCALES).toEqual(['en', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt']);
  });

  test('Traditional Chinese is spelled zh-TW, exactly as the website spells it', () => {
    expect(APP_LOCALES).toContain('zh-TW');
    expect(APP_LOCALES).not.toContain('zh-Hant' as never);
    expect(APP_LOCALES).not.toContain('zh-Hant-TW' as never);
    expect(APP_LOCALES).not.toContain('zh_TW' as never);
    expect(APP_LOCALES).not.toContain('zh-Hans' as never);
  });

  // The other six carry no region, and it matters as much as `zh-TW` carrying
  // one. `pt-BR` here would be a directory the website has never heard of and a
  // header value the gateway's table cannot look up -- and the symptom of both
  // is not an error, it is English.
  test('the languages we do not split by region are spelled bare', () => {
    expect(APP_LOCALES).toContain('pt');
    expect(APP_LOCALES).not.toContain('pt-BR' as never);
    expect(APP_LOCALES).not.toContain('pt-PT' as never);
    expect(APP_LOCALES).toContain('es');
    expect(APP_LOCALES).not.toContain('es-ES' as never);
    expect(APP_LOCALES).not.toContain('es-419' as never);
    expect(APP_LOCALES).not.toContain('en-US' as never);
  });

  test('English is the source locale and the end of every fallback', () => {
    expect(SOURCE_LOCALE).toBe('en');
  });

  test('every locale is named in its own language', () => {
    expect(LOCALE_LABELS.en).toBe('English');
    expect(LOCALE_LABELS['zh-TW']).toBe('繁體中文');
    expect(LOCALE_LABELS.ja).toBe('日本語');
    expect(LOCALE_LABELS.ko).toBe('한국어');
    expect(LOCALE_LABELS.de).toBe('Deutsch');
    expect(LOCALE_LABELS.fr).toBe('Français');
    expect(LOCALE_LABELS.es).toBe('Español');
    expect(LOCALE_LABELS.pt).toBe('Português');
  });

  test('the guards accept what we ship and nothing else', () => {
    expect(isAppLocale('zh-TW')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('ja')).toBe(true);
    expect(isAppLocale('pt')).toBe(true);
    expect(isAppLocale('zh-Hant')).toBe(false);
    expect(isAppLocale('pt-BR')).toBe(false);
    expect(isAppLocale('it')).toBe(false);
    expect(isAppLocale('')).toBe(false);
    expect(isAppLocale(null)).toBe(false);

    // `null` is a preference -- "follow the system" -- but not a locale.
    expect(isLocalePreference(null)).toBe(true);
    expect(isAppLocale(null)).toBe(false);
    expect(isLocalePreference('fr')).toBe(true);
    expect(isLocalePreference('ar')).toBe(false);
  });
});

describe('folding a device tag onto a catalog', () => {
  test('an exact tag matches, whatever its case', () => {
    expect(matchLocale('zh-TW')).toBe('zh-TW');
    expect(matchLocale('zh-tw')).toBe('zh-TW');
    expect(matchLocale('EN')).toBe('en');
  });

  test('an underscore is the same tag as a hyphen', () => {
    expect(matchLocale('zh_TW')).toBe('zh-TW');
  });

  test('the script subtag is enough, whatever the region', () => {
    expect(matchLocale('zh-Hant')).toBe('zh-TW');
    expect(matchLocale('zh-Hant-HK')).toBe('zh-TW');
  });

  test('the Traditional-writing regions match without a script subtag', () => {
    expect(matchLocale('zh-HK')).toBe('zh-TW');
    expect(matchLocale('zh-MO')).toBe('zh-TW');
  });

  // The important negative. Serving Traditional characters to someone who reads
  // Simplified is a worse answer than English, and it would also be a silent
  // claim to support a language nobody has translated.
  test('Simplified Chinese does not fall into the Traditional catalog', () => {
    expect(matchLocale('zh-Hans')).toBeNull();
    expect(matchLocale('zh-CN')).toBeNull();
    expect(matchLocale('zh-SG')).toBeNull();
    expect(matchLocale('zh')).toBeNull();
  });

  test('script beats region when they disagree', () => {
    expect(matchLocale('zh-Hans-TW')).toBeNull();
  });

  test('English matches on the bare language, since we ship no variants of it', () => {
    expect(matchLocale('en-GB')).toBe('en');
    expect(matchLocale('en-US')).toBe('en');
  });

  // The same rule as English, applied to the six languages added alongside it,
  // and the reason `pt` is spelled `pt`. A Brazilian phone reports `pt-BR` and a
  // Portuguese one `pt-PT`; we have one Portuguese catalog and both readers
  // should get it. Serving a Brazilian European Portuguese is a translation
  // quibble. Serving them English is a bug.
  test('a regional variant folds onto the one catalog we ship for its language', () => {
    expect(matchLocale('ja-JP')).toBe('ja');
    expect(matchLocale('ko-KR')).toBe('ko');
    expect(matchLocale('de-AT')).toBe('de');
    expect(matchLocale('de-CH')).toBe('de');
    expect(matchLocale('fr-CA')).toBe('fr');
    expect(matchLocale('fr-BE')).toBe('fr');
    expect(matchLocale('es-MX')).toBe('es');
    expect(matchLocale('es-419')).toBe('es');
    expect(matchLocale('pt-BR')).toBe('pt');
    expect(matchLocale('pt-PT')).toBe('pt');
  });

  test('the bare language matches too, and case still does not matter', () => {
    expect(matchLocale('ja')).toBe('ja');
    expect(matchLocale('PT')).toBe('pt');
    expect(matchLocale('de_DE')).toBe('de');
  });

  test('a language we do not have is a miss, not a guess', () => {
    // Italian and Arabic are on the website but not in the app, which is the
    // interesting case: a code existing somewhere in the product is not the
    // same as a catalog existing here.
    expect(matchLocale('it')).toBeNull();
    expect(matchLocale('ar')).toBeNull();
    expect(matchLocale('nl-NL')).toBeNull();
    expect(matchLocale('ru')).toBeNull();
  });

  // Portuguese and Spanish are near neighbours and Galician sits between them,
  // but "close enough to read" is not a thing a locale negotiator gets to
  // decide. Only an exact language match counts.
  test('a neighbouring language is not a near-enough match', () => {
    expect(matchLocale('gl')).toBeNull();
    expect(matchLocale('ca')).toBeNull();
  });

  test('junk is a miss rather than a throw', () => {
    expect(matchLocale('')).toBeNull();
    expect(matchLocale('   ')).toBeNull();
    expect(matchLocale('-')).toBeNull();
    expect(matchLocale(null)).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });
});

describe('negotiating against the device preference list', () => {
  test('the first tag we can serve wins, not the first tag', () => {
    expect(negotiateLocale(['it-IT', 'zh-Hant-TW', 'en-US'])).toBe('zh-TW');
  });

  test('order is the user preference and is honoured', () => {
    expect(negotiateLocale(['en-US', 'zh-TW'])).toBe('en');
    expect(negotiateLocale(['zh-TW', 'en-US'])).toBe('zh-TW');
    expect(negotiateLocale(['pt-BR', 'en-US'])).toBe('pt');
    expect(negotiateLocale(['ko-KR', 'ja-JP'])).toBe('ko');
  });

  test('a device that wants nothing we have gets the source locale', () => {
    expect(negotiateLocale(['it-IT', 'ar-EG'])).toBe('en');
    expect(negotiateLocale(['zh-Hans-CN'])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
  });
});

describe('resolving what to actually render', () => {
  test('no preference means follow the system', () => {
    expect(resolveLocale(null, ['zh-Hant-TW'])).toBe('zh-TW');
    expect(resolveLocale(null, ['ja-JP'])).toBe('ja');
    expect(resolveLocale(null, ['it-IT'])).toBe('en');
  });

  test('an explicit choice overrules the system, which is the point of it', () => {
    expect(resolveLocale('en', ['zh-TW'])).toBe('en');
    expect(resolveLocale('zh-TW', ['en-US'])).toBe('zh-TW');
  });
});

describe('what every gateway request carries', () => {
  test('both headers, one exact code, no q-values', () => {
    expect(localeHeaders('zh-TW')).toEqual({
      'X-Muqun-Locale': 'zh-TW',
      'Accept-Language': 'zh-TW',
    });
    expect(localeHeaders('en')).toEqual({
      'X-Muqun-Locale': 'en',
      'Accept-Language': 'en',
    });
  });

  test('the header value is the catalog code, character for character', () => {
    for (const locale of APP_LOCALES) {
      expect(localeHeaders(locale)['X-Muqun-Locale']).toBe(locale);
      expect(localeHeaders(locale)['Accept-Language']).toBe(locale);
    }
  });
});
