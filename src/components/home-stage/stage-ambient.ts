import {
  Color,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicNodeMaterial,
  PlaneGeometry,
  Vector2,
} from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { ThemeEffects } from '@/theme/schema';
import type { StageSceneColors } from './stage-scene';

const {
  attribute,
  float,
  fract,
  length,
  positionGeometry,
  select,
  sin,
  smoothstep,
  uniform,
  uv,
  vec3,
} = TSL;
const CAPACITY = 128;

/** One bounded instanced draw. Seeds are uploaded once; motion stays in TSL. */
export function createStageAmbient() {
  const geometry = new PlaneGeometry(1, 1);
  const seeds = new Float32Array(CAPACITY * 4);
  for (let i = 0; i < CAPACITY; i += 1) {
    seeds.set(
      [(i * 0.618034) % 1, (i * 0.754878 + 0.13) % 1, (i * 0.414214 + 0.2) % 1, i % 4],
      i * 4
    );
  }
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 4));
  const seed = attribute('aSeed', 'vec4');
  const time = uniform(0);
  const speed = uniform(0);
  const size = uniform(new Vector2(0.06, 0.06));
  const direction = uniform(new Vector2(0, 1));
  const kind = uniform(0); // 0 motes, 1 rain, 2 stars, 3 bloom, 4 scanlines
  const strength = uniform(0);
  const drift = uniform(0.12);
  const palette = [
    uniform(new Color()),
    uniform(new Color()),
    uniform(new Color()),
    uniform(new Color()),
  ];
  const phase = time.mul(speed);
  const x = fract(seed.x.add(phase.mul(direction.x)))
    .mul(14)
    .sub(7);
  const y = fract(seed.y.add(phase.mul(direction.y)))
    .mul(9)
    .sub(1);
  const still = kind.greaterThanEqual(2);
  const centerX = select(still, seed.x.mul(16).sub(8), x);
  const centerY = select(still, seed.y.mul(9), y);
  const sway = sin(time.mul(0.35).add(seed.z.mul(12))).mul(drift);
  const scan = kind.equal(4);
  const local = positionGeometry.xy.mul(size);
  // Rain leans with the configured wind; flakes and motes keep a round silhouette.
  const lean = select(kind.equal(1), local.y.mul(direction.x).mul(0.5), float(0));
  const center = vec3(centerX.add(sway).add(lean), centerY, seed.z.mul(-10).sub(1));
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  material.positionNode = select(
    scan,
    vec3(positionGeometry.x.mul(34), positionGeometry.y.mul(22).add(5), -16),
    center.add(vec3(local, 0))
  );
  const radial = float(1).sub(smoothstep(0.05, 0.5, length(uv().sub(0.5))));
  const streak = float(1)
    .sub(smoothstep(0.05, 0.5, TSL.abs(uv().x.sub(0.5))))
    .mul(sin(uv().y.mul(Math.PI)));
  const twinkle = sin(time.mul(speed).mul(15).add(seed.x.mul(30)))
    .mul(0.25)
    .add(0.65);
  const boundary = smoothstep(-1, 0.3, centerY).mul(float(1).sub(smoothstep(7, 8, centerY)));
  const lines = float(1).sub(smoothstep(0.08, 0.2, fract(uv().y.mul(size.y))));
  material.opacityNode = select(
    scan,
    lines,
    select(kind.equal(1), streak, radial.mul(radial)).mul(boundary).mul(twinkle)
  ).mul(strength);
  material.colorNode = select(
    seed.w.lessThan(1),
    palette[0]!,
    select(seed.w.lessThan(2), palette[1]!, select(seed.w.lessThan(3), palette[2]!, palette[3]!))
  );
  material.toneMapped = false;
  const mesh = new InstancedMesh(geometry, material, CAPACITY);
  const identity = new Matrix4();
  for (let i = 0; i < CAPACITY; i += 1) mesh.setMatrixAt(i, identity);
  mesh.frustumCulled = false;
  mesh.visible = false;
  let animated = false;
  return {
    mesh,
    configure(
      effects: ThemeEffects | undefined,
      colors: StageSceneColors,
      calm: boolean,
      particles: boolean
    ) {
      const effect = effects?.ambient ?? 'none';
      const intensity = effects?.intensity ?? 0.5;
      const density = effects?.density ?? 1;
      const isBloom = effect === 'bloom';
      const isScan = effect === 'scanlines';
      mesh.visible =
        effect !== 'none' &&
        intensity > 0 &&
        (isBloom || density > 0) &&
        (particles || isBloom || isScan);
      animated = mesh.visible && !calm && !isScan && (effects?.speed ?? 1) > 0;
      kind.value = effect === 'rain' ? 1 : effect === 'stars' ? 2 : isBloom ? 3 : isScan ? 4 : 0;
      const directionName =
        effects?.direction ?? (effect === 'rain' || effect === 'snow' ? 'down' : 'up');
      direction.value.set(
        directionName.includes('left') ? -1 : directionName.includes('right') ? 1 : 0,
        directionName.includes('down') ? -1 : directionName.includes('up') ? 1 : 0
      );
      speed.value = calm
        ? 0
        : (effects?.speed ?? 1) * (effect === 'rain' ? 0.22 : effect === 'snow' ? 0.035 : 0.018);
      const scale = effects?.size ?? 1;
      size.value.set(
        (isBloom ? 6 : effect === 'rain' ? 0.014 : effect === 'snow' ? 0.075 : 0.045) * scale,
        isScan
          ? 160 / scale
          : (isBloom ? 6 : effect === 'rain' ? 0.48 : effect === 'snow' ? 0.075 : 0.045) * scale
      );
      strength.value = intensity * (isBloom ? 0.22 : isScan ? 0.12 : effect === 'rain' ? 0.5 : 0.8);
      drift.value = effect === 'rain' || isScan ? 0 : effect === 'snow' ? 0.2 : 0.08;
      mesh.count = isScan
        ? 1
        : isBloom
          ? 5
          : Math.ceil((effect === 'rain' ? CAPACITY : 80) * density);
      const fallback =
        effect === 'rain' || effect === 'dust'
          ? colors.muted
          : effect === 'embers'
            ? colors.warning
            : effect === 'particles' || isBloom
              ? colors.primary
              : colors.text;
      const roles = { ...colors, textMuted: colors.muted };
      palette.forEach((color, i) => {
        const role = effects?.palette?.[i % effects.palette.length];
        color.value.set(role ? roles[role] : fallback);
      });
    },
    get animated() {
      return animated;
    },
    update(seconds: number) {
      time.value = seconds;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
