/**
 * Geometry of the Stage Home layout, the "depth window": the phone is a
 * window into the theme's world, built as layers at real depths -- the
 * backdrop far away, a haze in the theme's colour, the cut-out hero, one
 * glass pane per computer in a cover-flow, and an edge-only wallpaper as the
 * nearest frame. Pure math shared by the GPU scene, the static 2.5D stage and
 * the 2D HUD's projected hit areas and hint chips, so all three agree.
 */

export type StageVec3 = readonly [number, number, number];

export const STAGE_CAMERA_FOV = 38;
/** Screens drawn at once; with more computers the ones nearest the selection are drawn. */
export const STAGE_MAX_SCREENS = 8;

/** Layer depths, in world units in front of the camera. */
export const STAGE_BACKDROP_DEPTH = 60;
export const STAGE_HAZE_DEPTH = 30;
export const STAGE_HERO_DEPTH = 16;
export const STAGE_PANE_DEPTH = 12;
export const STAGE_FRAME_DEPTH = 3.2;
/** Cover layers are this much larger than the view, so tilt never shows their edges. */
export const STAGE_BACKDROP_OVERSCAN = 1.22;
export const STAGE_FRAME_OVERSCAN = 1.12;

/** A pane is 640 x 400: height over width. */
export const STAGE_PANE_RATIO = 0.625;
/** Panes further than this from the selection (in panes) are not drawn. */
export const STAGE_PANE_REACH = 1.7;
/** A drag across the full stage width moves this many panes (the sketch's 220 pt of 390). */
export const STAGE_DRAG_SPAN = 390 / 220;

const YAW_MAX = (5 * Math.PI) / 180;
const PITCH_MAX = (3.5 * Math.PI) / 180;
const CAMERA_TARGET: StageVec3 = [0, -0.2, -20];
/** Where the selected pane's centre sits on screen, in NDC. */
const PANE_ANCHOR_NDC = [0, -0.3] as const;
const PANE_SIDE_TURN = (48 * Math.PI) / 180;
/** How close a dive brings the camera: the front pane just fills the view's width. */
const DIVE_STANDOFF = STAGE_PANE_DEPTH * 0.72 * 0.95;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** `index` wrapped into `[0, count)`; 0 when there is nothing to choose. */
export function wrapStageIndex(index: number, count: number): number {
  if (count <= 0 || !Number.isFinite(index)) return 0;
  return ((Math.trunc(index) % count) + count) % count;
}

/** The view's size, in world units, at `distance` from the camera. */
export function stageViewSize(distance: number, aspect: number): { width: number; height: number } {
  const height = 2 * Math.tan((STAGE_CAMERA_FOV * Math.PI) / 360) * distance;
  return { width: height * aspect, height };
}

/**
 * Which computers get a pane: all of them up to `STAGE_MAX_SCREENS`, else
 * the contiguous run around the selection.
 */
export function stageDrawnScreens(selected: number, count: number): number[] {
  if (count <= 0) return [];
  const size = Math.min(count, STAGE_MAX_SCREENS);
  const first = clamp(Math.round(selected) - Math.floor(size / 2), 0, count - size);
  return Array.from({ length: size }, (_, index) => first + index);
}

/** The direction (+1 next, -1 previous) a swipe that ends at `translationX` moves. */
export function stageSwipeStep(translationX: number, velocityX: number, width: number): number {
  'worklet';
  const distance = width > 0 ? Math.abs(translationX) / width : 0;
  const fast = Math.abs(velocityX) > 520;
  if (distance < 0.1 && !fast) return 0;
  // Dragging left brings the next pane forward.
  const direction = fast && Math.sign(velocityX) !== 0 ? velocityX : translationX;
  return direction < 0 ? 1 : -1;
}

/**
 * Where a horizontal drag that ends at `translationX` settles: the pane the
 * drag has brought nearest the front, or at least one step towards the pull
 * when the drag was long or fast enough. Never past either end.
 */
export function stageSwipeTarget(
  selected: number,
  count: number,
  translationX: number,
  velocityX: number,
  width: number
): number {
  'worklet';
  if (count <= 0) return 0;
  const offset = width > 0 ? (-translationX / width) * STAGE_DRAG_SPAN : 0;
  let target = Math.round(selected + offset);
  if (target === selected) target = selected + stageSwipeStep(translationX, velocityX, width);
  return Math.max(0, Math.min(count - 1, target));
}

