/**
 * Geometry of the Stage Home layout: where each computer's holo-card stands,
 * how a card move travels between two selections, and how a scene point lands
 * on the 2D overlay. Pure math, shared by the GPU scene, the static 2.5D
 * fallback and the overlay labels so the three always agree.
 *
 * Scene units: the character stands on the plane z = 0, its feet on the
 * floor at `STAGE_FLOOR_Y`. The selected card stands in front of it, lower
 * centre; the others arc behind and to the sides, dimmer and smaller.
 */

export type StageVec3 = readonly [number, number, number];

export type StagePanelPose = {
  position: StageVec3;
  /** Yaw in radians; a card move adds a half turn to the incoming card. */
  rotationY: number;
  scale: number;
  /** 0 = fully lit, 1 = fully dimmed. */
  dim: number;
  /** 0 = hidden (beyond the visible arc), 1 = shown. */
  presence: number;
};

/** The front card plus two on each side. */
export const STAGE_MAX_VISIBLE = 5;
export const STAGE_SIDE_SLOTS = 2;

export const STAGE_PANEL_WIDTH = 1;
export const STAGE_PANEL_HEIGHT = 0.62;
export const STAGE_FLOOR_Y = -1.25;
/** The character billboard's height, slightly larger than life against a card. */
export const STAGE_CHARACTER_HEIGHT = 3.1;

const FRONT_POSE: StagePanelPose = {
  position: [0, -0.62, 1.55],
  rotationY: 0,
  scale: 1.22,
  dim: 0,
  presence: 1,
};
const ARC_RADIUS = 2;
const ARC_FIRST = 0.8;
const ARC_STEP = 0.4;
const ARC_DEPTH = 2.6;

/** `index` wrapped into `[0, count)`; 0 for an empty ring. */
export function wrapStageIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/**
 * Where `index` sits relative to the selected card on the ring: 0 is the
 * front, positive to the right, negative to the left, in `(-count/2, count/2]`.
 * With two computers the other one is always on the right.
 */
export function stageRingOffset(index: number, selected: number, count: number): number {
  if (count <= 1) return 0;
  const offset = wrapStageIndex(index - selected, count);
  return offset > count / 2 ? offset - count : offset;
}

