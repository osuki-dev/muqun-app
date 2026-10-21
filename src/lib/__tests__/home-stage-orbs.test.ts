import { describe, expect, test } from 'bun:test';

import {
  projectStagePoint,
  stageCamera,
  stageCore,
  stageCoreAnchor,
  stageRingPoint,
} from '../home-stage-geometry';
import {
  stageBehindCore,
  stageChipPlacement,
  stageOrbAngle,
  stageOrbAt,
  stageOrbRestPoint,
  stageOrbs,
  trackStageOrbs,
  STAGE_MORE_ORB_KEY,
  STAGE_ORB_CAP,
  STAGE_ORB_SPEED,
  type StageOrbTrack,
} from '../home-stage-orbs';

const agents = (marks: string) =>
  [...marks].map((mark, index) => ({
    key: `a${index}`,
    mark:
      mark === 'n'
        ? ('needs-you' as const)
        : mark === 'w'
          ? ('working' as const)
          : ('idle' as const),
  }));

describe('orbs', () => {
  test('one orb per agent up to the cap, then the first ones and a "+N" for the rest', () => {
    expect(stageOrbs([])).toEqual([]);
    expect(stageOrbs(agents('nwi')).map((orb) => [orb.key, orb.mark, orb.agent])).toEqual([
      ['a0', 'needs-you', 0],
      ['a1', 'working', 1],
      ['a2', 'idle', 2],
    ]);
    expect(stageOrbs(agents('w'.repeat(STAGE_ORB_CAP)))).toHaveLength(STAGE_ORB_CAP);
    const many = stageOrbs(agents(`nn${'i'.repeat(10)}`));
    expect(many).toHaveLength(STAGE_ORB_CAP);
    // The waiting agents keep their own orbs; the "+N" stands for exactly the rest.
    expect(many.slice(0, 2).map((orb) => orb.mark)).toEqual(['needs-you', 'needs-you']);
    expect(many.at(-1)).toEqual({ key: STAGE_MORE_ORB_KEY, mark: 'more', agent: -1, more: 12 - 7 });
  });
});

describe('orbit tracks', () => {
  const step = (
    tracks: StageOrbTrack[],
    orbs: { key: string; mark: 'working' | 'idle' | 'needs-you' }[],
    frames: number,
    orbitDt = 0
  ) => {
    let moving = false;
    for (let frame = 0; frame < frames; frame += 1) {
      const next = trackStageOrbs(tracks, orbs, 1 / 60, { orbitDt });
      tracks = next.tracks;
      moving = next.moving;
    }
    return { tracks, moving };
  };

  test('a ring seen for the first time is drawn as it is: evenly spaced, present, still', () => {
    const { tracks, moving } = trackStageOrbs([], agents('wwi'), 1 / 60, { still: true });
    expect(moving).toBe(false);
    expect(tracks.map((track) => track.slot.value)).toEqual([0, 1 / 3, 2 / 3]);
    expect(tracks.every((track) => track.presence.value === 1 && track.travel === 0)).toBe(true);
  });

  test('a new orb grows in and the others make room; a missing one fades and is dropped', () => {
    const start = trackStageOrbs([], agents('ww'), 1 / 60, { still: true }).tracks;
    const added = trackStageOrbs(start, agents('wwi'), 1 / 60);
    expect(added.moving).toBe(true);
    const fresh = added.tracks.find((track) => track.key === 'a2')!;
    expect(fresh.presence.value).toBeGreaterThan(0);
    expect(fresh.presence.value).toBeLessThan(0.5);
    // The second orb was half a turn round; it springs towards a third.
    const second = added.tracks.find((track) => track.key === 'a1')!.slot.value;
    expect(second).toBeLessThan(0.5);
    expect(second).toBeGreaterThan(1 / 3);
    const settled = step(added.tracks, agents('wwi'), 90);
    expect(settled.moving).toBe(false);
    expect(settled.tracks.map((track) => track.slot.value)).toEqual([0, 1 / 3, 2 / 3]);
    expect(settled.tracks.every((track) => track.presence.value === 1)).toBe(true);

    const removed = trackStageOrbs(settled.tracks, agents('ww'), 1 / 60);
    const leaving = removed.tracks.find((track) => track.key === 'a2')!;
    expect(leaving.leaving).toBe(true);
    expect(leaving.presence.value).toBeLessThan(1);
    expect(step(removed.tracks, agents('ww'), 90).tracks.map((track) => track.key)).toEqual([
      'a0',
      'a1',
    ]);
  });

  test('orbs travel only on the orbit clock, a running agent fastest, and a new mark never jumps', () => {
    const start = trackStageOrbs([], agents('wi'), 1 / 60, { still: true }).tracks;
    const frozen = step(start, agents('wi'), 30, 0);
    expect(frozen.tracks.map((track) => track.travel)).toEqual([0, 0]);
    const moved = step(start, agents('wi'), 60, 1 / 60);
    const [working, idle] = moved.tracks;
    expect(working!.travel).toBeCloseTo(STAGE_ORB_SPEED.working, 3);
    expect(idle!.travel).toBeCloseTo(STAGE_ORB_SPEED.idle, 3);
    expect(working!.travel).toBeGreaterThan(idle!.travel);
    // The idle agent starts working: it carries on from where it was.
    const before = stageOrbAngle(idle!);
    const after = trackStageOrbs(moved.tracks, agents('ww'), 1 / 60, { orbitDt: 0 }).tracks[1]!;
    expect(stageOrbAngle(after)).toBeCloseTo(before, 6);
  });

  test('a slot springs the short way round', () => {
    const tracks: StageOrbTrack[] = [
      {
        key: 'a0',
        mark: 'idle',
        slot: { value: 0.9, velocity: 0 },
        travel: 0,
        presence: { value: 1, velocity: 0 },
        leaving: false,
      },
    ];
    // Its goal is 0 (a lone orb), which is a tenth of a turn on, not nine back.
    const next = trackStageOrbs(tracks, [{ key: 'a0', mark: 'idle' }], 1 / 60).tracks[0]!;
    expect(next.slot.value).toBeGreaterThan(0.9);
    expect(step(tracks, [{ key: 'a0', mark: 'idle' }], 120).tracks[0]!.slot.value).toBe(1);
  });
});

