/**
 * The Stage's world (design §13), built imperatively and handed to
 * react-three-fiber as one `<primitive>`: the theme's character on a glowing
 * pedestal at the centre, a glass screen per computer on a ring around her,
 * a glossy floor with a grid in the theme colour, the wallpaper as the far
 * sky, all lit by an environment painted from the palette.
 *
 * It is a port of the WebGL sketch to `three/webgpu` node materials, folded
 * into six draw calls (§11.7: <= 6 draws, <= 8k triangles):
 *   1. sky       -- gradient dome with the wallpaper mapped onto its far arc
 *   2. floor     -- glossy metal disc with the additive grid as its emission
 *   3. pedestal  -- metal cylinders and the glowing torus, one merged mesh
 *   4. host      -- the `home.artwork` cutout (or the crystal), Y-billboard
 *   5. screens   -- glass slab + face + edge + stem for every computer, one
 *                   instanced physical draw; faces come from one atlas
 *   6. light fx  -- glows, floor status rings, the beam and its head, and the
 *                   sparks: one instanced additive draw, no post-processing
 * Triangles: sky ~580, floor 64, pedestal ~1.3k, host 2-8, screens ~360 x <= 8,
 * fx 2 x <= 260: about 5.4k at the most.
 *
 * Where the sketch used something the WebGPU renderer handles differently,
 * the closest node equivalent is used: ShaderMaterials became TSL node
 * materials, Sprites became camera-facing instanced quads, Points became
 * instanced quads (WebGPU points are one pixel), and the PMREM environment is
 * the renderer's own (`scene.environment` is prefiltered by its PMREM node).
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  EquirectangularReflectionMapping,
  ExtrudeGeometry,
  FrontSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MeshPhysicalNodeMaterial,
  MeshStandardNodeMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Quaternion,
  RGBAFormat,
  Scene,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Camera,
  type Texture,
  type WebGPURenderer,
  TSL,
} from 'three/webgpu';

import {
  STAGE_HOST_CHEST,
  STAGE_HOST_HEIGHT,
  STAGE_MAX_SCREENS,
  STAGE_PEDESTAL,
  STAGE_SCREEN_HEIGHT,
  STAGE_SCREEN_WIDTH,
  type StageVec3,
} from '@/lib/home-stage-geometry';

const {
  abs,
  atan,
  attribute,
  clamp,
  dot,
  exp,
  float,
  fract,
  length,
  max,
  mix,
  normalGeometry,
  normalView,
  positionGeometry,
  positionLocal,
  positionViewDirection,
  positionWorld,
  pow,
  select,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} = TSL;

export const STAGE_DRAW_CALLS = 6;
/** Faces in the atlas: two columns of `STAGE_MAX_SCREENS / 2` rows. */
export const STAGE_FACE_COLUMNS = 2;
export const STAGE_FACE_ROWS = STAGE_MAX_SCREENS / STAGE_FACE_COLUMNS;
const SPARK_COUNT = 220;
/** Per screen: glow, ring; plus pedestal glow, host glow, beam, beam head. */
const FX_CAPACITY = STAGE_MAX_SCREENS * 2 + 4 + SPARK_COUNT;

