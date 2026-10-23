/**
 * The Stage's frame pacing: the springs it steps on the JS thread, and the
 * policy that trades effects away when frames run long. Pure, so the budget
 * that protects the reader's battery is tested rather than tuned on faith.
 */

export type StageSpring = { value: number; velocity: number };
export type StageSpringConfig = { stiffness: number; damping: number; mass?: number };

/** The camera's pan between computers: about 420 ms to rest (design §11.3, spring per §7). */
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
 * The ladder the stage steps down when it cannot hold its frame budget:
 * `full` renders at the device's pixel ratio up to 2; `reduced` halves the
 * particles and renders at 1.5 at most; `low` drops the particles, renders
 * at 1x and caps every frame at 30 fps; `static` is the same layout drawn
 * flat, without parallax (§5, §11.7). Within a visit to Home it only steps
 * down; a later visit or launch may try one rung up (`StageLadder`).
 */
export type StageQuality = 'full' | 'reduced' | 'low' | 'static';
const LADDER: readonly StageQuality[] = ['full', 'reduced', 'low', 'static'];

/**
 * One rung down, never past `low`: a slow device keeps the 3D scene at its
 * cheapest rather than losing it to the static stage for the session.
 */
function lowerStageQuality(quality: StageQuality): StageQuality {
  const floor = LADDER.indexOf('low');
  const at = LADDER.indexOf(quality);
  return at >= floor ? quality : LADDER[at + 1]!;
}

/** The lower of two rungs. */
export function lowestStageQuality(a: StageQuality, b: StageQuality): StageQuality {
  return LADDER.indexOf(a) >= LADDER.indexOf(b) ? a : b;
}

/** A frame slower than this counts against the stage (about 45 fps). */
export const STAGE_FRAME_BUDGET_MS = 22;
/** ...when the 90th percentile of a window this long is over it. */
export const STAGE_BUDGET_WINDOW_MS = 2000;
/** A window needs this many frames to judge: a few slow frames are not a trend. */
const MIN_SAMPLES = 20;
/** A pause this long between measured frames starts a new window. */
const GAP_MS = 1000;
/** A frame this long measured a stall (a GC, backgrounding), not the device. */
const STALL_MS = 250;
const CAPACITY = 256;

/**
 * The current window's frame times, kept in place so that recording a frame
 * never allocates. Owned by one scene and advanced by `recordStageFrame`.
 */
export type StageFrameBudget = {
  quality: StageQuality;
  samples: Float32Array;
  count: number;
  /** When the current window started, or null between windows. */
  windowStartMs: number | null;
  lastMs: number;
  /** How long this rung's judged windows have met the budget. */
  passedMs: number;
  /** Whether `passedMs` has reached `STAGE_RUNG_HELD_MS`: the rung holds. */
  held: boolean;
};

/**
 * Judged frames a rung must meet the budget for before it holds: two
 * windows, about the first five seconds of the ambient motion that a return
 * to Home starts.
 */
export const STAGE_RUNG_HELD_MS = 2 * STAGE_BUDGET_WINDOW_MS;

export function createStageFrameBudget(quality: StageQuality = 'full'): StageFrameBudget {
  return {
    quality,
    samples: new Float32Array(CAPACITY),
    count: 0,
    windowStartMs: null,
    lastMs: 0,
    passedMs: 0,
    held: false,
  };
}

/** The 90th percentile of the first `count` values; sorts them in place. */
export function stageP90(values: Float32Array, count: number): number {
  if (count <= 0) return 0;
  const sorted = values.subarray(0, count).sort();
  return sorted[Math.min(count - 1, Math.floor(count * 0.9))]!;
}

/**
 * Record one measured frame and return the quality to draw at. Only frames
 * that measure the device are passed in: a frame's own work, or the gap
 * between frames drawn back to back at full rate. Idle frames run slowly on
 * purpose and say nothing. When a window of `STAGE_BUDGET_WINDOW_MS` closes
 * with its 90th percentile over `STAGE_FRAME_BUDGET_MS`, the stage drops one
 * rung and starts measuring the new rung afresh; one within it counts
 * towards the rung holding (`held`).
 */
