import { expect, test } from 'bun:test';
import { resolveHomeComposerOutset } from '../home-composer-outset';
import { parseThemeManifest } from '../schema';
import { createThemeStarter } from '../starter';
import { resolveThemeImage } from '../resolve';

const assets = { wash: 'file:///themes/wash.png' };
const parse = (image: unknown) =>
  parseThemeManifest(
    JSON.stringify({
      ...createThemeStarter(),
      assets: { wash: { path: 'assets/wash.png' } },
      decoration: { 'home.composer.background': image },
    })
  );

test('absent, zero, null and unavailable artwork retain the clipped field', () => {
  expect(resolveHomeComposerOutset(null, assets)).toBeNull();
  expect(resolveHomeComposerOutset({ asset: 'wash' }, assets)).toBeNull();
  expect(resolveHomeComposerOutset({ asset: 'wash', outset: {} }, assets)).toBeNull();
  expect(
    resolveHomeComposerOutset({ asset: 'wash', outset: { left: 0, right: 0, bottom: 0 } }, assets)
  ).toBeNull();
  expect(resolveHomeComposerOutset({ asset: 'wash', outset: { left: 12 } }, {})).toBeNull();
  expect(
    resolveHomeComposerOutset(
      { asset: 'wash', outset: { left: 12 } },
      { wash: 'https://example.com/image.png' }
    )
  ).toBeNull();
});

test('bounded outsets preserve explicit zero opacity and default missing edges to zero', () => {
  const manifest = parse({ asset: 'wash', opacity: 0, outset: { left: 12, bottom: 8 } });
  const image = resolveThemeImage(manifest, 'home.composer.background', 'light', 'compact');
  expect(image?.opacity).toBe(0);
  expect(resolveHomeComposerOutset(image, assets)).toEqual({ left: 12, right: 0, bottom: 8 });
});

test.each([
  { left: -1 },
  { left: 12.1 },
  { right: 12.1 },
  { bottom: 8.1 },
  { bottom: -0.1 },
  { top: 1 },
  { left: '12' },
])('invalid outset is rejected rather than reaching native geometry: %j', (outset) => {
  expect(() => parse({ asset: 'wash', outset })).toThrow();
});

test('responsive image replacements do not inherit another image outset', () => {
  const manifest = parse({
    asset: 'wash',
    outset: { left: 12, right: 12, bottom: 8 },
    compact: { asset: 'wash', outset: { right: 4 } },
    regular: { asset: 'wash' },
  });
  expect(
    resolveHomeComposerOutset(
      resolveThemeImage(manifest, 'home.composer.background', 'light', 'compact'),
      assets
    )
  ).toEqual({ left: 0, right: 4, bottom: 0 });
  expect(
    resolveHomeComposerOutset(
      resolveThemeImage(manifest, 'home.composer.background', 'light', 'regular'),
      assets
    )
  ).toBeNull();
  manifest.variantDecorations = { dark: { 'home.composer.background': null } };
  expect(
    resolveHomeComposerOutset(
      resolveThemeImage(manifest, 'home.composer.background', 'dark', 'compact'),
      assets
    )
  ).toBeNull();
});
