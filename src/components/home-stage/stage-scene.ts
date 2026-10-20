/**
 * The Stage's world, the "depth window", built imperatively and handed to
 * react-three-fiber as one `<primitive>`. Back to front:
 *
 *   1. backdrop  -- the theme's full painting or full-scene wallpaper, cover
 *                   fitted with room for tilt; a surface-to-background wash
 *                   when the theme has neither
 *   2. haze      -- the theme's background colour: a scrim under the header,
 *                   clear through the middle, thick at the foot
 *   3. hero      -- a cut-out character with a soft glow behind it, its feet
 *                   dissolving into the haze
 *   4. frame     -- an edge-only wallpaper, the nearest layer in depth (so it
 *                   parallaxes most) but drawn before the panes: it frames
 *                   the world and never covers a pane or its text
 *   5. motes     -- dust floating through every depth, one merged draw; or
 *                   the theme's own ambient effect (rain, snow, stars, ...)
 *                   in its place, one instanced draw (bloom, stars and
 *                   circuit traces are drawn behind the hero instead)
 *   6. panes     -- one frosted glass pane per computer in a cover-flow, each
 *                   with a status glow behind and a faint reflection below
 *                   (glows one instanced draw; panes and reflections another)
 *
 * Every layer is an unlit, textured plane: no lights, no shadows, no
 * environment, at most eight draws (the motes or a theme's ambient effect,
 * never both). Pictures are Skia readbacks, top row first, so every image
 * sample flips v.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
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
  STAGE_MAX_SCREENS,
  STAGE_PANE_RATIO,
  stageCoverPlane,
  stageHero,
  stageLayerCentre,
  stageViewSize,
  type StageVec3,
} from '@/lib/home-stage-geometry';
import type { StageAmbient } from '@/lib/home-stage-ambient';
import { createStageAmbient } from './stage-ambient';

const {
  abs,
  attribute,
  clamp,
  dot,
  exp,
  float,
  length,
  max,
  min,
  mix,
  positionLocal,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

/** Faces in the atlas: two columns of `STAGE_MAX_SCREENS / 2` rows. */
export const STAGE_FACE_COLUMNS = 2;
export const STAGE_FACE_ROWS = STAGE_MAX_SCREENS / STAGE_FACE_COLUMNS;
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

export type StageTextureSource = {
  texture: Texture;
  aspect: number;
  /** The theme's focal point, 0..1 from the top-left; centre when absent. */
  focal?: { x: number; y: number };
};

export type StageScreenLook = {
  tone: 'online' | 'offline' | 'unknown' | 'warning';
  working: boolean;
  attention: boolean;
  /** The face's cell in the atlas, or -1 for a blank face. */
  faceSlot: number;
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
  shimmer: boolean;
  /** The working pulse, the hero's bob and the motes' drift. */
  pulse: boolean;
};

