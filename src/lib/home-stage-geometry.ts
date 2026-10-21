/**
 * Geometry of the Stage Home layout, the "depth window": the phone is a
 * window into the theme's world, built as layers at real depths -- the
 * wallpaper far away, a painting's sky band, a haze in the theme's colour,
 * the figure or inset picture, one glowing core per computer in a
 * cover-flow (its agents orbiting it on a ring), and an edge-only wallpaper
 * as the nearest frame. Pure math shared by the GPU scene, the static 2.5D
 * stage and the 2D HUD's projected hit areas and chips, so all three agree.
 */
import {
  containedImageRect,
  coveredImageRect,
  editorialArtworkRect,
  homeCoverSceneRect,
  HOME_COVER_BOTTOM_FEATHER_START,
  HOME_HERO_FEATHER,
} from './hero-feather';
import type { StageRole } from './home-stage-layers';

export type StageVec3 = readonly [number, number, number];

export const STAGE_CAMERA_FOV = 38;
/** Cores drawn at once; with more computers the ones nearest the selection are drawn. */
export const STAGE_MAX_SCREENS = 8;

/** Layer depths, in world units in front of the camera. */
export const STAGE_BACKDROP_DEPTH = 60;
export const STAGE_HAZE_DEPTH = 30;
export const STAGE_HERO_DEPTH = 16;
export const STAGE_CORE_DEPTH = 12;
export const STAGE_FRAME_DEPTH = 3.2;
/** Cover layers are this much larger than the view, so tilt never shows their edges. */
export const STAGE_BACKDROP_OVERSCAN = 1.22;
export const STAGE_FRAME_OVERSCAN = 1.12;

/** Cores further than this from the selection (in cores) are not drawn. */
export const STAGE_CORE_REACH = 1.7;
/** A drag across the full stage width moves this many cores (the sketch's 220 pt of 390). */
export const STAGE_DRAG_SPAN = 390 / 220;

const YAW_MAX = (5 * Math.PI) / 180;
const PITCH_MAX = (3.5 * Math.PI) / 180;
const CAMERA_TARGET: StageVec3 = [0, -0.2, -20];
/**
 * The cores' scale: the view's width at their depth, but never more than
 * 0.72 of its height, so a wide view keeps a phone's proportions.
 */
const CORE_UNIT_HEIGHT_SHARE = 0.72;
/** The front core's radius as a share of that unit: about 44 pt on a phone... */
const CORE_RADIUS_SHARE = 0.115;
/** ...its orbit ring this many core radii out... */
export const STAGE_RING_SCALE = 2.05;
/** ...and an agent orb's bright dot this many core radii across. */
export const STAGE_ORB_SCALE = 0.16;
/**
 * Where the front core's centre sits on screen, in NDC, and how large it is,
 * by role: always below the art's body (a figure's face and torso, an inset
 * picture, a painting's band) and above the session strip. With no art the
 * core is the scene, a little larger and higher.
 */
const CORE_PLACE: Record<StageRole, { ndcY: number; scale: number }> = {
  figure: { ndcY: -0.25, scale: 1 },
  sky: { ndcY: -0.2, scale: 1 },
  inset: { ndcY: -0.2, scale: 1 },
  world: { ndcY: -0.1, scale: 1.2 },
};
/** A neighbour core stands this share of the unit aside, peeking in at the edge... */
const CORE_SIDE_SPREAD = 0.62;
/** ...this much further back, and this much smaller. */
const CORE_SIDE_DEPTH = 2.2;
const CORE_SIDE_SCALE = 0.62;
/** How close a dive brings the camera to the front core, in core radii. */
const DIVE_STANDOFF_RADII = 5;
/**
 * The ring's plane: level, its far side raised 15 degrees towards the camera
 * and rolled 7 degrees, so it reads as an orbit seen from a little above.
 */
const RING_RAISE = (15 * Math.PI) / 180;
const RING_ROLL = (-7 * Math.PI) / 180;

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
 * Which computers get a core: all of them up to `STAGE_MAX_SCREENS`, else
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
  // Dragging left brings the next core forward.
  const direction = fast && Math.sign(velocityX) !== 0 ? velocityX : translationX;
  return direction < 0 ? 1 : -1;
}

