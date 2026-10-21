/**
 * The theme's ambient effect in the Stage's world: one instanced draw of at
 * most `STAGE_AMBIENT_CAPACITY` quads. `stageAmbient` (pure, tested) decides
 * the instances; they are uploaded once per effect, and every frame moves them
 * in the shader from a single time uniform -- nothing is written per frame.
 */
import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
  TSL,
  type Node,
} from 'three/webgpu';

import { STAGE_AMBIENT_CAPACITY, type StageAmbient } from '@/lib/home-stage-ambient';
import { STAGE_CAMERA_FOV } from '@/lib/home-stage-geometry';

const {
  abs,
  attribute,
  clamp,
  float,
  fract,
  length,
  max,
  min,
  positionGeometry,
  select,
  sin,
  smoothstep,
  sqrt,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} = TSL;

const TAU = Math.PI * 2;
const VIEW_SPAN_PER_DEPTH = 2 * Math.tan((STAGE_CAMERA_FOV * Math.PI) / 360);
const MOTION_CODE = { drift: 0, rain: 1, stars: 2, bloom: 3, still: 4 } as const;
/** Drawn after the haze, behind the hero: lights and patterns in the far world. */
export const STAGE_AMBIENT_BACK_ORDER = 1.5;
/** Drawn with the motes: among the depths of the hero, the frame and the panes. */
export const STAGE_AMBIENT_MID_ORDER = 4;

export type StageAmbientLayer = {
  mesh: InstancedMesh;
  /** Swap the effect (null hides it); uploads its instances once. */
  configure: (ambient: StageAmbient | null) => void;
  /** The effect's description, or null. */
  readonly current: StageAmbient | null;
  setAspect: (aspect: number) => void;
  /** The share of the effect's instances drawn, 0..1: fewer on a lower quality rung. */
  setShare: (share: number) => void;
  /** The ambient clock, in seconds; frozen by the caller under Reduce Motion. */
  setTime: (seconds: number) => void;
  dispose: () => void;
};

