/**
 * Geometry of the Stage Home layout, the "depth window": the phone is a
 * window into the theme's own world, built from its pictures at real depths
 * -- the wallpaper far away, a painting's sky band, a haze in the theme's
 * colour, the figure or inset picture, and an edge-only wallpaper as the
 * nearest frame. Nothing foreign stands in it: the depth is the art's. Tilt,
 * a swipe between computers and a slow idle drift move the camera sideways,
 * so each layer slides by its depth. Pure math shared by the GPU scene, the
 * static stage and the 2D HUD's hit areas, so all three agree.
 */
import {
  containedImageRect,
  coveredImageRect,
  editorialArtworkRect,
  HOME_HERO_FEATHER,
} from './hero-feather';

export type StageVec3 = readonly [number, number, number];

export const STAGE_CAMERA_FOV = 38;

/**
 * Layer depths, in world units in front of the camera. A sideways camera
 * move slides a layer on screen by the inverse of its depth, so these set
 * the parallax: the wallpaper least, the painting and the hero in between,
 * the frame (and the nearest ambient particles) most.
 */
export const STAGE_BACKDROP_DEPTH = 48;
export const STAGE_PAINTING_DEPTH = 28;
export const STAGE_HAZE_DEPTH = 22;
export const STAGE_HERO_DEPTH = 16;
export const STAGE_FRAME_DEPTH = 10;
/** Cover layers are this much larger than the view, so the camera's moves never show their edges. */
export const STAGE_BACKDROP_OVERSCAN = 1.22;
export const STAGE_FRAME_OVERSCAN = 1.2;
/** The painting's band is this much wider than the view, for the same reason. */
export const STAGE_PAINTING_OVERSCAN = 1.08;

/** A drag across the full stage width moves this many computers. */
export const STAGE_DRAG_SPAN = 390 / 220;

/**
 * How far the camera moves, in world units: at full tilt (on a phone about
 * 12 pt of hero parallax, 4 pt of wallpaper and 20 pt of frame) and over the
 * whole pan between computers (about 11 pt of hero, 17 pt of frame). The
 * frame's overscan covers both at once.
 */
const LOOK_SHIFT_X = 0.16;
const LOOK_SHIFT_Y = 0.1;
const PAN_SHIFT = 0.14;
/** A dive brings the camera this share of the way to the hero's plane. */
const DIVE_SHARE = 0.38;
const CAMERA_HEIGHT = 0.6;
const CAMERA_TARGET: StageVec3 = [0, -0.2, -20];

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

/** The direction (+1 next, -1 previous) a swipe that ends at `translationX` moves. */
export function stageSwipeStep(translationX: number, velocityX: number, width: number): number {
  'worklet';
  const distance = width > 0 ? Math.abs(translationX) / width : 0;
  const fast = Math.abs(velocityX) > 520;
  if (distance < 0.1 && !fast) return 0;
  // Dragging left brings the next computer.
  const direction = fast && Math.sign(velocityX) !== 0 ? velocityX : translationX;
  return direction < 0 ? 1 : -1;
}

/**
 * Where a horizontal drag that ends at `translationX` settles: the computer
 * the drag has pulled nearest, or at least one step towards the pull when
 * the drag was long or fast enough. Never past either end.
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

/** The fractional selection while a finger drags between computers, with a little give at both ends. */
export function stageDragPosition(selected: number, count: number, dragX: number): number {
  'worklet';
  const position = selected - dragX * STAGE_DRAG_SPAN;
  return Math.max(-0.35, Math.min(Math.max(0, count - 1) + 0.35, position));
}

/**
 * The camera's pan (-1..1) for a fractional selection `flow`: each computer
 * looks into the world from its own place along one sideways track, the
 * first from the left and the last from the right, a step apart (a whole
 * `PAN_SHIFT` when there are few, less when there are many), so a swipe
 * travels the camera continuously across the layers. One computer: no pan.
 */
export function stageSwipePan(flow: number, count: number): number {
  if (count <= 1 || !Number.isFinite(flow)) return 0;
  const step = Math.min(1, 2 / (count - 1));
  return clamp((flow - (count - 1) / 2) * step, -1, 1);
}