/**
 * Where a horizontal drag that ends at `translationX` settles: the core the
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

/** The fractional selection while a finger drags the cores, with a little give at both ends. */
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

/**
 * `camera` flown (`dive` 0..1) to just in front of `core`, looking at it:
 * the core's glow fills the view as its computer opens.
 */
export function stageDiveCamera(
  camera: StageCamera,
  core: { position: StageVec3; radius: number },
  dive: number
): StageCamera {
  const t = clamp(dive, 0, 1);
  if (t === 0) return camera;
  const anchor = core.position;
  const [px, py, pz] = camera.position;
  const dx = anchor[0] - px;
  const dy = anchor[1] - py;
  const dz = anchor[2] - pz;
  const length = Math.hypot(dx, dy, dz) || 1;
  const back = Math.min(1, (core.radius * DIVE_STANDOFF_RADII) / length);
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

/** The point on the camera's centre line at `depth` in front of it: where cover layers hang. */
export function stageLayerCentre(depth: number): StageVec3 {
  const rest = stageCamera();
  return stageRayPoint(rest, [0, 0], depth, 1);
}

// -- Cores ------------------------------------------------------------------
//
// One luminous core per computer, its agents orbiting it as orbs on a thin
// ring. The front core sits below the art's body; its neighbours stand aside,
// smaller and further back, peeking in at the view's edges.

/** Where the selected core's centre sits for `role`: below the art, above the session strip. */
export function stageCoreAnchor(camera: StageCamera, aspect: number, role: StageRole): StageVec3 {
  return stageRayPoint(camera, [0, CORE_PLACE[role].ndcY], STAGE_CORE_DEPTH, aspect);
}

/** The cores' scale at their depth, in world units (`CORE_UNIT_HEIGHT_SHARE`). */
function coreUnit(aspect: number): number {
  const view = stageViewSize(STAGE_CORE_DEPTH, aspect);
  return Math.min(view.width, view.height * CORE_UNIT_HEIGHT_SHARE);
}

export type StageCore = {
  /** The core's centre, which is also its ring's. */
  position: StageVec3;
  radius: number;
  ringRadius: number;
  /** The bright dot of an agent orb on this core's ring. */
  orbRadius: number;
  /** 0 for the selected core, 1 for a neighbour or further. */
  side: number;
};

/**
 * The cover-flow: the core `offset` places from the (fractional) selection.
 * The selected core is about a ninth of the view's width across (at the
 * role's size); a neighbour stands 0.62 of the width aside -- half off the
 * screen -- 2.2 units further back at 0.62 of the size. Everything between
 * is interpolated, so a drag moves the cores continuously.
 */
export function stageCore(
  offset: number,
  anchor: StageVec3,
  aspect: number,
  role: StageRole
): StageCore {
  const unit = coreUnit(aspect);
  const side = Math.min(Math.abs(offset), 1);
  const radius = unit * CORE_RADIUS_SHARE * CORE_PLACE[role].scale * lerp(1, CORE_SIDE_SCALE, side);
  return {
    position: [
      anchor[0] + offset * unit * CORE_SIDE_SPREAD,
      anchor[1],
      anchor[2] - CORE_SIDE_DEPTH * side,
    ],
    radius,
    ringRadius: radius * STAGE_RING_SCALE,
    orbRadius: radius * STAGE_ORB_SCALE,
    side,
  };
}

/**
 * The ring's plane as two unit axes: `across` (angle 0, to the right) and
 * `far` (a quarter turn on, away from the camera and up). Angles increase
 * from the right round the back, so the near side is at three quarters.
 */
export const STAGE_RING_AXES: { across: StageVec3; far: StageVec3 } = {
  across: [Math.cos(RING_ROLL), Math.sin(RING_ROLL), 0],
  far: [
    -Math.sin(RING_RAISE) * Math.sin(RING_ROLL),
    Math.sin(RING_RAISE) * Math.cos(RING_ROLL),
    -Math.cos(RING_RAISE),
  ],
};

/** The point at `angle` (radians) on `core`'s ring. */
export function stageRingPoint(core: StageCore, angle: number): StageVec3 {
  const { across, far } = STAGE_RING_AXES;
  const c = Math.cos(angle) * core.ringRadius;
  const s = Math.sin(angle) * core.ringRadius;
  return [
    core.position[0] + across[0] * c + far[0] * s,
    core.position[1] + across[1] * c + far[1] * s,
    core.position[2] + across[2] * c + far[2] * s,
  ];
}

/**
 * The on-screen box of a core with its ring and orbs, clipped to the view:
 * what a tap on the computer covers. Not visible when none of it is on screen.
 */
export function stageCoreRect(
  core: StageCore,
  camera: StageCamera,
  viewportWidth: number,
  viewportHeight: number
): StageRect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  const take = (point: StageVec3, pad: number) => {
    const at = projectStagePoint(point, camera, viewportWidth, viewportHeight);
    if (at.depth <= 1e-3) return;
    const scale = pad * (viewportHeight / stageViewSize(at.depth, 1).height);
    left = Math.min(left, at.x - scale);
    right = Math.max(right, at.x + scale);
    top = Math.min(top, at.y - scale);
    bottom = Math.max(bottom, at.y + scale);
  };
  take(core.position, core.radius);
  for (let step = 0; step < 16; step += 1)
    take(stageRingPoint(core, (step / 16) * Math.PI * 2), core.orbRadius * 2);
  const depth = projectStagePoint(core.position, camera, viewportWidth, viewportHeight).depth;
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 0, height: 0, depth, visible: false };
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const w = Math.min(viewportWidth, right) - x;
  const h = Math.min(viewportHeight, bottom) - y;
  return w > 0 && h > 0
    ? { x, y, width: w, height: h, depth, visible: true }
    : { x: 0, y: 0, width: 0, height: 0, depth, visible: false };
}

