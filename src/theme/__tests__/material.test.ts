import { describe, expect, test } from 'bun:test';
import { createThemeStarter } from '../authoring';
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
  test('rejects unsupported material values and arbitrary targets', () => {
    const manifest = createThemeStarter();
    expect(() =>
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { default: 'neon' } }))
    ).toThrow();
    expect(() =>
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { osDialog: 'solid' } }))
    ).toThrow();
    expect(
      parseThemeManifest(JSON.stringify({ ...manifest, materials: { default: 'solid' } })).materials
        ?.default
    ).toBe('solid');
  });
});