export type StageSceneColors = {
  background: string;
  surface: string;
  primary: string;
  success: string;
  warning: string;
  muted: string;
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

/**
 * The theme's environment, painted like the sketch's equirect: the ground
 * colour with a primary horizon band and three soft light spots, bright from
 * above in the light variant and a night sky in the dark one.
 */
function paintEnvironment(colors: StageSceneColors, light: boolean): DataTexture {
  const width = 256;
  const height = 128;
  const pixels = new Uint8Array(width * height * 4);
  const top = new Color(light ? '#ffffff' : '#05080b');
  const bottom = new Color(light ? '#d8d2c6' : '#020304');
  const ground = new Color(colors.background);
  const band = new Color(colors.primary);
  const stops: [number, Color][] = [
    [0, top],
    [0.48, ground],
    [0.52, band],
    [0.6, ground],
    [1, bottom],
  ];
  const spots = [
    [45, 37, 30],
    [140, 27, 40],
    [220, 42, 22],
  ];
  const color = new Color();
  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    let index = 0;
    while (index < stops.length - 2 && v > stops[index + 1]![0]) index += 1;
    const [a, from] = stops[index]!;
    const [b, to] = stops[index + 1]!;
    color.copy(from).lerp(to, Math.min(1, Math.max(0, (v - a) / Math.max(1e-6, b - a))));
    for (let x = 0; x < width; x += 1) {
      let glow = 0;
      for (const [sx, sy, r] of spots) {
        const d = Math.hypot(x - sx!, y - sy!) / r!;
        if (d < 1) glow += 0.9 * (1 - d);
      }
      const offset = (y * width + x) * 4;
      const mixAmount = Math.min(1, glow);
      pixels[offset] = Math.round((color.r + (1 - color.r) * mixAmount) * 255);
      pixels[offset + 1] = Math.round((color.g + (1 - color.g) * mixAmount) * 255);
      pixels[offset + 2] = Math.round((color.b + (1 - color.b) * mixAmount) * 255);
      pixels[offset + 3] = 255;
    }
  }
  // The colours above are already in sRGB terms, as the canvas sketch's were.
  const env = new DataTexture(pixels, width, height, RGBAFormat);
  env.colorSpace = SRGBColorSpace;
  env.mapping = EquirectangularReflectionMapping;
  env.magFilter = LinearFilter;
  env.minFilter = LinearFilter;
  env.needsUpdate = true;
  return env;
}

function roundedShape(width: number, height: number, radius: number) {
  const shape = new Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.quadraticCurveTo(w, -h, w, -h + radius);
  shape.lineTo(w, h - radius);
  shape.quadraticCurveTo(w, h, w - radius, h);
  shape.lineTo(-w + radius, h);
  shape.quadraticCurveTo(-w, h, -w, h - radius);
  shape.lineTo(-w, -h + radius);
  shape.quadraticCurveTo(-w, -h, -w + radius, -h);
  return shape;
}

/** Merge indexed geometries (position, normal, uv) and tag each part with a float attribute. */
function mergeParts(parts: { geometry: BufferGeometry; tag: number }[], tagName: string) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const tags: number[] = [];
  const indices: number[] = [];
  for (const { geometry: source, tag } of parts) {
    const geometry = source.index ? source : source.toNonIndexed();
    const base = positions.length / 3;
    const position = geometry.getAttribute('position')!;
    const normal = geometry.getAttribute('normal')!;
    const uvAttribute = geometry.getAttribute('uv');
    for (let index = 0; index < position.count; index += 1) {
      positions.push(position.getX(index), position.getY(index), position.getZ(index));
      normals.push(normal.getX(index), normal.getY(index), normal.getZ(index));
      uvs.push(
        uvAttribute ? uvAttribute.getX(index) : 0,
        uvAttribute ? uvAttribute.getY(index) : 0
      );
      tags.push(tag);
    }
    if (geometry.index) {
      for (let index = 0; index < geometry.index.count; index += 1)
        indices.push(base + geometry.index.getX(index));
    } else {
      for (let index = 0; index < position.count; index += 1) indices.push(base + index);
    }
    source.dispose();
    if (geometry !== source) geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  merged.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  merged.setAttribute(tagName, new BufferAttribute(new Float32Array(tags), 1));
  merged.setIndex(indices);
  return merged;
}

