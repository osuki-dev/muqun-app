/**
 * A computer's agents as orbs on its core's ring: which agents get an orb,
 * where each sits and how it travels, and which one a touch lands on. Pure,
 * so the GPU scene, the static stage and the HUD's hit areas and chips agree.
 */
import {
  projectStagePoint,
  stageRingPoint,
  type StageCamera,
  type StageCore,
  type StageVec3,
} from './home-stage-geometry';
import {
  stageSpringAtRest,
  stepStageSpring,
  STAGE_CARD_SPRING,
  type StageSpring,
} from './home-stage-motion';
import type { StageAgentMark } from './home-stage-panels';

/** Orbs on one ring at most, the "+N" orb included. */
export const STAGE_ORB_CAP = 8;

/** An agent's mark, or `more`: the "+N" orb that stands for the agents past the cap. */
export type StageOrbMark = StageAgentMark | 'more';

export type StageOrb = {
  /** The agent's key, or `+` for the "+N" orb. */
  key: string;
  mark: StageOrbMark;
  /** The agent's index in its computer's list; -1 for the "+N" orb. */
  agent: number;
  /** How many agents the "+N" orb stands for; 0 for an agent's orb. */
  more: number;
};

/** The "+N" orb's key: an agent key is a mirror row id, never this. */
export const STAGE_MORE_ORB_KEY = '+';

/**
 * One orb per agent, in the order given (waiting on the reader first), up to
 * `cap`; past it the first `cap - 1` and a "+N" orb for the rest, so an agent
 * that needs the reader always has its own orb.
 */
export function stageOrbs(
  agents: readonly { key: string; mark: StageAgentMark }[],
  cap: number = STAGE_ORB_CAP
): StageOrb[] {
  const room = Math.max(1, Math.floor(cap));
  const shown = agents.length <= room ? agents.length : room - 1;
  const orbs: StageOrb[] = agents
    .slice(0, shown)
    .map((agent, index) => ({ key: agent.key, mark: agent.mark, agent: index, more: 0 }));
  if (shown < agents.length)
    orbs.push({ key: STAGE_MORE_ORB_KEY, mark: 'more', agent: -1, more: agents.length - shown });
  return orbs;
}

/** Radians per second of orbit-clock time: a running agent travels fastest. */
export const STAGE_ORB_SPEED: Readonly<Record<StageOrbMark, number>> = {
  working: 0.42,
  'needs-you': 0.16,
  idle: 0.08,
  more: 0.08,
};
/** The first orb's resting place: front right, clear of the core. */
const ORB_START = -Math.PI / 6;
const TAU = Math.PI * 2;

/**
 * One orb as the scene animates it: its slot (a share of a turn, evenly
 * spaced among its ring's orbs, springing when an orb comes or goes), how
 * far it has travelled on the orbit clock, and its presence (0..1, growing
 * in when it appears and fading when it leaves).
 */
export type StageOrbTrack = {
  key: string;
  mark: StageOrbMark;
  slot: StageSpring;
  travel: number;
  presence: StageSpring;
  /** Gone from the agents: fading out, then dropped. */
  leaving: boolean;
};

/** Where `index` of `count` evenly spaced orbs rests, as a share of a turn. */
export function stageOrbSlot(index: number, count: number): number {
  return count > 0 ? index / count : 0;
}

/** An orb's angle on its ring, radians. */
export function stageOrbAngle(track: { slot: StageSpring; travel: number }): number {
  return ORB_START + track.slot.value * TAU + track.travel;
}

/**
 * Advance one ring's tracks to `orbs`: each orb springs to its slot (the
 * short way round) and travels `orbitDt` seconds at its mark's speed; a new
 * orb grows in at its slot; a missing one fades where it is and is dropped.
 * `still` (Reduce Motion) takes every spring to its goal at once. Returns
 * the new tracks (a fresh array; the tracks themselves are reused) and
 * whether any spring is still moving.
 */
