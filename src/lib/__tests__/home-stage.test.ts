import { describe, expect, test } from 'bun:test';
import {
  projectStagePoint,
  stageCamera,
  stageMovePose,
  stageRingOffset,
  stageSlotPose,
  stageSwipeStep,
  wrapStageIndex,
} from '../home-stage-geometry';
import {
  initialStageDegrade,
  recordStageFrame,
  stageEffects,
  stepStageSpring,
  STAGE_CARD_SPRING,
  type StageDegradeState,
} from '../home-stage-motion';
import { stagePanels, stageSelectedIndex } from '../home-stage-panels';

describe('stage ring', () => {
  test('wraps selection in both directions and survives an empty ring', () => {
    expect(wrapStageIndex(-1, 4)).toBe(3);
    expect(wrapStageIndex(9, 4)).toBe(1);
    expect(wrapStageIndex(3, 0)).toBe(0);
    expect(wrapStageIndex(Number.NaN, 3)).toBe(0);
  });

  test('places every card once around the front, nearest first', () => {
    expect([0, 1, 2, 3].map((index) => stageRingOffset(index, 0, 4))).toEqual([0, 1, 2, -1]);
    expect([0, 1, 2, 3, 4].map((index) => stageRingOffset(index, 3, 5))).toEqual([2, -2, -1, 0, 1]);
    // Two computers: the other is always on the same side.
    expect(stageRingOffset(1, 0, 2)).toBe(1);
    expect(stageRingOffset(0, 1, 2)).toBe(1);
    expect(stageRingOffset(0, 0, 1)).toBe(0);
  });

  test('the front card is nearest the reader; the arc recedes and hides past two', () => {
    const front = stageSlotPose(0);
    const near = stageSlotPose(1);
    const far = stageSlotPose(2);
    expect(front.position[2]).toBeGreaterThan(near.position[2]);
    expect(near.position[2]).toBeGreaterThan(far.position[2]);
    expect(stageSlotPose(-1).position[0]).toBeCloseTo(-near.position[0]);
    expect(near.scale).toBeLessThan(front.scale);
    expect(far.dim).toBeGreaterThan(near.dim);
    expect(stageSlotPose(3).presence).toBe(0);
    expect(far.presence).toBe(1);
  });
});

describe('card move', () => {
  test('starts and ends exactly on the resting slots', () => {
    for (let index = 0; index < 5; index += 1) {
      const start = stageMovePose(index, 0, 1, 5, 0);
      const end = stageMovePose(index, 0, 1, 5, 1);
      expect(start.position).toEqual(stageSlotPose(stageRingOffset(index, 0, 5)).position);
      expect(end.position[0]).toBeCloseTo(stageSlotPose(stageRingOffset(index, 1, 5)).position[0]);
    }
  });

  test('the incoming card turns a half turn; the outgoing one lifts over a hump', () => {
    const incoming = stageMovePose(1, 0, 1, 4, 1);
    expect(Math.abs(incoming.rotationY)).toBeCloseTo(Math.PI);
    const leaving = stageMovePose(0, 0, 1, 4, 0.5);
    const straight =
      (stageSlotPose(0).position[1] + stageSlotPose(stageRingOffset(0, 1, 4)).position[1]) / 2;
    expect(leaving.position[1]).toBeGreaterThan(straight);
  });

  test('a spring overshoot never pushes dim or presence out of range', () => {
    const pose = stageMovePose(2, 0, 1, 5, 1.15);
    expect(pose.dim).toBeLessThanOrEqual(1);
    expect(pose.presence).toBeLessThanOrEqual(1);
    expect(Number.isFinite(stageMovePose(1, 0, 1, 3, Number.NaN).scale)).toBe(true);
  });

  test('a short slow drag stays; a long or fast one moves towards the pull', () => {
    expect(stageSwipeStep(-20, -50, 400)).toBe(0);
    expect(stageSwipeStep(-120, 0, 400)).toBe(1);
    expect(stageSwipeStep(120, 0, 400)).toBe(-1);
    expect(stageSwipeStep(10, -900, 400)).toBe(1);
  });
});

describe('label projection', () => {
  const camera = stageCamera(0, 0, 0, 390 / 440);

  test('the camera target lands at the centre; up is up and right is right', () => {
    const centre = projectStagePoint(camera.target, camera, 390, 440);
    expect(centre.x).toBeCloseTo(195, 3);
    expect(centre.y).toBeCloseTo(220, 3);
    const above = projectStagePoint([0, 1, 0], camera, 390, 440);
    const right = projectStagePoint([1, 0.18, 0], camera, 390, 440);
    expect(above.y).toBeLessThan(centre.y);
    expect(right.x).toBeGreaterThan(centre.x);
  });

  test('points behind the camera are never placed on screen', () => {
    const behind = projectStagePoint([0, 0, 50], camera, 390, 440);
    expect(behind.visible).toBe(false);
  });

  test('every resting card of a full arc is inside a phone stage', () => {
    for (const offset of [-2, -1, 0, 1, 2]) {
      const pose = stageSlotPose(offset);
      expect(projectStagePoint(pose.position, camera, 390, 440).visible).toBe(true);
    }
  });

  test('pitch is clamped to its limit', () => {
    expect(stageCamera(1, 0, 0, 1).position).toEqual(stageCamera(0.5, 0, 0, 1).position);
  });
});

