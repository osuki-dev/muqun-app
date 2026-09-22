import { describe, expect, test } from 'bun:test';
import { createThemeStarter } from '../starter';
import { resolveThemeMaterial } from '../material';
import { parseThemeManifest } from '../schema';

describe('theme surface materials', () => {
  test('built-ins retain platform defaults', () => {
    expect(resolveThemeMaterial(undefined, 'navigation', false, false)).toBe('auto');
    expect(resolveThemeMaterial(undefined, 'navigation', false, true)).toBe('auto');
  });
  test('only the image-bearing surface defaults to solid', () => {
    const manifest = createThemeStarter();
    expect(resolveThemeMaterial(manifest, 'composer', true, true)).toBe('solid');
    expect(resolveThemeMaterial(manifest, 'navigation', false, true)).toBe('auto');
  });
  test('explicit overrides precede defaults and glass fails safely', () => {
    const manifest = createThemeStarter();
    manifest.materials = { default: 'solid', navigation: 'glass', composer: 'auto' };
    expect(resolveThemeMaterial(manifest, 'navigation', true, true)).toBe('glass');
    expect(resolveThemeMaterial(manifest, 'navigation', true, false)).toBe('solid');
    expect(resolveThemeMaterial(manifest, 'actions', false, true)).toBe('solid');
    expect(resolveThemeMaterial(manifest, 'composer', false, true)).toBe('auto');
  });
  test('an unsupported material or target degrades instead of failing the pack', () => {
    const manifest = createThemeStarter();
    // Both halves of "a newer app might have more of these". A material this
    // build does not have becomes `auto`, which is what `resolveThemeMaterial`
    // already does with anything that is not solid or glass; a surface it does
    // not paint is simply never asked about. Refusing either would have made
    // every future material a breaking change -- see `docs/theme-contract.md`.
    expect(
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { default: 'neon' } })).materials
        ?.default
    ).toBe('auto');
    expect(
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { osDialog: 'solid' } }))
        .materials?.osDialog
    ).toBe('solid');
    expect(
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { default: 'solid' } })).materials
        ?.default
    ).toBe('solid');
  });
});
