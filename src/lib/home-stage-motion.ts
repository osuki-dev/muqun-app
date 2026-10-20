/**
 * The Stage's frame pacing: the springs it steps on the JS thread, and the
 * policy that trades effects away when frames run long. Pure, so the budget
 * that protects the reader's battery is tested rather than tuned on faith.
 */

export type StageSpring = { value: number; velocity: number };
export type StageSpringConfig = { stiffness: number; damping: number; mass?: number };

/** The card move: about 420 ms to rest (design §11.3, spring per §7). */
export const STAGE_CARD_SPRING: StageSpringConfig = { stiffness: 160, damping: 18 };
/** Pitch and tilt settle a little softer. */
export const STAGE_CAMERA_SPRING: StageSpringConfig = { stiffness: 120, damping: 16 };

const SUBSTEP_S = 1 / 240;
/** A frame that stalls (backgrounding, a GC) is stepped as at most this much time. */
const MAX_STEP_S = 0.064;
const REST_DISTANCE = 0.0015;
const REST_VELOCITY = 0.01;

/** Advance `spring` towards `target` by `dtSeconds` (semi-implicit Euler, fixed substeps). */
export function stepStageSpring(
  spring: StageSpring,
  target: number,
  dtSeconds: number,
  config: StageSpringConfig
): StageSpring {
  const mass = config.mass ?? 1;
  let { value, velocity } = spring;
  if (!Number.isFinite(value) || !Number.isFinite(velocity)) return { value: target, velocity: 0 };
  let remaining = Math.min(MAX_STEP_S, Math.max(0, Number.isFinite(dtSeconds) ? dtSeconds : 0));
  while (remaining > 1e-9) {
    const dt = Math.min(SUBSTEP_S, remaining);
    const force = -config.stiffness * (value - target) - config.damping * velocity;
    velocity += (force / mass) * dt;
    value += velocity * dt;
    remaining -= dt;
  }
  if (stageSpringAtRest({ value, velocity }, target)) return { value: target, velocity: 0 };
  return { value, velocity };
}

export function stageSpringAtRest(spring: StageSpring, target: number): boolean {
  return (
    Math.abs(spring.value - target) < REST_DISTANCE && Math.abs(spring.velocity) < REST_VELOCITY
  );
}

/** The glow's breath: 1.0 -> peak -> 1.0 over `periodMs` (§11.6: 4 s). */
export function stageBreath(nowMs: number, periodMs = 4000, depth = 0.18): number {
  const phase = ((nowMs % periodMs) + periodMs) % periodMs;
  return 1 + depth * 0.5 * (1 - Math.cos((2 * Math.PI * phase) / periodMs));
}

/** The selection flash: 1.0 -> 1.4 -> 1.0 over 400 ms after a selection changes (§7). */
export function stageSelectionGlow(sinceSelectMs: number): number {
  if (!(sinceSelectMs >= 0) || sinceSelectMs >= 400) return 1;
  return 1 + 0.4 * Math.sin((Math.PI * sinceSelectMs) / 400);
}

// -- Degrade policy ---------------------------------------------------------

/**
 * The ladder the stage steps down when it cannot hold its frame rate:
 * particles go first, then the foil shimmer with a 30 fps cap, then the
 * static 2.5D composition (§5, §11.7). It never climbs back within a visit:
 * a device that was too slow once will be again, and flapping costs more
 * than it saves.
 */
export type StageQuality = 'full' | 'no-particles' | 'capped' | 'static';
const LADDER: readonly StageQuality[] = ['full', 'no-particles', 'capped', 'static'];

/** A frame slower than 45 fps counts against the stage. */
export const STAGE_SLOW_FRAME_MS = 1000 / 45;
/** ...when the average stays that slow for this long while moving. */
export const STAGE_SLOW_WINDOW_MS = 2000;

export type StageDegradeState = {
  quality: StageQuality;
  /** Smoothed frame time over moving frames, ms. */
  averageMs: number;
  /** When the average first went slow in the current run, or null. */
  slowSinceMs: number | null;
};

export function initialStageDegrade(quality: StageQuality = 'full'): StageDegradeState {
  return { quality, averageMs: 1000 / 60, slowSinceMs: null };
}

/**
 * Record one frame. Only frames rendered back to back while something moves
 * are evidence: idle breathing runs at 20 fps on purpose, and the first frame
 * after a pause measures the pause, not the device.
 */
export function recordStageFrame(
  state: StageDegradeState,
  frame: { nowMs: number; frameMs: number; continuous: boolean }
): StageDegradeState {
  if (state.quality === 'static') return state;
  if (!frame.continuous || !(frame.frameMs > 0) || frame.frameMs > 250)
    return state.slowSinceMs === null ? state : { ...state, slowSinceMs: null };
  // A 30 fps cap paces frames at 33 ms by design; judge it against its own pace.
  const budget = state.quality === 'capped' ? 1000 / 27 : STAGE_SLOW_FRAME_MS;
  const averageMs = state.averageMs * 0.85 + frame.frameMs * 0.15;
  if (averageMs <= budget) return { ...state, averageMs, slowSinceMs: null };
  const slowSinceMs = state.slowSinceMs ?? frame.nowMs;
  if (frame.nowMs - slowSinceMs < STAGE_SLOW_WINDOW_MS) return { ...state, averageMs, slowSinceMs };
  const next = LADDER[Math.min(LADDER.length - 1, LADDER.indexOf(state.quality) + 1)]!;
  return { quality: next, averageMs: 1000 / 60, slowSinceMs: null };
}

export type StageEffects = {
  /** Whether the WebGPU scene runs at all; false draws the static 2.5D stage. */
  gpu: boolean;
  particles: boolean;
  shimmer: boolean;
  /** The working pulse and the 4 s breathing. Off under Reduce Motion (glow shown steady). */
  pulse: boolean;
  tilt: boolean;
  /** Minimum milliseconds between frames while moving. */
  frameIntervalMs: number;
  /** Idle breathing frame interval (20 fps), or null when nothing breathes. */
  idleIntervalMs: number | null;
};

/** What the stage draws for its quality step and the reader's motion setting. */
export function stageEffects(
  quality: StageQuality,
  options: { gpuAvailable: boolean; reducedMotion: boolean }
): StageEffects {
  const gpu = options.gpuAvailable && quality !== 'static';
  const calm = options.reducedMotion;
  return {
    gpu,
    particles: gpu && !calm && quality === 'full',
    shimmer: gpu && quality !== 'capped',
    pulse: !calm,
    tilt: !calm,
    frameIntervalMs: quality === 'capped' ? 1000 / 30 : 0,
    idleIntervalMs: gpu && !calm ? 50 : null,
  };
}