/** The fractional selection while a finger drags the panes, with a little give at both ends. */
export function stageDragPosition(selected: number, count: number, dragX: number): number {
  'worklet';
  const position = selected - dragX * STAGE_DRAG_SPAN;
  return Math.max(-0.35, Math.min(Math.max(0, count - 1) + 0.35, position));
}

// -- Camera -----------------------------------------------------------------

export type StageCamera = {
  position: StageVec3;
  target: StageVec3;
  /** Vertical field of view in degrees. */
  fov: number;
};

/**
 * The window's camera. `lookX`/`lookY` (-1..1, from device tilt) turn it up
 * to 5 degrees of yaw and 3.5 of pitch, which slides the layers against each
 * other by their depth.
 */
export function stageCamera({
  lookX = 0,
  lookY = 0,
}: { lookX?: number; lookY?: number } = {}): StageCamera {
  const yaw = clamp(lookX, -1, 1) * YAW_MAX;
  const pitch = clamp(lookY, -1, 1) * PITCH_MAX;
  return {
    position: [Math.sin(yaw) * 4, 0.6 + Math.sin(pitch) * 3, 0],
    target: CAMERA_TARGET,
    fov: STAGE_CAMERA_FOV,
  };
}

/** `camera` flown (`dive` 0..1) to just in front of the pane at `anchor`, looking at it. */
export function stageDiveCamera(camera: StageCamera, anchor: StageVec3, dive: number): StageCamera {
  const t = clamp(dive, 0, 1);
  if (t === 0) return camera;
  const [px, py, pz] = camera.position;
  const dx = anchor[0] - px;
  const dy = anchor[1] - py;
  const dz = anchor[2] - pz;
  const length = Math.hypot(dx, dy, dz) || 1;
  const back = DIVE_STANDOFF / length;
  const near: StageVec3 = [anchor[0] - dx * back, anchor[1] - dy * back, anchor[2] - dz * back];
  return {
    position: [lerp(px, near[0], t), lerp(py, near[1], t), lerp(pz, near[2], t)],
    target: [
      lerp(camera.target[0], anchor[0], t),
      lerp(camera.target[1], anchor[1], t),
      lerp(camera.target[2], anchor[2], t),
    ],
    fov: camera.fov,
  };
}

type Basis = { forward: StageVec3; right: StageVec3; up: StageVec3 };

/** Forward, right and up of a camera looking at its target with world-up Y. */
function cameraBasis(camera: StageCamera): Basis {
  const [px, py, pz] = camera.position;
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
  return {
    forward: [fx, fy, fz],
    right: [rx, 0, rz],
    up: [-rz * fy, rz * fx - rx * fz, rx * fy],
  };
}

/** The point at `distance` along the ray through `ndc` (-1..1, y up) of a `aspect` view. */
export function stageRayPoint(
  camera: StageCamera,
  ndc: readonly [number, number],
  distance: number,
  aspect: number
): StageVec3 {
  const { forward, right, up } = cameraBasis(camera);
  const half = Math.tan((camera.fov * Math.PI) / 360);
  const sx = ndc[0] * half * aspect;
  const sy = ndc[1] * half;
  const dx = forward[0] + right[0] * sx + up[0] * sy;
  const dy = forward[1] + right[1] * sx + up[1] * sy;
  const dz = forward[2] + right[2] * sx + up[2] * sy;
  const length = Math.hypot(dx, dy, dz) || 1;
  const scale = distance / length;
  const [px, py, pz] = camera.position;
  return [px + dx * scale, py + dy * scale, pz + dz * scale];
}

/** Where the selected pane's centre sits: below the screen's middle, between hero and HUD. */
export function stagePaneAnchor(camera: StageCamera, aspect: number): StageVec3 {
  return stageRayPoint(camera, PANE_ANCHOR_NDC, STAGE_PANE_DEPTH, aspect);
}

/** The point on the camera's centre line at `depth` in front of it: where cover layers hang. */
export function stageLayerCentre(depth: number): StageVec3 {
  const rest = stageCamera();
  return stageRayPoint(rest, [0, 0], depth, 1);
}

export type StagePane = {
  position: StageVec3;
  width: number;
  height: number;
  /** Turn about Y, radians; side panes face inwards. */
  yaw: number;
  /** 0 for the selected pane, 1 for a neighbour or further. */
  side: number;
};

/**
 * The cover-flow: the pane `offset` places from the (fractional) selection.
 * The selected pane faces the camera at 0.72 of the view's width; a neighbour
 * stands 0.66 of the width aside, 2.2 units further back, turned 48 degrees
 * inwards at 0.62 of the width. Everything in between is interpolated, so a
 * drag moves the panes continuously.
 */
