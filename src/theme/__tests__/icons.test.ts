import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { createThemeStarter } from '@/theme/starter';
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

test('tolerance stops at the shape of an entry', () => {
  // The names a pack may use are open -- icons, slots, material surfaces -- for
  // the reason argued in `iconsSchema`: an app older than the pack cannot tell
  // "a name I do not know" from "not supplied", and both have the same right
  // answer. A slot name this build does not draw is therefore accepted and
  // ignored rather than fatal.
  expect(() =>
    parseThemeManifest(JSON.stringify({ ...base, decoration: { 'shell.backgrund': null } }))
  ).not.toThrow();
  // What stays strict is the *inside* of an entry. `rendre` is not a name this
  // build might grow into; it is a misspelling of a key that decides how the
  // glyph is drawn, and there is no sensible fallback for a value that was
  // never read.
  expect(() =>
    parseThemeManifest(withIcons({ 'chrome.back': { asset: 'a', rendre: 'template' } }))
  ).toThrow();
});

test('an icon entry still needs a real asset id', () => {
  expect(() => parseThemeManifest(withIcons({ 'chrome.back': { asset: 'Not An Id' } }))).toThrow();
  expect(() => parseThemeManifest(withIcons({ 'chrome.back': {} }))).toThrow();
});

/** Which file draws each advertised glyph. Both guards below read this one. */
const CONSUMERS: Record<(typeof THEME_ICONS)[number], string> = {
  'chrome.scan': 'src/components/home-overview.tsx',
  'chrome.settings': 'src/components/home-overview.tsx',
  'chrome.back': 'src/components/nav-header.tsx',
  'chrome.send': 'src/components/terminal-composer.tsx',
  'chrome.attach': 'src/components/server-terminal-workspace.tsx',
};

test('every advertised glyph is drawn by a real consumer', () => {
  // The same guard the artwork slots have: a name in the table that nothing
  // reads is a promise to authors the app does not keep.
  expect(Object.keys(CONSUMERS).sort()).toEqual([...THEME_ICONS].sort());
  for (const [name, file] of Object.entries(CONSUMERS))
    expect(readFileSync(file, 'utf8')).toContain(`name="${name}"`);
});

test('every consumer passes a fallback, so no glyph can go missing', () => {
  // A control whose icon merely vanished is a screen with no way out. The
  // component requires `fallback`, and this is the guard that it is always a
  // real built-in icon rather than something that can resolve to nothing.
  //
  // Derived from the table above rather than listed again. A hand-written list
  // here is a guard that silently stops covering the next glyph added, which is
  // exactly the failure it exists to catch.
  for (const file of new Set(Object.values(CONSUMERS))) {
    const source = readFileSync(file, 'utf8');
    for (const use of source.match(/<ThemeIcon[\s\S]*?\/>/g) ?? [])
      expect(/fallback=\{[A-Z]\w*\}/.test(use)).toBe(true);
  }
});
