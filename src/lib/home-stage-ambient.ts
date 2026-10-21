/**
 * A theme's ambient effect (`effects.ambient`) as the Stage draws it in 3D:
 * the same named effect the 2D Skia layer paints (`skia-ambient-effect.tsx`),
 * with its colours, direction defaults, sizes, periods and opacities, mapped to
 * the instances of one bounded instanced draw. Pure, so the mapping is tested;
 * the scene uploads the instances once and moves them in its shader from a
 * single time uniform.
 *
 * Sizes are given as the 2D layer gives them, in points on a reference
 * 844 pt tall view, and converted here to shares of the view: positions as
 * 0..1 of its width and height (y down, as on screen), sizes as shares of its
 * height. The scene places each instance at its own depth, so tilt shows the
 * depth while the effect still fills the screen as it does in 2D.
 */
import {
  THEME_EFFECT_CAPABILITIES,
  type ThemeAmbientEffect,
  type ThemeEffectDirection,
  type ThemeEffectPaletteRole,
  type ThemeEffects,
} from '@/theme/schema';

/** The most instances one effect draws: the scene's buffer size. */
export const STAGE_AMBIENT_CAPACITY = 128;

/** The 2D layer's sizes are points on a view about this tall. */
const REFERENCE_HEIGHT = 844;

export type StageAmbientColors = Record<ThemeEffectPaletteRole, string>;

/**
 * How the shader moves an instance:
 * - `drift` travels along `direction` and wraps, swaying across it (particles,
 *   dust, embers, snow)
 * - `rain` the same, as streaks along the direction, half of them twice as fast
 * - `stars` stay put and twinkle
 * - `bloom` stays put and breathes
 * - `still` never moves (scanlines' circuit traces)
 */
export type StageAmbientMotion = 'drift' | 'rain' | 'stars' | 'bloom' | 'still';

/** 0 a round dot, 1 a line along `orient`, 2 a soft glow. */
export type StageAmbientShape = 0 | 1 | 2;

export type StageAmbientInstance = {
  /** 0..1 across the view; for travelling motions, where it starts. */
  x: number;
  /** 0..1 down the view. */
  y: number;
  /** World units in front of the camera. */
  depth: number;
  /** Index into `colors`. */
  color: number;
  /** Shares of the view's height. */
  width: number;
  height: number;
  /** 0..1, before the shape's own falloff. */
  alpha: number;
  shape: StageAmbientShape;
  /** 0..1: where in its cycle the instance starts. */
  offset: number;
  /** Cycles relative to the effect's: 2 for the fast half of the rain. */
  rate: number;
  /** Radians: the sway's own phase. */
  swayPhase: number;
  /** The sway's amplitude, as a share of the view's width. */
  sway: number;
  /** The direction a line points along, on screen (y down); not normalised. */
  orientX: number;
  orientY: number;
};

export type StageAmbient = {
  effect: Exclude<ThemeAmbientEffect, 'none'>;
  motion: StageAmbientMotion;
  /** Drawn behind the hero (bloom, traces, stars) or among the near layers' depths. */
  layer: 'back' | 'mid';
  /** Whether the quality ladder's "no particles" step removes it. */
  particles: boolean;
  /** 1 to 4 colours, as hex. */
  colors: string[];
  /** Travel per cycle, on screen (y down): -1, 0 or 1 per axis. */
  direction: { x: number; y: number };
  /** Cycles per second of the effect's clock; 0 when it holds still. */
  cyclesPerSecond: number;
  instances: StageAmbientInstance[];
};

/** The 2D layer's period for one cycle at speed 1, ms. */
function periodMs(effect: ThemeAmbientEffect): number {
  return effect === 'dust'
    ? 18000
    : effect === 'embers'
      ? 12000
      : effect === 'snow'
        ? 16000
        : effect === 'stars'
          ? 8000
          : 6000;
}

/** The colour the 2D layer falls back to when the theme names no palette. */
function fallbackRole(effect: ThemeAmbientEffect): ThemeEffectPaletteRole {
  return effect === 'rain' || effect === 'dust'
    ? 'textMuted'
    : effect === 'particles' || effect === 'bloom'
      ? 'primary'
      : effect === 'embers'
        ? 'warning'
        : 'text';
}

/** The direction the 2D layer uses when the theme names none. */
function defaultDirection(effect: ThemeAmbientEffect): ThemeEffectDirection {
  return effect === 'rain'
    ? 'down-right'
    : effect === 'snow' || effect === 'particles'
      ? 'down'
      : 'up';
}