// -- Theme layers ------------------------------------------------------------
//
// The theme's pictures are laid out in points over the resting view, the way
// the 2D Home lays them out on its page, then hung in the world at their
// depth (`stageWorldRect`): what the author framed for the 2D Home is what
// the window shows at rest, and tilt only slides the layers by their depth.

/** The view in points, and the safe area's top inset the HUD starts below. */
export type StageViewport = { width: number; height: number; inset: number };
/** A box in points from the view's top-left corner. */
export type StageBox = { x: number; y: number; width: number; height: number };
/** A plane's window into its texture, 0..1 from the top left; may reach past either end. */
export type StageUvWindow = { x: number; y: number; width: number; height: number };

/** The sky role's painting hangs just in front of the backdrop... */
export const STAGE_PAINTING_DEPTH = 56;
/** ...with just enough overscan that tilt never shows its sides. */
export const STAGE_PAINTING_OVERSCAN = 1.08;
/** The painting's band starts this far above the view, so tilt never shows its top edge. */
const PAINTING_BLEED_PT = 12;
/**
 * The HUD, in points below the safe area's top: the computer's name row ends
 * at 63 (10 padding, the 17 pt kicker, the 36 pt name), its status line and
 * page dots at about 96.
 */
const HUD_NAME_BOTTOM_PT = 63;
const HUD_NAME_LINE_PT = 36;
export const STAGE_HUD_BOTTOM_PT = 96;
/** A hint chip and its leader are about this tall: a hint never rises into the HUD. */
const HINT_CLEARANCE_PT = 44;
/** The cover box tucks under the name as Editorial's cover art overlaps its title: by 35 %. */
const COVER_BOX_TOP_PT = HUD_NAME_BOTTOM_PT - HUD_NAME_LINE_PT * 0.35;
/** The standard band sits just below the HUD. */
const INSET_BOX_TOP_PT = STAGE_HUD_BOTTOM_PT + 8;
/** Classic's standard band fades its cut-out's foot from here. */
const INSET_FADE_FROM = 0.72;

/** The 2D cover box's height for a view `width` points wide (`homeCoverArtworkHeight`). */
export function stageCoverBoxHeight(width: number): number {
  return Math.min(640, Math.max(0, width) * 0.9);
}

/** The 2D standard band's height for a view `width` points wide (Editorial's). */
export function stageInsetBoxHeight(width: number): number {
  return Math.min(280, Math.max(0, width) / 2);
}

