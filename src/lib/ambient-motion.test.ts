import { describe, expect, test } from 'bun:test';

import {
  themeEffectsSchema,
  THEME_EFFECT_DIRECTIONS,
  THEME_EFFECT_CAPABILITIES,
} from '@/theme/schema';

import {
  AMBIENT_MOTES,
  ambientMoteFrame,
  ambientParticleCount,
  directionalAmbientFrame,
} from './ambient-motion';

describe('ambient mote motion', () => {
  test('bounded count and stable full-loop coordinates', () => {
    expect(AMBIENT_MOTES).toHaveLength(16);
    for (const effect of ['dust', 'embers', 'snow', 'stars'] as const) {
      for (const seed of AMBIENT_MOTES) {
        const start = ambientMoteFrame(0, seed, 390, 844, effect);
        const end = ambientMoteFrame(1, seed, 390, 844, effect);
        expect(end.x).toBeCloseTo(start.x);
        expect(end.y).toBeCloseTo(start.y);
        expect(end.opacity).toBeCloseTo(start.opacity);
      }
    }
  });

  test('wraps are invisible and motion respects the actual surface', () => {
    const seed = { ...AMBIENT_MOTES[0]!, offset: 0 };
    expect(ambientMoteFrame(0, seed, 160, 240, 'embers').opacity).toBe(0);
    expect(ambientMoteFrame(0.999999, seed, 160, 240, 'embers').opacity).toBeLessThan(0.001);
    const middle = ambientMoteFrame(0.5, seed, 160, 240, 'dust');
    expect(middle.y).toBe(120);
    expect(middle.opacity).toBe(1);
  });
});

test('new effects retain explicit zero intensity and speed through parsing', () => {
  for (const ambient of ['dust', 'embers', 'snow', 'stars'] as const) {
    expect(themeEffectsSchema.parse({ ambient, intensity: 0, speed: 0 })).toEqual({
      ambient,
      intensity: 0,
      speed: 0,
    });
  }
});

test('snow descends while embers rise', () => {
  const seed = { ...AMBIENT_MOTES[0]!, offset: 0 };
  const snow = [0.25, 0.5].map((progress) => ambientMoteFrame(progress, seed, 390, 844, 'snow'));
  const embers = [0.25, 0.5].map((progress) =>
    ambientMoteFrame(progress, seed, 390, 844, 'embers')
  );
  expect(snow[1]!.y).toBeGreaterThan(snow[0]!.y);
  expect(embers[1]!.y).toBeLessThan(embers[0]!.y);
});

test('stars twinkle without moving', () => {
  const seed = AMBIENT_MOTES[0]!;
  const start = ambientMoteFrame(0, seed, 390, 844, 'stars');
  const later = ambientMoteFrame(0.25, seed, 390, 844, 'stars');
  expect(later.x).toBe(start.x);
  expect(later.y).toBe(start.y);
  expect(later.opacity).not.toBe(start.opacity);
});

test('all eight directions loop continuously with bounded density', () => {
  for (const direction of THEME_EFFECT_DIRECTIONS) {
    for (const seed of AMBIENT_MOTES) {
      const first = directionalAmbientFrame(0, seed, 390, 844, direction, 8);
      const last = directionalAmbientFrame(1, seed, 390, 844, direction, 8);
      expect(last.x).toBeCloseTo(first.x);
      expect(last.y).toBeCloseTo(first.y);
      expect(last.opacity).toBeCloseTo(first.opacity);
    }
  }
  expect(ambientParticleCount('rain', 1)).toBe(32);
  expect(ambientParticleCount('snow', 1)).toBe(16);
  expect(ambientParticleCount('scanlines', 1)).toBe(10);
  expect(ambientParticleCount('rain', 0)).toBe(0);
  expect(ambientParticleCount('rain', 10)).toBe(32);
  expect(ambientParticleCount('dust', 0.5)).toBe(8);
});

test('direction controls actually change travel axes', () => {
  const seed = { ...AMBIENT_MOTES[0]!, x: 0.5, offset: 0 };
  for (const direction of THEME_EFFECT_DIRECTIONS) {
    const before = directionalAmbientFrame(0.1, seed, 390, 844, direction);
    const after = directionalAmbientFrame(0.2, seed, 390, 844, direction);
    if (direction.includes('left')) expect(after.x).toBeLessThan(before.x);
    if (direction.includes('right')) expect(after.x).toBeGreaterThan(before.x);
    if (direction.includes('up')) expect(after.y).toBeLessThan(before.y);
    if (direction.includes('down')) expect(after.y).toBeGreaterThan(before.y);
  }
});

test('effect controls have strict bounds and tolerate inactive capabilities', () => {
  const value = {
    ambient: 'scanlines',
    density: 0,
    size: 2,
    palette: ['primary', 'info'],
    direction: 'up',
    speed: 0,
  };
  expect(themeEffectsSchema.safeParse(value).success).toBe(true);
  expect(THEME_EFFECT_CAPABILITIES.scanlines.speed).toBe(false);
  expect(THEME_EFFECT_CAPABILITIES.stars.direction).toBe(false);
  expect(THEME_EFFECT_CAPABILITIES.bloom.density).toBe(false);
  for (const invalid of [
    { density: 1.1 },
    { density: -1 },
    { size: 0.4 },
    { size: 2.1 },
    { palette: [] },
    { palette: ['#ffffff'] },
    { palette: ['text', 'text', 'text', 'text', 'text'] },
    { direction: 'diagonal' },
  ]) {
    expect(themeEffectsSchema.safeParse({ ambient: 'rain', ...invalid }).success).toBe(false);
  }
});