export function stageAmbientDirection(direction: ThemeEffectDirection): { x: number; y: number } {
  return {
    x: direction.includes('left') ? -1 : direction.includes('right') ? 1 : 0,
    y: direction.includes('up') ? -1 : direction.includes('down') ? 1 : 0,
  };
}

/**
 * How many instances an effect draws at `density`: twice the 2D layer's
 * count, since the Stage spreads them through depth and the far ones are
 * smaller; scanlines draw four segments per trace and a node on every other.
 */
export function stageAmbientCount(effect: ThemeAmbientEffect, density: number): number {
  if (effect === 'none') return 0;
  const share = Math.max(0, Math.min(1, density));
  if (effect === 'scanlines') {
    const traces = Math.ceil(10 * share);
    return traces * 4 + Math.ceil(traces / 2);
  }
  const maximum = effect === 'rain' ? 64 : 32;
  return Math.min(STAGE_AMBIENT_CAPACITY, Math.ceil(maximum * share));
}

const fract = (value: number) => value - Math.floor(value);

/** The 2D layer's mote seeds, extended past its sixteen without repeating. */
function seed(index: number) {
  return {
    x: 0.04 + fract(0.5 + index * 0.618034) * 0.92,
    y: fract(0.31 + index * 0.56984),
    offset: fract(0.13 + index * 0.754878),
    depthShare: fract(0.2 + index * 0.414214),
    radius: 0.8 + (index % 3) * 0.45,
    drift: 4 + (index % 4) * 3,
    phase: index * 1.7,
  };
}