export function recordStageFrame(
  budget: StageFrameBudget,
  frame: { nowMs: number; frameMs: number }
): StageQuality {
  if (budget.quality === 'static' || budget.quality === 'low') return budget.quality;
  if (!(frame.frameMs > 0) || frame.frameMs > STALL_MS) return budget.quality;
  if (budget.windowStartMs === null || frame.nowMs - budget.lastMs > GAP_MS) {
    budget.windowStartMs = frame.nowMs;
    budget.count = 0;
  }
  budget.lastMs = frame.nowMs;
  if (budget.count < CAPACITY) {
    budget.samples[budget.count] = frame.frameMs;
    budget.count += 1;
  }
  if (frame.nowMs - budget.windowStartMs < STAGE_BUDGET_WINDOW_MS) return budget.quality;
  if (budget.count >= MIN_SAMPLES) {
    if (stageP90(budget.samples, budget.count) > STAGE_FRAME_BUDGET_MS)
      budget.quality = lowerStageQuality(budget.quality);
    else {
      budget.passedMs += frame.nowMs - budget.windowStartMs;
      if (budget.passedMs >= STAGE_RUNG_HELD_MS) budget.held = true;
    }
  }
  budget.windowStartMs = null;
  budget.count = 0;
  return budget.quality;
}

// -- Recovery ---------------------------------------------------------------

/** Away from Home at least this long, a return may try one rung up. */
export const STAGE_CLIMB_AWAY_MS = 60_000;
/** After the first step down; each later one doubles it, up to the cap. */
const CLIMB_WAIT_MS = 60_000;
const MAX_CLIMB_WAIT_MS = 30 * 60_000;
/** A day without stepping down forgets the earlier ones. */
const STRIKES_FORGOTTEN_MS = 24 * 60 * 60_000;
const MAX_STRIKES = 16;

/**
 * Where the stage stands on the ladder across visits and launches. It steps
 * down as `recordStageFrame` decides, and holds that rung for the visit.
 * On a return to Home after `STAGE_CLIMB_AWAY_MS` away, or on the next
 * launch, it tries one rung up (`trial`): if the trial rung meets the budget
 * for `STAGE_RUNG_HELD_MS` it holds, if it does not the stage steps back.
 *
 * Hysteresis: each step down is a strike, and a climb waits a minute after
 * the last one, doubling per strike up to half an hour. A rung that held
 * does not clear the strikes; only a day without stepping down does. A
 * device that cannot hold a rung tries it less and less often rather than on
 * every visit.
 */
export type StageLadder = {
  /** The rung the stage holds. */
  settled: StageQuality;
  /** One rung above `settled` being tried, or null. */
  trial: StageQuality | null;
  strikes: number;
  /** When the stage last stepped down (epoch ms), or null. */
  lastDropAt: number | null;
  /** When Home was left (epoch ms), or null while it is shown. */
  awayAt: number | null;
};

/** What a ladder keeps across launches. */
export type SavedStageLadder = Pick<StageLadder, 'settled' | 'strikes' | 'lastDropAt'>;

/** The rung to draw at. */
export function stageLadderQuality(ladder: StageLadder): StageQuality {
  return ladder.trial ?? ladder.settled;
}

/** How long after the last step down a climb waits. */
export function stageClimbWaitMs(strikes: number): number {
  return Math.min(MAX_CLIMB_WAIT_MS, CLIMB_WAIT_MS * 2 ** Math.max(0, strikes - 1));
}

function climb(ladder: StageLadder, nowMs: number): StageLadder {
  const at = LADDER.indexOf(ladder.settled);
  if (ladder.trial !== null || at <= 0 || ladder.settled === 'static') return ladder;
  if (ladder.lastDropAt !== null && nowMs - ladder.lastDropAt < stageClimbWaitMs(ladder.strikes))
    return ladder;
  return { ...ladder, trial: LADDER[at - 1]! };
}

/**
 * A launch: the saved ladder (anything unreadable starts at `full`), trying
 * one rung up when it stands below `full`.
 */
export function startStageLadder(saved: unknown, nowMs: number): StageLadder {
  const value = (typeof saved === 'object' && saved !== null ? saved : {}) as Record<
    string,
    unknown
  >;
  const settled =
    value.settled === 'reduced' || value.settled === 'low' ? value.settled : ('full' as const);
  const strikes =
    typeof value.strikes === 'number' && Number.isInteger(value.strikes)
      ? Math.max(0, Math.min(MAX_STRIKES, value.strikes))
      : 0;
  const lastDropAt =
    typeof value.lastDropAt === 'number' && Number.isFinite(value.lastDropAt)
      ? value.lastDropAt
      : null;
  return climb({ settled, trial: null, strikes, lastDropAt, awayAt: null }, nowMs);
}