/** The world plane at `depth` that the resting camera sees as `box`. */
export function stageWorldRect(
  box: StageBox,
  depth: number,
  viewport: StageViewport
): { position: StageVec3; width: number; height: number } {
  const ratio = viewport.height > 0 ? viewport.width / viewport.height : 1;
  const view = stageViewSize(depth, ratio);
  const centre = stageLayerCentre(depth);
  const sx = viewport.width > 0 ? view.width / viewport.width : 0;
  const sy = viewport.height > 0 ? view.height / viewport.height : 0;
  return {
    position: [
      centre[0] + (box.x + box.width / 2 - viewport.width / 2) * sx,
      centre[1] - (box.y + box.height / 2 - viewport.height / 2) * sy,
      centre[2],
    ],
    width: box.width * sx,
    height: box.height * sy,
  };
}

/** `plane`'s window into a picture drawn at `drawn`, both in the same units. */
function stageUvWindow(plane: StageBox, drawn: StageBox): StageUvWindow {
  if (!(drawn.width > 0) || !(drawn.height > 0)) return { x: 0, y: 0, width: 1, height: 1 };
  return {
    x: (plane.x - drawn.x) / drawn.width,
    y: (plane.y - drawn.y) / drawn.height,
    width: plane.width / drawn.width,
    height: plane.height / drawn.height,
  };
}