/** The Stage's version of the theme's effect, or null when it draws nothing. */
export function stageAmbient(
  effects: ThemeEffects | null | undefined,
  palette: StageAmbientColors,
  mode: 'light' | 'dark',
  aspect: number
): StageAmbient | null {
  const effect = effects?.ambient ?? 'none';
  if (effect === 'none') return null;
  const can = THEME_EFFECT_CAPABILITIES[effect];
  const intensity = effects?.intensity ?? 0.5;
  const density = can.density ? (effects?.density ?? 1) : 1;
  if (intensity <= 0 || density <= 0) return null;
  const speed = can.speed ? (effects?.speed ?? 1) : 0;
  const size = can.size ? (effects?.size ?? 1) : 1;
  const roles = can.palette && effects?.palette?.length ? effects.palette : null;
  const viewAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 390 / 844;
  const viewWidth = REFERENCE_HEIGHT * viewAspect;
  const toHeight = (points: number) => points / REFERENCE_HEIGHT;

  if (effect === 'scanlines') {
    // Sparse printed-circuit traces from both edges, as the 2D layer draws them.
    const colors = (roles ?? (['primary', 'info', 'success', 'warning'] as const)).map(
      (role) => palette[role]
    );
    const traces = Math.ceil(10 * density);
    const instances: StageAmbientInstance[] = [];
    const segment = (
      from: { x: number; y: number },
      to: { x: number; y: number },
      color: number
    ) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      instances.push({
        x: (from.x + dx / 2) / viewWidth,
        y: (from.y + dy / 2) / REFERENCE_HEIGHT,
        depth: 24,
        color,
        width: toHeight(size),
        height: toHeight(Math.hypot(dx, dy) + size),
        alpha: intensity * 0.24,
        shape: 1,
        offset: 0,
        rate: 0,
        swayPhase: 0,
        sway: 0,
        orientX: dx,
        orientY: dy,
      });
    };
    for (let index = 0; index < traces; index += 1) {
      const left = index % 2 === 0;
      const turn = left ? 1 : -1;
      const startX = left ? -4 : viewWidth + 4;
      const startY = REFERENCE_HEIGHT * (0.07 + index * 0.091);
      const reach = Math.min(viewWidth * (0.12 + (index % 3) * 0.035), 110);
      const elbow = 12 + (index % 3) * 7;
      const points = [
        { x: startX, y: startY },
        { x: startX + turn * reach, y: startY },
        { x: startX + turn * (reach + elbow), y: startY + elbow },
        { x: startX + turn * (reach + elbow), y: startY + elbow + 14 },
        { x: startX + turn * (reach + elbow + 20), y: startY + elbow + 14 },
      ];
      const color = index % colors.length;
      for (let at = 1; at < points.length; at += 1) segment(points[at - 1]!, points[at]!, color);
    }
    for (let index = 0; index < traces; index += 2) {
      const left = index % 2 === 0;
      const turn = left ? 1 : -1;
      const reach = Math.min(viewWidth * (0.12 + (index % 3) * 0.035), 110);
      const elbow = 12 + (index % 3) * 7;
      const end = {
        x: (left ? -4 : viewWidth + 4) + turn * (reach + elbow + 20),
        y: REFERENCE_HEIGHT * (0.07 + index * 0.091) + elbow + 14,
      };
      instances.push({
        x: end.x / viewWidth,
        y: end.y / REFERENCE_HEIGHT,
        depth: 24,
        color: index % colors.length,
        width: toHeight(4.4 * size),
        height: toHeight(4.4 * size),
        alpha: intensity * 0.35,
        shape: 0,
        offset: 0,
        rate: 0,
        swayPhase: 0,
        sway: 0,
        orientX: 0,
        orientY: 1,
      });
    }
    return {
      effect,
      motion: 'still',
      layer: 'back',
      particles: false,
      colors,
      direction: { x: 0, y: 0 },
      cyclesPerSecond: 0,
      instances,
    };
  }

  const colors = (roles ?? [fallbackRole(effect)]).map((role) => palette[role]);
  const cyclesPerSecond = speed > 0 ? (1000 / periodMs(effect)) * speed : 0;

  if (effect === 'bloom') {
    // One soft, breathing light per colour, side by side below the middle.
    const diameter = Math.min(viewWidth, REFERENCE_HEIGHT) * Math.min(0.9, 0.6 * size) * 2;
    const alpha = ((mode === 'dark' ? 0.12 : 0.08) * intensity) / colors.length;
    return {
      effect,
      motion: 'bloom',
      layer: 'back',
      particles: false,
      colors,
      direction: { x: 0, y: 0 },
      cyclesPerSecond,
      instances: colors.map((_, index) => ({
        x: 0.5 + (index - (colors.length - 1) / 2) * 0.12,
        y: 0.6,
        depth: 40,
        color: index,
        width: toHeight(diameter),
        height: toHeight(diameter),
        alpha,
        shape: 2,
        offset: 0,
        rate: 1,
        swayPhase: 0,
        sway: 0,
        orientX: 0,
        orientY: 1,
      })),
    };
  }

  const stars = effect === 'stars';
  const rain = effect === 'rain';
  const direction = stars
    ? { x: 0, y: 0 }
    : stageAmbientDirection(
        (can.direction ? effects?.direction : undefined) ?? defaultDirection(effect)
      );
  const count = stageAmbientCount(effect, density);
  const alpha = intensity * (rain ? (mode === 'dark' ? 0.45 : 0.35) : 0.7);
  const instances: StageAmbientInstance[] = [];
  for (let index = 0; index < count; index += 1) {
    const s = seed(index);
    let width: number;
    let height: number;
    if (rain) {
      width = 1.5 * size;
      height = (18 + (index % 5) * 8) * size;
    } else if (effect === 'particles') {
      width = (3 + (index % 4) * 1.5) * 1.4 * size;
      height = (3 + (index % 4) * 1.5) * 0.65 * size;
    } else {
      const radius =
        effect === 'snow'
          ? 1.2 + ((s.radius - 0.8) / 0.9) * 1.4
          : stars
            ? 1 + (s.radius - 0.8) / 0.9
            : s.radius;
      width = 2 * radius * size;
      height = width;
    }
    instances.push({
      x: s.x,
      y: s.y,
      // Stars far behind; everything else from just in front of the frame
      // back towards the backdrop, so tilt shows the depth.
      depth: stars ? 34 + s.depthShare * 20 : 5 + s.depthShare * 40,
      color: index % colors.length,
      width: toHeight(width),
      height: toHeight(height),
      alpha,
      shape: rain ? 1 : 0,
      offset: s.offset,
      rate: rain ? 1 + (index % 2) : 1,
      swayPhase: s.phase,
      sway: rain || stars ? 0 : s.drift / viewWidth,
      // A streak leans with a sideways wind, steeper than the travel.
      orientX: direction.x * (direction.y === 0 ? 1 : 0.3),
      orientY: direction.y === 0 && direction.x === 0 ? 1 : direction.y,
    });
  }
  return {
    effect,
    motion: stars ? 'stars' : rain ? 'rain' : 'drift',
    layer: stars ? 'back' : 'mid',
    particles: true,
    colors,
    direction,
    cyclesPerSecond,
    instances,
  };
}
