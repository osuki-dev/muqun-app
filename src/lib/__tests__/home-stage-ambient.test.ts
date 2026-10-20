import { describe, expect, test } from 'bun:test';
import { THEME_AMBIENT_EFFECTS } from '@/theme/schema';
import {
  stageAmbient,
  stageAmbientCount,
  STAGE_AMBIENT_CAPACITY,
  type StageAmbientColors,
} from '../home-stage-ambient';

const palette: StageAmbientColors = {
  primary: '#111111',
  text: '#222222',
  textMuted: '#333333',
  info: '#444444',
  success: '#555555',
  warning: '#666666',
};
const aspect = 390 / 844;

describe('stageAmbient', () => {
  test('none, no effects, zero intensity or zero density draw nothing', () => {
    expect(stageAmbient(undefined, palette, 'dark', aspect)).toBeNull();
    expect(stageAmbient({ ambient: 'none' }, palette, 'dark', aspect)).toBeNull();
    expect(stageAmbient({ ambient: 'rain', intensity: 0 }, palette, 'dark', aspect)).toBeNull();
    expect(stageAmbient({ ambient: 'snow', density: 0 }, palette, 'dark', aspect)).toBeNull();
  });

  test('every named effect draws within the buffer', () => {
    for (const effect of THEME_AMBIENT_EFFECTS) {
      if (effect === 'none') continue;
      for (const density of [0.1, 1]) {
        const ambient = stageAmbient(
          { ambient: effect, density, size: 2 },
          palette,
          'dark',
          aspect
        );
        expect(ambient?.effect).toBe(effect);
        expect(ambient!.instances.length).toBeGreaterThan(0);
        expect(ambient!.instances.length).toBeLessThanOrEqual(STAGE_AMBIENT_CAPACITY);
        expect(ambient!.colors.length).toBeGreaterThan(0);
        for (const instance of ambient!.instances)
          expect(instance.color).toBeLessThan(ambient!.colors.length);
      }
    }
  });

  test('falls back to the 2D layer colour for each effect', () => {
    const colorOf = (ambient: (typeof THEME_AMBIENT_EFFECTS)[number]) =>
      stageAmbient({ ambient }, palette, 'dark', aspect)?.colors;
    expect(colorOf('rain')).toEqual([palette.textMuted]);
    expect(colorOf('dust')).toEqual([palette.textMuted]);
    expect(colorOf('particles')).toEqual([palette.primary]);
    expect(colorOf('bloom')).toEqual([palette.primary]);
    expect(colorOf('embers')).toEqual([palette.warning]);
    expect(colorOf('snow')).toEqual([palette.text]);
    expect(colorOf('stars')).toEqual([palette.text]);
    expect(colorOf('scanlines')).toEqual([
      palette.primary,
      palette.info,
      palette.success,
      palette.warning,
    ]);
    expect(
      stageAmbient({ ambient: 'snow', palette: ['info', 'success'] }, palette, 'dark', aspect)
        ?.colors
    ).toEqual([palette.info, palette.success]);
  });

  test('direction defaults follow the 2D layer and only directional effects take one', () => {
    const directionOf = (ambient: (typeof THEME_AMBIENT_EFFECTS)[number], direction?: 'left') =>
      stageAmbient({ ambient, direction }, palette, 'dark', aspect)?.direction;
    expect(directionOf('rain')).toEqual({ x: 1, y: 1 });
    expect(directionOf('snow')).toEqual({ x: 0, y: 1 });
    expect(directionOf('particles')).toEqual({ x: 0, y: 1 });
    expect(directionOf('dust')).toEqual({ x: 0, y: -1 });
    expect(directionOf('embers')).toEqual({ x: 0, y: -1 });
    expect(directionOf('embers', 'left')).toEqual({ x: -1, y: 0 });
    expect(directionOf('stars', 'left')).toEqual({ x: 0, y: 0 });
    expect(directionOf('bloom', 'left')).toEqual({ x: 0, y: 0 });
  });

  test('speed sets the clock where the effect moves; scanlines never move', () => {
    const rain = stageAmbient({ ambient: 'rain', speed: 2 }, palette, 'dark', aspect)!;
    expect(rain.cyclesPerSecond).toBeCloseTo((1000 / 6000) * 2);
    expect(stageAmbient({ ambient: 'dust' }, palette, 'dark', aspect)!.cyclesPerSecond).toBeCloseTo(
      1000 / 18000
    );
    expect(
      stageAmbient({ ambient: 'snow', speed: 0 }, palette, 'dark', aspect)!.cyclesPerSecond
    ).toBe(0);
    expect(
      stageAmbient({ ambient: 'scanlines', speed: 2 }, palette, 'dark', aspect)!.cyclesPerSecond
    ).toBe(0);
  });

  test('size scales instances; rain streaks lean with the wind and half fall twice as fast', () => {
    const small = stageAmbient({ ambient: 'snow', size: 0.5 }, palette, 'dark', aspect)!;
    const large = stageAmbient({ ambient: 'snow', size: 2 }, palette, 'dark', aspect)!;
    expect(large.instances[0]!.width).toBeCloseTo(small.instances[0]!.width * 4);
    const rain = stageAmbient({ ambient: 'rain' }, palette, 'dark', aspect)!;
    expect(rain.instances[0]!.orientX).toBeCloseTo(0.3);
    expect(new Set(rain.instances.map((instance) => instance.rate))).toEqual(new Set([1, 2]));
  });

  test('bloom ignores density and spreads one light per palette colour', () => {
    const bloom = stageAmbient(
      { ambient: 'bloom', density: 0, palette: ['primary', 'info', 'warning'] },
      palette,
      'dark',
      aspect
    )!;
    expect(bloom.instances).toHaveLength(3);
    expect(bloom.particles).toBe(false);
  });
});

describe('stageAmbientCount', () => {
  test('scales with density, twice the 2D count, scanlines as segments and nodes', () => {
    expect(stageAmbientCount('rain', 1)).toBe(64);
    expect(stageAmbientCount('dust', 0.5)).toBe(16);
    expect(stageAmbientCount('scanlines', 1)).toBe(45);
    expect(stageAmbientCount('none', 1)).toBe(0);
  });
});