describe('frame pacing', () => {
  test('a card spring settles near its rest within half a second', () => {
    let spring = { value: 0, velocity: 0 };
    for (let frame = 0; frame < 30; frame += 1)
      spring = stepStageSpring(spring, 1, 1 / 60, STAGE_CARD_SPRING);
    expect(Math.abs(spring.value - 1)).toBeLessThan(0.03);
    for (let frame = 0; frame < 60; frame += 1)
      spring = stepStageSpring(spring, 1, 1 / 60, STAGE_CARD_SPRING);
    expect(spring).toEqual({ value: 1, velocity: 0 });
  });

  test('a stalled frame does not explode the spring', () => {
    const spring = stepStageSpring({ value: 0, velocity: 0 }, 1, 5, STAGE_CARD_SPRING);
    expect(Math.abs(spring.value)).toBeLessThan(2);
  });

  const run = (state: StageDegradeState, frameMs: number, untilMs: number, continuous = true) => {
    let now = 0;
    let next = state;
    while (now < untilMs) {
      now += frameMs;
      next = recordStageFrame(next, { nowMs: now, frameMs, continuous });
    }
    return next;
  };

  test('steps down one rung after two seconds below 45 fps while moving', () => {
    expect(run(initialStageDegrade(), 30, 1500).quality).toBe('full');
    expect(run(initialStageDegrade(), 30, 2600).quality).toBe('no-particles');
    expect(run(initialStageDegrade(), 16, 10_000).quality).toBe('full');
  });

  test('idle and paused frames are not evidence', () => {
    expect(run(initialStageDegrade(), 50, 10_000, false).quality).toBe('full');
    const pause = recordStageFrame(initialStageDegrade(), {
      nowMs: 0,
      frameMs: 900,
      continuous: true,
    });
    expect(pause.slowSinceMs).toBeNull();
  });

  test('the capped rung is judged against its own pace and ends static', () => {
    const capped = initialStageDegrade('capped');
    expect(run(capped, 33, 6000).quality).toBe('capped');
    expect(run(capped, 45, 2600).quality).toBe('static');
    expect(run(initialStageDegrade('static'), 200, 6000).quality).toBe('static');
  });

  test('effects drop particles first, then shimmer; Reduce Motion stills everything', () => {
    const gpu = { gpuAvailable: true, reducedMotion: false };
    expect(stageEffects('full', gpu)).toMatchObject({ particles: true, shimmer: true });
    expect(stageEffects('no-particles', gpu)).toMatchObject({ particles: false, shimmer: true });
    expect(stageEffects('capped', gpu)).toMatchObject({
      shimmer: false,
      frameIntervalMs: 1000 / 30,
    });
    expect(stageEffects('full', { gpuAvailable: false, reducedMotion: false }).gpu).toBe(false);
    expect(stageEffects('full', { gpuAvailable: true, reducedMotion: true })).toMatchObject({
      particles: false,
      pulse: false,
      tilt: false,
      idleIntervalMs: null,
    });
  });
});

describe('stage panels', () => {
  const now = 1_000_000_000;
  const servers = [
    { serverId: 'a', label: 'studio' },
    { serverId: 'b', label: 'laptop' },
  ];
  const base = {
    servers,
    connectionStatuses: { a: 'live' as const, b: 'offline' as const },
    attention: {},
    recentEntries: [],
    nowMs: now,
  };

  test('a fresh working agent pulses; a stale or offline one does not', () => {
    const agents = (checkedAtMs: number) => ({
      a: {
        serverId: 'a',
        checkedAtMs,
        agents: [{ id: '1', name: 'x', status: 'working' as const, hasAgent: true }],
      },
      b: {
        serverId: 'b',
        checkedAtMs,
        agents: [{ id: '2', name: 'y', status: 'working' as const, hasAgent: true }],
      },
    });
    const fresh = stagePanels({ ...base, agentsByServer: agents(now - 1000) });
    expect(fresh.map((panel) => panel.working)).toEqual([true, false]);
    expect(fresh.map((panel) => panel.tone)).toEqual(['online', 'offline']);
    const stale = stagePanels({ ...base, agentsByServer: agents(now - 60 * 60 * 1000) });
    expect(stale[0]!.working).toBe(false);
    expect(stale[0]!.lastSeenMs).toBe(now - 60 * 60 * 1000);
  });

  test('attention comes from open requests or a blocked agent, per computer', () => {
    const panels = stagePanels({
      ...base,
      agentsByServer: {},
      attention: {
        key: {
          target: { serverId: 'b' } as never,
          requestIds: ['r1'],
          observedAt: now,
        },
        resolved: { target: { serverId: 'a' } as never, requestIds: [], observedAt: now },
      },
    });
    expect(panels.map((panel) => panel.attention)).toEqual([false, true]);
  });

  test('selection falls back to the first card when the target is gone', () => {
    expect(stageSelectedIndex(servers, 'b')).toBe(1);
    expect(stageSelectedIndex(servers, 'gone')).toBe(0);
    expect(stageSelectedIndex([], undefined)).toBe(0);
  });
});
