import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/starter';
import { parseThemeManifest } from '@/theme/schema';

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
