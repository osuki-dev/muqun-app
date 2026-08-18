import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

/**
 * Locale codes are shared verbatim with the marketing site
 * (~/.osuki/web -> src/lib/site-chrome.ts) and with the Herdr gateway's
 * language table. The literal strings are `en`, `zh-TW`, `ja`, `ko`, `de`,
 * `fr`, `es` and `pt`.
 *
 * Do not "normalise" these to zh-Hant / zh-Hant-TW / zh_TW, and do not
 * regionalise the ones that carry no region: one `pt` catalog serves Brazilian
 * and European Portuguese, one `es` catalog serves Spain and Latin America.
 * The same string is used as this catalog's directory name, as the value
 * persisted by the Settings screen, as the `X-Muqun-Locale` request header
 * value, and as the gateway's lookup key. Any divergence silently drops users
 * back to English.
 */
export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt'],
  // Every locale falls back to `en`, which is also the source locale, so a
  // message with no translation renders the English source text rather than a
  // blank or a raw message id. There is deliberately no chain between the
  // non-source locales: Portuguese does not fall back through Spanish, however
  // close the two look on paper.
  fallbackLocales: {
    'zh-TW': 'en',
    ja: 'en',
    ko: 'en',
    de: 'en',
    fr: 'en',
    es: 'en',
    pt: 'en',
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
