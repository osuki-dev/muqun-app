/**
 * Geometry of Home's workspace windows: a selected window in front, its
 * neighbours receding to either side, and theme artwork on a separate plane.
 * Pure math shared by the GPU scene, the static 2.5D stage and the 2D HUD's
 * projected hit areas and hint chips, so all three always agree.
 */

export type StageVec3 = readonly [number, number, number];

export const STAGE_RING_RADIUS = 2.65;
export const STAGE_SCREEN_Y = 1.35;
/** The selected window rests straight ahead. */
export const STAGE_FRONT_OFFSET = 0;
/** Screens drawn at once; with more computers the ones nearest the front are drawn. */
export const STAGE_MAX_SCREENS = 8;
export const STAGE_SCREEN_WIDTH = 2.15;
export const STAGE_SCREEN_HEIGHT = 2.05;
export const STAGE_FRONT_SCALE = 0.8;
export const STAGE_SIDE_SCALE = 0.23;

export const STAGE_PEDESTAL: StageVec3 = [0, 0, -1.1];
/** Where the beam leaves the host. */
export const STAGE_HOST_CHEST: StageVec3 = [-0.25, 1.75, -0.25];
/** Where the "start a new task" hint hangs. */
export const STAGE_HOST_HINT: StageVec3 = [-0.25, 3.05, -0.35];
export const STAGE_HOST_HEIGHT = 3.1;
/** Legacy reference span used to bound theme artwork. */
export const STAGE_PEDESTAL_DIAMETER = 2.36;
const HOST_MAX_WIDTH = STAGE_PEDESTAL_DIAMETER * 1.25;
const HOST_MAX_HEIGHT = 2.6;
/** How far the art's cut bottom edge sits above the floor: just inside the pedestal's top. */
export const STAGE_HOST_BASE_Y = 1.95;

/** Fit theme artwork completely inside its composition bounds. */
export function stageHostSize(aspect: number): {
  width: number;
  height: number;
} {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const height = Math.min(
    ratio > 1.3 ? HOST_MAX_HEIGHT : STAGE_HOST_HEIGHT,
    HOST_MAX_WIDTH / ratio
  );
  return { width: height * ratio, height };
}

/** `index` wrapped into `[0, count)`; 0 for an empty ring. */
export function wrapStageIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/**
 * The ring angle that brings `to` to the front, turning the short way round
 * from wherever `current` (the ring's present target) has it. Accumulates, so
 * the ring never spins back through a full turn.
 */
export function stageRingTarget(current: number, from: number, to: number, count: number): number {
  if (count <= 1) return current;
  let delta = wrapStageIndex(to, count) - wrapStageIndex(from, count);
  if (delta > count / 2) delta -= count;
  if (delta < -count / 2) delta += count;
  return current - (delta * Math.PI * 2) / count;
}

/** The ring angle at rest with `selected` in front. */
export function stageRingRest(selected: number, count: number): number {
  return count > 0 ? (-wrapStageIndex(selected, count) * Math.PI * 2) / count : 0;
}

/** A cyclic selection phase projected onto a shallow workspace arc. */
export function stageScreenPosition(index: number, count: number, ringAngle: number): StageVec3 {
  const angle = (count > 0 ? (wrapStageIndex(index, count) / count) * Math.PI * 2 : 0) + ringAngle;
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  const step = count > 1 ? wrapped / ((Math.PI * 2) / count) : 0;
  return [
    step * 1.32 - 0.18,
    STAGE_SCREEN_Y + Math.min(1, Math.abs(step)) * 2.0,
    STAGE_RING_RADIUS - Math.abs(step) * 1.5,
  ];
}

/**
 * Only the current computer and its two neighbours are visible. A computer
 * behind the selection must not show through the active window's surface.
 */
export function stageDrawnScreens(selected: number, count: number): number[] {
  if (count <= 3) return Array.from({ length: count }, (_, index) => index);
  return [
    wrapStageIndex(selected - 1, count),
    wrapStageIndex(selected, count),
    wrapStageIndex(selected + 1, count),
  ].sort((a, b) => a - b);
}