export function trackStageOrbs(
  tracks: readonly StageOrbTrack[],
  orbs: readonly { key: string; mark: StageOrbMark }[],
  dt: number,
  { orbitDt = 0, still = false }: { orbitDt?: number; still?: boolean } = {}
): { tracks: StageOrbTrack[]; moving: boolean } {
  const byKey = new Map(tracks.map((track) => [track.key, track]));
  const next: StageOrbTrack[] = [];
  let moving = false;
  const step = (spring: StageSpring, goal: number) => {
    if (still || stageSpringAtRest(spring, goal)) return { value: goal, velocity: 0 };
    const stepped = stepStageSpring(spring, goal, dt, STAGE_CARD_SPRING);
    if (!stageSpringAtRest(stepped, goal)) moving = true;
    return stepped;
  };
  orbs.forEach((orb, index) => {
    const slot = stageOrbSlot(index, orbs.length);
    const known = byKey.get(orb.key);
    byKey.delete(orb.key);
    if (!known) {
      next.push({
        key: orb.key,
        mark: orb.mark,
        slot: { value: slot, velocity: 0 },
        travel: 0,
        presence: step({ value: 0, velocity: 0 }, 1),
        leaving: false,
      });
      return;
    }
    // The short way round: a slot is a share of a turn.
    const goal = slot + Math.round(known.slot.value - slot);
    known.mark = orb.mark;
    known.leaving = false;
    known.slot = step(known.slot, goal);
    known.travel = (known.travel + STAGE_ORB_SPEED[orb.mark] * orbitDt) % TAU;
    known.presence = step(known.presence, 1);
    next.push(known);
  });
  for (const gone of byKey.values()) {
    gone.leaving = true;
    gone.presence = step(gone.presence, 0);
    if (gone.presence.value > 0) next.push(gone);
  }
  return { tracks: next, moving };
}

/** An orb's place at rest, before any travel: the static stage and a ring not yet drawn. */
export function stageOrbRestPoint(core: StageCore, index: number, count: number): StageVec3 {
  return stageRingPoint(core, ORB_START + stageOrbSlot(index, count) * TAU);
}

/**
 * Whether `point` is hidden behind `core` from `eye`: past the core along
 * the line of sight, and within its radius of that line. The scene dims a
 * hidden orb the same way, so a touch never lands on one it cannot see.
 */
export function stageBehindCore(point: StageVec3, core: StageCore, eye: StageVec3): boolean {
  const vx = point[0] - eye[0];
  const vy = point[1] - eye[1];
  const vz = point[2] - eye[2];
  const length = Math.hypot(vx, vy, vz) || 1;
  const ox = core.position[0] - eye[0];
  const oy = core.position[1] - eye[1];
  const oz = core.position[2] - eye[2];
  const along = (ox * vx + oy * vy + oz * vz) / length;
  if (along <= 0 || along >= length) return false;
  const distance = Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - along * along));
  return distance < core.radius;
}

/** A touch this close to an orb's centre, in points, lands on it. */
export const STAGE_ORB_TOUCH_PT = 22;

/**
 * Which orb a touch at `touch` (points from the view's top left) lands on:
 * the nearest visible orb within `STAGE_ORB_TOUCH_PT`, the nearer of two
 * that overlap; -1 for none, when the touch is the core's.
 */
export function stageOrbAt(
  touch: { x: number; y: number },
  points: readonly StageVec3[],
  core: StageCore,
  camera: StageCamera,
  width: number,
  height: number
): number {
  let best = -1;
  let bestScore = Infinity;
  points.forEach((point, index) => {
    if (stageBehindCore(point, core, camera.position)) return;
    const at = projectStagePoint(point, camera, width, height);
    if (!at.visible) return;
    const distance = Math.hypot(at.x - touch.x, at.y - touch.y);
    if (distance > STAGE_ORB_TOUCH_PT) return;
    // Nearer the touch wins; between two equally near, the nearer the camera.
    const score = distance + at.depth * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}

/** The gap between an orb and its chip, and the chip's margin from the view's edges. */
const CHIP_GAP_PT = 12;
const CHIP_MARGIN_PT = 12;

/**
 * Where an orb's chip goes, in points: centred on the orb at `anchor` and
 * away from its core -- below an orb on the ring's near side, above one on
 * its far side -- so it never covers the core; on the other side when that
 * would reach into the HUD (above `ceiling`) or the session strip (below
 * `floor`). Kept `CHIP_MARGIN_PT` inside the view's sides.
 */
export function stageChipPlacement(
  anchor: { x: number; y: number },
  chip: { width: number; height: number },
  view: { width: number; ceiling: number; floor: number; coreY: number }
): { left: number; top: number; below: boolean } {
  const maxLeft = Math.max(CHIP_MARGIN_PT, view.width - CHIP_MARGIN_PT - chip.width);
  const left = Math.min(maxLeft, Math.max(CHIP_MARGIN_PT, anchor.x - chip.width / 2));
  const above = anchor.y - CHIP_GAP_PT - chip.height;
  const under = anchor.y + CHIP_GAP_PT;
  const fitsAbove = above >= view.ceiling;
  const fitsBelow = under + chip.height <= view.floor;
  const below = anchor.y >= view.coreY ? fitsBelow || !fitsAbove : !fitsAbove && fitsBelow;
  return { left, top: below ? under : above, below };
}
