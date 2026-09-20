import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/**
 * react-native-enriched-markdown measures with a `StaticLayout` (advance
 * widths) and draws with a `TextView`, which on API 35+ breaks by glyph bounds
 * unless told otherwise. Under an italic reader font the two disagree by the
 * last glyph's overhang, and a plate that hugs a short reply wraps it. The
 * theme item is the whole fix, so it must stay registered and stay `false`.
 */
test('the app theme keeps TextView line breaking on advance widths', () => {
  const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8')) as {
    expo: { plugins: unknown[] };
  };
  expect(app.expo.plugins).toContain('./plugins/with-advance-width-line-breaks.js');

  const plugin = readFileSync(join(root, 'plugins/with-advance-width-line-breaks.js'), 'utf8');
  expect(plugin).toContain("'android:useBoundsForWidth'");
  expect(plugin).toContain("value: 'false'");
  expect(plugin).toContain("targetApi: '35'");
});
