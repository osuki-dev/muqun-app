/**
 * The Stage's frame pacing: the springs it steps on the JS thread, and the
 * policy that trades effects away when frames run long. Pure, so the budget
 * that protects the reader's battery is tested rather than tuned on faith.
 */

export type StageSpring = { value: number; velocity: number };
export type StageSpringConfig = { stiffness: number; damping: number; mass?: number };

/** The card move: about 420 ms to rest (design §11.3, spring per §7). */
export const STAGE_CARD_SPRING: StageSpringConfig = { stiffness: 160, damping: 18 };
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

// -- Degrade policy ---------------------------------------------------------

/**
 * The ladder the stage steps down when it cannot hold its frame rate:
 * the motes go first, then the glass sheen with a 30 fps cap, then the
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
  /** The floating motes; still under Reduce Motion, but still drawn. */
  particles: boolean;
  /** The sheen that tilt slides across the glass panes. */
  shimmer: boolean;
  /** The working pulse, the hero's bob and the motes' drift. Off under Reduce Motion. */
  pulse: boolean;
  tilt: boolean;
  /** Minimum milliseconds between frames while moving. */
  frameIntervalMs: number;
  /** Idle frame interval (20 fps) for the pulse, bob and drift, or null when nothing moves. */
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
    particles: gpu && quality === 'full',
    shimmer: gpu && quality !== 'capped',
    pulse: !calm,
    tilt: !calm,
    frameIntervalMs: quality === 'capped' ? 1000 / 30 : 0,
    idleIntervalMs: gpu && !calm ? 50 : null,
  };
}

// -- Idle policy ------------------------------------------------------------

/**
 * How long the ambient motion (the motes' drift, the hero's bob, the working
 * pulse, a theme's ambient effect) keeps running at the idle rate after the
 * last interaction. Past it the scene holds its last frame and draws nothing
 * until something wakes it: a drag, a swipe, tilt, a dive, a completion's
 * flare or a change to what the scene shows. A phone left on Home then costs
 * the GPU nothing instead of 20 frames every second.
 */
export const STAGE_AMBIENT_IDLE_MS = 6000;

/**
 * A gap between frames longer than this means the scene had stopped and
 * something woke it, which counts as activity: the ambient motion resumes.
 */
export const STAGE_WAKE_GAP_MS = 250;

/**
 * The smallest change in smoothed device tilt (-1..1 per axis) that is
 * written to the scene. Hand tremor and sensor noise stay under it, so a
 * phone held still does not keep the camera easing at the full frame rate.
 */
export const STAGE_TILT_DEADBAND = 0.004;
/** Accumulated tilt change that wakes a scene which has stopped drawing. */
export const STAGE_TILT_WAKE = 0.03;

/**
 * When the next frame is due while nothing moves: the idle interval while the
 * ambient motion is still running, null once the scene has been idle for
 * `STAGE_AMBIENT_IDLE_MS` (or has no ambient motion at all).
 */
export function stageIdleInterval(effects: StageEffects, idleForMs: number): number | null {
  if (effects.idleIntervalMs === null) return null;
  return idleForMs < STAGE_AMBIENT_IDLE_MS ? effects.idleIntervalMs : null;
}
