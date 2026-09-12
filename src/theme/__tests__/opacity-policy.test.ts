import { expect, test } from 'bun:test';
import { createThemeStarter } from '../authoring';
import { contrastRatio } from '../contrast';
import { clampThemeOpacity, jointArtworkOpacity, themeOpacityPolicy } from '../opacity-policy';

function monochrome() {
  const manifest = createThemeStarter();
  for (const [mode, variant] of Object.entries(manifest.variants)) {
    const base = mode === 'light' ? '#FFFFFF' : '#000000';
    const ink = mode === 'light' ? '#000000' : '#FFFFFF';
    for (const key of [
      'background',
      'surface',
      'surfaceRaised',
      'onPrimary',
      'primarySubtle',
      'dangerSubtle',
    ] as const)
      variant.colors[key] = base;
    for (const key of [
      'text',
      'textMuted',
      'textSubtle',
      'primary',
      'danger',
      'info',
      'warning',
      'success',
    ] as const)
      variant.colors[key] = ink;
    variant.terminal.background = base;
    variant.terminal.foreground = ink;
    variant.terminal.cursor = ink;
    variant.terminal.link = ink;
    variant.terminal.ansi = variant.terminal.ansi.map(() => ink) as typeof variant.terminal.ansi;
  }
  return manifest;
}

test('floors protect declared foregrounds against arbitrary RGB underlays at every allowed alpha', () => {
  const manifest = monochrome();
  for (const variant of Object.values(manifest.variants)) {
    const policy = themeOpacityPolicy(variant);
    expect(policy.surface.baselineIssues).toEqual([]);
    expect(policy.terminal.baselineIssues).toEqual([]);
    expect(policy.terminal.minimum).toBeLessThan(1);
    for (let percent = Math.round(policy.terminal.minimum * 100); percent <= 100; percent++) {
      for (const backdrop of [0, 40, 128, 220, 255]) {
        const base = Number.parseInt(variant.terminal.background.slice(1, 3), 16);
        const color = Math.round((base * percent) / 100 + backdrop * (1 - percent / 100));
        const hex = '#' + color.toString(16).padStart(2, '0').repeat(3);
        expect(contrastRatio(variant.terminal.foreground, hex)).toBeGreaterThanOrEqual(4.5);
      }
    }
  }
});

test('authored alpha tint and its underlying surface both consume the global alpha', () => {
  const variant = monochrome().variants.light;
  variant.colors.primarySubtle = '#55555580';
  const policy = themeOpacityPolicy(variant);
  expect(policy.surface.baselineIssues).toEqual([]);
  for (let percent = Math.round(policy.surface.minimum * 100); percent <= 100; percent++) {
    const alpha = percent / 100;
    const tintAlpha = alpha * (128 / 255);
    for (const under of [0, 64, 128, 255]) {
      const lower = 255 * alpha + under * (1 - alpha);
      const composite = Math.round(85 * tintAlpha + lower * (1 - tintAlpha));
      const hex = '#' + composite.toString(16).padStart(2, '0').repeat(3);
      expect(contrastRatio(variant.colors.primary, hex)).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('unachievable opaque contrast reports issues and cannot claim safe translucency', () => {
  const variant = monochrome().variants.dark;
  variant.colors.textMuted = '#000000';
  variant.terminal.link = '#000000';
  variant.terminal.ansi[0] = '#000000';
  const policy = themeOpacityPolicy(variant);
  expect(policy.surface.minimum).toBe(1);
  expect(policy.surface.baselineIssues.length).toBeGreaterThan(0);
  expect(policy.terminal.minimum).toBe(1);
  expect(policy.terminal.baselineIssues[0].path).toBe('terminal.link/background');
  expect(policy.ansiIssues[0].path).toBe('terminal.ansi.0/background');
});

test('clamping is immutable, idempotent, shared across modes and preserves omitted defaults', () => {
  const manifest = monochrome();
  expect(clampThemeOpacity(manifest)).toEqual(manifest);
  manifest.variants.light.surfaces = { backgroundOpacity: 0 };
  manifest.variants.dark.surfaces = { backgroundOpacity: 0.99 };
  manifest.variants.light.terminal.backgroundOpacity = 0;
  manifest.variants.dark.terminal.backgroundOpacity = 0;
  const policies = Object.values(manifest.variants).map(themeOpacityPolicy);
  const result = clampThemeOpacity(manifest);
  const surface = Math.max(...policies.map((p) => p.surface.minimum));
  const terminal = Math.max(...policies.map((p) => p.terminal.minimum));
  expect(result.variants.light.surfaces?.backgroundOpacity).toBe(surface);
  expect(result.variants.dark.surfaces?.backgroundOpacity).toBe(Math.max(0.99, surface));
  expect(result.variants.light.terminal.backgroundOpacity).toBe(terminal);
  expect(result.variants.dark.terminal.backgroundOpacity).toBe(terminal);
  expect(manifest.variants.light.terminal.backgroundOpacity).toBe(0);
  expect(clampThemeOpacity(result)).toEqual(result);
});

test('joint artwork budget preserves effective base contribution without NaN or overshoot', () => {
  expect(jointArtworkOpacity(0.4, 1, 0.8)).toBeCloseTo(0.4);
  expect(jointArtworkOpacity(0.4, 0.8, 1)).toBeCloseTo(0.25);
  expect(jointArtworkOpacity(0.4, 0.6)).toBe(0);
  expect(jointArtworkOpacity(1, 0)).toBe(0);
  for (const bad of [NaN, Infinity, -Infinity]) {
    expect(jointArtworkOpacity(bad, 1)).toBe(0);
    expect(jointArtworkOpacity(1, bad)).toBe(0);
  }
  expect(jointArtworkOpacity(0.8, 1, 0.1)).toBe(0.1);
});