function intersect(a: StageBox, b: StageBox): StageBox {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

function within(rect: StageBox, box: StageBox): StageBox {
  return { x: rect.x + box.x, y: rect.y + box.y, width: rect.width, height: rect.height };
}

function ratioOf(aspect: number): { width: number; height: number } {
  return { width: Number.isFinite(aspect) && aspect > 0 ? aspect : 1, height: 1 };
}

/**
 * A cover-depth layer (the backdrop, the frame): a plane the size of the view
 * with `overscan`, and the picture fitted into it as CSS `object-fit` and
 * `object-position` fit it -- `contain` keeps it whole with the slack placed
 * by the focal point; anything else (a tile included) covers, cropping the
 * slack by the focal point.
 */
export function stageCoverLayer(
  layer: { aspect: number; fit?: string; focal: { x: number; y: number } },
  depth: number,
  overscan: number,
  aspect: number
): { width: number; height: number; uv: StageUvWindow } {
  const view = stageViewSize(depth, aspect);
  const plane = { x: 0, y: 0, width: view.width * overscan, height: view.height * overscan };
  const drawn = (layer.fit === 'contain' ? containedImageRect : coveredImageRect)(
    plane,
    ratioOf(layer.aspect),
    layer.focal
  );
  return { width: plane.width, height: plane.height, uv: stageUvWindow(plane, drawn) };
}

/** An artwork laid out in its 2D box, in points. */
export type StageArtPlacement = {
  /** The 2D box the picture is fitted into. */
  box: StageBox;
  /** The whole picture as fitted, which may reach past the box. */
  drawn: StageBox;
  /** What shows: the picture clipped to its box. The plane hung in the world. */
  plane: StageBox;
  uv: StageUvWindow;
  /** The bottom fade, as shares of the plane's height from its top; past 1 for none. */
  fade: { from: number; to: number };
  /** The fade at every edge, as shares of the plane's width and height; 0 for none. */
  edges: { x: number; y: number };
};

function placeArt(
  box: StageBox,
  drawn: StageBox,
  fadeFrom: number | null,
  edges: { x: number; y: number }
): StageArtPlacement {
  const plane = intersect(drawn, box);
  const share = (y: number) => (plane.height > 0 ? (y - plane.y) / plane.height : 1);
  return {
    box,
    drawn,
    plane,
    uv: stageUvWindow(plane, drawn),
    fade:
      fadeFrom === null
        ? { from: 2, to: 3 }
        : { from: share(box.y + box.height * fadeFrom), to: share(box.y + box.height) },
    edges,
  };
}

/**
 * The sky role's painting, framed as the 2D cover frames it
 * (`homeCoverSceneRect`: the full width at its natural height, the top kept)
 * in a band as wide as the view plus the painting's overscan and as tall as
 * the 2D cover box at that width, bleeding a little past the view's top. Its
 * foot fades from 68 % of the band into the wallpaper's base, as in 2D.
 */
export function stagePaintingPlacement(
  painting: { aspect: number; fit?: string; focal: { x: number; y: number } },
  viewport: StageViewport
): StageArtPlacement {
  const width = viewport.width * STAGE_PAINTING_OVERSCAN;
  const box = {
    x: (viewport.width - width) / 2,
    y: -PAINTING_BLEED_PT,
    width,
    height: (width * stageCoverBoxHeight(viewport.width)) / Math.max(1, viewport.width),
  };
  const drawn = within(
    homeCoverSceneRect(box, ratioOf(painting.aspect), painting.fit, painting.focal),
    box
  );
  return placeArt(box, drawn, HOME_COVER_BOTTOM_FEATHER_START, { x: 0, y: 0 });
}

/**
 * The figure (a cover header's cut-out) or the inset picture (a standard
 * header's artwork), fitted into its 2D box as Editorial fits it
 * (`editorialArtworkRect`: contained at the focal point, or covered keeping
 * the top). The cover box is the view's width by the 2D cover's height,
 * tucked under the computer's name; the standard band is the 2D standard
 * band, just below the HUD.
 */
export function stageHeroPlacement(
  hero: {
    aspect: number;
    fit?: string;
    focal: { x: number; y: number };
    box: 'cover' | 'standard';
    feather: 'cover' | 'inset' | 'framed';
  },
  viewport: StageViewport
): StageArtPlacement {
  const cover = hero.box === 'cover';
  const box = {
    x: 0,
    y: viewport.inset + (cover ? COVER_BOX_TOP_PT : INSET_BOX_TOP_PT),
    width: viewport.width,
    height: cover ? stageCoverBoxHeight(viewport.width) : stageInsetBoxHeight(viewport.width),
  };
  const drawn = within(editorialArtworkRect(box, ratioOf(hero.aspect), hero.fit, hero.focal), box);
  if (hero.feather === 'framed')
    return placeArt(box, drawn, null, {
      x: HOME_HERO_FEATHER.horizontal,
      y: HOME_HERO_FEATHER.vertical,
    });
  const from = hero.feather === 'cover' ? HOME_COVER_BOTTOM_FEATHER_START : INSET_FADE_FROM;
  return placeArt(box, drawn, from, { x: 0, y: 0 });
}

/** Where a tap starts a new task, and where its first-visit hint hangs, in points. */
export type StageHostTarget = { rect: StageBox; hint: { x: number; y: number } };

/**
 * The new-task target, in every role: the figure's or inset picture's middle
 * (not its faded foot or a wide picture's sides); the painting's band below
 * the HUD; or, with no artwork, the open band between the HUD and the core.
 * The cores are nearer, so where they overlap a target they take the tap.
 */
export function stageHostTarget(
  art: { kind: 'hero' | 'painting'; placement: StageArtPlacement } | null,
  viewport: StageViewport
): StageHostTarget {
  const hudBottom = viewport.inset + STAGE_HUD_BOTTOM_PT;
  const hintAt = (rect: StageBox, share: number) => ({
    x: rect.x + rect.width / 2,
    y: Math.min(
      rect.y + rect.height,
      Math.max(rect.y + rect.height * share, hudBottom + HINT_CLEARANCE_PT)
    ),
  });
  const plane = art?.placement.plane;
  if (art?.kind === 'hero' && plane && plane.height > 0) {
    const width = Math.min(plane.width, plane.height * 0.6);
    const rect = {
      x: plane.x + (plane.width - width) / 2,
      y: plane.y,
      width,
      height: plane.height * Math.min(0.76, Math.max(0.3, art.placement.fade.from)),
    };
    // On the chest: the chip hangs above its point, and must not cover the face.
    return { rect, hint: hintAt(rect, 0.8) };
  }
  if (art?.kind === 'painting' && plane && plane.y + plane.height - hudBottom > 48) {
    const rect = {
      x: viewport.width * 0.06,
      y: hudBottom,
      width: viewport.width * 0.88,
      height: plane.y + plane.height - hudBottom,
    };
    return { rect, hint: hintAt(rect, 0.45) };
  }
  const rect = {
    x: viewport.width * 0.1,
    y: viewport.inset + INSET_BOX_TOP_PT,
    width: viewport.width * 0.8,
    height: stageInsetBoxHeight(viewport.width),
  };
  return { rect, hint: hintAt(rect, 0.5) };
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