/**
 * The idle drift: a slow figure of eight the camera traces while the
 * ambient window runs, as a look (-1..1 per axis) added to the tilt.
 * `timeS` is the ambient clock, so the drift holds where it is when the
 * window closes and goes on from there when it opens again.
 */
export function stageIdleDrift(timeS: number): [number, number] {
  const t = Number.isFinite(timeS) ? timeS : 0;
  return [Math.sin(t * 0.23) * 0.22, Math.sin(t * 0.17 + 1.1) * 0.14];
}

// -- Camera -----------------------------------------------------------------

export type StageCamera = {
  position: StageVec3;
  target: StageVec3;
  /** Vertical field of view in degrees. */
  fov: number;
};

/**
 * The window's camera. `lookX`/`lookY` (-1..1, from device tilt and the
 * idle drift) and `pan` (-1..1, a swipe between computers) move it
 * sideways and up without turning it, so every layer slides by the inverse
 * of its depth: a head moving at a window.
 */
export function stageCamera({
  lookX = 0,
  lookY = 0,
  pan = 0,
}: { lookX?: number; lookY?: number; pan?: number } = {}): StageCamera {
  const dx = clamp(lookX, -1, 1) * LOOK_SHIFT_X + clamp(pan, -1, 1) * PAN_SHIFT;
  const dy = clamp(lookY, -1, 1) * LOOK_SHIFT_Y;
  return {
    position: [dx, CAMERA_HEIGHT + dy, 0],
    target: [CAMERA_TARGET[0] + dx, CAMERA_TARGET[1] + dy, CAMERA_TARGET[2]],
    fov: STAGE_CAMERA_FOV,
  };
}

/**
 * `camera` pushed in (`dive` 0..1) towards the middle of the hero's plane:
 * the art comes closer as a computer or an agent opens.
 */
