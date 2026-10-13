import { expect, test } from 'bun:test';
import {
  introParticleOrigin,
  introParticlePositions,
  introParticleTarget,
  projectIntroParticles,
  RELEASE_INTRO_PARTICLE_COUNT,
} from '../release-intro-particles';

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test('all chapters physically travel from connection points and progressively gather into their motif', () => {
  for (const scene of [0, 1, 2]) {
    const formation = { scene, from: null };
    const entry = introParticlePositions(formation, 0);
    const middle = introParticlePositions(formation, 0.45);
    const late = introParticlePositions(formation, 0.85);
    const settled = introParticlePositions(formation, 1);
    expect(entry).toHaveLength(RELEASE_INTRO_PARTICLE_COUNT);
    let moved = 0;
    let approaching = 0;
    for (let index = 0; index < entry.length; index++) {
      expect(entry[index]).toEqual(introParticleOrigin(scene, index));
      expect(distance(settled[index]!, introParticleTarget(scene, index))).toBeLessThan(1e-6);
      if (distance(entry[index]!, middle[index]!) > 0.025) moved++;
      if (distance(late[index]!, settled[index]!) < distance(middle[index]!, settled[index]!))
        approaching++;
    }
    expect(moved).toBeGreaterThan(180);
    expect(approaching).toBeGreaterThan(220);
    expect(distance(late[0]!, settled[0]!)).toBeLessThan(1e-6);
    expect(distance(late.at(-1)!, settled.at(-1)!)).toBeGreaterThan(0.001);
  }
});

test('every forward/back change preserves interrupted positions and then reforms its destination', () => {
  let points = introParticlePositions({ scene: 0, from: null }, 0.4);
  for (const scene of [1, 2, 1, 0, 2]) {
    const formation = { scene, from: points };
    expect(introParticlePositions(formation, 0)).toEqual(points);
    expect(introParticlePositions(formation, 0.18)).toEqual(
      introParticlePositions({ scene, from: null }, 0)
    );
    expect(introParticlePositions(formation, 1)).toEqual(
      introParticlePositions({ scene, from: null }, 1)
    );
    points = introParticlePositions(formation, 0.5);
  }
});

test('all frames keep the same bounded pool inside the canvas and project into three disjoint batches', () => {
  for (const scene of [0, 1, 2]) {
    for (const progress of [0, 0.1, 0.3, 0.5, 0.8, 1]) {
      const points = introParticlePositions({ scene, from: null }, progress);
      expect(points).toHaveLength(RELEASE_INTRO_PARTICLE_COUNT);
      const batches = [0, 1, 2].map((layer) => projectIntroParticles(points, 360, 310, layer));
      expect(batches.flat()).toHaveLength(RELEASE_INTRO_PARTICLE_COUNT);
      expect(
        batches
          .flat()
          .every((point) => point.x > 0 && point.x < 360 && point.y > 0 && point.y < 310)
      ).toBe(true);
    }
  }
});

test('the three draw batches include each particle exactly once', () => {
  const points = Array.from({ length: RELEASE_INTRO_PARTICLE_COUNT }, (_, index) => ({
    x: index,
    y: 0,
  }));
  const indices = [0, 1, 2].flatMap((layer) =>
    projectIntroParticles(points, 1, 1, layer).map((point) => point.x - 0.5)
  );
  expect(indices.toSorted((a, b) => a - b)).toEqual(points.map((point) => point.x));
});
