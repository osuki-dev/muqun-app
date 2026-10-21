/**
 * The Stage's world, the "depth window", built imperatively and handed to
 * react-three-fiber as one `<primitive>`. Back to front:
 *
 *   1. backdrop  -- a surface-to-background wash, and over it the theme's
 *                   full-scene wallpaper at its authored fit, focal point and
 *                   opacity, with room for tilt
 *   1b. painting -- the sky role's painting: a width-fit band across the
 *                   top, as the 2D cover shows it, its foot fading into the
 *                   wallpaper
 *   2. haze      -- the theme's background colour: a scrim under the header
 *                   (light over a cover's authored sky), clear through the
 *                   middle, thick at the foot
 *   3. hero      -- the figure or inset picture in its 2D box, at its focal
 *                   point and opacity, a cut-out with a soft glow behind it;
 *                   its foot (or a framed picture's every edge) dissolves
 *   4. frame     -- an edge-only wallpaper at its authored opacity, the
 *                   nearest layer in depth (so it parallaxes most) but
 *                   drawn before the panes: it frames
 *                   the world and never covers a pane or its text
 *   5. motes     -- dust floating through every depth, one merged draw; or
 *                   the theme's own ambient effect (rain, snow, stars, ...)
 *                   in its place, one instanced draw (bloom, stars and
 *                   circuit traces are drawn behind the hero instead)
 *   6. panes     -- one frosted glass pane per computer in a cover-flow, each
 *                   with a status glow behind and a faint reflection below
 *                   (glows one instanced draw; panes and reflections another;
 *                   the reflections only at full quality)
 *
 * Every layer is an unlit, textured plane: no lights, no shadows, no
 * environment, no MSAA (every edge is soft in its shader already). Layers 1,
 * 1b and 2 are one draw of the backdrop's plane, which composes the
 * painting's and the haze's planes along each view ray, so the screen is
 * filled once for all three. At most seven draws (the motes or a theme's
 * ambient effect, never both; the hero and its glow only for a hero), and
 * the only other layer that covers the whole screen is a frame. Pictures are Skia
 * readbacks, top row first: each is sampled through its plane's window,
 * measured from the picture's top left.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  Vector4,
  type Camera,
  type Node,
  type Scene,
  type Texture,
  type WebGPURenderer,
  TSL,
} from 'three/webgpu';

import {
  STAGE_BACKDROP_DEPTH,
  STAGE_BACKDROP_OVERSCAN,
  STAGE_CAMERA_FOV,
  STAGE_FRAME_DEPTH,
  STAGE_FRAME_OVERSCAN,
  STAGE_HAZE_DEPTH,
  STAGE_HERO_DEPTH,
  STAGE_MAX_SCREENS,
  STAGE_PAINTING_DEPTH,
  STAGE_PANE_RATIO,
  stageCoverLayer,
  stageHeroPlacement,
  stageLayerCentre,
  stagePaintingPlacement,
  stageViewSize,
  stageWorldRect,
  type StageArtPlacement,
  type StageUvWindow,
  type StageVec3,
  type StageViewport,
} from '@/lib/home-stage-geometry';
import type { StageHeroLayer, StageLayer, StageRole } from '@/lib/home-stage-layers';
import type { StageAmbient } from '@/lib/home-stage-ambient';
import { createStageAmbient } from './stage-ambient';

const {
  abs,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  exp2,
  float,
  length,
  max,
  min,
  mix,
  positionLocal,
  positionWorld,
  select,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

/** Faces in the atlas: two columns of at most `STAGE_MAX_SCREENS / 2` rows, each face twice. */
export const STAGE_FACE_COLUMNS = 2;
export const STAGE_FACE_ROWS = STAGE_MAX_SCREENS / STAGE_FACE_COLUMNS;
/**
 * One face cell, in atlas pixels: the sketch's 640 x 400 pane at 0.7. The
 * atlas holds every face twice, the front face's cells in the first
 * `STAGE_FACE_COLUMNS` columns and the compact side face's in the next.
 */
export const STAGE_FACE_CELL_WIDTH = 448;
export const STAGE_FACE_CELL_HEIGHT = 280;
export const STAGE_FACE_PAD = 32;
/**
 * The front face's agent lines, in cell pixels: the first line's top, the
 * step between lines, and how far below a line's top its working streak runs.
 */
export const STAGE_FACE_LINE_TOP = 122;
export const STAGE_FACE_LINE_STEP = 38;
export const STAGE_FACE_STREAK_OFFSET = 31;
/** Agent lines that can carry a streak. */
const STREAK_LINES = 4;
const MOTE_COUNT = 80;
/** About the sketch's 0.09-unit points, which three sizes at half the canvas height per unit. */
const MOTE_SIZE = 0.05;
/** The pane face as the sketch drew it: 640 x 400 canvas pixels, a 6 px inset, 36 px corners. */
const FACE_W = 640;
const FACE_H = 400;
const FACE_INSET = 6;
const FACE_RADIUS = 36;

export type StageSceneColors = {
  background: string;
  surface: string;
  text: string;
  primary: string;
  success: string;
  warning: string;
  /** An offline computer's edge and glow. */
  offline: string;
};