export function stageDiveCamera(camera: StageCamera, dive: number): StageCamera {
  const t = clamp(dive, 0, 1);
  if (t === 0) return camera;
  const anchor = stageRayPoint(camera, [0, 0], STAGE_HERO_DEPTH, 1);
  const [px, py, pz] = camera.position;
  const share = DIVE_SHARE * t;
  return {
    position: [lerp(px, anchor[0], share), lerp(py, anchor[1], share), lerp(pz, anchor[2], share)],
    target: camera.target,
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

// -- Theme layers ------------------------------------------------------------
//
// The theme's pictures are laid out in points over the resting view -- the
// art filling it from under the computer's name down to the HUD's foot rows
// (the agents, the sessions, the composer) -- then hung in the world at
// their depth (`stageWorldRect`): what is laid out here is what the window
// shows at rest, and the camera's moves only slide the layers by depth.

/**
 * The view in points: the safe area's top inset the HUD starts below, and
 * the `floor`, where the HUD's foot rows start (the agents' row, then the
 * sessions and the composer). The art reaches down to it and fades out
 * behind them.
 */
export type StageViewport = { width: number; height: number; inset: number; floor: number };
/** A box in points from the view's top-left corner. */
export type StageBox = { x: number; y: number; width: number; height: number };
/** A plane's window into its texture, 0..1 from the top left; may reach past either end. */
export type StageUvWindow = { x: number; y: number; width: number; height: number };

/** The painting's band starts this far above the view, so the camera never shows its top edge. */
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
/** The figure's box tucks under the name as Editorial's cover art overlaps its title: by 35 %. */
const COVER_BOX_TOP_PT = HUD_NAME_BOTTOM_PT - HUD_NAME_LINE_PT * 0.35;
/** An inset picture keeps this far from the HUD above it and the foot rows below it. */
const INSET_GAP_PT = 8;
/** An inset cut-out's foot fades from this share of its box. */
const INSET_FADE_FROM = 0.72;
/**
 * The art runs this far past the floor, behind the foot rows, and fades out
 * from about this far above it: it stands on the HUD's foot rather than
 * ending in a line above it.
 */
const ART_FOOT_PT = 36;
const ART_FADE_PT = 52;
/**
 * A picture fitted whole may grow this much past the view's width (cropping
 * its sides at the focal point) when that fills more of the art's height: a
 * wide figure or inset picture, a short sky painting.
 */
const FIGURE_ZOOM = 1.3;
const INSET_ZOOM = 1.22;
const SKY_ZOOM = 1.5;

/** Where the HUD's foot rows start when the layout has not said: about a phone's. */
export function stageDefaultFloor(height: number): number {
  return Math.max(0, height) * 0.74;
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

const unit = (value: number) => clamp(value, 0, 1);

/**
 * `aspect` fitted whole into `box` -- or, when it is wider than the box,
 * grown up to `zoom` times the box's width while it fits the box's height,
 * its sides cropped -- with the slack placed by `align` (0..1 per axis).
 */
function zoomedContain(
  box: StageBox,
  aspect: number,
  zoom: number,
  align: { x: number; y: number }
): StageBox {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const whole = Math.min(box.width, box.height * ratio);
  const width = Math.max(whole, Math.min(box.width * zoom, box.height * ratio));
  const height = width / ratio;
  return {
    x: box.x + (box.width - width) * unit(align.x),
    y: box.y + (box.height - height) * unit(align.y),
    width,
    height,
  };
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
  const drawn =
    layer.fit === 'contain'
      ? containedImageRect(plane, ratioOf(layer.aspect), layer.focal)
      : coveredImageRect(plane, ratioOf(layer.aspect), layer.focal);
  return { width: plane.width, height: plane.height, uv: stageUvWindow(plane, drawn) };
}

/** An artwork laid out in its box, in points. */
export type StageArtPlacement = {
  /** The box the picture is fitted into. */
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

/**
 * `drawn` clipped to `box`, its foot fading from `fadeFrom` (in points) to
 * the plane's foot, or not at all (null).
 */
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
    fade: fadeFrom === null ? { from: 2, to: 3 } : { from: share(fadeFrom), to: 1 },
    edges,
  };
}

/**
 * Where a picture standing on the HUD's foot starts to fade: `ART_FADE_PT`
 * above the floor when it reaches past it; one that ends short of it fades
 * over as long a stretch above its own end (a short one over at most its
 * last third).
 */
function footFadeFrom(drawn: StageBox, box: StageBox, floor: number): number {
  const top = Math.max(drawn.y, box.y);
  const bottom = Math.min(drawn.y + drawn.height, box.y + box.height);
  const fade = Math.min(ART_FADE_PT + ART_FOOT_PT, (bottom - top) / 3);
  return Math.max(top, Math.min(floor - ART_FADE_PT, bottom - fade));
}

/**
 * The sky role's painting: a band across the top, as wide as the view plus
 * the painting's overscan and bleeding a little past the view's top, that
 * reaches down past the floor. The painting fills the band's width keeping
 * its top; covered (or without a fit) it grows -- up to `SKY_ZOOM`, its
 * sides cropped at the focal point -- until it reaches the floor, so the sky
 * fills the window rather than leaving a band of wallpaper under it.
 * Contained, it keeps its whole width. Its foot fades into the HUD's foot.
 */
export function stagePaintingPlacement(
  painting: { aspect: number; fit?: string; focal: { x: number; y: number } },
  viewport: StageViewport
): StageArtPlacement {
  const width = viewport.width * STAGE_PAINTING_OVERSCAN;
  const top = -PAINTING_BLEED_PT;
  const box = {
    x: (viewport.width - width) / 2,
    y: top,
    width,
    height: Math.max(0, viewport.floor + ART_FOOT_PT - top),
  };
  const ratio = ratioOf(painting.aspect).width;
  const natural = width / ratio;
  const zoom =
    painting.fit === 'contain' ? 1 : clamp(box.height / Math.max(1, natural), 1, SKY_ZOOM);
  const drawnWidth = width * zoom;
  const drawn = {
    x: box.x + (width - drawnWidth) * unit(painting.focal.x),
    y: top,
    width: drawnWidth,
    height: natural * zoom,
  };
  return placeArt(box, drawn, footFadeFrom(drawn, box, viewport.floor), { x: 0, y: 0 });
}

/**
 * The figure (a cover header's cut-out) or the inset picture (a standard
 * header's artwork).
 *
 * The figure's box is the view's width, from under the computer's name down
 * past the floor. Contained, the figure stands on the box's foot at its
 * focal x, as large as the box allows (a wide one up to `FIGURE_ZOOM` past
 * the width); covered, it fills the box keeping its top, as Editorial's.
 * Its feet fade into the HUD's foot.
 *
 * The inset picture is centred between the HUD and the floor, the view's
 * width (a little more for a wide picture, `INSET_ZOOM`) unless that is
 * taller than the room; a cut-out fades at its foot, a framed picture at
 * every edge.
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
  const ratio = ratioOf(hero.aspect).width;
  if (hero.box === 'cover') {
    const top = viewport.inset + COVER_BOX_TOP_PT;
    const box = {
      x: 0,
      y: top,
      width: viewport.width,
      height: Math.max(0, viewport.floor + ART_FOOT_PT - top),
    };
    const drawn =
      hero.fit === 'contain'
        ? zoomedContain(box, ratio, FIGURE_ZOOM, { x: hero.focal.x, y: 1 })
        : within(editorialArtworkRect(box, ratioOf(ratio), hero.fit, hero.focal), box);
    return placeArt(box, drawn, footFadeFrom(drawn, box, viewport.floor), { x: 0, y: 0 });
  }
  const roomTop = viewport.inset + STAGE_HUD_BOTTOM_PT + INSET_GAP_PT;
  const room = Math.max(0, viewport.floor - INSET_GAP_PT - roomTop);
  const height = Math.min(room, (viewport.width / ratio) * INSET_ZOOM);
  const box = { x: 0, y: roomTop + (room - height) / 2, width: viewport.width, height };
  const drawn =
    hero.fit === 'contain'
      ? zoomedContain(box, ratio, INSET_ZOOM, { x: hero.focal.x, y: hero.focal.y })
      : within(editorialArtworkRect(box, ratioOf(ratio), hero.fit, hero.focal), box);
  if (hero.feather === 'framed')
    return placeArt(box, drawn, null, {
      x: HOME_HERO_FEATHER.horizontal,
      y: HOME_HERO_FEATHER.vertical,
    });
  const plane = intersect(drawn, box);
  return placeArt(box, drawn, plane.y + plane.height * INSET_FADE_FROM, { x: 0, y: 0 });
}

/** Where a tap starts a new task, and where its first-visit hint hangs, in points. */
export type StageHostTarget = { rect: StageBox; hint: { x: number; y: number } };

/**
 * The new-task target, in every role: the figure's or inset picture's middle
 * (not its faded foot or a wide picture's sides); the painting's band below
 * the HUD down to where it fades; or, with no artwork, the world between the
 * HUD and its foot rows.
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
    const top = Math.max(plane.y, hudBottom);
    const body = plane.y + plane.height * Math.min(1, art.placement.fade.from);
    const rect = {
      x: plane.x + (plane.width - width) / 2,
      y: top,
      width,
      height: Math.max(0, Math.min(body, viewport.floor) - top),
    };
    // On the chest: the chip hangs above its point, and must not cover the face.
    return { rect, hint: hintAt(rect, 0.6) };
  }
  if (art?.kind === 'painting' && plane) {
    const body = plane.y + plane.height * Math.min(1, art.placement.fade.from);
    if (body - hudBottom > 48) {
      const rect = {
        x: viewport.width * 0.06,
        y: hudBottom,
        width: viewport.width * 0.88,
        height: body - hudBottom,
      };
      return { rect, hint: hintAt(rect, 0.45) };
    }
  }
  const rect = {
    x: viewport.width * 0.1,
    y: hudBottom + INSET_GAP_PT,
    width: viewport.width * 0.8,
    height: Math.max(0, viewport.floor - INSET_GAP_PT - hudBottom - INSET_GAP_PT),
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
