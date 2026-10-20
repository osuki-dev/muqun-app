/**
 * The Stage's 3D scene, built imperatively and handed to react-three-fiber as
 * one `<primitive>`. No React here: the scene is a fixed set of six draws,
 * and keeping it out of the reconciler is what keeps it at six.
 *
 * Draw calls (the §11.7 contract is <= 6, <= 8k triangles):
 *   1. backdrop    -- the theme wallpaper on a slightly curved plane, sky-lit
 *   2. god ray     -- one additive gradient quad behind the character
 *   3. shadow      -- the character's soft contact shadow on the floor
 *   4. character   -- the `home.artwork` cutout billboard with a primary rim,
 *                     or the crystal when the theme has no cutout
 *   5. panels      -- every holo-card in one instanced draw, one cheap shader
 *   6. light fx    -- fake bloom halos and the dust motes, one instanced
 *                     additive draw (no post-processing pass)
 *
 * Triangles: backdrop 48, god ray 2, shadow 2, character 2 (crystal 8),
 * panels 2 x <= 16, fx 2 x <= 128: under 400 at the most.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  NormalBlending,
  OctahedronGeometry,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Texture,
  TSL,
} from 'three/webgpu';

import {
  STAGE_CHARACTER_HEIGHT,
  STAGE_FLOOR_Y,
  STAGE_PANEL_HEIGHT,
  STAGE_PANEL_WIDTH,
  type StagePanelPose,
} from '@/lib/home-stage-geometry';

const {
  abs,
  attribute,
  clamp,
  dot,
  exp,
  float,
  fract,
  frontFacing,
  length,
  max,
  mix,
  normalView,
  positionLocal,
  positionViewDirection,
  pow,
  select,
  sin,
  smoothstep,
  step,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

/** Cards drawn at once: the visible arc plus one arriving from beyond it. */
export const STAGE_PANEL_CAPACITY = 16;
const PARTICLE_COUNT = 96;
const HALO_CAPACITY = STAGE_PANEL_CAPACITY * 2 + 2;
const FX_CAPACITY = HALO_CAPACITY + PARTICLE_COUNT;

export const STAGE_DRAW_CALLS = 6;

export type StageSceneColors = {
  background: string;
  surface: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
  muted: string;
};

export type StageTheme = {
  colors: StageSceneColors;
  mode: 'light' | 'dark';
  /** The theme's surface opacity (Settings -> Theme), 0..1. */
  surfaceOpacity: number;
};

export type StageTextureSource = {
  texture: Texture;
  aspect: number;
  /** The theme's focal point, 0..1 from the top-left; centre when absent. */
  focal?: { x: number; y: number };
};

export type StagePanelLook = {
  /** Status underglow colour: success, warning, danger or muted. */
  tone: 'online' | 'offline' | 'unknown' | 'warning';
  working: boolean;
  attention: boolean;
  /** The empty slab with nothing paired: drawn, never glowing. */
  placeholder?: boolean;
};

export type StageFrameInput = {
  poses: readonly StagePanelPose[];
  looks: readonly StagePanelLook[];
  /** Index of the selected card in `poses`, or -1. */
  selected: number;
  /** The character's head-plane yaw towards the selected card. */
  lookYaw: number;
  /** Seconds, for the shimmer, pulse and dust. Frozen under Reduce Motion. */
  timeS: number;
  /** 4 s breathing multiplier (1 when still). */
  breath: number;
  /** The selection flash multiplier on the selected card (1 when still). */
  selectionGlow: number;
  /** Tilt parallax for the foil band, -1..1 per axis. */
  tilt: readonly [number, number];
  particles: boolean;
  shimmer: boolean;
  pulse: boolean;
};

export type StageSceneHandle = {
  root: Group;
  setTheme: (theme: StageTheme) => void;
  setBackdrop: (source: StageTextureSource | null) => void;
  setCharacter: (source: StageTextureSource | null) => void;
  /** The backdrop fills the view at its depth; call when the viewport changes. */
  setViewport: (aspect: number, fovDegrees: number, cameraDistance: number) => void;
  update: (frame: StageFrameInput) => void;
  dispose: () => void;
};

