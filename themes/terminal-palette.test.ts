import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseThemeManifest } from '../src/theme/schema';
import { auditThemeContrast } from '../src/theme/contrast';
import { themeOpacityPolicy, clampThemeOpacity } from '../src/theme/opacity-policy';

for (const id of ['cloud-atelier', 'comic-bloom']) {
  test(`${id} retains readable role colors and offers a genuine 85% terminal floor`, () => {
    const manifest = parseThemeManifest(readFileSync(`themes/${id}/theme.json`, 'utf8'));
    expect(auditThemeContrast(manifest)).toEqual([]);
    for (const mode of ['light', 'dark'] as const) {
      const policy = themeOpacityPolicy(manifest.variants[mode]);
      expect(policy.terminal.minimum).toBe(0.85);
      expect(policy.terminal.baselineIssues).toEqual([]);
      expect(policy.surface.baselineIssues).toEqual([]);
      expect(policy.ansiIssues.map((issue) => issue.path)).toEqual(
        id === 'cloud-atelier' && mode === 'light' ? ['terminal.ansi.15/background'] : []
      );
      expect(manifest.variants[mode].terminal.backgroundOpacity).toBeUndefined();
      manifest.variants[mode].terminal.backgroundOpacity = 0.85;
    }
    const effective = clampThemeOpacity(manifest);
    for (const mode of ['light', 'dark'] as const)
      expect(effective.variants[mode].terminal.backgroundOpacity).toBe(0.85);
  });
}
