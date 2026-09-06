import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

/**
 * Locale codes are shared verbatim with the marketing site
 * (~/.osuki/web -> src/lib/site-chrome.ts) and with the Herdr gateway's
 * language table. The literal strings are `en`, `zh-TW`, `zh-CN`, `ja`, `ko`,
 * `de`, `fr`, `es`, `pt`, `ru` and `vi`.
 *
 * Do not "normalise" these to zh-Hant / zh-Hant-TW / zh_TW or zh-Hans / zh_CN,
 * and do not regionalise the ones that carry no region: one `pt` catalog
 * serves Brazilian and European Portuguese, one `es` catalog serves Spain and
 * Latin America, one `vi` catalog serves every Vietnamese reader.
 * The same string is used as this catalog's directory name, as the value
 * persisted by the Settings screen, as the `X-Muqun-Locale` request header
 * value, and as the gateway's lookup key. Any divergence silently drops users
 * back to English.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'zh-TW', 'zh-CN', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'vi'],
  // Every locale falls back to `en`, which is also the source locale, so a
  // message with no translation renders the English source text rather than a
  // blank or a raw message id. There is deliberately no chain between the
  // non-source locales: Portuguese does not fall back through Spanish, however
  // close the two look on paper, and Simplified Chinese does not fall back
  // through Traditional: a reader of one script is not served the other.
  fallbackLocales: {
    'zh-TW': 'en',
    'zh-CN': 'en',
    ja: 'en',
    ko: 'en',
    de: 'en',
    fr: 'en',
    es: 'en',
    pt: 'en',
    ru: 'en',
    vi: 'en',
  },
  catalogs: [
    {
      path: '<rootDir>/src/i18n/locales/{locale}/messages',
      include: ['src'],
      exclude: ['**/node_modules/**', '**/*.test.ts', '**/*.test.tsx'],
    },
  ],
  // PO rather than JSON, and with source line numbers switched off: the
  // locations are useful to a translator but they churn on every unrelated edit
  // above them, which turns a one-string change into a hundred-line diff.
  format: formatter({ lineNumbers: false }),
});
