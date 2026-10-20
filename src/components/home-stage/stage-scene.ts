import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  TSL,
  type Camera,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu';
import type { ThemeEffects } from '@/theme/schema';
import {
  STAGE_HOST_BASE_Y,
  STAGE_PEDESTAL,
  STAGE_MAX_SCREENS,
  stageHostSize,
  type StageVec3,
} from '@/lib/home-stage-geometry';
import { createCoreRenderer } from './model/core-renderer';
import { createStageAmbient } from './stage-ambient';
const { float, mix, smoothstep, texture, uniform, uv, vec2 } = TSL;
export const STAGE_DRAW_CALLS = 9;
export const STAGE_FACE_COLUMNS = 2;
export const STAGE_FACE_ROWS = STAGE_MAX_SCREENS / STAGE_FACE_COLUMNS;
export type StageSceneColors = {
  background: string;
  surface: string;
  text: string;
  primary: string;
  success: string;
  warning: string;
  muted: string;
  info: string;
};

export type StageTheme = {
  colors: StageSceneColors;
  mode: 'light' | 'dark';
};

export type StageTextureSource = {
  texture: Texture;
  aspect: number;
  kind?: 'cutout' | 'scene';
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

export type StageScreenFrame = {
  position: StageVec3;
  scale: number;
  front: boolean;
  look: StageScreenLook;
  /** Distance from the camera, for back-to-front order. */
  depth: number;
};

export type StageFrameInput = {
  camera: Camera;
  open: number;
  yaw: number;
  screens: readonly StageScreenFrame[];
  /** The chosen screen's centre, where the beam lands, or null. */
  beamTo: StageVec3 | null;
  /** 1 just after a selection, settling to 0.25. */
  beam: number;
  /** Seconds since the stage started; frozen under Reduce Motion. */
  timeS: number;
  /** 0..1, decaying after a task completes. */
  burst: number;
  /** Accumulated spark rise, and the burst's share of it. */
  rise: number;
  burstRise: number;
  sparks: boolean;
  pulse: boolean;
};

export type StageSceneHandle = {
  root: Group;
  /** Theme colours, the light/dark variant's lighting and the painted environment. */
  setTheme: (theme: StageTheme, scene: Scene, renderer: WebGPURenderer | null) => void;
  setBackdrop: (source: StageTextureSource | null) => void;
  setCharacter: (source: StageTextureSource | null) => void;
  setFaces: (atlas: Texture | null) => void;
  setAmbient: (
    effects: ThemeEffects | undefined,
    colors: StageSceneColors,
    calm: boolean,
    particles: boolean
  ) => void;
  ambientAnimated: () => boolean;
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

/** A theme environment and tactile device selectors; no session content lives in this scene. */
export function createStageScene(): StageSceneHandle {
  const root = new Group();
  const blank = blankTexture();
  const ground = uniform(new Color());
  const tint = uniform(new Color());
  const backgroundScale = uniform(new Vector2(1, 1));
  const backgroundOffset = uniform(new Vector2());
  const backgroundStrength = uniform(0);
  const image = texture(
    blank,
    TSL.screenUV.sub(0.5).mul(backgroundScale).add(0.5).add(backgroundOffset)
  );
  const height = TSL.screenUV.y;
  const wash = mix(tint, ground, smoothstep(0.15, 0.9, height));
  const skyMaterial = new MeshBasicNodeMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
  });
  skyMaterial.colorNode = mix(wash, image.rgb, image.a.mul(backgroundStrength));
  skyMaterial.toneMapped = false;
  const sky = new Mesh(new SphereGeometry(90, 12, 8), skyMaterial);
  sky.renderOrder = -2;
  root.add(sky);
  let backdrop: StageTextureSource | null = null;
  let scenic = false;

  const subjectSample = texture(blank, vec2(uv().x, float(1).sub(uv().y)));
  const subjectMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  subjectMaterial.colorNode = subjectSample.rgb;
  subjectMaterial.opacityNode = subjectSample.a;
  subjectMaterial.alphaTest = 0.02;
  subjectMaterial.toneMapped = false;
  const subject = new Mesh(new PlaneGeometry(1, 1), subjectMaterial);
  subject.visible = false;
  root.add(subject);

  const fill = new HemisphereLight(0xffffff, 0x101820, 0.85);
  const key = new DirectionalLight(0xcbdfff, 4.5);
  key.position.set(-3, 5, 7);
  const rim = new DirectionalLight(0xffc18e, 3.0);
  rim.position.set(4, 2, -2);
  root.add(fill, key, rim);

  const core = createCoreRenderer(STAGE_MAX_SCREENS);
  root.add(core.root);
  const ambient = createStageAmbient();
  root.add(ambient.mesh);
  return {
    root,
    setAmbient: ambient.configure,
    ambientAnimated: () => ambient.animated,
    setTheme({ colors, mode }, scene, renderer) {
      ground.value.set(colors.background);
      tint.value
        .set(colors.surface)
        .lerp(new Color(colors.primary), mode === 'light' ? 0.08 : 0.16);
      core.setTint(colors.primary);
      fill.color.set(colors.surface).lerp(new Color('#ffffff'), 0.7);
      fill.groundColor.set(colors.background);
      rim.color.set(0xffc18e);
      key.intensity = mode === 'light' ? 4.5 : 5.5;
      scene.background = new Color(colors.background);
      scene.fog = null;
      scene.environment = null;
      if (renderer) {
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1;
      }
    },
    setBackdrop(source) {
      backdrop = source;
      image.value = source?.texture ?? blank;
      backgroundStrength.value = source ? (scenic ? 1 : 0.75) : 0;
    },
    setCharacter(source) {
      scenic = source?.kind === 'scene';
      backgroundStrength.value = backdrop ? (scenic ? 1 : 0.75) : 0;
      subjectSample.value = source?.texture ?? blank;
      subject.visible = Boolean(source) && !scenic;
      const size = stageHostSize(source?.aspect ?? 1);
      subject.scale.set(size.width, size.height, 1);
      subject.position.set(
        STAGE_PEDESTAL[0],
        STAGE_HOST_BASE_Y + size.height / 2,
        STAGE_PEDESTAL[2]
      );
    },
    setFaces(atlas) {
      void atlas;
    },
    update(frame) {
      const aspect =
        frame.camera.projectionMatrix.elements[5]! / frame.camera.projectionMatrix.elements[0]!;
      const imageAspect = backdrop?.aspect ?? 1;
      backgroundScale.value
        .set(
          imageAspect > aspect ? aspect / imageAspect : 1,
          imageAspect > aspect ? 1 : imageAspect / aspect
        )
        .multiplyScalar(0.98);
      backgroundOffset.value.set(
        (backdrop?.focal?.x ?? 0.5) * (1 - backgroundScale.value.x) -
          (1 - backgroundScale.value.x) / 2,
        (backdrop?.focal?.y ?? 0.5) * (1 - backgroundScale.value.y) -
          (1 - backgroundScale.value.y) / 2
      );
      ambient.update(frame.timeS);
      subject.rotation.y = frame.camera.position.x * 0.03;
      core.update(frame.screens, frame.timeS, frame.open, frame.yaw);
    },
    dispose() {
      ambient.dispose();
      core.dispose();
      blank.dispose();
      for (const mesh of [sky, subject]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
    },
  };
}
