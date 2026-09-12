import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { auditThemeContrast } from '../contrast';
import { resolveArtworkOpacity } from '../artwork-contrast';
import { resolveThemeImage } from '../resolve';
import { parseThemeManifest } from '../schema';

const manifest = parseThemeManifest(readFileSync('themes/comic-bloom/theme.json', 'utf8'));

test('Comic Bloom is a complete two-mode skin, not a banner-only fixture', () => {
  expect(auditThemeContrast(manifest)).toEqual([]);
  for (const mode of ['light', 'dark'] as const) {
    expect(resolveArtworkOpacity(manifest.variants[mode].colors)).toBeGreaterThan(0.15);
    expect(resolveThemeImage(manifest, 'home.decoration', mode, 'compact')).toBeNull();
    for (const size of ['compact', 'regular'] as const) {
      for (const slot of [
        'shell.background',
        'navigation.background',
        'composer.background',
        'actions.background',
        'tabs.background',
        'cards.decoration',
        'buttons.primary.background',
        'emptyState.illustration',
      ] as const) {
        const artwork = resolveThemeImage(manifest, slot, mode, size);
        expect(artwork).not.toBeNull();
        expect(manifest.assets?.[artwork!.asset]).toBeDefined();
      }
    }
  }
});