export type StageSceneHandle = {
  root: Group;
  setTheme: (theme: StageTheme, scene: Scene, renderer: WebGPURenderer | null) => void;
  /** The view's width over its height: the cover layers are fitted to it. */
  setViewport: (aspect: number) => void;
  setBackdrop: (source: StageTextureSource | null) => void;
  setHero: (source: StageTextureSource | null) => void;
  setFrame: (source: StageTextureSource | null) => void;
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

/** The haze's alpha down the view (0 = top): header scrim, clear middle, thick foot. */
function hazeAlpha(t: number, light: boolean): number {
  const stops: readonly (readonly [number, number])[] = [
    [0, 0.8],
    [0.2, light ? 0.12 : 0.3],
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
  let aspect = 390 / 844;
  let light = false;

  const uBackground = uniform(new Color('#151c22'));
  const uSurface = uniform(new Color('#1e2831'));
  // The same colour as a vector: a colour uniform does not mix with vec3s in the typings.
  const uGlass = uniform(new Vector3());

  // -- 1. Backdrop -------------------------------------------------------------
  const uHasBackdrop = uniform(0);
  const backdropSample = texture(blank, flippedUv());
  const backdropMaterial = layerMaterial();
  backdropMaterial.transparent = false;
  backdropMaterial.colorNode = vec4(
    mix(mix(uBackground, uSurface, uv().y), backdropSample.rgb, uHasBackdrop),
    1
  );
  const backdrop = new Mesh(new PlaneGeometry(1, 1), backdropMaterial);
  backdrop.renderOrder = 0;
  let backdropSource: StageTextureSource | null = null;

  // -- 2. Haze -----------------------------------------------------------------
  const hazePixels = new Uint8Array(HAZE_ROWS * 4);
  const hazeTexture = new DataTexture(hazePixels, 1, HAZE_ROWS, RGBAFormat);
  hazeTexture.colorSpace = SRGBColorSpace;
  hazeTexture.magFilter = LinearFilter;
  hazeTexture.minFilter = LinearFilter;
  const hazeMaterial = layerMaterial();
  hazeMaterial.colorNode = texture(hazeTexture, flippedUv());
  const haze = new Mesh(new PlaneGeometry(1, 1), hazeMaterial);
  haze.renderOrder = 1;

  // -- 3. Hero and its glow ----------------------------------------------------
  const uHeroGlow = uniform(new Color('#ffffff'));
  const uHeroGlowAlpha = uniform(0.35);
  const heroGlowMaterial = layerMaterial();
  heroGlowMaterial.colorNode = vec4(uHeroGlow, glowFalloff().mul(uHeroGlowAlpha));
  const heroGlow = new Mesh(new PlaneGeometry(1, 1), heroGlowMaterial);
  heroGlow.renderOrder = 2;
  const heroSample = texture(blank, flippedUv());
  const heroMaterial = layerMaterial();
  // The feet dissolve into the haze over the bottom 28 %.
  heroMaterial.colorNode = vec4(heroSample.rgb, heroSample.a.mul(smoothstep(0, 0.28, uv().y)));
  const hero = new Mesh(new PlaneGeometry(1, 1), heroMaterial);
  hero.renderOrder = 3;
  let heroAspect = 1;
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
  const glowGeometry = new PlaneGeometry(1.5, 1.2);
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
  for (const attributeValue of [paneInfo, paneEdge, paneSheen])
    attributeValue.setUsage(DynamicDrawUsage);
  paneGeometry.setAttribute('aPane', paneInfo);
  paneGeometry.setAttribute('aEdge', paneEdge);
  paneGeometry.setAttribute('aSheen', paneSheen);
  const info = attribute('aPane', 'vec4');
  const edge = attribute('aEdge', 'vec4');
  const sheenOffset = attribute('aSheen', 'float');
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
  const cell = vec2(slot.mod(STAGE_FACE_COLUMNS), slot.div(STAGE_FACE_COLUMNS).floor());
  const faceUv = cell
    .add(vec2(paneU, float(1).sub(paneV)))
    .div(vec2(STAGE_FACE_COLUMNS, STAGE_FACE_ROWS));
  const faceSample = texture(blank, faceUv);
  const face = {
    rgb: faceSample.rgb,
    a: select(slot.greaterThanEqual(0), faceSample.a, float(0)).mul(inside),
  };
  const composed = over(over(glass, stroke), face);
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
  const frameSample = texture(blank, flippedUv());
  const frameMaterial = layerMaterial();
  frameMaterial.colorNode = vec4(frameSample.rgb, frameSample.a.mul(0.95));
  const frame = new Mesh(new PlaneGeometry(1, 1), frameMaterial);
  frame.renderOrder = 3.5;
  let frameSource: StageTextureSource | null = null;
  frame.visible = false;

  const ambient = createStageAmbient();

  root.add(backdrop, haze, heroGlow, hero, motes, ambient.mesh, glows, panes, frame);

  // -- Layout ------------------------------------------------------------------
  const cover = (
    mesh: Mesh,
    source: StageTextureSource | null,
    depth: number,
    overscan: number
  ) => {
    const centre = stageLayerCentre(depth);
    const plane = stageCoverPlane(source?.aspect ?? aspect, depth, overscan, aspect, source?.focal);
    mesh.scale.set(plane.width, plane.height, 1);
    mesh.position.set(centre[0] + plane.shiftX, centre[1] + plane.shiftY, centre[2]);
  };
  const layout = () => {
    uAspect.value = aspect;
    ambient.setAspect(aspect);
    cover(backdrop, backdropSource, STAGE_BACKDROP_DEPTH, STAGE_BACKDROP_OVERSCAN);
    const hazeView = stageViewSize(STAGE_HAZE_DEPTH, aspect);
    const hazeAt = stageLayerCentre(STAGE_HAZE_DEPTH);
    haze.scale.set(hazeView.width * 1.5, hazeView.height * 1.3, 1);
    haze.position.set(hazeAt[0], hazeAt[1], hazeAt[2]);
    const placed = stageHero(heroAspect, aspect);
    hero.scale.set(placed.width, placed.height, 1);
    heroBase.set(...placed.position);
    hero.position.copy(heroBase);
    heroGlow.scale.set(placed.width * 1.5, placed.height * 1.1, 1);
    heroGlow.position.set(heroBase.x, heroBase.y, heroBase.z - 0.5);
    cover(frame, frameSource, STAGE_FRAME_DEPTH, STAGE_FRAME_OVERSCAN);
  };
  layout();

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
      uHeroGlow.value.copy(deepened(light ? palette.surface : palette.primary));
      uHeroGlowAlpha.value = light ? 0.7 : 0.35;
      uMote.value.set(light ? palette.surface : palette.primary);
      uFill.value = light ? 0.8 : 0.6;
      uGlowAlpha.value = light ? 0.45 : 0.55;
      // Night glows add light; by day they would wash out, so they lie over the scene.
      glowMaterial.blending = light ? NormalBlending : AdditiveBlending;
      glowMaterial.needsUpdate = true;
      // The haze is the true background colour, so it meets the HUD's scrims without a seam.
      const srgb = new Color();
      background.getRGB(srgb, SRGBColorSpace);
      for (let row = 0; row < HAZE_ROWS; row += 1) {
        const offset = row * 4;
        hazePixels[offset] = Math.round(srgb.r * 255);
        hazePixels[offset + 1] = Math.round(srgb.g * 255);
        hazePixels[offset + 2] = Math.round(srgb.b * 255);
        hazePixels[offset + 3] = Math.round(hazeAlpha(row / (HAZE_ROWS - 1), light) * 255);
      }
      hazeTexture.needsUpdate = true;
      scene.background = background;
      scene.environment = null;
      scene.fog = null;
      if (renderer) renderer.toneMapping = NoToneMapping;
    },
    setViewport(next) {
      if (!(next > 0) || next === aspect) return;
      aspect = next;
      layout();
    },
    setBackdrop(source) {
      backdropSource = source;
      backdropSample.value = source?.texture ?? blank;
      uHasBackdrop.value = source ? 1 : 0;
      layout();
    },
    setHero(source) {
      heroSample.value = source?.texture ?? blank;
      heroAspect = source?.aspect ?? 1;
      hero.visible = Boolean(source);
      heroGlow.visible = Boolean(source);
      layout();
    },
    setFrame(source) {
      frameSource = source;
      frameSample.value = source?.texture ?? blank;
      frame.visible = Boolean(source);
      layout();
    },
    setFaces(atlas) {
      faceSample.value = atlas ?? blank;
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
      motes.visible = input.motes && !effect;
      ambient.mesh.visible = effect !== null && (!effect.particles || input.motes);
      ambient.setTime(input.pulse ? timeS : 0);
      uDrift.value = input.pulse ? timeS * 0.05 : 0;
      uBurst.value = input.burst;
      uSheen.value = input.shimmer ? (light ? 0.2 : 0.1) : 0;

      // Furthest first, so the nearer glass blends over the further.
      order.length = 0;
      for (let index = 0; index < input.panes.length && index < STAGE_MAX_SCREENS; index += 1)
        order.push(index);
      order.sort((a, b) => input.panes[b]!.side - input.panes[a]!.side);
      const pulseNow = input.pulse ? 0.75 + 0.25 * Math.sin(timeS * 2.4) : 1;
      const reflection = light ? 0.16 : 0.1;
      // Every reflection lies under every pane: reflections take the first slots.
      const count = order.length;
      order.forEach((source, drawn) => {
        const pane = input.panes[source]!;
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

        position.set(x, y - height * 0.78, z);
        scale.set(pane.width, pane.width * 0.5, 1);
        panes.setMatrixAt(drawn, scratch.compose(position, rotation, scale));
        paneInfo.setXYZW(drawn, look.faceSlot, reflection, pane.side, 1);
        paneEdge.setXYZW(drawn, status.r, status.g, status.b, offline ? 0.45 : 0.9);
        paneSheen.setX(drawn, sheenAt);

        const slot = count + drawn;
        position.set(x, y, z);
        scale.set(pane.width, pane.width, 1);
        panes.setMatrixAt(slot, scratch.compose(position, rotation, scale));
        paneInfo.setXYZW(slot, look.faceSlot, 1, pane.side, 0);
        paneEdge.setXYZW(slot, status.r, status.g, status.b, offline ? 0.45 : 0.9);
        paneSheen.setX(slot, sheenAt);

        position.set(x, y, z - 0.6);
        glows.setMatrixAt(drawn, scratch.compose(position, still, scale));
        glowTint.setXYZW(
          drawn,
          glowColor.r,
          glowColor.g,
          glowColor.b,
          (1 - pane.side * 0.6) * (working ? pulseNow : 1) * (offline ? 0.4 : 1)
        );
      });
      panes.count = count * 2;
      glows.count = count;
      panes.instanceMatrix.needsUpdate = true;
      glows.instanceMatrix.needsUpdate = true;
      paneInfo.needsUpdate = true;
      paneEdge.needsUpdate = true;
      paneSheen.needsUpdate = true;
      glowTint.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [backdrop, haze, heroGlow, hero, motes, glows, panes, frame]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      ambient.dispose();
      hazeTexture.dispose();
      blank.dispose();
    },
  };
}