export function createStageAmbient(): StageAmbientLayer {
  const geometry = new PlaneGeometry(1, 1);
  const buffer = () => {
    const values = new InstancedBufferAttribute(new Float32Array(STAGE_AMBIENT_CAPACITY * 4), 4);
    return values;
  };
  const placeBuffer = buffer();
  const shapeBuffer = buffer();
  const motionBuffer = buffer();
  const orientBuffer = buffer();
  geometry.setAttribute('aAmbPlace', placeBuffer);
  geometry.setAttribute('aAmbShape', shapeBuffer);
  geometry.setAttribute('aAmbMotion', motionBuffer);
  geometry.setAttribute('aAmbOrient', orientBuffer);
  // x, y (0..1, y down), depth, colour index
  const place = attribute('aAmbPlace', 'vec4');
  // width, height (shares of the view's height), alpha, shape
  const shape = attribute('aAmbShape', 'vec4');
  // offset, rate, sway phase, sway (share of the view's width)
  const motion = attribute('aAmbMotion', 'vec4');
  // the direction a line points, on screen (y down)
  const orient = attribute('aAmbOrient', 'vec4');

  const uTime = uniform(0);
  const uCycles = uniform(0);
  const uMotion = uniform(0);
  const uDirection = uniform(new Vector2(0, 0));
  const uAspect = uniform(390 / 844);
  const uColors = [0, 1, 2, 3].map(() => uniform(new Color()));

  const phase = fract(motion.x.add(uTime.mul(uCycles).mul(motion.y)));
  const wave = sin(phase.mul(TAU).add(motion.z));
  const edge = (value: Node<'float'>) =>
    clamp(min(value.div(0.12), float(1).sub(value).div(0.12)), 0, 1);
  // Travelling motions: along the direction and wrapping; across it, a sway.
  const travelX = select(
    uDirection.x.equal(0),
    place.x.add(wave.mul(motion.w)),
    fract(place.x.add(uDirection.x.mul(phase)))
  );
  const travelY = select(
    uDirection.y.equal(0),
    place.y.add(wave.mul(motion.w).mul(uAspect)),
    select(uDirection.y.greaterThan(0), phase, float(1).sub(phase))
  );
  const travelling = uMotion.lessThan(2);
  const screenX = select(travelling, travelX, place.x);
  const screenY = select(travelling, travelY, place.y);
  const travelFade = edge(phase).mul(select(uDirection.x.equal(0), float(1), edge(travelX)));
  const twinkle = float(0.2).add(sin(phase.mul(TAU)).add(1).mul(0.4));
  const fade = select(travelling, travelFade, select(uMotion.equal(2), twinkle, float(1)));
  const breathe = select(uMotion.equal(3), sin(phase.mul(TAU)).mul(0.15).add(0.85), float(1));

  // The view at this instance's depth: positions fill it, sizes keep the 2D
  // layer's on-screen size, a little larger near and smaller far.
  const depth = place.z;
  const span = depth.mul(VIEW_SPAN_PER_DEPTH);
  const depthCue = select(
    uMotion.greaterThanEqual(3),
    float(1),
    clamp(sqrt(float(24).div(max(depth, 1))), 0.6, 1.6)
  );
  const width = shape.x.mul(span).mul(depthCue).mul(breathe);
  const height = shape.y.mul(span).mul(depthCue).mul(breathe);
  // A line points along `orient`, turned into world axes (y up).
  const pointX = orient.x;
  const pointY = orient.y.negate();
  const pointLength = max(length(vec2(pointX, pointY)), 0.0001);
  const alongX = pointX.div(pointLength);
  const alongY = pointY.div(pointLength);
  const localX = positionGeometry.x.mul(width);
  const localY = positionGeometry.y.mul(height);
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  material.toneMapped = false;
  material.fog = false;
  material.positionNode = vec3(
    screenX.sub(0.5).mul(span).mul(uAspect).add(localX.mul(alongY)).add(localY.mul(alongX)),
    float(0.5).sub(screenY).mul(span).sub(localX.mul(alongX)).add(localY.mul(alongY)),
    depth.negate()
  );
  const centre = length(uv().sub(0.5));
  const dot = float(1).sub(smoothstep(0.3, 0.5, centre));
  const line = float(1)
    .sub(smoothstep(0.2, 0.5, abs(uv().x.sub(0.5))))
    .mul(float(1).sub(smoothstep(0.4, 0.5, abs(uv().y.sub(0.5)))));
  const glow = float(1).sub(smoothstep(0.1, 0.5, centre));
  const silhouette = select(shape.w.lessThan(0.5), dot, select(shape.w.lessThan(1.5), line, glow));
  const colour = select(
    place.w.lessThan(0.5),
    uColors[0]!,
    select(
      place.w.lessThan(1.5),
      uColors[1]!,
      select(place.w.lessThan(2.5), uColors[2]!, uColors[3]!)
    )
  );
  material.colorNode = vec4(colour, silhouette.mul(shape.z).mul(fade));

  const mesh = new InstancedMesh(geometry, material, STAGE_AMBIENT_CAPACITY);
  const identity = new Matrix4();
  for (let index = 0; index < STAGE_AMBIENT_CAPACITY; index += 1) mesh.setMatrixAt(index, identity);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.count = 0;
  mesh.renderOrder = STAGE_AMBIENT_MID_ORDER;
  let current: StageAmbient | null = null;
  let configured = 0;
  let share = 1;
  // Particles are spread at random, so any prefix of them is an even thinning.
  // A composed effect (a bloom, traces) is drawn whole or not at all.
  const drawnCount = () =>
    current?.particles ? Math.max(1, Math.round(configured * share)) : configured;

  return {
    mesh,
    configure(ambient) {
      current = ambient;
      if (!ambient || ambient.instances.length === 0) {
        mesh.visible = false;
        mesh.count = 0;
        configured = 0;
        return;
      }
      const count = Math.min(STAGE_AMBIENT_CAPACITY, ambient.instances.length);
      for (let index = 0; index < count; index += 1) {
        const instance = ambient.instances[index]!;
        placeBuffer.setXYZW(index, instance.x, instance.y, instance.depth, instance.color);
        shapeBuffer.setXYZW(index, instance.width, instance.height, instance.alpha, instance.shape);
        motionBuffer.setXYZW(
          index,
          instance.offset,
          instance.rate,
          instance.swayPhase,
          instance.sway
        );
        orientBuffer.setXYZW(index, instance.orientX, instance.orientY, 0, 0);
      }
      for (const values of [placeBuffer, shapeBuffer, motionBuffer, orientBuffer])
        values.needsUpdate = true;
      uColors.forEach((colorUniform, index) =>
        colorUniform.value.set(ambient.colors[index % ambient.colors.length]!)
      );
      uCycles.value = ambient.cyclesPerSecond;
      uMotion.value = MOTION_CODE[ambient.motion];
      uDirection.value.set(ambient.direction.x, ambient.direction.y);
      configured = count;
      mesh.count = drawnCount();
      mesh.renderOrder =
        ambient.layer === 'back' ? STAGE_AMBIENT_BACK_ORDER : STAGE_AMBIENT_MID_ORDER;
      mesh.visible = true;
    },
    get current() {
      return current;
    },
    setShare(next) {
      share = next;
      if (configured > 0) mesh.count = drawnCount();
    },
    setAspect(aspect) {
      uAspect.value = aspect;
    },
    setTime(seconds) {
      uTime.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
