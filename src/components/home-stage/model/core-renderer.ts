import {
  BufferAttribute,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardNodeMaterial,
  Quaternion,
  TSL,
  Vector3,
} from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCoreParts } from './core-model';
import type { StageScreenFrame } from '../stage-scene';

/** Six instanced draws, shared by every visible computer; no per-panel draw overhead. */
export function createCoreRenderer(max: number) {
  const root = new Group();
  const parts = createCoreParts();
  const colors = { armor: '#273243', edge: '#61788e', light: '#71e7ff', copper: '#dba06b' };
  const batches: {
    mesh: InstancedMesh<import('three').BufferGeometry, MeshStandardNodeMaterial>;
    state: InstancedBufferAttribute;
    spin: boolean;
    kind: 'armor' | 'edge' | 'light' | 'copper';
  }[] = [];
  for (const spin of [false, true])
    for (const kind of ['armor', 'edge', 'light', 'copper'] as const) {
      const group = parts.filter((p) => p.spin === spin && p.material === kind);
      if (!group.length) continue;
      for (const part of group) {
        const count = part.geometry.getAttribute('position').count;
        const offsets = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) part.spread.toArray(offsets, i * 3);
        part.geometry.setAttribute('aSpread', new BufferAttribute(offsets, 3));
      }
      const geometry = mergeGeometries(group.map((p) => p.geometry))!;
      const state = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(
        DynamicDrawUsage
      );
      geometry.setAttribute('aCore', state);
      const input = TSL.attribute('aCore', 'vec4');
      const material = new MeshStandardNodeMaterial({
        color: colors[kind],
        metalness: kind === 'light' ? 0.12 : 0.65,
        roughness: kind === 'armor' ? 0.36 : 0.27,
      });
      material.positionNode = TSL.positionLocal.add(TSL.attribute('aSpread', 'vec3').mul(input.x));
      if (kind === 'light') {
        material.emissiveNode = TSL.vec3(0.035, 0.65, 1).mul(input.y);
        material.colorNode = TSL.mix(TSL.vec3(0.23, 0.31, 0.36), TSL.vec3(0.35, 0.85, 1), input.z);
      } else if (kind === 'copper')
        material.emissiveNode = TSL.vec3(0.45, 0.16, 0.025).mul(input.w.mul(1.5).add(0.1));
      const mesh = new InstancedMesh(geometry, material, max);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      root.add(mesh);
      batches.push({ mesh, state, spin, kind });
    }
  for (const p of parts) p.geometry.dispose();
  const position = new Vector3(),
    scale = new Vector3(),
    rotation = new Quaternion(),
    euler = new Euler();
  const base = new Matrix4(),
    extra = new Matrix4(),
    final = new Matrix4();
  return {
    root,
    draws: batches.length,
    update(screens: readonly StageScreenFrame[], time: number, open: number, yaw: number) {
      for (const batch of batches) {
        batch.mesh.count = Math.min(screens.length, max);
        screens.slice(0, max).forEach((screen, i) => {
          const [x, y, z] = screen.position;
          const idle = screen.front ? Math.sin(time * 0.8) * 0.025 : 0;
          position.set(x, y + idle, z);
          euler.set(0.2, -0.48 + (screen.front ? yaw : 0.1 * x), -0.13);
          rotation.setFromEuler(euler);
          scale.setScalar(screen.scale);
          base.compose(position, rotation, scale);
          if (batch.spin) {
            extra.makeRotationY(time * 0.24);
            final.multiplyMatrices(base, extra);
          } else final.copy(base);
          batch.mesh.setMatrixAt(i, final);
          const online = screen.look.tone !== 'offline' && screen.look.tone !== 'unknown';
          const energy = online
            ? screen.look.working
              ? 1.3 + Math.sin(time * 1.5) * 0.2
              : 0.8
            : 0.06;
          batch.state.setXYZW(
            i,
            screen.front ? open : 0,
            energy,
            online ? 1 : 0,
            screen.look.attention ? 1 : 0
          );
        });
        batch.mesh.instanceMatrix.needsUpdate = true;
        batch.state.needsUpdate = true;
      }
    },
    setTint(primary: string) {
      const tint = new Color(primary);
      // Dark armor stays readable in both modes; only its reflected edge picks up the theme.
      for (const batch of batches)
        if (batch.kind === 'edge') batch.mesh.material.color.set('#61788e').lerp(tint, 0.16);
    },
    dispose() {
      for (const b of batches) {
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
      }
    },
  };
}