export type StageTheme = {
  colors: StageSceneColors;
  mode: 'light' | 'dark';
};

/** A picture converted for the Stage: its texture, and its width over its height. */
export type StageTextureSource = { texture: Texture; aspect: number };

/** A layer's texture, and how the theme asks for the layer to be drawn. */
export type StagePicture<L extends StageLayer = StageLayer> = { texture: Texture; layer: L };

export type StageScreenLook = {
  tone: 'online' | 'offline' | 'unknown' | 'warning';
  working: boolean;
  attention: boolean;
  /** The face's cell in the atlas, or -1 for a blank face. */
  faceSlot: number;
  /** The front face's lines with a working streak, as bits from the first. */
  streaks: number;
};

export type StagePaneFrame = {
  position: StageVec3;
  width: number;
  yaw: number;
  /** 0 for the selected pane, 1 for a neighbour or further. */
  side: number;
  /** Panes from the (fractional) selection; moves the sheen across them. */
  offset: number;
  look: StageScreenLook;
};

export type StageFrameInput = {
  camera: Camera;
  panes: readonly StagePaneFrame[];
  /** Seconds since the stage started; frozen under Reduce Motion. */
  timeS: number;
  /** -1..1: the smoothed sideways tilt, which slides the sheen. */
  tilt: number;
  /** 0..1, decaying after a task completes: the motes flare. */
  burst: number;
  /** Particles are on at this quality: the motes, or a theme's travelling particles. */
  motes: boolean;
  /** The share of the particles drawn, 0..1. */
  particleShare: number;
  /** The panes' reflections. */
  reflections: boolean;
  shimmer: boolean;
  /** The working pulse, the hero's bob and the motes' drift. */
  pulse: boolean;
};

export type StageSceneHandle = {
  root: Group;
  setTheme: (theme: StageTheme, scene: Scene, renderer: WebGPURenderer | null) => void;
  /** The view in points: the layers are laid out over it as the 2D Home lays them out. */
  setViewport: (viewport: StageViewport) => void;
  /** A cover's roles keep the authored sky: the haze's header scrim all but goes. */
  setRole: (role: StageRole) => void;
  setBackdrop: (picture: StagePicture | null) => void;
  setPainting: (picture: StagePicture | null) => void;
  setHero: (picture: StagePicture<StageHeroLayer> | null) => void;
  setFrame: (picture: StagePicture | null) => void;
  setFaces: (atlas: Texture | null) => void;
  /** The theme's ambient effect in place of the motes, or null for the motes. */
  setAmbient: (ambient: StageAmbient | null) => void;
  update: (frame: StageFrameInput) => void;
  dispose: () => void;
};

/** A Skia RGBA readback (top row first) as an sRGB texture. */
export function stageTextureFromPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  { mipmaps = false }: { mipmaps?: boolean } = {}
) {
  const result = new DataTexture(pixels, width, height, RGBAFormat);
  result.colorSpace = SRGBColorSpace;
  result.magFilter = LinearFilter;
  // Text shrunk to a few pixels needs mips, or its thin strokes break up.
  result.minFilter = mipmaps ? LinearMipmapLinearFilter : LinearFilter;
  result.generateMipmaps = mipmaps;
  result.needsUpdate = true;
  return result;
}

function blankTexture() {
  const blank = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
  blank.needsUpdate = true;
  return blank;
}

/** `hex` darkened as the sketch's canvas painted it: its linear values taken as sRGB. */
function deepened(hex: string): Color {
  return new Color(hex).convertSRGBToLinear();
}

/**
 * The haze's alpha down the view (0 = top): header scrim, clear middle, thick
 * foot. Over a cover's authored sky (`open`) the scrim all but goes; the HUD
 * plates its own text instead.
 */
function hazeAlpha(t: number, light: boolean, open: boolean): number {
  const stops: readonly (readonly [number, number])[] = [
    [0, open ? 0.12 : 0.8],
    [0.2, open ? 0.04 : light ? 0.12 : 0.3],
    [0.45, light ? 0 : 0.15],
    [0.72, 0.6],
    [1, 0.96],
  ];
  for (let index = 1; index < stops.length; index += 1) {
    const [to, end] = stops[index]!;
    const [from, start] = stops[index - 1]!;
    if (t <= to) return start + ((end - start) * (t - from)) / (to - from);
  }
  return stops[stops.length - 1]![1];
}

const HAZE_ROWS = 128;

/** An unlit, transparent material that neither reads nor writes depth: layers are ordered by hand. */
function layerMaterial(options: { blending?: typeof NormalBlending } = {}) {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    ...options,
  });
  material.toneMapped = false;
  material.fog = false;
  return material;
}

/** A plane's uv with v flipped, for pictures read back top row first. */
const flippedUv = () => vec2(uv().x, float(1).sub(uv().y));

/** x, y, width, height: a plane's window into its picture, or its fades. */
const vec4Uniform = () => uniform(new Vector4(0, 0, 1, 1));
type Vec4Uniform = ReturnType<typeof vec4Uniform>;

/**
 * A picture seen through its plane's window (a `StageUvWindow` as x, y,
 * width, height): the plane's point `p`, 0..1 from its top left, samples the
 * picture at `window.xy + p * window.zw`. Outside the picture -- a contained
 * wallpaper's slack -- is clear.
 */
