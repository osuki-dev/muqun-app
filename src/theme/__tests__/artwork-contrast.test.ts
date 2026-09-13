import { describe, expect, test } from 'bun:test';
import { safeArtworkOpacity, resolveArtworkOpacity } from '../artwork-contrast';
import { createThemeStarter } from '../authoring';

describe('safe artwork opacity', () => {
  test('preserves a safe requested opacity and clamps the allowed range', () => {
    const inks = [{ color: '#000000', minimum: 4.5 }];
    expect(safeArtworkOpacity('#FFFFFF', inks, 0.1)).toBe(0.1);
    const limit = safeArtworkOpacity('#FFFFFF', inks, 2);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(1);
    expect(safeArtworkOpacity('#FFFFFF', inks, limit / 2)).toBe(limit / 2);
  });

  test('composites encoded sRGB before linearizing instead of blending luminance', () => {
    const lightLimit = safeArtworkOpacity('#FFFFFF', [{ color: '#000000', minimum: 4.5 }]);
    const darkLimit = safeArtworkOpacity('#000000', [{ color: '#FFFFFF', minimum: 4.5 }]);
    expect(lightLimit).toBeCloseTo(1 - (1.055 * 0.175 ** (1 / 2.4) - 0.055), 10);
    expect(darkLimit).toBeCloseTo(1.055 * (1.05 / 4.5 - 0.05) ** (1 / 2.4) - 0.055, 10);
  });

  test('rejects interior luminance collisions even when black and white endpoints pass', () => {
    // #777 has contrast > 3 against both black and white, but identical gray artwork is 1.
    const limit = safeArtworkOpacity('#FFFFFF', [{ color: '#777777', minimum: 3 }]);
    expect(limit).toBeGreaterThan(0);
    expect(limit).toBeLessThan(0.3);
  });

  test('invalid inputs and already unreadable baseline fail closed without NaN', () => {
    for (const requested of [NaN, Infinity, -Infinity, -1, 0])
      expect(safeArtworkOpacity('#FFFFFF', [{ color: '#000000', minimum: 4.5 }], requested)).toBe(
        0
      );
    expect(safeArtworkOpacity('#FFFFFF', [{ color: '#FFFFFF', minimum: 4.5 }])).toBe(0);
    expect(safeArtworkOpacity('invalid', [{ color: '#000000', minimum: 4.5 }])).toBe(0);
    expect(safeArtworkOpacity('#FFFFFF', [{ color: '#GGGGGG', minimum: 4.5 }])).toBe(0);
    expect(safeArtworkOpacity('#FFFFFF', [{ color: '#000000', minimum: NaN }])).toBe(0);
    expect(safeArtworkOpacity('#FFFFFF', [])).toBe(0);
  });

  test('each chrome label and semantic icon constrains the result', () => {
    const colors = createThemeStarter().variants.light.colors;
    colors.surfaceRaised = '#FFFFFF';
    const keys = [
      'text',
      'textMuted',
      'textSubtle',
      'primary',
      'danger',
      'info',
      'success',
      'warning',
    ] as const;
    for (const key of keys) colors[key] = '#000000';
    expect(resolveArtworkOpacity(colors)).toBeGreaterThan(0);
    for (const key of keys) {
      expect(resolveArtworkOpacity({ ...colors, [key]: '#FFFFFF' })).toBe(0);
    }
    expect(resolveArtworkOpacity(colors, 0.05)).toBe(0.05);
  });
});
