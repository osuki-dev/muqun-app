/** Rebuild the portable CORE 01 asset from the exact native geometry. */
import { mkdir, writeFile } from 'node:fs/promises';
import {
  AnimationClip,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
  Quaternion,
  Vector3,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createCoreModel } from '../src/components/home-stage/model/core-model';

// GLTFExporter reads its final binary Blob through the browser FileReader API.
class BlobReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  async readAsArrayBuffer(blob: Blob) {
    this.result = await blob.arrayBuffer();
    this.onloadend?.();
  }
}
Object.assign(globalThis, { FileReader: BlobReader });
const { root, parts } = createCoreModel();
const open = new AnimationClip(
  'Open',
  0.65,
  parts
    .filter((p) => p.spread.lengthSq() > 0)
    .map(
      (p) =>
        new VectorKeyframeTrack(
          `${p.name}.position`,
          [0, 0.2, 0.65],
          [0, 0, 0, ...p.spread.clone().multiplyScalar(0.2).toArray(), ...p.spread.toArray()]
        )
    )
);
const spin = new AnimationClip(
  'Reactor',
  12,
  parts
    .filter((p) => p.spin)
    .map((p) => {
      const times = [0, 3, 6, 9, 12];
      const values = times.flatMap((t) =>
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (t / 12) * Math.PI * 2).toArray()
      );
      return new QuaternionKeyframeTrack(`${p.name}.quaternion`, times, values);
    })
);
const binary = await new GLTFExporter().parseAsync(root, {
  binary: true,
  animations: [open, spin],
});
await mkdir('assets/models', { recursive: true });
await writeFile('assets/models/home-core.glb', Buffer.from(binary as ArrayBuffer));
const triangles = parts.reduce((n, p) => n + p.geometry.getAttribute('position').count / 3, 0);
console.log(
  JSON.stringify({
    bytes: (binary as ArrayBuffer).byteLength,
    triangles,
    meshes: parts.length,
    animations: ['Open', 'Reactor'],
  })
);