function windowed(blank: Texture, window: Vec4Uniform, p: Node<'vec2'> = flippedUv()) {
  const at = window.xy.add(p.mul(window.zw));
  const sample = texture(blank, at);
  const inside = step(0, at.x).mul(step(at.x, 1)).mul(step(0, at.y)).mul(step(at.y, 1));
  return { p, sample, alpha: sample.a.mul(inside) };
}

function setWindow(target: Vector4, window: StageUvWindow) {
  target.set(window.x, window.y, window.width, window.height);
}

/** A foot fading over `fade` (shares of the plane from its top) and every edge over `edges`. */
function artAlpha(p: Node<'vec2'>, fade: Vec4Uniform): Node<'float'> {
  const foot = float(1).sub(smoothstep(fade.x, fade.y, p.y));
  const ex = max(fade.z, 0.0001);
  const ey = max(fade.w, 0.0001);
  const sides = smoothstep(0, ex, p.x).mul(smoothstep(0, ex, float(1).sub(p.x)));
  const ends = smoothstep(0, ey, p.y).mul(smoothstep(0, ey, float(1).sub(p.y)));
  return foot.mul(sides).mul(ends);
}

function setFade(target: Vector4, placement: StageArtPlacement) {
  target.set(
    placement.fade.from,
    Math.max(placement.fade.to, placement.fade.from + 0.0001),
    placement.edges.x,
    placement.edges.y
  );
}

/**
 * A `width` x `height` ellipse with a plane's uv: a radial glow is clear
 * outside it, so its quad's corners -- a fifth of the quad -- were shaded
 * for nothing.
 */
function glowDisc(width: number, height: number) {
  const disc = new CircleGeometry(0.5, 32);
  disc.scale(width, height, 1);
  return disc;
}

/** A soft round glow over a quad's uv: 1 at the middle, 0 at the rim. */
const radialGlow = () => clamp(float(1).sub(length(uv().sub(0.5).mul(2))), 0, 1);

/**
 * A status or hero glow. This renderer blends in linear light, where the
 * sketch's canvas glow blended in sRGB: steepened, it falls off as the
 * approved glow did instead of flooding a dark scene.
 */
const glowFalloff = () => radialGlow().pow(1.6);

type Layer = { rgb: Node<'vec3'>; a: Node<'float'> };

/** `top` composited over `under`, both straight (non-premultiplied) alpha. */
function over(under: Layer, top: Layer): Layer {
  const a = top.a.add(under.a.mul(float(1).sub(top.a)));
  const rgb = top.rgb
    .mul(top.a)
    .add(under.rgb.mul(under.a).mul(float(1).sub(top.a)))
    .div(max(a, 0.0001));
  return { rgb, a };
}

