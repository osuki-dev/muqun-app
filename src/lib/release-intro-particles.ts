/** A fixed particle pool travels from connection anchors into each chapter's motif. */
export const RELEASE_INTRO_PARTICLE_COUNT = 240;
export const RELEASE_INTRO_FORMATION_MS = 2600;

export type IntroPoint = { x: number; y: number };
export type IntroFormation = { scene: number; from: readonly IntroPoint[] | null };

function smooth(value: number) {
  'worklet';
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function seed(index: number) {
  'worklet';
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Anchors correspond to the emblem's linked nodes, fork root, and layer corners. */
export function introParticleOrigin(scene: number, index: number): IntroPoint {
  'worklet';
  if (scene === 1) return { x: 0, y: 0.27 };
  if (scene === 2) return { x: index % 2 === 0 ? -0.2 : 0.2, y: 0.12 };
  return index % 2 === 0 ? { x: -0.028, y: -0.028 } : { x: 0.028, y: 0.028 };
}

export function introParticleTarget(scene: number, index: number): IntroPoint {
  'worklet';
  const unit = index / RELEASE_INTRO_PARTICLE_COUNT;
  const scatter = (seed(index) - 0.5) * 0.032;
  if (scene === 1) {
    // Three connected routes grow upwards from one root into the fork's endpoints.
    const branch = (index % 3) - 1;
    const along = Math.floor(index / 3) / (RELEASE_INTRO_PARTICLE_COUNT / 3 - 1);
    const spread = smooth((along - 0.24) / 0.7);
    return { x: branch * 0.24 * spread + scatter, y: 0.29 - along * 0.57 };
  }
  const angle = unit * Math.PI * 2 * (scene === 2 ? 3 : 2);
  const band = scene === 2 ? Math.floor(unit * 3) : Math.floor(unit * 2);
  const radius = (scene === 2 ? 0.21 + band * 0.085 : 0.28 + band * 0.08) + scatter;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius * (scene === 2 ? 0.85 : 1),
  };
}

// Geometry and stagger are immutable; only interpolation runs on the UI thread.
const PARTICLE_PATHS = [0, 1, 2].map((scene) =>
  Array.from({ length: RELEASE_INTRO_PARTICLE_COUNT }, (_, index) => ({
    origin: introParticleOrigin(scene, index),
    target: introParticleTarget(scene, index),
    delay: (index / RELEASE_INTRO_PARTICLE_COUNT) * 0.22 + seed(index + 19) * 0.06,
    direction: index % 2 === 0 ? 1 : -1,
  }))
);

/**
 * Initial entry emits immediately. Later chapters first draw the current particles
 * back to their new connection anchors, then launch staggered curved streams.
 * Keeping the actual previous positions also makes interrupted transitions continuous.
 */
export function introParticlePositions(formation: IntroFormation, progress: number): IntroPoint[] {
  'worklet';
  const points: IntroPoint[] = [];
  const regroup = formation.from === null ? 0 : 0.18;
  const paths = PARTICLE_PATHS[formation.scene] ?? PARTICLE_PATHS[0]!;
  for (let index = 0; index < RELEASE_INTRO_PARTICLE_COUNT; index++) {
    const { origin, target, delay, direction } = paths[index]!;
    const previous = formation.from?.[index];
    if (previous && progress < regroup) {
      const gather = smooth(progress / regroup);
      points.push({
        x: previous.x + (origin.x - previous.x) * gather,
        y: previous.y + (origin.y - previous.y) * gather,
      });
    } else {
      // Travel order follows the motif, with small deterministic variation.
      const travel = smooth((progress - regroup - delay) / (1 - regroup - 0.28));
      const bend = Math.sin(travel * Math.PI) * direction;
      const dx = target.x - origin.x;
      const dy = target.y - origin.y;
      points.push({
        x: origin.x + dx * travel - dy * bend * 0.42,
        y: origin.y + dy * travel + dx * bend * 0.42,
      });
    }
  }
  return points;
}

/** Three bounded draw batches, with no per-particle React nodes or frame bridge. */
export function projectIntroParticles(
  points: readonly IntroPoint[],
  width: number,
  height: number,
  layer: number
): IntroPoint[] {
  'worklet';
  const scale = Math.min(width, height);
  const projected: IntroPoint[] = [];
  for (let group = 0; group < points.length / 3; group++) {
    // Rotate sizes between neighboring particles so every branch has all three weights.
    const point = points[group * 3 + ((group + layer) % 3)]!;
    projected.push({ x: width / 2 + point.x * scale, y: height / 2 + point.y * scale });
  }
  return projected;
}
