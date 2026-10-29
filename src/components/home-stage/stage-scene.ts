/**
 * The Stage's world, the "depth window", built imperatively and handed to
 * react-three-fiber as one `<primitive>`: only the theme's own pictures at
 * their depths and its ambient effect -- no object of the Stage's own stands
 * in the art. Back to front:
 *
 *   1. backdrop  -- a surface-to-background wash, and over it the theme's
 *                   full-scene wallpaper at its authored fit, focal point and
 *                   opacity, with room for tilt
 *   1b. painting -- the sky role's painting: a band across the top down to
 *                   the HUD's foot rows, its foot fading behind them
 *   2. haze      -- the theme's background colour: a scrim under the header
 *                   (light over a cover's authored sky), clear down to the
 *                   HUD's foot rows, thick below them
 *   3. hero      -- the figure or inset picture in its box, at its focal
 *                   point and opacity, a cut-out with a soft glow behind it;
 *                   its foot (or a framed picture's every edge) dissolves
 *   4. frame     -- an edge-only wallpaper at its authored opacity, the
 *                   nearest layer in depth, so it parallaxes most
 *   5. motes     -- dust floating through every depth, one merged draw; or
 *                   the theme's own ambient effect (rain, snow, stars, ...)
 *                   in its place, one instanced draw (bloom, stars and
 *                   circuit traces are drawn behind the hero instead)
 *
 * Every layer is an unlit, textured plane: no lights, no shadows, no
 * environment, no MSAA (every edge is soft in its shader already). Layers 1,
 * 1b and 2 are one draw of the backdrop's plane, which composes the
 * painting's and the haze's planes along each view ray, so the screen is
 * filled once for all three. At most five draws (the motes or a theme's
 * ambient effect, never both; the hero and its glow only for a hero), and
 * the only other layer that covers the whole screen is a frame. Pictures are Skia
 * readbacks, top row first: each is sampled through its plane's window,
 * measured from the picture's top left.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  NoToneMapping,
  NormalBlending,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Vector3,
  Vector4,
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
  STAGE_PAINTING_DEPTH,
  stageCoverLayer,
  stageHeroPlacement,
  stageLayerCentre,
  stagePaintingPlacement,
  stageViewSize,
  stageWorldRect,
  type StageArtPlacement,
  type StageUvWindow,
  type StageViewport,
} from '@/lib/home-stage-geometry';
import type { StageHeroLayer, StageLayer, StageRole } from '@/lib/home-stage-layers';
import type { StageAmbient } from '@/lib/home-stage-ambient';
import { createStageAmbient } from './stage-ambient';

const {
  attribute,
  cameraPosition,
  clamp,
  float,
  length,
  max,
  mix,
  positionLocal,
  positionWorld,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

const MOTE_COUNT = 80;
/** About the sketch's 0.09-unit points, which three sizes at half the canvas height per unit. */
const MOTE_SIZE = 0.05;
export type StageSceneColors = {
  background: string;
  surface: string;
  primary: string;
};

export type StageTheme = {
  colors: StageSceneColors;
  mode: 'light' | 'dark';
};

/** A picture converted for the Stage: its texture, and its width over its height. */
export type StageTextureSource = { texture: Texture; aspect: number };

/** A layer's texture, and how the theme asks for the layer to be drawn. */
export type StagePicture<L extends StageLayer = StageLayer> = { texture: Texture; layer: L };

export type StageFrameInput = {
  /** Seconds since the stage started; frozen outside the ambient window and under Reduce Motion. */
  timeS: number;
  /** 0..1, decaying after a task completes: the motes flare. */
  burst: number;
  /** Particles are on at this quality: the motes, or a theme's travelling particles. */
  motes: boolean;
  /** The share of the particles drawn, 0..1. */
  particleShare: number;
  /** The hero's bob and the motes' drift. */
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
  /** The theme's ambient effect in place of the motes, or null for the motes. */
  setAmbient: (ambient: StageAmbient | null) => void;
  update: (frame: StageFrameInput) => void;
  dispose: () => void;
};

/** A Skia RGBA readback (top row first) as an sRGB texture. */
export function stageTextureFromPixels(pixels: Uint8Array, width: number, height: number) {
  const result = new DataTexture(pixels, width, height, RGBAFormat);
  result.colorSpace = SRGBColorSpace;
  result.magFilter = LinearFilter;
  result.minFilter = LinearFilter;
  result.generateMipmaps = false;
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
 * The haze's alpha down its plane (0 = top, a little above the view): header
 * scrim, clear down to about the HUD's foot rows, thick below them. Over a cover's authored sky (`open`) the scrim all but goes; the HUD
 * plates its own text instead.
 */
function hazeAlpha(t: number, light: boolean, open: boolean): number {
  const stops: readonly (readonly [number, number])[] = [
    [0, open ? 0.12 : 0.8],
    [0.2, open ? 0.04 : light ? 0.12 : 0.3],
    [0.66, light ? 0 : 0.1],
    [0.86, 0.6],
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

export function createStageScene(): StageSceneHandle {
  const root = new Group();
  const blank = blankTexture();
  let viewport: StageViewport = { width: 390, height: 844, inset: 0, floor: 624 };
  let aspect = viewport.width / viewport.height;
  let light = false;
  let open = false;

  const uBackground = uniform(new Color('#151c22'));
  const uSurface = uniform(new Color('#1e2831'));

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

  // -- Frame (drawn 4th) -------------------------------------------------------
  // Nearest in depth, drawn after the hero and before the motes: the nearest
  // particles drift in front of the foliage or rooftops at the edge.
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

  root.add(backdrop, heroGlow, hero, motes, ambient.mesh, frame);

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

  let particleShare = 1;

  return {
    root,
    setTheme({ colors: palette, mode }, scene, renderer) {
      light = mode === 'light';
      const background = new Color(palette.background);
      uBackground.value.copy(background);
      uSurface.value.set(palette.surface);
      uHeroGlow.value.copy(deepened(light ? palette.surface : palette.primary));
      uHeroGlowAlpha.value = light ? 0.7 : 0.35;
      uMote.value.set(light ? palette.surface : palette.primary);
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
        next.inset === viewport.inset &&
        next.leftInset === viewport.leftInset &&
        next.rightInset === viewport.rightInset &&
        next.floor === viewport.floor
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
    },
    dispose() {
      for (const mesh of [backdrop, heroGlow, hero, motes, frame]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      ambient.dispose();
      hazeTexture.dispose();
      blank.dispose();
    },
  };
}