/** The resting pose for a ring offset. Offsets past the visible arc are hidden there. */
export function stageSlotPose(offset: number): StagePanelPose {
  if (offset === 0) return FRONT_POSE;
  const side = Math.sign(offset);
  const distance = Math.abs(offset);
  const step = Math.min(distance, STAGE_SIDE_SLOTS + 1) - 1;
  const angle = side * (ARC_FIRST + ARC_STEP * step);
  return {
    position: [
      ARC_RADIUS * Math.sin(angle),
      0.12 + 0.34 * step,
      -0.35 - ARC_DEPTH * (1 - Math.cos(angle)),
    ],
    // Turned in towards the character, as if the arc were drawn around it.
    rotationY: -angle * 0.6,
    scale: 0.8 - 0.12 * step,
    dim: Math.min(1, 0.35 + 0.25 * step),
    presence: distance > STAGE_SIDE_SLOTS ? 0 : 1,
  };
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * One card's pose part-way through a card move from selection `fromSelected`
 * to `toSelected`. `progress` follows a spring and may overshoot 1 a little.
 *
 * - The card leaving the front flies back onto the arc over a small hump.
 * - The card arriving at the front slides forward and turns a half turn to
 *   face the reader. Its rest yaw is then pi, which the panel shader draws
 *   exactly like 0 (the back face mirrors its UVs), so nothing jumps when
 *   the move hands over to the resting pose.
 * - Every other card glides between its two arc slots.
 */
export function stageMovePose(
  index: number,
  fromSelected: number,
  toSelected: number,
  count: number,
  progress: number
): StagePanelPose {
  const fromOffset = stageRingOffset(index, fromSelected, count);
  const toOffset = stageRingOffset(index, toSelected, count);
  const from = stageSlotPose(fromOffset);
  const to = stageSlotPose(toOffset);
  const p = Number.isFinite(progress) ? progress : 1;
  const clamped = Math.min(1, Math.max(0, p));
  const hump = Math.sin(Math.PI * clamped);
  const position: [number, number, number] = [
    lerp(from.position[0], to.position[0], p),
    lerp(from.position[1], to.position[1], p),
    lerp(from.position[2], to.position[2], p),
  ];
  let rotationY = lerp(from.rotationY, to.rotationY, p);
  if (fromOffset === 0 && toOffset !== 0) {
    position[1] += hump * 0.35;
    position[2] -= hump * 0.45;
  } else if (toOffset === 0 && fromOffset !== 0) {
    // Turns towards the side it came from, so the flip reads as one motion.
    rotationY += Math.PI * Math.sign(fromOffset || 1) * clamped;
    position[2] += hump * 0.25;
  }
  return {
    position,
    rotationY,
    scale: lerp(from.scale, to.scale, p),
    dim: Math.min(1, Math.max(0, lerp(from.dim, to.dim, clamped))),
    presence: lerp(from.presence, to.presence, clamped),
  };
}

/** The direction (+1 right, -1 left) a swipe that ends at `translationX` moves the ring. */
export function stageSwipeStep(translationX: number, velocityX: number, width: number): number {
  const distance = width > 0 ? Math.abs(translationX) / width : 0;
  const fast = Math.abs(velocityX) > 520;
  if (distance < 0.18 && !fast) return 0;
  // Dragging left brings the right-hand card forward.
  const direction = fast && Math.sign(velocityX) !== 0 ? velocityX : translationX;
  return direction < 0 ? 1 : -1;
}

/** The character's head-plane turn towards the selected card, at most ~6 degrees. */
export const STAGE_LOOK_YAW = (6 * Math.PI) / 180;

// -- Camera -----------------------------------------------------------------

export type StageCamera = {
  position: StageVec3;
  target: StageVec3;
  /** Vertical field of view in degrees. */
  fov: number;
};

export const STAGE_CAMERA_FOV = 38;
const CAMERA_TARGET: StageVec3 = [0, 0.18, 0];
const CAMERA_DISTANCE = 6.6;
const CAMERA_BASE_PITCH = (5 * Math.PI) / 180;
/** Drag pitch, ±6 degrees, and tilt parallax, ±3 degrees. */
export const STAGE_DRAG_PITCH = (6 * Math.PI) / 180;
export const STAGE_TILT_LIMIT = (3 * Math.PI) / 180;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

/** The camera for a drag pitch and a tilt offset (both radians, clamped to their limits). */
export function stageCamera(
  dragPitch: number,
  tiltPitch: number,
  tiltYaw: number,
  aspect: number
): StageCamera {
  const pitch =
    CAMERA_BASE_PITCH +
    clamp(dragPitch, -STAGE_DRAG_PITCH, STAGE_DRAG_PITCH) +
    clamp(tiltPitch, -STAGE_TILT_LIMIT, STAGE_TILT_LIMIT);
  const yaw = clamp(tiltYaw, -STAGE_TILT_LIMIT, STAGE_TILT_LIMIT);
  // A narrow stage steps back so the arc's outer cards stay in frame.
  const distance = CAMERA_DISTANCE * Math.max(1, 0.86 / Math.max(0.3, aspect));
  return {
    position: [
      CAMERA_TARGET[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
      CAMERA_TARGET[1] + Math.sin(pitch) * distance,
      CAMERA_TARGET[2] + Math.cos(yaw) * Math.cos(pitch) * distance,
    ],
    target: CAMERA_TARGET,
    fov: STAGE_CAMERA_FOV,
  };
}

export type StageProjection = {
  x: number;
  y: number;
  /** Distance along the view direction; larger is further away. */
  depth: number;
  /** In front of the camera and inside the viewport. */
  visible: boolean;
};

/**
 * Where a scene point lands in a `width` x `height` viewport, in points from
 * its top-left corner -- the same perspective the scene renders with.
 */
export function projectStagePoint(
  point: StageVec3,
  camera: StageCamera,
  width: number,
  height: number
): StageProjection {
  const [px, py, pz] = camera.position;
  // Forward, right and up of a camera looking at its target with world-up Y.
  let fx = camera.target[0] - px;
  let fy = camera.target[1] - py;
  let fz = camera.target[2] - pz;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  // right = forward x up(0, 1, 0) = (-fz, 0, fx)
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  // up = right x forward
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const dx = point[0] - px;
  const dy = point[1] - py;
  const dz = point[2] - pz;
  const depth = dx * fx + dy * fy + dz * fz;
  const right = dx * rx + dz * rz;
  const up = dx * ux + dy * uy + dz * uz;
  if (depth <= 1e-3 || width <= 0 || height <= 0) return { x: 0, y: 0, depth, visible: false };
  const focal = 1 / Math.tan((camera.fov * Math.PI) / 360);
  const aspect = width / height;
  const ndcX = (right / depth) * (focal / aspect);
  const ndcY = (up / depth) * focal;
  const x = ((ndcX + 1) / 2) * width;
  const y = ((1 - ndcY) / 2) * height;
  return { x, y, depth, visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1 };
}

/** The point an overlay label hangs from: just under the card's bottom edge. */
export function stageLabelAnchor(pose: StagePanelPose): StageVec3 {
  return [
    pose.position[0],
    pose.position[1] - (STAGE_PANEL_HEIGHT / 2) * pose.scale - 0.04,
    pose.position[2],
  ];
}

/** The card's projected box, for its 2D hit area and accessibility frame. */
export function stagePanelRect(
  pose: StagePanelPose,
  camera: StageCamera,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number; visible: boolean } {
  const halfW = (STAGE_PANEL_WIDTH / 2) * pose.scale * Math.abs(Math.cos(pose.rotationY));
  const halfH = (STAGE_PANEL_HEIGHT / 2) * pose.scale;
  const [cx, cy, cz] = pose.position;
  const a = projectStagePoint([cx - halfW, cy + halfH, cz], camera, width, height);
  const b = projectStagePoint([cx + halfW, cy - halfH, cz], camera, width, height);
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  return {
    x: left,
    y: top,
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
    visible: pose.presence > 0.5 && (a.visible || b.visible),
  };
}