/** The direction (+1 next, -1 previous) a swipe that ends at `translationX` moves the ring. */
export function stageSwipeStep(translationX: number, velocityX: number, width: number): number {
  'worklet';
  const distance = width > 0 ? Math.abs(translationX) / width : 0;
  const fast = Math.abs(velocityX) > 520;
  if (distance < 0.1 && !fast) return 0;
  // Dragging left brings the next screen forward.
  const direction = fast && Math.sign(velocityX) !== 0 ? velocityX : translationX;
  return direction < 0 ? 1 : -1;
}

// -- Camera -----------------------------------------------------------------

export type StageCamera = {
  position: StageVec3;
  target: StageVec3;
  /** Vertical field of view in degrees. */
  fov: number;
};

export const STAGE_CAMERA_FOV = 42;
const CAMERA_POSITION: StageVec3 = [0, 2.6, 11];
const CAMERA_TARGET: StageVec3 = [0, 1.65, 0];
/** How far the camera stops in front of a screen it dives to. */
const DIVE_STANDOFF = 1.55;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The stage camera. `lookX`/`lookY` (-1..1, from tilt or a drag) move it like
 * a window onto the world; `dive` (0..1) flies it to the screen at `diveTo`.
 * A screen narrower than a phone in portrait steps back so the ring fits.
 */
export function stageCamera({
  lookX = 0,
  lookY = 0,
  dive = 0,
  diveTo,
  aspect = 390 / 844,
}: {
  lookX?: number;
  lookY?: number;
  dive?: number;
  diveTo?: StageVec3;
  aspect?: number;
}): StageCamera {
  const x = clamp(lookX, -1, 1) * 0.5;
  const y = clamp(lookY, -1, 1) * 0.5;
  const back = Math.max(1, 390 / 844 / Math.max(0.2, aspect)) ** 0.5;
  const stage: StageVec3 = [
    CAMERA_POSITION[0] + x * 0.6,
    CAMERA_POSITION[1] - y * 0.6,
    CAMERA_POSITION[2] * back,
  ];
  const t = clamp(dive, 0, 1);
  if (!diveTo || t === 0) return { position: stage, target: CAMERA_TARGET, fov: STAGE_CAMERA_FOV };
  const flat = Math.hypot(diveTo[0], diveTo[2]) || 1;
  const near: StageVec3 = [
    diveTo[0] + (diveTo[0] / flat) * DIVE_STANDOFF,
    diveTo[1] + 0.05,
    diveTo[2] + (diveTo[2] / flat) * DIVE_STANDOFF,
  ];
  return {
    position: [lerp(stage[0], near[0], t), lerp(stage[1], near[1], t), lerp(stage[2], near[2], t)],
    target: [
      lerp(CAMERA_TARGET[0], diveTo[0], t),
      lerp(CAMERA_TARGET[1], diveTo[1], t),
      lerp(CAMERA_TARGET[2], diveTo[2], t),
    ],
    fov: STAGE_CAMERA_FOV,
  };
}

/** Yaw that turns an object at `at` to face the camera about the Y axis (a Y-billboard). */
export function stageFacingYaw(at: StageVec3, camera: StageVec3): number {
  return Math.atan2(camera[0] - at[0], camera[2] - at[2]);
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
  return {
    x: ((ndcX + 1) / 2) * width,
    y: ((1 - ndcY) / 2) * height,
    depth,
    visible: Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1,
  };
}

export type StageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  visible: boolean;
};

/** A camera-facing box of `width` x `height` world units centred at `centre`, on screen. */
export function stageBillboardRect(
  centre: StageVec3,
  width: number,
  height: number,
  camera: StageCamera,
  viewportWidth: number,
  viewportHeight: number
): StageRect {
  const middle = projectStagePoint(centre, camera, viewportWidth, viewportHeight);
  const top = projectStagePoint(
    [centre[0], centre[1] + height / 2, centre[2]],
    camera,
    viewportWidth,
    viewportHeight
  );
  // Facing the camera, the box keeps its aspect on screen.
  const h = Math.abs(middle.y - top.y) * 2;
  const w = (h * width) / height;
  return {
    x: middle.x - w / 2,
    y: middle.y - h / 2,
    width: w,
    height: h,
    depth: middle.depth,
    visible: middle.visible,
  };
}
