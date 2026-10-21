/**
 * Geometry of the Stage Home layout, the "depth window": the phone is a
 * window into the theme's world, built as layers at real depths -- the
 * wallpaper far away, a painting's sky band, a haze in the theme's colour,
 * the figure or inset picture, one glass pane per computer in a cover-flow,
 * and an edge-only wallpaper as the nearest frame. Pure math shared by the GPU scene, the static 2.5D stage and
 * the 2D HUD's projected hit areas and hint chips, so all three agree.
 */
import {
  containedImageRect,
  coveredImageRect,
  editorialArtworkRect,
  homeCoverSceneRect,
  HOME_COVER_BOTTOM_FEATHER_START,
  HOME_HERO_FEATHER,
} from './hero-feather';

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
/**
 * Where the selected pane's centre sits on screen, in NDC: 55% of the way
 * down, so the pane and its reflection clear the session strip above the
 * composer by about 24-32 pt on a 20:9 phone.
 */
const PANE_ANCHOR_NDC = [0, -0.1] as const;
/** The selected pane's width as a share of the view's width... */
const PANE_WIDTH_SHARE = 0.72;
/** ...and at most this share of its height, so a wide view (a tablet held sideways) keeps the phone's proportions. */
const PANE_HEIGHT_SHARE = 0.52;
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

/** Where the selected pane's centre sits: just below the screen's middle, between hero and HUD. */
export function stagePaneAnchor(camera: StageCamera, aspect: number): StageVec3 {
  return stageRayPoint(camera, PANE_ANCHOR_NDC, STAGE_PANE_DEPTH, aspect);
}

/** The point on the camera's centre line at `depth` in front of it: where cover layers hang. */
export function stageLayerCentre(depth: number): StageVec3 {
  const rest = stageCamera();
  return stageRayPoint(rest, [0, 0], depth, 1);
}

// -- Faces -------------------------------------------------------------------
//
// A pane's face is painted into a cell of the faces atlas at the sketch's
// 640 x 400 pane times 0.7. A pane is only as tall as what its face says:
// its glass shows the top of the cell, and the rest of the cell is unused.

/** One face cell, in atlas pixels: the tallest a face can be. */
export const STAGE_FACE_CELL_WIDTH = 448;
export const STAGE_FACE_CELL_HEIGHT = 280;
export const STAGE_FACE_PAD = 32;
/**
 * The front face's rows under the name, in cell pixels: the summary's top,
 * the first line's top, the step between lines, and how far below a line's
 * top its working streak runs.
 */
export const STAGE_FACE_SUMMARY_TOP = 78;
export const STAGE_FACE_LINE_TOP = 122;
export const STAGE_FACE_LINE_STEP = 38;
export const STAGE_FACE_STREAK_OFFSET = 31;
/** Rows under the name: the summary and one line at least, the summary and four lines at most. */
export const STAGE_FACE_MIN_ROWS = 2;
export const STAGE_FACE_MAX_ROWS = 5;
/** Below the last row's top: its text and the glass's bottom margin. */
const FACE_FOOT_PX = 44;
/** A side pane's face is the name and its dots: this tall, in cell pixels. */
export const STAGE_FACE_SIDE_HEIGHT = 150;

/**
 * How tall a front face with `rows` rows under its name (the summary counts
 * as one) is, in cell pixels: never less than the name and two rows, the
 * whole cell for the summary and four lines.
 */
export function stageFaceHeight(rows: number): number {
  const count = clamp(Math.round(rows), STAGE_FACE_MIN_ROWS, STAGE_FACE_MAX_ROWS);
  return STAGE_FACE_LINE_TOP + (count - 2) * STAGE_FACE_LINE_STEP + FACE_FOOT_PX;
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
 * The selected pane faces the camera at 0.72 of the view's width (at most
 * 0.52 of its height); a neighbour stands 0.66 of the width aside, 2.2 units
 * further back, turned 48 degrees inwards at 0.62 of the width (the same
 * ratios of the selected pane when the height bounds it). Everything in
 * between is interpolated, so a drag moves the panes continuously.
 *
 * A pane is as tall as its face says (`faceHeight`, in cell pixels, from
 * `stageFaceHeight`) at the front and as a side face at the side, and hangs
 * from where the tallest pane's top would be: the name stays put while the
 * height changes, and a pane never reaches lower than the tallest would.
 */
export function stagePane(
  offset: number,
  anchor: StageVec3,
  aspect: number,
  faceHeight: number = STAGE_FACE_CELL_HEIGHT
): StagePane {
  const view = stageViewSize(STAGE_PANE_DEPTH, aspect);
  const unit = Math.min(view.width, (view.height * PANE_HEIGHT_SHARE) / PANE_WIDTH_SHARE);
  const side = Math.min(Math.abs(offset), 1);
  const width = unit * (PANE_WIDTH_SHARE - 0.1 * side);
  const tallest = width * STAGE_PANE_RATIO;
  const front = clamp(faceHeight, STAGE_FACE_SIDE_HEIGHT, STAGE_FACE_CELL_HEIGHT);
  const height = (width * lerp(front, STAGE_FACE_SIDE_HEIGHT, side)) / STAGE_FACE_CELL_WIDTH;
  return {
    position: [
      anchor[0] + offset * unit * 0.66,
      anchor[1] + tallest * 0.06 * side + (tallest - height) / 2,
      anchor[2] - 2.2 * side,
    ],
    width,
    height,
    yaw: -Math.sign(offset) * side * PANE_SIDE_TURN,
    side,
  };
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
 * the HUD; or, with no artwork, the open band between the HUD and the panes.
 * The panes are nearer, so where they overlap a target they take the tap.
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