export function createStageScene(): StageSceneHandle {
  const root = new Group();
  const blank = blankTexture();
  let viewport: StageViewport = { width: 390, height: 844, inset: 0 };
  let aspect = viewport.width / viewport.height;
  let light = false;
  let open = false;

  const uBackground = uniform(new Color('#151c22'));
  const uSurface = uniform(new Color('#1e2831'));
  // The same colour as a vector: a colour uniform does not mix with vec3s in the typings.
  const uGlass = uniform(new Vector3());

  // -- 1, 1b, 2. Backdrop, painting and haze: one full-screen pass -------------
  // Three layers at three depths, all drawn by the backdrop's plane: each
  // fragment follows its view ray on to the painting's plane and the haze's
  // (planes of constant z, nearer the camera) and composes what those planes
  // would have drawn there, back to front. Parallax, tilt and the dive see
  // exactly the three layers, but the screen is filled once instead of three
  // times, two of them blended -- most of a phone GPU's fill rate.
  const ray = positionWorld.sub(cameraPosition);
  /** Where the view ray meets the plane at `z` centred and sized by `rect`: 0..1 from its top left. */
  const onPlane = (rect: Vec4Uniform, z: Node<'float'>) => {
    const along = z.sub(cameraPosition.z).div(ray.z);
    const hit = cameraPosition.xy.add(ray.xy.mul(along)).sub(rect.xy).div(rect.zw);
    const p = vec2(hit.x.add(0.5), float(0.5).sub(hit.y));
    return { p, inside: step(0, p.x).mul(step(p.x, 1)).mul(step(0, p.y)).mul(step(p.y, 1)) };
  };

  // The wash, and over it the wallpaper at its authored opacity: what the 2D
  // Home shows of a wallpaper drawn at that opacity over the theme's ground.
  const uBackdropOpacity = uniform(0);
  const uBackdropWindow = vec4Uniform();
  const backdropPicture = windowed(blank, uBackdropWindow);
  const ground = mix(
    mix(uBackground, uSurface, uv().y),
    backdropPicture.sample.rgb,
    backdropPicture.alpha.mul(uBackdropOpacity)
  );
  let backdropLayer: StageLayer | null = null;

  // The sky role's painting: a width-fit band across the top, its foot fading.
  const uPaintingShown = uniform(0);
  const uPaintingOpacity = uniform(1);
  const uPaintingWindow = vec4Uniform();
  const uPaintingFade = vec4Uniform();
  const uPaintingRect = vec4Uniform();
  const uPaintingZ = uniform(-STAGE_PAINTING_DEPTH);
  const paintingPlane = onPlane(uPaintingRect, uPaintingZ);
  const paintingPicture = windowed(blank, uPaintingWindow, paintingPlane.p);
  const paintingAlpha = paintingPicture.alpha
    .mul(uPaintingOpacity)
    .mul(artAlpha(paintingPlane.p, uPaintingFade))
    .mul(paintingPlane.inside)
    .mul(uPaintingShown);
  let paintingLayer: StageLayer | null = null;

  // The haze: the theme's background colour down the view.
  const hazePixels = new Uint8Array(HAZE_ROWS * 4);
  const hazeTexture = new DataTexture(hazePixels, 1, HAZE_ROWS, RGBAFormat);
  hazeTexture.colorSpace = SRGBColorSpace;
  hazeTexture.magFilter = LinearFilter;
  hazeTexture.minFilter = LinearFilter;
  const uHazeRect = vec4Uniform();
  const uHazeZ = uniform(-STAGE_HAZE_DEPTH);
  const hazePlane = onPlane(uHazeRect, uHazeZ);
  const hazeSample = texture(hazeTexture, hazePlane.p);

  const backdropMaterial = layerMaterial();
  backdropMaterial.transparent = false;
  backdropMaterial.colorNode = vec4(
    mix(
      mix(ground, paintingPicture.sample.rgb, paintingAlpha),
      hazeSample.rgb,
      hazeSample.a.mul(hazePlane.inside)
    ),
    1
  );
  const backdrop = new Mesh(new PlaneGeometry(1, 1), backdropMaterial);
  backdrop.renderOrder = 0;

  // -- 3. Hero and its glow ----------------------------------------------------
  const uHeroGlow = uniform(new Color('#ffffff'));
  const uHeroGlowAlpha = uniform(0.35);
  const heroGlowMaterial = layerMaterial();
  heroGlowMaterial.colorNode = vec4(uHeroGlow, glowFalloff().mul(uHeroGlowAlpha));
  const heroGlow = new Mesh(glowDisc(1, 1), heroGlowMaterial);
  heroGlow.renderOrder = 2;
  const uHeroOpacity = uniform(1);
  const uHeroWindow = vec4Uniform();
  const uHeroFade = vec4Uniform();
  const heroPicture = windowed(blank, uHeroWindow);
  const heroMaterial = layerMaterial();
  // The foot (or a framed picture's every edge) dissolves as the 2D one does.
  heroMaterial.colorNode = vec4(
    heroPicture.sample.rgb,
    heroPicture.alpha.mul(uHeroOpacity).mul(artAlpha(heroPicture.p, uHeroFade))
  );
  const hero = new Mesh(new PlaneGeometry(1, 1), heroMaterial);
  hero.renderOrder = 3;
  let heroLayer: StageHeroLayer | null = null;
  const heroBase = new Vector3();
  heroGlow.visible = false;
  hero.visible = false;

  // -- 5. Motes ----------------------------------------------------------------
  // One merged geometry: each mote is a quad whose corners are `position`,
  // placed in the shader from `aMote` (x and y as shares of the view at its
  // depth, the depth) so the spread follows the view's aspect.
  const motePositions = new Float32Array(MOTE_COUNT * 4 * 3);
  const moteUvs = new Float32Array(MOTE_COUNT * 4 * 2);
  const motePlaces = new Float32Array(MOTE_COUNT * 4 * 3);
  const moteIndex: number[] = [];
  {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ] as const;
    for (let mote = 0; mote < MOTE_COUNT; mote += 1) {
      const depth = 4 + random() * 40;
      const x = random() - 0.5;
      const y = random() - 0.5;
      corners.forEach(([cx, cy], corner) => {
        const vertex = mote * 4 + corner;
        motePositions.set([cx, cy, 0], vertex * 3);
        moteUvs.set([cx + 0.5, cy + 0.5], vertex * 2);
        motePlaces.set([x, y, depth], vertex * 3);
      });
      const base = mote * 4;
      moteIndex.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const moteGeometry = new BufferGeometry();
  moteGeometry.setAttribute('position', new BufferAttribute(motePositions, 3));
  moteGeometry.setAttribute('uv', new BufferAttribute(moteUvs, 2));
  moteGeometry.setAttribute('aMote', new BufferAttribute(motePlaces, 3));
  moteGeometry.setIndex(moteIndex);
  const uAspect = uniform(aspect);
  const uDrift = uniform(0);
  const uBurst = uniform(0);
  const uMote = uniform(new Color('#ffffff'));
  const place = attribute('aMote', 'vec3');
  const span = place.z.mul(2 * Math.tan((STAGE_CAMERA_FOV * Math.PI) / 360));
  // Each mote rises through its own view height and wraps, fading at both ends.
  const rise = place.y.add(0.5).add(uDrift.div(span)).fract();
  const moteMaterial = layerMaterial();
  moteMaterial.positionNode = vec3(
    place.x.mul(span).mul(uAspect),
    rise.sub(0.5).mul(span),
    place.z.negate()
  ).add(positionLocal.mul(float(MOTE_SIZE).mul(uBurst.mul(1.5).add(1))));
  moteMaterial.colorNode = vec4(
    uMote,
    radialGlow()
      .mul(0.85)
      .mul(smoothstep(0, 0.08, rise).mul(smoothstep(1, 0.92, rise)))
      .mul(uBurst.mul(0.6).add(1))
  );
  const motes = new Mesh(moteGeometry, moteMaterial);
  motes.frustumCulled = false;
  motes.renderOrder = 4;

  // -- 6. Panes: status glows, then reflections and panes ----------------------
  const glowGeometry = glowDisc(1.5, 1.2);
  // rgb + strength
  const glowTint = new InstancedBufferAttribute(new Float32Array(STAGE_MAX_SCREENS * 4), 4);
  glowTint.setUsage(DynamicDrawUsage);
  glowGeometry.setAttribute('aGlow', glowTint);
  const uGlowAlpha = uniform(0.55);
  const glowInfo = attribute('aGlow', 'vec4');
  const glowMaterial = layerMaterial();
  glowMaterial.colorNode = vec4(glowInfo.xyz, glowFalloff().mul(glowInfo.w).mul(uGlowAlpha));
  const glows = new InstancedMesh(glowGeometry, glowMaterial, STAGE_MAX_SCREENS);
  glows.instanceMatrix.setUsage(DynamicDrawUsage);
  glows.frustumCulled = false;
  glows.count = 0;
  glows.renderOrder = 5;

  const paneGeometry = new PlaneGeometry(1, STAGE_PANE_RATIO);
  const capacity = STAGE_MAX_SCREENS * 2;
  // faceSlot, opacity, side (0 front .. 1 side), flip (1 for a reflection)
  const paneInfo = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  // edge rgb, edge alpha
  const paneEdge = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
  // sheen offset
  const paneSheen = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  // working streak line bits
  const paneStreaks = new InstancedBufferAttribute(new Float32Array(capacity), 1);
  for (const attributeValue of [paneInfo, paneEdge, paneSheen, paneStreaks])
    attributeValue.setUsage(DynamicDrawUsage);
  paneGeometry.setAttribute('aPane', paneInfo);
  paneGeometry.setAttribute('aEdge', paneEdge);
  paneGeometry.setAttribute('aSheen', paneSheen);
  paneGeometry.setAttribute('aStreak', paneStreaks);
  const info = attribute('aPane', 'vec4');
  const edge = attribute('aEdge', 'vec4');
  const sheenOffset = attribute('aSheen', 'float');
  const streakBits = attribute('aStreak', 'float');
  const uStreak = uniform(new Vector3(1, 1, 1));
  const uStreakTime = uniform(0);
  const uFill = uniform(0.6);
  const uSheen = uniform(0.1);
  // A reflection is the pane upside down.
  const paneV = mix(uv().y, float(1).sub(uv().y), info.w);
  const paneU = uv().x;
  // The sketch's canvas: pixels from the top left.
  const pixel = vec2(paneU.mul(FACE_W), float(1).sub(paneV).mul(FACE_H));
  const corner = abs(pixel.sub(vec2(FACE_W / 2, FACE_H / 2))).sub(
    vec2(FACE_W / 2 - FACE_INSET - FACE_RADIUS, FACE_H / 2 - FACE_INSET - FACE_RADIUS)
  );
  const distance = length(max(corner, 0))
    .add(min(max(corner.x, corner.y), 0))
    .sub(FACE_RADIUS);
  // Two canvas pixels of soft edge: a pane is about half its canvas size on screen.
  const inside = clamp(float(1).sub(distance), 0, 2).mul(0.5);
  // Frosted glass, a little denser at the top left.
  const diagonal = dot(pixel, vec2(FACE_W, FACE_H)).div(FACE_W * FACE_W + FACE_H * FACE_H);
  const glass: Layer = { rgb: uGlass, a: uFill.add(0.1).sub(diagonal.mul(0.2)).mul(inside) };
  // The status edge: 6 px on the selected pane, 4 px at the side.
  const strokeHalf = float(3).sub(info.z);
  const stroke = {
    rgb: edge.xyz,
    a: clamp(strokeHalf.add(1).sub(abs(distance)), 0, 1).mul(edge.w),
  };
  const slot = info.x;
  const hasFace = select(slot.greaterThanEqual(0), float(1), float(0));
  const cell = vec2(slot.mod(STAGE_FACE_COLUMNS), slot.div(STAGE_FACE_COLUMNS).floor());
  const cellUv = cell.add(vec2(paneU, float(1).sub(paneV)));
  const uFaceRows = uniform(STAGE_FACE_ROWS);
  const atlasCells = vec2(STAGE_FACE_COLUMNS * 2, uFaceRows);
  const faceSample = texture(blank, cellUv.div(atlasCells));
  // The same face's compact cell, which a pane turns to as it steps aside.
  const compactSample = texture(blank, cellUv.add(vec2(STAGE_FACE_COLUMNS, 0)).div(atlasCells));
  const compact = smoothstep(0.25, 0.75, info.z);
  const faceAlpha = mix(faceSample.a, compactSample.a, compact);
  const face = {
    // Blended premultiplied, so neither face's transparent texels darken the other.
    rgb: mix(faceSample.rgb.mul(faceSample.a), compactSample.rgb.mul(compactSample.a), compact).div(
      max(faceAlpha, 0.0001)
    ),
    a: faceAlpha.mul(hasFace).mul(inside),
  };
  // A working agent's line: a faint rule with a band of light travelling
  // along it on the ambient clock, so it holds still whenever that clock does.
  const cellX = paneU.mul(STAGE_FACE_CELL_WIDTH);
  const lineY = float(1).sub(paneV).mul(STAGE_FACE_CELL_HEIGHT).sub(STAGE_FACE_LINE_TOP);
  const line = lineY.div(STAGE_FACE_LINE_STEP).floor();
  const within = lineY.sub(line.mul(STAGE_FACE_LINE_STEP));
  const lit = streakBits
    .div(exp2(max(line, 0)))
    .floor()
    .mod(2);
  const rule = clamp(float(1.5).sub(abs(within.sub(STAGE_FACE_STREAK_OFFSET))), 0, 1)
    .mul(step(0, lineY))
    .mul(step(line, STREAK_LINES - 0.5))
    .mul(smoothstep(STAGE_FACE_PAD, STAGE_FACE_PAD + 12, cellX))
    .mul(
      float(1).sub(
        smoothstep(
          STAGE_FACE_CELL_WIDTH - STAGE_FACE_PAD - 12,
          STAGE_FACE_CELL_WIDTH - STAGE_FACE_PAD,
          cellX
        )
      )
    );
  const head = uStreakTime.mul(0.35).add(line.mul(0.27)).fract().mul(1.4).sub(0.2);
  const travel = exp(paneU.sub(head).mul(7).pow(2).negate());
  const streak = {
    rgb: uStreak,
    a: rule
      .mul(lit)
      .mul(travel.mul(0.8).add(0.2))
      .mul(float(1).sub(compact))
      .mul(hasFace)
      .mul(inside),
  };
  const composed = over(over(over(glass, stroke), streak), face);
  // A narrow specular band that tilt slides across the glass.
  const band = paneU.mul(0.85).add(paneV.mul(0.45));
  const sheen = exp(band.sub(sheenOffset.add(0.62)).mul(11).pow(2).negate());
  const paneMaterial = layerMaterial();
  paneMaterial.colorNode = vec4(
    composed.rgb.add(vec3(sheen.mul(uSheen).mul(composed.a))),
    composed.a.mul(info.y)
  );
  const panes = new InstancedMesh(paneGeometry, paneMaterial, capacity);
  panes.instanceMatrix.setUsage(DynamicDrawUsage);
  panes.frustumCulled = false;
  panes.count = 0;
  panes.renderOrder = 6;

  // -- Frame (drawn 4th) -------------------------------------------------------
  // Nearest in depth, but drawn after the hero and before the motes and the
  // panes: foliage or rooftops at the edge must never sit over a pane's text.
  const uFrameOpacity = uniform(1);
  const uFrameWindow = vec4Uniform();
  const framePicture = windowed(blank, uFrameWindow);
  const frameMaterial = layerMaterial();
  frameMaterial.colorNode = vec4(framePicture.sample.rgb, framePicture.alpha.mul(uFrameOpacity));
  const frame = new Mesh(new PlaneGeometry(1, 1), frameMaterial);
  frame.renderOrder = 3.5;
  let frameLayer: StageLayer | null = null;
  frame.visible = false;

  const ambient = createStageAmbient();

  root.add(backdrop, heroGlow, hero, motes, ambient.mesh, glows, panes, frame);

  // -- Layout ------------------------------------------------------------------
  const cover = (
    mesh: Mesh,
    window: Vector4,
    layer: StageLayer | null,
    depth: number,
    overscan: number
  ) => {
    const centre = stageLayerCentre(depth);
    const placed = stageCoverLayer(
      layer ?? { aspect, fit: 'cover', focal: { x: 0.5, y: 0.5 } },
      depth,
      overscan,
      aspect
    );
    mesh.scale.set(placed.width, placed.height, 1);
    mesh.position.set(centre[0], centre[1], centre[2]);
    setWindow(window, placed.uv);
  };
  /** An artwork's plane, hung at `depth` where the resting camera sees it as laid out. */
  const hang = (mesh: Mesh, placement: StageArtPlacement, depth: number) => {
    const placed = stageWorldRect(placement.plane, depth, viewport);
    mesh.scale.set(Math.max(placed.width, 1e-4), Math.max(placed.height, 1e-4), 1);
    mesh.position.set(...placed.position);
    return placed;
  };
  const layout = () => {
    uAspect.value = aspect;
    ambient.setAspect(aspect);
    cover(
      backdrop,
      uBackdropWindow.value,
      backdropLayer,
      STAGE_BACKDROP_DEPTH,
      STAGE_BACKDROP_OVERSCAN
    );
    if (paintingLayer) {
      const placement = stagePaintingPlacement(paintingLayer, viewport);
      const placed = stageWorldRect(placement.plane, STAGE_PAINTING_DEPTH, viewport);
      const [x, y, z] = placed.position;
      uPaintingRect.value.set(x, y, Math.max(placed.width, 1e-4), Math.max(placed.height, 1e-4));
      uPaintingZ.value = z;
      setWindow(uPaintingWindow.value, placement.uv);
      setFade(uPaintingFade.value, placement);
    }
    const hazeView = stageViewSize(STAGE_HAZE_DEPTH, aspect);
    const hazeAt = stageLayerCentre(STAGE_HAZE_DEPTH);
    uHazeRect.value.set(hazeAt[0], hazeAt[1], hazeView.width * 1.5, hazeView.height * 1.3);
    uHazeZ.value = hazeAt[2];
    if (heroLayer) {
      const placement = stageHeroPlacement(heroLayer, viewport);
      const placed = hang(hero, placement, STAGE_HERO_DEPTH);
      setWindow(uHeroWindow.value, placement.uv);
      setFade(uHeroFade.value, placement);
      heroBase.copy(hero.position);
      // The glow sits behind the figure's body, not its faded foot.
      const body = Math.min(1, placement.fade.from);
      heroGlow.scale.set(placed.width * 1.5, placed.height * body * 1.1, 1);
      heroGlow.position.set(
        heroBase.x,
        heroBase.y + (placed.height * (1 - body)) / 2,
        heroBase.z - 0.5
      );
    }
    cover(frame, uFrameWindow.value, frameLayer, STAGE_FRAME_DEPTH, STAGE_FRAME_OVERSCAN);
  };
  layout();

  const paintHaze = () => {
    const srgb = new Color();
    uBackground.value.getRGB(srgb, SRGBColorSpace);
    for (let row = 0; row < HAZE_ROWS; row += 1) {
      const offset = row * 4;
      hazePixels[offset] = Math.round(srgb.r * 255);
      hazePixels[offset + 1] = Math.round(srgb.g * 255);
      hazePixels[offset + 2] = Math.round(srgb.b * 255);
      hazePixels[offset + 3] = Math.round(hazeAlpha(row / (HAZE_ROWS - 1), light, open) * 255);
    }
    hazeTexture.needsUpdate = true;
  };

  // -- Per-frame state ---------------------------------------------------------
  type Status = 'primary' | 'success' | 'warning' | 'offline';
  const edges: Record<Status, Color> = {
    primary: new Color(),
    success: new Color(),
    warning: new Color(),
    offline: new Color(),
  };
  const glowColors: Record<Status, Color> = {
    primary: new Color(),
    success: new Color(),
    warning: new Color(),
    offline: new Color(),
  };
  const scratch = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const still = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  const order: number[] = [];
  let particleShare = 1;

  return {
    root,
    setTheme({ colors: palette, mode }, scene, renderer) {
      light = mode === 'light';
      const background = new Color(palette.background);
      uBackground.value.copy(background);
      uSurface.value.set(palette.surface);
      // The glass and the glows keep the depth of the approved sketch, whose
      // canvas painted them with the palette's linear values as sRGB: deeper
      // and more saturated than the plain colours, which matters most at night.
      const glass = deepened(palette.surface);
      uGlass.value.set(glass.r, glass.g, glass.b);
      for (const status of ['primary', 'success', 'warning', 'offline'] as const) {
        edges[status].set(palette[status]);
        glowColors[status].copy(deepened(palette[status]));
      }
      uStreak.value.set(edges.primary.r, edges.primary.g, edges.primary.b);
      uHeroGlow.value.copy(deepened(light ? palette.surface : palette.primary));
      uHeroGlowAlpha.value = light ? 0.7 : 0.35;
      uMote.value.set(light ? palette.surface : palette.primary);
      uFill.value = light ? 0.8 : 0.6;
      uGlowAlpha.value = light ? 0.45 : 0.55;
      // Night glows add light; by day they would wash out, so they lie over the scene.
      glowMaterial.blending = light ? NormalBlending : AdditiveBlending;
      glowMaterial.needsUpdate = true;
      // The haze is the true background colour, so it meets the HUD's scrims without a seam.
      paintHaze();
      scene.background = background;
      scene.environment = null;
      scene.fog = null;
      if (renderer) renderer.toneMapping = NoToneMapping;
    },
    setViewport(next) {
      if (!(next.width > 0) || !(next.height > 0)) return;
      if (
        next.width === viewport.width &&
        next.height === viewport.height &&
        next.inset === viewport.inset
      )
        return;
      viewport = next;
      aspect = next.width / next.height;
      layout();
    },
    setRole(role) {
      const next = role === 'sky' || role === 'figure';
      if (next === open) return;
      open = next;
      paintHaze();
    },
    setBackdrop(picture) {
      backdropLayer = picture?.layer ?? null;
      backdropPicture.sample.value = picture?.texture ?? blank;
      uBackdropOpacity.value = picture ? picture.layer.opacity : 0;
      layout();
    },
    setPainting(picture) {
      paintingLayer = picture?.layer ?? null;
      paintingPicture.sample.value = picture?.texture ?? blank;
      uPaintingOpacity.value = picture?.layer.opacity ?? 1;
      uPaintingShown.value = picture ? 1 : 0;
      layout();
    },
    setHero(picture) {
      heroLayer = picture?.layer ?? null;
      heroPicture.sample.value = picture?.texture ?? blank;
      uHeroOpacity.value = picture?.layer.opacity ?? 1;
      hero.visible = Boolean(picture);
      heroGlow.visible = Boolean(picture?.layer.cutout);
      layout();
    },
    setFrame(picture) {
      frameLayer = picture?.layer ?? null;
      framePicture.sample.value = picture?.texture ?? blank;
      uFrameOpacity.value = picture?.layer.opacity ?? 1;
      frame.visible = Boolean(picture);
      layout();
    },
    setFaces(atlas) {
      faceSample.value = atlas ?? blank;
      compactSample.value = atlas ?? blank;
      // The atlas holds only the rows its faces need.
      const height = (atlas?.image as { height?: number } | undefined)?.height ?? 0;
      uFaceRows.value = Math.max(1, Math.round(height / STAGE_FACE_CELL_HEIGHT));
    },
    setAmbient(next) {
      ambient.configure(next);
    },
    update(input) {
      const { timeS } = input;
      hero.position.set(
        heroBase.x,
        heroBase.y + (input.pulse ? Math.sin(timeS * 0.9) * 0.08 : 0),
        heroBase.z
      );
      const effect = ambient.current;
      if (input.particleShare !== particleShare) {
        particleShare = input.particleShare;
        moteGeometry.setDrawRange(0, Math.round(MOTE_COUNT * particleShare) * 6);
        ambient.setShare(particleShare);
      }
      motes.visible = input.motes && !effect;
      ambient.mesh.visible = effect !== null && (!effect.particles || input.motes);
      ambient.setTime(input.pulse ? timeS : 0);
      uDrift.value = input.pulse ? timeS * 0.05 : 0;
      uBurst.value = input.burst;
      uSheen.value = input.shimmer ? (light ? 0.2 : 0.1) : 0;
      // The ambient clock: still outside the window and under Reduce Motion.
      uStreakTime.value = timeS;

      // Furthest first, so the nearer glass blends over the further.
      order.length = 0;
      for (let index = 0; index < input.panes.length && index < STAGE_MAX_SCREENS; index += 1)
        order.push(index);
      order.sort((a, b) => input.panes[b]!.side - input.panes[a]!.side);
      const pulseNow = input.pulse ? 0.75 + 0.25 * Math.sin(timeS * 2.4) : 1;
      const reflection = light ? 0.16 : 0.1;
      // Every reflection lies under every pane: reflections take the first slots.
      const count = order.length;
      const reflected = input.reflections;
      for (let drawn = 0; drawn < count; drawn += 1) {
        const pane = input.panes[order[drawn]!]!;
        const { look } = pane;
        const offline = look.tone === 'offline' || look.tone === 'unknown';
        const working = look.working && !offline;
        const tone: Status = offline
          ? 'offline'
          : look.tone === 'warning' || look.attention
            ? 'warning'
            : working
              ? 'primary'
              : 'success';
        const status = edges[tone];
        const glowColor = glowColors[tone];
        const height = pane.width * STAGE_PANE_RATIO;
        const sheenAt = input.tilt * 0.35 - pane.offset * 0.3;
        rotation.setFromAxisAngle(yAxis, pane.yaw);
        const [x, y, z] = pane.position;

        if (reflected) {
          position.set(x, y - height * 0.78, z);
          scale.set(pane.width, pane.width * 0.5, 1);
          panes.setMatrixAt(drawn, scratch.compose(position, rotation, scale));
          paneInfo.setXYZW(drawn, look.faceSlot, reflection, pane.side, 1);
          paneEdge.setXYZW(drawn, status.r, status.g, status.b, offline ? 0.45 : 0.9);
          paneSheen.setX(drawn, sheenAt);
          paneStreaks.setX(drawn, working ? look.streaks : 0);
        }

        const slot = reflected ? count + drawn : drawn;
        position.set(x, y, z);
        scale.set(pane.width, pane.width, 1);
        panes.setMatrixAt(slot, scratch.compose(position, rotation, scale));
        paneInfo.setXYZW(slot, look.faceSlot, 1, pane.side, 0);
        paneEdge.setXYZW(slot, status.r, status.g, status.b, offline ? 0.45 : 0.9);
        paneSheen.setX(slot, sheenAt);
        paneStreaks.setX(slot, working ? look.streaks : 0);

        position.set(x, y, z - 0.6);
        glows.setMatrixAt(drawn, scratch.compose(position, still, scale));
        glowTint.setXYZW(
          drawn,
          glowColor.r,
          glowColor.g,
          glowColor.b,
          (1 - pane.side * 0.6) * (working ? pulseNow : 1) * (offline ? 0.4 : 1)
        );
      }
      panes.count = reflected ? count * 2 : count;
      glows.count = count;
      panes.instanceMatrix.needsUpdate = true;
      glows.instanceMatrix.needsUpdate = true;
      paneInfo.needsUpdate = true;
      paneEdge.needsUpdate = true;
      paneSheen.needsUpdate = true;
      paneStreaks.needsUpdate = true;
      glowTint.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [backdrop, heroGlow, hero, motes, glows, panes, frame]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      ambient.dispose();
      hazeTexture.dispose();
      blank.dispose();
    },
  };
}
