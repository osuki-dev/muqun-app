/** Deterministic, bounded atmosphere; also shared with local visual inspection. */
export const AMBIENT_MOTES = Array.from({ length: 16 }, (_, index) => ({
  x: 0.06 + (((index * 137.5) % 100) / 100) * 0.88,
  offset: ((index * 73.1) % 100) / 100,
  radius: 0.8 + (index % 3) * 0.45,
  drift: 4 + (index % 4) * 3,
  phase: index * 1.7,
}));

export function ambientMoteFrame(
  progress: number,
  seed: (typeof AMBIENT_MOTES)[number],
  width: number,
  height: number,
  effect: 'dust' | 'embers' | 'snow' | 'stars'
) {
  'worklet';
  const phase = (progress + seed.offset) % 1;
  if (effect === 'stars') {
    return {
      x: seed.x * width,
      y: seed.offset * height,
      opacity: 0.2 + 0.8 * ((1 + Math.sin(phase * Math.PI * 2)) / 2),
    };
  }
  const drift = effect === 'dust' ? seed.drift : seed.drift * 0.6;
  return {
    x: seed.x * width + Math.sin(phase * Math.PI * 2 + seed.phase) * drift,
    y: (effect === 'snow' ? phase : 1 - phase) * height,
    opacity: Math.max(0, Math.min(phase / 0.12, (1 - phase) / 0.12, 1)),
  };
}

export function ambientDirectionVector(direction: import('@/theme/schema').ThemeEffectDirection) {
  'worklet';
  return {
    x: direction.includes('left') ? -1 : direction.includes('right') ? 1 : 0,
    y: direction.includes('up') ? -1 : direction.includes('down') ? 1 : 0,
  };
}

export function directionalAmbientFrame(
  progress: number,
  seed: (typeof AMBIENT_MOTES)[number],
  width: number,
  height: number,
  direction: import('@/theme/schema').ThemeEffectDirection,
  drift = 0
) {
  'worklet';
  const phase = (progress + seed.offset) % 1;
  const vector = ambientDirectionVector(direction);
  const x = vector.x === 0 ? seed.x : (((seed.x + vector.x * phase) % 1) + 1) % 1;
  const y = vector.y === 0 ? seed.offset : vector.y > 0 ? phase : 1 - phase;
  const edge = (value: number) => Math.max(0, Math.min(value / 0.12, (1 - value) / 0.12, 1));
  return {
    x: x * width + (vector.x === 0 ? Math.sin(phase * Math.PI * 2 + seed.phase) * drift : 0),
    y: y * height + (vector.y === 0 ? Math.sin(phase * Math.PI * 2 + seed.phase) * drift : 0),
    opacity: edge(phase) * (vector.x === 0 ? 1 : edge(x)),
  };
}

export function ambientParticleCount(
  effect: import('@/theme/schema').ThemeAmbientEffect,
  density: number
) {
  const maximum = effect === 'rain' ? 32 : effect === 'scanlines' ? 10 : 16;
  return Math.ceil(maximum * Math.max(0, Math.min(1, density)));
}
