import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { auditThemeContrast } from '../../src/theme/contrast';
import { resolveArtworkOpacity, safeArtworkOpacity } from '../../src/theme/artwork-contrast';
import { inspectThemeImage } from '../../src/theme/image-inspection';
import { resolveThemeImage } from '../../src/theme/resolve';
import { parseThemeManifest } from '../../src/theme/schema';

const manifest = parseThemeManifest(readFileSync('themes/cloud-atelier/theme.json', 'utf8'));

test('Cloud Atelier is a complete responsive blue-and-ivory skin with usable texture headroom', () => {
  expect(manifest.id).toBe('cloud-atelier');
  expect(auditThemeContrast(manifest)).toEqual([]);
  for (const mode of ['light', 'dark'] as const) {
    const colors = manifest.variants[mode].colors;
    expect(resolveArtworkOpacity(colors)).toBeGreaterThan(0.15);
    expect(
      safeArtworkOpacity(colors.primary, [{ color: colors.onPrimary, minimum: 4.5 }])
    ).toBeGreaterThan(0.2);
    expect(resolveThemeImage(manifest, 'home.decoration', mode, 'compact')).toBeNull();
    expect(resolveThemeImage(manifest, 'shell.background', mode, 'compact')?.asset).toBe(
      `scene-${mode}`
    );
    expect(resolveThemeImage(manifest, 'shell.background', mode, 'regular')?.asset).toBe(
      `scene-wide-${mode}`
    );
    for (const slot of [
      'navigation.background',
      'composer.background',
      'tabs.background',
      'actions.background',
      'cards.decoration',
      'buttons.primary.background',
    ] as const) {
      expect(resolveThemeImage(manifest, slot, mode, 'compact')?.fit).toBe('cover');
      expect(resolveThemeImage(manifest, slot, mode, 'regular')?.fit).toBe('cover');
    }
  }
});

test('all twelve packaged images match hashes and runtime textures remain bounded', () => {
  expect(Object.keys(manifest.assets ?? {})).toHaveLength(12);
  for (const [name, descriptor] of Object.entries(manifest.assets ?? {})) {
    if (!('path' in descriptor)) throw new Error('Pack must remain offline');
    if (!descriptor.sha256) throw new Error('Every production asset must declare its hash');
    const bytes = readFileSync(`themes/cloud-atelier/${descriptor.path}`);
    const info = inspectThemeImage(bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(descriptor.sha256);
    if (!name.startsWith('scene')) {
      expect(descriptor.path.endsWith('-512.png')).toBe(true);
      expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(512);
      expect(readFileSync(`themes/cloud-atelier/assets/${name}.png`).length).toBeGreaterThan(
        bytes.length
      );
    }
  }
});