describe('orb touches and chips', () => {
  const aspect = 390 / 844;
  const camera = stageCamera();
  const core = stageCore(0, stageCoreAnchor(camera, aspect, 'figure'), aspect, 'figure');
  const screen = (point: readonly [number, number, number]) => {
    const at = projectStagePoint(point, camera, 390, 844);
    return { x: at.x, y: at.y };
  };

  test('the far side of the ring behind the core is hidden; the near side and the ends are not', () => {
    expect(stageBehindCore(stageRingPoint(core, Math.PI / 2), core, camera.position)).toBe(true);
    expect(stageBehindCore(stageRingPoint(core, (3 * Math.PI) / 2), core, camera.position)).toBe(
      false
    );
    expect(stageBehindCore(stageRingPoint(core, 0), core, camera.position)).toBe(false);
    expect(stageBehindCore(stageRingPoint(core, Math.PI), core, camera.position)).toBe(false);
  });

  test('a touch lands on the nearest visible orb within reach, or on the core', () => {
    const points = [0, 1, 2, 3].map((index) => stageOrbRestPoint(core, index, 4));
    // The first orb rests at the front right.
    const first = screen(points[0]!);
    expect(first.x).toBeGreaterThan(195);
    expect(stageOrbAt(first, points, core, camera, 390, 844)).toBe(0);
    expect(stageOrbAt({ x: first.x + 10, y: first.y + 8 }, points, core, camera, 390, 844)).toBe(0);
    // Too far from any orb: the core's.
    expect(stageOrbAt(screen(core.position), points, core, camera, 390, 844)).toBe(-1);
    // An orb behind the core cannot be touched.
    const behind = [stageRingPoint(core, Math.PI / 2)];
    expect(stageOrbAt(screen(behind[0]!), behind, core, camera, 390, 844)).toBe(-1);
    // Of two orbs under the finger, the one nearer the touch.
    const pair = [stageRingPoint(core, 0), stageRingPoint(core, 0.12)];
    expect(stageOrbAt(screen(pair[1]!), pair, core, camera, 390, 844)).toBe(1);
  });

  test("a chip hangs on the orb's side away from the core, on screen and clear of the HUD and the strip", () => {
    const chip = { width: 140, height: 28 };
    const view = { width: 390, ceiling: 143, floor: 640, coreY: 520 };
    // A near-side orb: below it, centred.
    const near = stageChipPlacement({ x: 200, y: 548 }, chip, view);
    expect(near).toEqual({ left: 130, top: 560, below: true });
    // A far-side orb: above it.
    const far = stageChipPlacement({ x: 200, y: 500 }, chip, view);
    expect(far.below).toBe(false);
    expect(far.top + chip.height).toBeLessThanOrEqual(500);
    // Below would reach the strip: above instead; above would reach the HUD: below instead.
    expect(stageChipPlacement({ x: 200, y: 620 }, chip, view).below).toBe(false);
    expect(stageChipPlacement({ x: 200, y: 160 }, chip, { ...view, coreY: 200 }).below).toBe(true);
    // Kept inside the sides.
    expect(stageChipPlacement({ x: 380, y: 548 }, chip, view).left).toBe(390 - 12 - 140);
    expect(stageChipPlacement({ x: 4, y: 548 }, chip, view).left).toBe(12);
  });
});