const BACKDROP_Z = -5.2;
const BACKDROP_CURVE = (20 * Math.PI) / 180;

/** A 1 x 1 stand-in so the texture nodes always have something bound. */
function blankTexture() {
  const blank = new DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);
  blank.needsUpdate = true;
  return blank;
}

/** A Skia RGBA readback (top row first) as an sRGB texture. */
export function stageTextureFromPixels(pixels: Uint8Array, width: number, height: number) {
  const result = new DataTexture(pixels, width, height, RGBAFormat);
  result.colorSpace = SRGBColorSpace;
  result.generateMipmaps = false;
  result.needsUpdate = true;
  return result;
}

/** Cover-fit scale for an image of `imageAspect` on a plane of `planeAspect`. */
function coverScale(imageAspect: number, planeAspect: number, out: Vector2) {
  if (imageAspect > planeAspect) out.set(planeAspect / imageAspect, 1);
  else out.set(1, imageAspect / planeAspect);
  return out;
}

export function createStageScene(): StageSceneHandle {
  const root = new Group();
  const blank = blankTexture();

  // -- Shared uniforms --------------------------------------------------------
  const uBackground = uniform(new Color('#000000'));
  const uSurface = uniform(new Color('#202020'));
  const uPrimary = uniform(new Color('#ffffff'));
  const uSky = uniform(new Color('#ffffff'));
  const uLight = uniform(new Color('#ffffff'));
  const uGlass = uniform(0.55);
  const uTime = uniform(0);
  const uBreath = uniform(1);
  const uTilt = uniform(new Vector2());
  const uShimmer = uniform(1);
  const uPulse = uniform(1);
  const uNight = uniform(0);

  // -- 1. Backdrop -------------------------------------------------------------
  const uBackdropScale = uniform(new Vector2(1, 1));
  const uBackdropOffset = uniform(new Vector2(0, 0));
  const uHasBackdrop = uniform(0);
  const backdropUv = uv().sub(0.5).mul(uBackdropScale).add(0.5).add(uBackdropOffset).toVar();
  // Skia reads rows top first: flip V when sampling.
  const backdropSample = texture(blank, vec2(backdropUv.x, float(1).sub(backdropUv.y)));
  const skyGradient = mix(uBackground, uSky, smoothstep(0.05, 0.95, uv().y));
  const backdropBase = mix(skyGradient, backdropSample.rgb.mul(uLight), uHasBackdrop);
  // The floor tone rises from the bottom; the corners fall off to the ground.
  const floorFog = smoothstep(0.42, 0.02, uv().y).mul(0.6);
  const vignette = smoothstep(0.95, 0.35, length(uv().sub(vec2(0.5, 0.55))));
  const backdropMaterial = new MeshBasicNodeMaterial();
  backdropMaterial.colorNode = mix(
    uBackground,
    mix(backdropBase, uBackground, floorFog),
    mix(float(0.55), float(1), vignette)
  );
  backdropMaterial.depthWrite = false;
  let backdropGeometry = new PlaneGeometry(1, 1, 24, 1);
  const backdrop = new Mesh(backdropGeometry, backdropMaterial);
  backdrop.position.set(0, 0, BACKDROP_Z);
  backdrop.renderOrder = 0;
  root.add(backdrop);
  let backdropAspect = 1;
  let backdropPlaneAspect = 1;
  let backdropFocal = { x: 0.5, y: 0.5 };
  const fitBackdrop = () => {
    const scale = coverScale(backdropAspect, backdropPlaneAspect, uBackdropScale.value);
    uBackdropOffset.value.set(
      (backdropFocal.x - 0.5) * (1 - scale.x),
      (0.5 - backdropFocal.y) * (1 - scale.y)
    );
  };

  // -- 2. God ray ----------------------------------------------------------
  const rayUv = uv();
  const across = abs(rayUv.x.sub(0.5)).mul(2);
  const streaks = sin(rayUv.x.mul(37).add(rayUv.y.mul(4)))
    .mul(0.25)
    .add(0.75);
  const rayMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  rayMaterial.colorNode = vec4(
    mix(uSky, uPrimary, 0.35)
      .mul(pow(float(1).sub(across), 2.2))
      .mul(smoothstep(0, 0.9, rayUv.y))
      .mul(streaks)
      .mul(uBreath)
      .mul(mix(float(0.28), float(0.2), uNight)),
    1
  );
  const ray = new Mesh(new PlaneGeometry(3.6, 7.2), rayMaterial);
  ray.position.set(-0.55, 1.7, -0.9);
  ray.renderOrder = 1;
  root.add(ray);

  // -- 3. Contact shadow -----------------------------------------------------
  const shadowMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });
  const shadowDistance = length(uv().sub(0.5).mul(2));
  shadowMaterial.colorNode = vec4(
    uBackground.mul(0.25),
    pow(clamp(float(1).sub(shadowDistance), 0, 1), 1.6).mul(0.55)
  );
  const shadow = new Mesh(new PlaneGeometry(2.4, 0.8), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0, STAGE_FLOOR_Y + 0.005, 0.15);
  shadow.renderOrder = 2;
  root.add(shadow);

  // -- 4. Character billboard (or crystal) -------------------------------------
  const characterUv = vec2(uv().x, float(1).sub(uv().y));
  const characterSample = texture(blank, characterUv);
  const rimSample = texture(blank, characterUv.add(vec2(-0.012, 0.008)));
  const rim = clamp(characterSample.a.sub(rimSample.a), 0, 1);
  const characterMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    side: DoubleSide,
  });
  characterMaterial.colorNode = vec4(
    characterSample.rgb.mul(uLight).add(uPrimary.mul(rim).mul(1.4)),
    characterSample.a
  );
  characterMaterial.alphaTest = 0.12;
  const character = new Mesh(new PlaneGeometry(1, 1), characterMaterial);
  character.renderOrder = 3;
  root.add(character);

  const crystalFresnel = float(1).sub(abs(dot(normalView, positionViewDirection)));
  const crystalMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: true });
  crystalMaterial.colorNode = vec4(
    uPrimary
      .mul(float(0.3).add(crystalFresnel.mul(1.3)))
      .add(vec3(1).mul(pow(crystalFresnel, 3)).mul(0.6))
      .mul(uBreath),
    0.94
  );
  const crystal = new Mesh(new OctahedronGeometry(0.55, 0), crystalMaterial);
  crystal.scale.set(1, 1.75, 1);
  crystal.position.set(0, 0.35, 0);
  crystal.renderOrder = 3;
  root.add(crystal);

  // -- 5. Holo-cards -------------------------------------------------------
  const panelGeometry = new PlaneGeometry(STAGE_PANEL_WIDTH, STAGE_PANEL_HEIGHT);
  const panelTone = new InstancedBufferAttribute(new Float32Array(STAGE_PANEL_CAPACITY * 3), 3);
  // glow, dim, selected, working
  const panelState = new InstancedBufferAttribute(new Float32Array(STAGE_PANEL_CAPACITY * 4), 4);
  panelTone.setUsage(DynamicDrawUsage);
  panelState.setUsage(DynamicDrawUsage);
  panelGeometry.setAttribute('aTone', panelTone);
  panelGeometry.setAttribute('aState', panelState);
  const tone = attribute('aTone', 'vec3');
  const state = attribute('aState', 'vec4');
  // The back face mirrors its UVs, so a card at rest after a half turn looks
  // exactly like one that never turned.
  const cardUv = select(frontFacing, uv(), vec2(float(1).sub(uv().x), uv().y));
  const half = vec2(STAGE_PANEL_WIDTH / 2, STAGE_PANEL_HEIGHT / 2);
  const local = cardUv.sub(0.5).mul(half.mul(2));
  const corner = 0.07;
  const q = abs(local).sub(half).add(corner);
  const edgeDistance = length(max(q, 0))
    .add(TSL.min(max(q.x, q.y), 0))
    .sub(corner);
  const inside = smoothstep(0.004, -0.004, edgeDistance);
  const edge = float(1).sub(smoothstep(0, 0.04, edgeDistance.negate()));
  const fresnel = float(1).sub(abs(dot(normalView, positionViewDirection)));
  const selected = state.z;
  const dim = state.y;
  const pulse = select(
    state.w.greaterThan(0.5),
    sin(uTime.mul((2 * Math.PI) / 1.6))
      .mul(0.5)
      .add(0.5)
      .mul(uPulse)
      .mul(0.8)
      .add(0.6),
    float(1)
  );
  const glow = state.x.mul(uBreath).mul(pulse);
  const band = fract(
    cardUv.x
      .mul(0.8)
      .add(cardUv.y.mul(0.45))
      .add(uTilt.x.mul(0.6))
      .add(uTilt.y.mul(0.3))
      .add(uTime.mul(0.04))
  );
  const foil = smoothstep(0.09, 0, abs(band.sub(0.5)))
    .mul(uShimmer)
    .mul(0.32);
  const foilColor = mix(uPrimary, vec3(0.75, 0.95, 1), cardUv.y);
  const scan = step(0.5, fract(cardUv.y.mul(56))).mul(0.06);
  const under = exp(cardUv.y.mul(-6)).mul(glow);
  const rimLight = uPrimary
    .mul(edge.mul(0.9).add(fresnel.mul(0.7)))
    .mul(selected.mul(0.7).add(0.5));
  const lit = float(1).sub(dim.mul(0.6));
  const panelColor = uSurface
    .mul(lit)
    .add(rimLight.mul(lit))
    .add(foilColor.mul(foil).mul(lit))
    .add(tone.mul(under).mul(0.85))
    .mul(float(1).sub(scan));
  const panelAlpha = clamp(
    uGlass
      .mul(float(1).sub(dim.mul(0.35)))
      .add(edge.mul(0.55))
      .add(under.mul(0.35))
      .add(foil.mul(0.4)),
    0,
    1
  ).mul(inside);
  const panelMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  panelMaterial.colorNode = vec4(panelColor, panelAlpha);
  panelMaterial.alphaTest = 0.01;
  const panels = new InstancedMesh(panelGeometry, panelMaterial, STAGE_PANEL_CAPACITY);
  panels.instanceMatrix.setUsage(DynamicDrawUsage);
  panels.frustumCulled = false;
  panels.count = 0;
  panels.renderOrder = 4;
  root.add(panels);

  // -- 6. Halos and dust ----------------------------------------------------
  const fxGeometry = new PlaneGeometry(1, 1);
  // rgb + strength
  const fxColor = new InstancedBufferAttribute(new Float32Array(FX_CAPACITY * 4), 4);
  // kind (0 halo, 1 dust), seed
  const fxMeta = new InstancedBufferAttribute(new Float32Array(FX_CAPACITY * 2), 2);
  fxColor.setUsage(DynamicDrawUsage);
  fxGeometry.setAttribute('aColor', fxColor);
  fxGeometry.setAttribute('aMeta', fxMeta);
  const fxTint = attribute('aColor', 'vec4');
  const fxInfo = attribute('aMeta', 'vec2');
  const dust = fxInfo.x;
  const seed = fxInfo.y;
  const drift = vec3(
    sin(uTime.mul(0.17).add(seed.mul(43))).mul(0.22),
    sin(uTime.mul(0.11).add(seed.mul(71))).mul(0.3),
    0
  ).mul(dust);
  const radius = length(uv().sub(0.5).mul(2));
  const haloFalloff = exp(radius.mul(radius).mul(-3.2)).mul(
    float(1).sub(smoothstep(0.75, 1, radius))
  );
  const dustFalloff = pow(clamp(float(1).sub(radius), 0, 1), 2.5);
  const twinkle = sin(uTime.mul(0.9).add(seed.mul(97)))
    .mul(0.3)
    .add(0.7);
  const fxMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  fxMaterial.positionNode = positionLocal.add(drift);
  fxMaterial.colorNode = vec4(
    fxTint.rgb.mul(fxTint.a).mul(mix(haloFalloff, dustFalloff.mul(twinkle), dust)),
    1
  );
  const fx = new InstancedMesh(fxGeometry, fxMaterial, FX_CAPACITY);
  fx.instanceMatrix.setUsage(DynamicDrawUsage);
  fx.frustumCulled = false;
  fx.count = 0;
  fx.renderOrder = 5;
  root.add(fx);

  // Dust is placed once: a deterministic scatter in the light, in front of the backdrop.
  const dustMatrices: Matrix4[] = [];
  const dustSeeds: number[] = [];
  {
    let s = 7;
    const random = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const size = 0.025 + random() * 0.05;
      dustMatrices.push(
        new Matrix4().compose(
          new Vector3(-2.6 + random() * 5.2, -1.2 + random() * 4, -1.8 + random() * 3.6),
          new Quaternion(),
          new Vector3(size, size, size)
        )
      );
      dustSeeds.push(random());
    }
  }
  const dustColors: Color[] = [new Color(), new Color()];

  // -- Updates ---------------------------------------------------------------
  const toneColors = {
    online: new Color(),
    offline: new Color(),
    unknown: new Color(),
    warning: new Color(),
  };
  const warningColor = new Color();
  const scratch = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  let characterAspect = 0.6;

  const placeCharacter = (yaw: number) => {
    const height = STAGE_CHARACTER_HEIGHT;
    character.scale.set(height * characterAspect, height, 1);
    character.position.set(0, STAGE_FLOOR_Y + height / 2, 0);
    character.rotation.y = yaw;
    shadow.scale.set(Math.min(1.4, Math.max(0.6, characterAspect * 1.4)), 1, 1);
  };
  placeCharacter(0);
  const showCharacter = (art: boolean) => {
    character.visible = art;
    crystal.visible = !art;
  };
  showCharacter(false);

  let haloCount = 0;
  const pushHalo = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    color: Color,
    strength: number,
    kind = 0,
    seedValue = 0
  ) => {
    if (haloCount >= FX_CAPACITY) return;
    position.set(x, y, z);
    scale.set(width, height, 1);
    rotation.identity();
    fx.setMatrixAt(haloCount, scratch.compose(position, rotation, scale));
    fxColor.setXYZW(haloCount, color.r, color.g, color.b, strength);
    fxMeta.setXY(haloCount, kind, seedValue);
    haloCount += 1;
  };

  return {
    root,
    setTheme({ colors, mode, surfaceOpacity }) {
      uBackground.value.set(colors.background);
      uSurface.value.set(colors.surface);
      uPrimary.value.set(colors.primary);
      const night = mode === 'dark';
      uNight.value = night ? 1 : 0;
      // Day: a soft warm key from above-left. Night: cool moonlight, warm practical from the art.
      uSky.value
        .set(colors.background)
        .lerp(night ? new Color('#7f9cff') : new Color('#ffffff'), night ? 0.22 : 0.45);
      uLight.value
        .set(night ? '#c9d4ff' : '#fff6ea')
        .lerp(new Color('#ffffff'), night ? 0.35 : 0.5);
      // Glass reads at the theme's surface opacity, never fully clear or fully solid.
      uGlass.value = 0.22 + Math.min(1, Math.max(0, surfaceOpacity)) * 0.5;
      ray.position.x = night ? 0.6 : -0.55;
      ray.rotation.z = night ? 0.28 : -0.32;
      toneColors.online.set(colors.success);
      toneColors.offline.set(colors.muted);
      toneColors.unknown.set(colors.muted);
      toneColors.warning.set(colors.warning);
      warningColor.set(colors.warning);
      dustColors[0]!.set(colors.primary);
      dustColors[1]!.copy(uSky.value).lerp(new Color('#ffffff'), 0.5);
    },
    setBackdrop(source) {
      backdropSample.value = source?.texture ?? blank;
      uHasBackdrop.value = source ? 1 : 0;
      backdropAspect = source?.aspect ?? 1;
      backdropFocal = source?.focal ?? { x: 0.5, y: 0.5 };
      fitBackdrop();
    },
    setCharacter(source) {
      characterSample.value = source?.texture ?? blank;
      rimSample.value = source?.texture ?? blank;
      characterAspect = source?.aspect ?? 0.6;
      showCharacter(Boolean(source));
      placeCharacter(character.rotation.y);
    },
    setViewport(aspect, fovDegrees, cameraDistance) {
      const distance = cameraDistance - BACKDROP_Z;
      // A little past the frame on every side, for the parallax and the pitch.
      const height = 2 * distance * Math.tan((fovDegrees * Math.PI) / 360) * 1.22;
      const width = height * Math.max(0.3, aspect) * 1.12;
      backdropGeometry.dispose();
      backdropGeometry = new PlaneGeometry(width, height, 24, 1);
      // A cyclorama: the edges curve towards the camera over ~20 degrees.
      const radius = width / 2 / Math.sin(BACKDROP_CURVE / 2);
      const positions = backdropGeometry.attributes.position!;
      for (let index = 0; index < positions.count; index += 1) {
        const x = positions.getX(index);
        const angle = (x / (width / 2)) * (BACKDROP_CURVE / 2);
        positions.setZ(index, radius * (1 - Math.cos(angle)));
      }
      positions.needsUpdate = true;
      backdrop.geometry = backdropGeometry;
      backdropPlaneAspect = width / height;
      fitBackdrop();
    },
    update(frame) {
      uTime.value = frame.timeS;
      uBreath.value = frame.breath;
      uTilt.value.set(frame.tilt[0], frame.tilt[1]);
      uShimmer.value = frame.shimmer ? 1 : 0;
      uPulse.value = frame.pulse ? 1 : 0;
      placeCharacter(frame.lookYaw);

      haloCount = 0;
      let drawn = 0;
      const count = Math.min(frame.poses.length, STAGE_PANEL_CAPACITY);
      for (let index = 0; index < count; index += 1) {
        const pose = frame.poses[index]!;
        const look = frame.looks[index];
        if (!look || pose.presence <= 0.01) continue;
        const size = pose.scale * pose.presence;
        position.set(pose.position[0], pose.position[1], pose.position[2]);
        rotation.setFromAxisAngle(yAxis, pose.rotationY);
        scale.set(size, size, size);
        panels.setMatrixAt(drawn, scratch.compose(position, rotation, scale));
        const color = toneColors[look.tone];
        panelTone.setXYZ(drawn, color.r, color.g, color.b);
        const isSelected = index === frame.selected;
        const offline = look.tone === 'offline' || look.tone === 'unknown';
        const glow = look.placeholder
          ? 0
          : (offline ? 0 : isSelected ? 1.1 * frame.selectionGlow : 0.75) * (1 - pose.dim * 0.5);
        panelState.setXYZW(
          drawn,
          glow,
          // An offline card sits at 0.4 emissive.
          Math.max(pose.dim, offline ? 0.6 : 0),
          isSelected ? 1 : 0,
          look.working && frame.pulse ? 1 : 0
        );
        drawn += 1;
        if (glow > 0) {
          // The underglow's bloom: a wide, low halo under the card.
          pushHalo(
            pose.position[0],
            pose.position[1] - STAGE_PANEL_HEIGHT * 0.5 * size,
            pose.position[2] + 0.02,
            STAGE_PANEL_WIDTH * 1.5 * size,
            0.55 * size,
            color,
            glow * 0.35 * frame.breath
          );
        }
        if (look.attention) {
          // The attention beacon: a static warning light above the card.
          pushHalo(
            pose.position[0],
            pose.position[1] + STAGE_PANEL_HEIGHT * 0.5 * size + 0.22,
            pose.position[2] + 0.03,
            0.5 * size,
            0.5 * size,
            warningColor,
            0.9
          );
        }
      }
      panels.count = drawn;
      panels.instanceMatrix.needsUpdate = true;
      panelTone.needsUpdate = true;
      panelState.needsUpdate = true;
      // The art's (or crystal's) own glow at its heart.
      pushHalo(0, 0.6, -0.2, 2.6, 2.6, dustColors[0]!, 0.12 * frame.breath);
      if (frame.particles) {
        for (let index = 0; index < PARTICLE_COUNT && haloCount < FX_CAPACITY; index += 1) {
          fx.setMatrixAt(haloCount, dustMatrices[index]!);
          const color = dustColors[index % 2]!;
          fxColor.setXYZW(haloCount, color.r, color.g, color.b, 0.75);
          fxMeta.setXY(haloCount, 1, dustSeeds[index]!);
          haloCount += 1;
        }
      }
      fx.count = haloCount;
      fx.instanceMatrix.needsUpdate = true;
      fxColor.needsUpdate = true;
      fxMeta.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [backdrop, ray, shadow, character, crystal, panels, fx]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      blank.dispose();
    },
  };
}