export function stagePane(offset: number, anchor: StageVec3, aspect: number): StagePane {
  const viewWidth = stageViewSize(STAGE_PANE_DEPTH, aspect).width;
  const side = Math.min(Math.abs(offset), 1);
  const width = viewWidth * (0.72 - 0.1 * side);
  const height = width * STAGE_PANE_RATIO;
  return {
    position: [
      anchor[0] + offset * viewWidth * 0.66,
      anchor[1] + height * 0.06 * side,
      anchor[2] - 2.2 * side,
    ],
    width,
    height,
    yaw: -Math.sign(offset) * side * PANE_SIDE_TURN,
    side,
  };
}

export type StageHero = { position: StageVec3; width: number; height: number };

/**
 * The cut-out hero for art of `artAspect` (width / height): half the view's
 * height at most, never wider than 0.92 of it, standing right of centre and
 * a little high so the panes sit below its waist.
 */
export function stageHero(artAspect: number, aspect: number): StageHero {
  const ratio = Number.isFinite(artAspect) && artAspect > 0 ? artAspect : 1;
  const view = stageViewSize(STAGE_HERO_DEPTH, aspect);
  const height = Math.min(view.height * 0.5, (view.width * 0.92) / ratio);
  return {
    position: [view.width * 0.12, view.height * 0.06, -STAGE_HERO_DEPTH],
    width: height * ratio,
    height,
  };
}

/**
 * A layer of `textureAspect` covering the view at `depth` with `overscan`,
 * and how far it shifts to bring its focal point (0..1 from the top left)
 * towards the middle without giving up the overscan.
 */
export function stageCoverPlane(
  textureAspect: number,
  depth: number,
  overscan: number,
  aspect: number,
  focal: { x: number; y: number } = { x: 0.5, y: 0.5 }
): { width: number; height: number; shiftX: number; shiftY: number } {
  const view = stageViewSize(depth, aspect);
  const ratio = Number.isFinite(textureAspect) && textureAspect > 0 ? textureAspect : 1;
  let width = view.width * overscan;
  let height = view.height * overscan;
  if (width / height > ratio) height = width / ratio;
  else width = height * ratio;
  const roomX = (width - view.width * overscan) / 2;
  const roomY = (height - view.height * overscan) / 2;
  return {
    width,
    height,
    shiftX: clamp((0.5 - focal.x) * width, -roomX, roomX),
    shiftY: clamp((focal.y - 0.5) * height, -roomY, roomY),
  };
}

// -- Projection -------------------------------------------------------------

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
  const { forward, right, up } = cameraBasis(camera);
  const dx = point[0] - camera.position[0];
  const dy = point[1] - camera.position[1];
  const dz = point[2] - camera.position[2];
  const depth = dx * forward[0] + dy * forward[1] + dz * forward[2];
  const across = dx * right[0] + dz * right[2];
  const rise = dx * up[0] + dy * up[1] + dz * up[2];
  if (depth <= 1e-3 || width <= 0 || height <= 0) return { x: 0, y: 0, depth, visible: false };
  const focal = 1 / Math.tan((camera.fov * Math.PI) / 360);
  const aspect = width / height;
  const ndcX = (across / depth) * (focal / aspect);
  const ndcY = (rise / depth) * focal;
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

/**
 * The on-screen box of a `width` x `height` quad centred at `centre` and
 * turned `yaw` about Y, clipped to the viewport; not visible when none of it
 * is on screen.
 */
export function stageQuadRect(
  centre: StageVec3,
  width: number,
  height: number,
  yaw: number,
  camera: StageCamera,
  viewportWidth: number,
  viewportHeight: number
): StageRect {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [u, v] of [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ] as const) {
    const point = projectStagePoint(
      [centre[0] + u * width * cos, centre[1] + v * height, centre[2] - u * width * sin],
      camera,
      viewportWidth,
      viewportHeight
    );
    if (point.depth <= 1e-3)
      return { x: 0, y: 0, width: 0, height: 0, depth: point.depth, visible: false };
    left = Math.min(left, point.x);
    right = Math.max(right, point.x);
    top = Math.min(top, point.y);
    bottom = Math.max(bottom, point.y);
  }
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const w = Math.min(viewportWidth, right) - x;
  const h = Math.min(viewportHeight, bottom) - y;
  const depth = projectStagePoint(centre, camera, viewportWidth, viewportHeight).depth;
  return w > 0 && h > 0
    ? { x, y, width: w, height: h, depth, visible: true }
    : { x: 0, y: 0, width: 0, height: 0, depth, visible: false };
}