export function createStageScene(): StageSceneHandle {
  const root = new Group();
  const blank = blankTexture();
  let environment: DataTexture | null = null;

  // -- Shared uniforms --------------------------------------------------------
  const uPrimary = uniform(new Color('#9fe4ce'));
  const uBackground = uniform(new Color('#151c22'));
  const uTop = uniform(new Color('#0a0e11'));
  const uHorizon = uniform(new Color('#2a3a3a'));
  const uTime = uniform(0);
  const uRise = uniform(0);
  const uBurstRise = uniform(0);
  const uBurst = uniform(0);
  const uPulse = uniform(1);

  // -- Lights (no draw calls) ---------------------------------------------------
  const hemisphere = new HemisphereLight(0xffffff, 0x000000, 0.5);
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(3, 6, 5);
  root.add(hemisphere, key);

  // -- 1. Sky: the dome and, on its far arc, the wallpaper --------------------
  const uSkyScale = uniform(new Vector2(1, 1));
  const uSkyOffset = uniform(new Vector2(0, 0));
  const uHasSky = uniform(0);
  const skyDirection = positionWorld.normalize();
  const height = skyDirection.y;
  const dome = mix(uHorizon, uTop, smoothstep(-0.02, 0.5, height)).add(
    uHorizon.mul(0.6).mul(exp(abs(height).mul(-20)))
  );
  // The wallpaper hangs on a far cylinder behind the stage: an arc of about
  // 63 degrees centred straight ahead, rising from below the horizon.
  const SKY_ARC = 1.1;
  const theta = atan(skyDirection.x, skyDirection.z.negate());
  const flat = length(vec2(positionWorld.x, positionWorld.z)).max(0.001);
  const cylinderY = positionWorld.y.mul(40).div(flat);
  const skyWindow = vec2(float(0.5).sub(theta.div(SKY_ARC)), cylinderY.add(4).div(26));
  const skyUv = skyWindow.sub(0.5).mul(uSkyScale).add(0.5).add(uSkyOffset);
  const skySample = texture(blank, vec2(skyUv.x, float(1).sub(skyUv.y)));
  const inWindow = smoothstep(0, 0.12, skyWindow.x)
    .mul(smoothstep(1, 0.88, skyWindow.x))
    .mul(smoothstep(0, 0.1, skyWindow.y))
    .mul(smoothstep(1, 0.92, skyWindow.y));
  const skyMaterial = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  skyMaterial.colorNode = mix(
    dome,
    skySample.rgb.mul(1.4),
    inWindow.mul(skySample.a).mul(0.5).mul(uHasSky)
  );
  skyMaterial.toneMapped = false;
  const sky = new Mesh(new SphereGeometry(90, 24, 12), skyMaterial);
  sky.renderOrder = -2;
  root.add(sky);
  let skyAspect = 1;
  let skyFocal = { x: 0.5, y: 0.5 };
  const fitSky = () => {
    // Cover the window (about 44 x 26 units) with the picture, at its focal point.
    const windowAspect = (SKY_ARC * 40) / 26;
    if (skyAspect > windowAspect) uSkyScale.value.set(windowAspect / skyAspect, 1);
    else uSkyScale.value.set(1, skyAspect / windowAspect);
    uSkyOffset.value.set(
      (skyFocal.x - 0.5) * (1 - uSkyScale.value.x),
      (0.5 - skyFocal.y) * (1 - uSkyScale.value.y)
    );
  };

  // -- 2. Floor and grid --------------------------------------------------------
  const floorMaterial = new MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.7 });
  floorMaterial.envMapIntensity = 0.6;
  const gridPoint = vec2(positionWorld.x, positionWorld.z).mul(0.8);
  const gridLines = max(
    smoothstep(0.47, 0.5, abs(fract(gridPoint.x).sub(0.5))),
    smoothstep(0.47, 0.5, abs(fract(gridPoint.y).sub(0.5)))
  );
  const fromPedestal = length(
    vec2(positionWorld.x.sub(STAGE_PEDESTAL[0]), positionWorld.z.sub(STAGE_PEDESTAL[2]))
  );
  const gridFade = smoothstep(18, 2.5, fromPedestal).mul(smoothstep(1.4, 2.6, fromPedestal));
  const gridWave = sin(uTime.mul(0.9).sub(fromPedestal.mul(0.9)))
    .mul(0.5)
    .add(0.5)
    .mul(0.45)
    .add(0.55);
  // Night: the grid glows (additive emission). Day: light cannot add to a
  // bright floor, so the lines are inked into its colour instead.
  const uFloor = uniform(new Color('#0b0f12'));
  const uDay = uniform(0);
  const grid = gridLines.mul(gridFade).mul(gridWave);
  floorMaterial.colorNode = mix(uFloor, uPrimary, grid.mul(uDay).mul(0.7));
  floorMaterial.emissiveNode = uPrimary
    .mul(grid)
    .mul(0.55)
    .mul(float(1).sub(uDay.mul(0.7)));
  const floor = new Mesh(new CircleGeometry(30, 64), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  root.add(floor);

  // -- 3. Pedestal --------------------------------------------------------------
  const base = new CylinderGeometry(1.05, 1.18, 0.2, 48);
  base.translate(0, 0.11, 0);
  const top = new CylinderGeometry(0.92, 0.98, 0.08, 48);
  top.translate(0, 0.26, 0);
  const torus = new TorusGeometry(1, 0.02, 8, 72);
  torus.rotateX(Math.PI / 2);
  torus.translate(0, 0.24, 0);
  const pedestalGeometry = mergeParts(
    [
      { geometry: base, tag: 0 },
      { geometry: top, tag: 0 },
      { geometry: torus, tag: 1 },
    ],
    'aGlow'
  );
  const glowPart = attribute('aGlow', 'float');
  const metalMaterial = new MeshStandardNodeMaterial({ roughness: 0.28, metalness: 1 });
  metalMaterial.emissiveNode = uPrimary.mul(glowPart).mul(2.2);
  const pedestal = new Group();
  pedestal.position.set(STAGE_PEDESTAL[0], STAGE_PEDESTAL[1], STAGE_PEDESTAL[2]);
  pedestal.add(new Mesh(pedestalGeometry, metalMaterial));
  const rim = new PointLight(0xffffff, 1.4, 6);
  rim.position.set(0, 2.6, -1.6);
  pedestal.add(rim);
  root.add(pedestal);

  // -- 4. Host billboard, or the crystal ------------------------------------
  const hostUv = vec2(uv().x, float(1).sub(uv().y));
  const hostSample = texture(blank, hostUv);
  const hostMaterial = new MeshBasicNodeMaterial({ side: DoubleSide });
  hostMaterial.colorNode = vec4(hostSample.rgb, hostSample.a);
  hostMaterial.alphaTest = 0.45;
  hostMaterial.toneMapped = false;
  const host = new Mesh(new PlaneGeometry(1, 1), hostMaterial);
  pedestal.add(host);
  const crystalFresnel = float(1).sub(abs(dot(normalView, positionViewDirection)));
  const crystalMaterial = new MeshBasicNodeMaterial({ transparent: true });
  crystalMaterial.colorNode = vec4(
    uPrimary
      .mul(float(0.35).add(crystalFresnel.mul(1.3)))
      .add(vec3(pow(crystalFresnel, 3).mul(0.6))),
    0.94
  );
  crystalMaterial.toneMapped = false;
  const crystal = new Mesh(new OctahedronGeometry(0.55, 0), crystalMaterial);
  crystal.scale.set(1, 1.75, 1);
  crystal.position.set(0, 1.35, 0);
  pedestal.add(crystal);
  let hostAspect = 1.5;
  const placeHost = () => {
    let h = STAGE_HOST_HEIGHT;
    let w = h * hostAspect;
    // A wide picture keeps the sketch's 4-unit width and loses height instead.
    if (w > 4.2) {
      w = 4.2;
      h = w / hostAspect;
    }
    host.scale.set(w, h, 1);
    // The cut bottom edge sinks into the pedestal's top.
    host.position.set(0, 0.215 + h / 2, 0);
  };
  placeHost();
  host.visible = false;

  // -- 5. Screens: slab + face + edge + stem, one instanced draw ------------
  const slab = new ExtrudeGeometry(roundedShape(STAGE_SCREEN_WIDTH, STAGE_SCREEN_HEIGHT, 0.14), {
    depth: 0.06,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 2,
    curveSegments: 6,
  });
  slab.translate(0, 0, -0.03);
  const stem = new CylinderGeometry(0.02, 0.035, 0.9, 10, 1, true);
  stem.translate(0, -0.9, 0);
  const screenGeometry = mergeParts(
    [
      { geometry: slab, tag: 0 },
      { geometry: stem, tag: 1 },
    ],
    'aPart'
  );
  // faceSlot, faceOpacity, slabOpacity, edgeOpacity
  const screenLook = new InstancedBufferAttribute(new Float32Array(STAGE_MAX_SCREENS * 4), 4);
  screenLook.setUsage(DynamicDrawUsage);
  screenGeometry.setAttribute('aLook', screenLook);
  // edge colour
  const screenEdge = new InstancedBufferAttribute(new Float32Array(STAGE_MAX_SCREENS * 3), 3);
  screenEdge.setUsage(DynamicDrawUsage);
  screenGeometry.setAttribute('aEdge', screenEdge);
  const part = attribute('aPart', 'float');
  const look = attribute('aLook', 'vec4');
  const edgeColor = attribute('aEdge', 'vec3');
  const isStem = part.greaterThan(0.5);
  const onFace = normalGeometry.z.greaterThan(0.9).and(isStem.not());
  const onEdge = abs(normalGeometry.z).lessThan(0.9).and(isStem.not());
  const slot = look.x;
  const cell = vec2(slot.mod(STAGE_FACE_COLUMNS), slot.div(STAGE_FACE_COLUMNS).floor());
  const faceLocal = vec2(
    positionGeometry.x.div(1.82).add(0.5),
    float(0.5).sub(positionGeometry.y.div(1.14))
  );
  const faceUv = cell.add(clamp(faceLocal, 0, 1)).div(vec2(STAGE_FACE_COLUMNS, STAGE_FACE_ROWS));
  const faceSample = texture(blank, faceUv);
  const faceAlpha = select(
    onFace.and(slot.greaterThanEqual(0)),
    faceSample.a.mul(look.y),
    float(0)
  );
  // Linear RGB as vectors: a colour uniform does not mix with the face's vec3 in the typings.
  const uSlabTint = uniform(new Vector3(0.004, 0.005, 0.007));
  const uMetal = uniform(new Vector3(0.26, 0.32, 0.37));
  const screenMaterial = new MeshPhysicalNodeMaterial({
    roughness: 0.18,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
    transparent: true,
  });
  screenMaterial.envMapIntensity = 0.55;
  // The face is printed into the glass's colour (dark ink reads on a light
  // slab) and, at night, also glows like the sketch's unlit face layer.
  screenMaterial.colorNode = select(isStem, uMetal, mix(uSlabTint, faceSample.rgb, faceAlpha));
  screenMaterial.metalnessNode = select(isStem, float(1), float(0.1));
  screenMaterial.roughnessNode = select(isStem, float(0.28), float(0.18));
  screenMaterial.emissiveNode = faceSample.rgb
    .mul(faceAlpha)
    .mul(float(1).sub(uDay.mul(0.85)))
    .add(select(onEdge, edgeColor.mul(look.w).mul(1.6), vec3(0)));
  screenMaterial.opacityNode = select(
    isStem,
    float(1),
    max(look.z, max(faceAlpha, select(onEdge, look.w, float(0))))
  );
  const screens = new InstancedMesh(screenGeometry, screenMaterial, STAGE_MAX_SCREENS);
  screens.instanceMatrix.setUsage(DynamicDrawUsage);
  screens.frustumCulled = false;
  screens.count = 0;
  root.add(screens);

  // -- 6. Light fx: glows, rings, beam, sparks --------------------------------
  const fxGeometry = new PlaneGeometry(1, 1);
  // rgb + strength
  const fxColor = new InstancedBufferAttribute(new Float32Array(FX_CAPACITY * 4), 4);
  // kind (0 glow, 1 spark, 2 ring, 3 beam), seed, base y, unused
  const fxMeta = new InstancedBufferAttribute(new Float32Array(FX_CAPACITY * 4), 4);
  fxColor.setUsage(DynamicDrawUsage);
  fxMeta.setUsage(DynamicDrawUsage);
  fxGeometry.setAttribute('aColor', fxColor);
  fxGeometry.setAttribute('aMeta', fxMeta);
  const fxTint = attribute('aColor', 'vec4');
  const fxInfo = attribute('aMeta', 'vec4');
  const kind = fxInfo.x;
  const seed = fxInfo.y;
  const isSpark = abs(kind.sub(1)).lessThan(0.5);
  // Sparks rise and wrap at 7 units, faster and further in a completion burst.
  const sparkY = fract(
    fxInfo.z
      .add(uRise.mul(0.1))
      .add(uBurstRise.mul(seed.div(6)))
      .div(7)
  ).mul(7);
  const sparkLift = select(isSpark, sparkY.sub(fxInfo.z), float(0));
  const sparkSway = select(isSpark, sin(uTime.mul(0.5).add(seed)).mul(0.12), float(0));
  const sparkHeight = varying(select(isSpark, sparkY, float(3.5)));
  const fxMaterial = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    // Every fx quad is turned to face the camera: one pass, not a double-sided two.
    side: FrontSide,
  });
  fxMaterial.positionNode = positionLocal.add(vec3(sparkSway, sparkLift, 0));
  const centred = uv().sub(0.5).mul(2);
  const radius = length(centred);
  const glow = clamp(float(1).sub(radius), 0, 1).pow(1.6);
  const ring = smoothstep(0.78, 0.86, radius).mul(smoothstep(1, 0.92, radius));
  const beamProfile = exp(centred.x.mul(centred.x).mul(-9));
  const sparkFade = smoothstep(0, 0.6, sparkHeight).mul(smoothstep(7, 6, sparkHeight));
  const shape = select(
    kind.lessThan(0.5),
    glow,
    select(
      kind.lessThan(1.5),
      glow.mul(sparkFade),
      select(kind.lessThan(2.5), ring.add(glow.mul(0.12)), beamProfile)
    )
  );
  fxMaterial.colorNode = vec4(fxTint.rgb.mul(fxTint.a).mul(shape), 1);
  fxMaterial.toneMapped = false;
  const fx = new InstancedMesh(fxGeometry, fxMaterial, FX_CAPACITY);
  fx.instanceMatrix.setUsage(DynamicDrawUsage);
  fx.frustumCulled = false;
  fx.count = 0;
  root.add(fx);

  // Sparks are scattered once, deterministically.
  const sparkBase: { x: number; y: number; z: number; seed: number }[] = [];
  {
    let s = 11;
    const random = () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
    for (let index = 0; index < SPARK_COUNT; index += 1)
      sparkBase.push({
        x: (random() - 0.5) * 16,
        y: random() * 7,
        z: (random() - 0.5) * 12,
        seed: random() * 6,
      });
  }

  // -- Per-frame state --------------------------------------------------------
  const colors = {
    primary: new Color(),
    success: new Color(),
    warning: new Color(),
    offline: new Color('#3b4550'),
  };
  const scratch = new Matrix4();
  const position = new Vector3();
  const scale = new Vector3();
  const rotation = new Quaternion();
  const flatRotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const yAxis = new Vector3(0, 1, 0);
  const from = new Vector3();
  const to = new Vector3();
  const axis = new Vector3();
  const side = new Vector3();
  const facing = new Vector3();
  const basis = new Matrix4();
  const cameraPosition = new Vector3();
  const order: number[] = [];

  let fxCount = 0;
  const pushFx = (
    kindValue: number,
    matrix: Matrix4,
    color: Color,
    strength: number,
    seedValue = 0,
    baseY = 0
  ) => {
    if (fxCount >= FX_CAPACITY || strength <= 0.001) return;
    fx.setMatrixAt(fxCount, matrix);
    fxColor.setXYZW(fxCount, color.r, color.g, color.b, strength);
    fxMeta.setXYZW(fxCount, kindValue, seedValue, baseY, 0);
    fxCount += 1;
  };
  const glowAt = (
    x: number,
    y: number,
    z: number,
    width: number,
    heightValue: number,
    camera: Camera,
    color: Color,
    strength: number
  ) => {
    position.set(x, y, z);
    scale.set(width, heightValue, 1);
    pushFx(0, scratch.compose(position, camera.quaternion, scale), color, strength);
  };

  return {
    root,
    setTheme({ colors: palette, mode }, scene, renderer) {
      const light = mode === 'light';
      const background = new Color(palette.background);
      uBackground.value.copy(background);
      uPrimary.value.set(palette.primary);
      uTop.value.copy(background).multiplyScalar(light ? 1 : 0.5);
      uHorizon.value.copy(background).lerp(uPrimary.value, 0.32);
      colors.primary.set(palette.primary);
      colors.success.set(palette.success);
      colors.warning.set(palette.warning);
      uFloor.value.copy(background).multiplyScalar(light ? 0.85 : 0.55);
      uDay.value = light ? 1 : 0;
      metalMaterial.color.set(light ? '#d9d4cb' : '#8c99a4');
      const metal = metalMaterial.color;
      uMetal.value.set(metal.r, metal.g, metal.b);
      const tint = new Color(light ? palette.surface : palette.background).multiplyScalar(
        light ? 1 : 0.6
      );
      uSlabTint.value.set(tint.r, tint.g, tint.b);
      key.color.set(light ? '#fff4e2' : '#cfe6ff');
      key.intensity = light ? 1.3 : 0.9;
      rim.color.copy(colors.primary);
      scene.background = background;
      scene.fog = new Fog(background, 10, 34);
      const next = paintEnvironment(palette, light);
      scene.environment = next;
      environment?.dispose();
      environment = next;
      if (renderer) {
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
      }
    },
    setBackdrop(source) {
      skySample.value = source?.texture ?? blank;
      uHasSky.value = source ? 1 : 0;
      skyAspect = source?.aspect ?? 1;
      skyFocal = source?.focal ?? { x: 0.5, y: 0.5 };
      fitSky();
    },
    setCharacter(source) {
      hostSample.value = source?.texture ?? blank;
      hostAspect = source?.aspect ?? 1.5;
      host.visible = Boolean(source);
      crystal.visible = !source;
      placeHost();
    },
    setFaces(atlas) {
      faceSample.value = atlas ?? blank;
    },
    update(frame) {
      const { camera } = frame;
      camera.getWorldPosition(cameraPosition);
      uTime.value = frame.timeS;
      uRise.value = frame.rise;
      uBurstRise.value = frame.burstRise;
      uBurst.value = frame.burst;
      uPulse.value = frame.pulse ? 1 : 0;

      // The host turns to the camera about her own axis.
      const hostYaw = Math.atan2(
        cameraPosition.x - STAGE_PEDESTAL[0],
        cameraPosition.z - STAGE_PEDESTAL[2]
      );
      host.rotation.y = hostYaw;
      crystal.rotation.y = hostYaw;

      fxCount = 0;
      // Screens back to front, so the glass blends over what is behind it.
      order.length = 0;
      for (let index = 0; index < frame.screens.length && index < STAGE_MAX_SCREENS; index += 1)
        order.push(index);
      order.sort((a, b) => frame.screens[b]!.depth - frame.screens[a]!.depth);
      const pulseNow = frame.pulse ? 0.5 + 0.5 * Math.sin(frame.timeS * 3.9) : 1;
      order.forEach((source, drawn) => {
        const screen = frame.screens[source]!;
        const [x, y, z] = screen.position;
        const offline = screen.look.tone === 'offline' || screen.look.tone === 'unknown';
        const working = screen.look.working && !offline;
        const pulse = working ? pulseNow : 1;
        position.set(x, y, z);
        rotation.setFromAxisAngle(yAxis, Math.atan2(cameraPosition.x - x, cameraPosition.z - z));
        scale.setScalar(screen.scale);
        screens.setMatrixAt(drawn, scratch.compose(position, rotation, scale));
        screenLook.setXYZW(
          drawn,
          screen.look.faceSlot,
          offline ? 0.45 : screen.front ? 1 : 0.7,
          screen.front ? 0.78 : 0.55,
          (offline ? 0.25 : screen.front ? 0.9 : 0.45) * (working ? 0.6 + 0.4 * pulse : 1)
        );
        const edge = offline ? colors.offline : colors.primary;
        screenEdge.setXYZ(drawn, edge.r, edge.g, edge.b);

        // The floor ring under the stem, and its glow.
        const status = offline
          ? colors.offline
          : screen.look.tone === 'warning' || screen.look.attention
            ? colors.warning
            : working
              ? colors.primary
              : colors.success;
        const ringStrength = offline ? 0.2 : 0.9 * pulse;
        const floorY = y - 0.94 * screen.scale;
        position.set(x, floorY + 0.01, z);
        scale.set(0.84 * screen.scale, 0.84 * screen.scale, 1);
        pushFx(2, scratch.compose(position, flatRotation, scale), status, ringStrength);
        glowAt(
          x,
          floorY + 0.04,
          z,
          1.6 * screen.scale,
          0.45 * screen.scale,
          camera,
          status,
          offline ? 0 : 0.55 * pulse
        );
      });
      screens.count = order.length;
      screens.instanceMatrix.needsUpdate = true;
      screenLook.needsUpdate = true;
      screenEdge.needsUpdate = true;

      // The pedestal's glow, and the host's heart when she is the crystal.
      glowAt(STAGE_PEDESTAL[0], 0.3, STAGE_PEDESTAL[2], 3.4, 1, camera, colors.primary, 0.55);
      if (crystal.visible)
        glowAt(STAGE_PEDESTAL[0], 1.35, STAGE_PEDESTAL[2], 2.4, 2.4, camera, colors.primary, 0.25);

      // The beam: from her chest to the screen the composer sends to.
      if (frame.beamTo) {
        from.set(STAGE_HOST_CHEST[0], STAGE_HOST_CHEST[1], STAGE_HOST_CHEST[2]);
        to.set(frame.beamTo[0], frame.beamTo[1], frame.beamTo[2]);
        axis.subVectors(to, from);
        const span = axis.length();
        if (span > 0.01) {
          axis.divideScalar(span);
          // A ribbon turned to face the camera around the beam's own axis.
          facing.subVectors(cameraPosition, from).normalize();
          side.crossVectors(axis, facing).normalize();
          facing.crossVectors(side, axis);
          basis.makeBasis(side, axis, facing);
          rotation.setFromRotationMatrix(basis);
          position.addVectors(from, to).multiplyScalar(0.5);
          scale.set(0.09, span, 1);
          pushFx(3, scratch.compose(position, rotation, scale), colors.primary, frame.beam * 0.9);
          const travel = (frame.timeS * 0.6) % 1;
          position.copy(from).lerp(to, travel);
          glowAt(
            position.x,
            position.y,
            position.z,
            0.35,
            0.35,
            camera,
            colors.primary,
            frame.beam
          );
        }
      }

      if (frame.sparks) {
        const size = 0.07 + frame.burst * 0.12;
        for (const spark of sparkBase) {
          position.set(spark.x, spark.y, spark.z);
          scale.set(size, size, 1);
          pushFx(
            1,
            scratch.compose(position, camera.quaternion, scale),
            colors.primary,
            0.9,
            spark.seed,
            spark.y
          );
        }
      }
      fx.count = fxCount;
      fx.instanceMatrix.needsUpdate = true;
      fxColor.needsUpdate = true;
      fxMeta.needsUpdate = true;
    },
    dispose() {
      for (const mesh of [sky, floor, host, crystal, screens, fx]) {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicNodeMaterial).dispose();
      }
      pedestalGeometry.dispose();
      metalMaterial.dispose();
      environment?.dispose();
      blank.dispose();
    },
  };
}
