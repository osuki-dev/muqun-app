/** CORE 01: authored geometry shared by the native scene and the GLB exporter. */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  Shape,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type CorePart = {
  name: string;
  geometry: BufferGeometry;
  material: 'armor' | 'edge' | 'light' | 'copper';
  spread: Vector3;
  spin: boolean;
};

function plate(width: number, height: number, depth: number, cut = 0.13) {
  const x = width / 2,
    y = height / 2;
  const s = new Shape();
  s.moveTo(-x + cut, -y);
  s.lineTo(x - cut, -y);
  s.lineTo(x, -y + cut);
  s.lineTo(x, y - cut);
  s.lineTo(x - cut, y);
  s.lineTo(-x + cut, y);
  s.lineTo(-x, y - cut);
  s.lineTo(-x, -y + cut);
  s.closePath();
  const g = new ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.025,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Merged by material and movable assembly, with no texture or runtime network dependency. */
export function createCoreParts(): CorePart[] {
  const parts: CorePart[] = [];
  function assembly(
    name: string,
    spread: Vector3,
    build: (
      add: (
        material: CorePart['material'],
        g: BufferGeometry,
        x?: number,
        y?: number,
        z?: number,
        rx?: number,
        ry?: number,
        rz?: number
      ) => void
    ) => void,
    spin = false
  ) {
    const buckets = new Map<CorePart['material'], BufferGeometry[]>();
    build((material, geometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      geometry.rotateX(rx);
      geometry.rotateY(ry);
      geometry.rotateZ(rz);
      geometry.translate(x, y, z);
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      if (g !== geometry) geometry.dispose();
      g.deleteAttribute('uv');
      g.clearGroups();
      const list = buckets.get(material) ?? [];
      list.push(g);
      buckets.set(material, list);
    });
    for (const [material, geometries] of buckets) {
      const geometry = mergeGeometries(geometries)!;
      for (const g of geometries) g.dispose();
      geometry.computeBoundingSphere();
      parts.push({ name: `${name}_${material}`, geometry, material, spread, spin });
    }
  }
  // Four thick armor cassettes; every detail moves with its parent cassette.
  for (const side of [-1, 1]) {
    assembly(`wing_${side < 0 ? 'left' : 'right'}`, new Vector3(side * 0.4, 0, 0.06), (add) => {
      add('edge', plate(0.54, 1.65, 0.32), side * 0.65, 0, 0.25);
      add('armor', plate(0.44, 1.47, 0.1), side * 0.65, 0, 0.47);
      add('armor', plate(0.48, 1.52, 0.09), side * 0.65, 0, -0.45);
      add('light', new BoxGeometry(0.035, 1.2, 0.04), side * 0.4, 0, 0.44);
      add('copper', new BoxGeometry(0.03, 0.24, 0.04), side * 0.88, 0.35, 0.47);
      for (let i = 0; i < 6; i++) {
        add('edge', new BoxGeometry(0.08, 0.035, 0.68), side * 0.91, -0.53 + i * 0.18, -0.03);
        add(
          'edge',
          new CylinderGeometry(0.018, 0.018, 0.018, 6),
          side * 0.78,
          -0.57 + i * 0.22,
          0.54,
          Math.PI / 2
        );
      }
      // Inset parallel vent slits, geometry rather than noisy texture detail.
      for (let i = 0; i < 4; i++)
        add('edge', new BoxGeometry(0.19, 0.015, 0.012), side * 0.65, -0.35 + i * 0.065, 0.54);
    });
    assembly(`cap_${side < 0 ? 'lower' : 'upper'}`, new Vector3(0, side * 0.36, 0.05), (add) => {
      add('edge', plate(1.18, 0.42, 0.95), 0, side * 0.72, 0);
      add('armor', plate(1.04, 0.32, 0.08), 0, side * 0.72, 0.53);
      add('armor', plate(1.13, 0.78, 0.08), 0, side * 0.94, -0.02, Math.PI / 2);
      add('light', new BoxGeometry(0.92, 0.026, 0.035), 0, side * 0.53, 0.5);
      add('copper', new BoxGeometry(0.23, 0.025, 0.02), 0.31, side * 0.73, 0.585);
      for (const x of [-0.46, 0.46]) {
        add('edge', new BoxGeometry(0.07, 0.07, 0.87), x, side * 0.99, 0);
        add('edge', new CylinderGeometry(0.02, 0.02, 0.02, 6), x, side * 0.73, 0.59, Math.PI / 2);
      }
    });
  }
  assembly('chassis', new Vector3(), (add) => {
    add('armor', plate(1.15, 1.18, 0.1), 0, 0, -0.58);
    add('edge', new TorusGeometry(0.47, 0.04, 6, 40), 0, 0, 0.07);
    add('light', new TorusGeometry(0.42, 0.014, 4, 40), 0, 0, 0.1);
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      add(
        'copper',
        new BoxGeometry(0.08, 0.028, 0.045),
        Math.cos(a) * 0.47,
        Math.sin(a) * 0.47,
        0.12,
        0,
        0,
        a
      );
    }
    for (const x of [-0.45, 0.45])
      for (const y of [-0.45, 0.45]) {
        add('edge', new BoxGeometry(0.065, 0.065, 0.98), x, y, -0.03);
        add('light', new BoxGeometry(0.018, 0.018, 0.81), x, y, 0.01);
      }
  });
  assembly(
    'reactor',
    new Vector3(),
    (add) => {
      add('light', new OctahedronGeometry(0.24, 0));
      add('edge', new TorusGeometry(0.31, 0.017, 5, 32), 0, 0, 0, Math.PI / 3);
      add('light', new TorusGeometry(0.31, 0.008, 4, 32), 0, 0, 0, -Math.PI / 3);
    },
    true
  );
  return parts;
}

export function createCoreModel() {
  const parts = createCoreParts();
  const materials = {
    armor: new MeshStandardMaterial({ color: '#273243', metalness: 0.68, roughness: 0.32 }),
    edge: new MeshStandardMaterial({ color: '#61788e', metalness: 0.75, roughness: 0.26 }),
    light: new MeshStandardMaterial({
      color: '#71e7ff',
      emissive: '#18bbff',
      emissiveIntensity: 2.2,
      roughness: 0.3,
    }),
    copper: new MeshStandardMaterial({
      color: '#dba06b',
      metalness: 0.65,
      roughness: 0.3,
      emissive: '#ad5824',
      emissiveIntensity: 0.2,
    }),
  };
  const root = new Group();
  root.name = 'Muqun_CORE_01';
  for (const part of parts) {
    const mesh = new Mesh(part.geometry, materials[part.material]);
    mesh.name = part.name;
    mesh.userData = { spread: part.spread.toArray(), spin: part.spin };
    root.add(mesh);
  }
  return { root, parts, materials };
}
