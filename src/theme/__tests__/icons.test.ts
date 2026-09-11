import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createThemeStarter } from '@/theme/authoring';
import { parseThemeManifest, THEME_ICONS } from '@/theme/schema';

const base = createThemeStarter();
const withIcons = (icons: unknown) => JSON.stringify({ ...base, icons });

test('a replaced glyph parses and defaults to following the theme colour', () => {
  const manifest = parseThemeManifest(withIcons({ 'chrome.back': { asset: 'arrow' } }));
  expect(manifest.icons?.['chrome.back']).toEqual({ asset: 'arrow', render: 'template' });
});

test('a mark with fixed colours can say so', () => {
  const manifest = parseThemeManifest(
    withIcons({ 'chrome.send': { asset: 'mark', render: 'original' } })
  );
  expect(manifest.icons?.['chrome.send']?.render).toBe('original');
});

test('a name this build does not draw is carried, not rejected', () => {
  // The whole point of the open record: a reader on an older app installs a
  // newer pack and simply does not get that glyph. Rejecting the manifest would
  // make every future glyph a breaking change for everyone who has not updated.
  const manifest = parseThemeManifest(withIcons({ 'chrome.future': { asset: 'x' } }));
  expect(manifest.icons?.['chrome.future']).toEqual({ asset: 'x', render: 'template' });
});

test('a glyph explicitly turned off is allowed', () => {
  expect(() => parseThemeManifest(withIcons({ 'chrome.back': null }))).not.toThrow();
});

test('the rest of the manifest stays strict', () => {
  // Tolerance is scoped to icon names and nothing else: a typo in a colour is a
  // mistake, and it must still fail.
  expect(() =>
    parseThemeManifest(JSON.stringify({ ...base, decoration: { 'shell.backgrund': null } }))
  ).toThrow();
  expect(() =>
    parseThemeManifest(withIcons({ 'chrome.back': { asset: 'a', rendre: 'template' } }))
  ).toThrow();
});

test('an icon entry still needs a real asset id', () => {
  expect(() => parseThemeManifest(withIcons({ 'chrome.back': { asset: 'Not An Id' } }))).toThrow();
  expect(() => parseThemeManifest(withIcons({ 'chrome.back': {} }))).toThrow();
});

test('every advertised glyph is drawn by a real consumer', () => {
  // The same guard the artwork slots have: a name in the table that nothing
  // reads is a promise to authors the app does not keep.
  const consumers: Record<(typeof THEME_ICONS)[number], string> = {
    'chrome.back': 'src/components/nav-header.tsx',
    'chrome.send': 'src/components/terminal-composer.tsx',
  };
  expect(Object.keys(consumers).sort()).toEqual([...THEME_ICONS].sort());
  for (const [name, file] of Object.entries(consumers))
    expect(readFileSync(file, 'utf8')).toContain(`name="${name}"`);
});

test('every consumer passes a fallback, so no glyph can go missing', () => {
  // A control whose icon merely vanished is a screen with no way out. The
  // component requires `fallback`, and this is the guard that it is always a
  // real built-in icon rather than something that can resolve to nothing.
  for (const file of ['src/components/nav-header.tsx', 'src/components/terminal-composer.tsx']) {
    const source = readFileSync(file, 'utf8');
    for (const use of source.match(/<ThemeIcon[\s\S]*?\/>/g) ?? [])
      expect(/fallback=\{[A-Z]\w*\}/.test(use)).toBe(true);
  }
});