/** Home left: a trial not yet judged is dropped without a strike. */
export function leaveStageLadder(ladder: StageLadder, nowMs: number): StageLadder {
  return { ...ladder, trial: null, awayAt: ladder.awayAt ?? nowMs };
}

/** Home shown again: after long enough away, try one rung up. */
export function returnStageLadder(ladder: StageLadder, nowMs: number): StageLadder {
  if (ladder.awayAt === null) return ladder;
  const back = { ...ladder, awayAt: null };
  return nowMs - ladder.awayAt >= STAGE_CLIMB_AWAY_MS ? climb(back, nowMs) : back;
}

/** The frame budget stepped down to `next`: a trial falls back to the rung below it. */
export function dropStageLadder(
  ladder: StageLadder,
  next: StageQuality,
  nowMs: number
): StageLadder {
  const forgotten = ladder.lastDropAt !== null && nowMs - ladder.lastDropAt >= STRIKES_FORGOTTEN_MS;
  return {
    ...ladder,
    settled: lowestStageQuality(ladder.settled, next),
    trial: null,
    strikes: forgotten ? 1 : Math.min(MAX_STRIKES, ladder.strikes + 1),
    lastDropAt: nowMs,
  };
}

/** `quality` met the budget long enough: a trial of it becomes the rung held. */
export function holdStageLadder(ladder: StageLadder, quality: StageQuality): StageLadder {
  if (ladder.trial !== quality) return ladder;
  return { ...ladder, settled: quality, trial: null };
}

export type StageEffects = {
  /** Whether the WebGPU scene runs at all; false draws the static stage. */
  gpu: boolean;
  /** The motes or a theme's ambient particles; still under Reduce Motion, but still drawn. */
  particles: boolean;
  /** The share of the particles drawn. */
  particleShare: number;
  /** The idle drift, the hero's bob and the motes' drift. Off under Reduce Motion. */
  pulse: boolean;
  tilt: boolean;
  /**
   * The highest pixel ratio the scene renders at; the device's own ratio
   * below it. Shading cost grows with its square: 2.0 on a 3x phone shades
   * about 44% of the native pixels, 1.5 a quarter, 1.0 a ninth. 1.5 is the
   * ceiling: 2.0 held 60 fps on a flagship, so the ladder never stepped it
   * down, and the phone ran hot. The ladder answers dropped frames, not
   * heat, so the full rung has to be one a phone can sustain.
   */
  maxDpr: number;
  /** Minimum milliseconds between frames while a finger, the cover-flow or a dive moves it. */
  frameIntervalMs: number;
  /** ...while only something indirect moves: tilt easing in, a completion's flare. */
  glideIntervalMs: number;
  /** Idle frame interval (20 fps) for the drift, bob and particles, or null when nothing moves. */
  idleIntervalMs: number | null;
};

/** What the stage draws for its quality step and the reader's motion setting. */
export function stageEffects(
  quality: StageQuality,
  options: { gpuAvailable: boolean; reducedMotion: boolean }
): StageEffects {
  const gpu = options.gpuAvailable && quality !== 'static';
  const calm = options.reducedMotion;
  const low = quality === 'low';
  return {
    gpu,
    particles: gpu && !low,
    particleShare: quality === 'full' ? 1 : 0.5,
    pulse: !calm,
    tilt: !calm,
    maxDpr: quality === 'full' ? 1.5 : quality === 'reduced' ? 1.25 : 1,
    frameIntervalMs: low ? 1000 / 30 : 0,
    glideIntervalMs: 1000 / 30,
    idleIntervalMs: gpu && !calm ? 50 : null,
  };
}

// -- Idle policy ------------------------------------------------------------

/**
 * How long the ambient motion (the camera's idle drift, the motes, the
 * hero's bob, a theme's ambient effect) keeps running at the idle rate after
 * the last interaction. Past it the scene holds its last frame and draws
 * nothing until an interaction starts the window again: a drag, a swipe,
 * tilt, a dive, a completion's flare, coming back to Home or a new theme. A
 * change to what the scene shows (a texture, the layout) draws one frame and
 * leaves the window alone.
 */
export const STAGE_AMBIENT_IDLE_MS = 6000;

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
