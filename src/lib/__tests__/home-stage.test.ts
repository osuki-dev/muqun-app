import { describe, expect, test } from 'bun:test';
import {
  projectStagePoint,
  stageBillboardRect,
  stageCamera,
  stageDrawnScreens,
  stageFacingYaw,
  stageHostSize,
  stageRingRest,
  stageRingTarget,
  stageScreenPosition,
  stageSwipeStep,
  wrapStageIndex,
  STAGE_FRONT_OFFSET,
  STAGE_HOST_HINT,
  STAGE_MAX_SCREENS,
  STAGE_RING_RADIUS,
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
import { stageReadableInk } from '../home-stage-ink';
import { contrastRatio } from '../../theme/contrast';

describe('stage ring', () => {
  test('wraps selection in both directions and survives an empty ring', () => {
    expect(wrapStageIndex(-1, 4)).toBe(3);
    expect(wrapStageIndex(9, 4)).toBe(1);
    expect(wrapStageIndex(3, 0)).toBe(0);
    expect(wrapStageIndex(Number.NaN, 3)).toBe(0);
  });

  test('turns the short way round and accumulates instead of spinning back', () => {
    const step = (Math.PI * 2) / 5;
    expect(stageRingTarget(0, 0, 1, 5)).toBeCloseTo(-step);
    // From the last back to the first is one step forward, not four back.
    expect(stageRingTarget(-4 * step, 4, 0, 5)).toBeCloseTo(-5 * step);
    expect(stageRingTarget(0, 0, 4, 5)).toBeCloseTo(step);
    expect(stageRingTarget(1.5, 0, 0, 1)).toBe(1.5);
  });

  test('the selected screen stands at the front offset, on the ring', () => {
    for (const count of [1, 2, 5]) {
      for (let selected = 0; selected < count; selected += 1) {
        const [x, , z] = stageScreenPosition(selected, count, stageRingRest(selected, count));
        expect(Math.atan2(x, z)).toBeCloseTo(STAGE_FRONT_OFFSET);
        expect(Math.hypot(x, z)).toBeCloseTo(STAGE_RING_RADIUS);
      }
    }
  });

  test('with many computers, draws the selection and its nearest neighbours', () => {
    expect(stageDrawnScreens(0, 3)).toEqual([0, 1, 2]);
    const drawn = stageDrawnScreens(0, 20);
    expect(drawn).toHaveLength(STAGE_MAX_SCREENS);
    expect(drawn).toContain(0);
    expect(drawn).toContain(1);
    expect(drawn).toContain(19);
    expect(drawn).not.toContain(10);
  });

  test('a short slow drag stays; a long or fast one moves towards the pull', () => {
    expect(stageSwipeStep(-20, -50, 400)).toBe(0);
    expect(stageSwipeStep(-120, 0, 400)).toBe(1);
    expect(stageSwipeStep(120, 0, 400)).toBe(-1);
    expect(stageSwipeStep(10, -900, 400)).toBe(1);
  });
});

describe('camera and projection', () => {
  const camera = stageCamera({});

  test('the camera target lands at the centre; up is up and right is right', () => {
    const centre = projectStagePoint(camera.target, camera, 390, 844);
    expect(centre.x).toBeCloseTo(195, 3);
    expect(centre.y).toBeCloseTo(422, 3);
    const above = projectStagePoint([0.55, 2.3, 0], camera, 390, 844);
    const right = projectStagePoint([1.55, 1.3, 0], camera, 390, 844);
    expect(above.y).toBeLessThan(centre.y);
    expect(right.x).toBeGreaterThan(centre.x);
  });

  test('the front screen and the host hint are on screen; behind the camera is not', () => {
    const front = stageScreenPosition(0, 4, stageRingRest(0, 4));
    expect(projectStagePoint(front, camera, 390, 844).visible).toBe(true);
    expect(projectStagePoint(STAGE_HOST_HINT, camera, 390, 844).visible).toBe(true);
    expect(projectStagePoint([0, 0, 50], camera, 390, 844).visible).toBe(false);
  });

  test('a dive ends in front of the screen, looking at it', () => {
    const front = stageScreenPosition(0, 4, stageRingRest(0, 4));
    const dived = stageCamera({ dive: 1, diveTo: front });
    expect(dived.target).toEqual(front);
    const distance = Math.hypot(
      dived.position[0] - front[0],
      dived.position[1] - front[1],
      dived.position[2] - front[2]
    );
    expect(distance).toBeLessThan(2);
    expect(projectStagePoint(front, dived, 390, 844).visible).toBe(true);
  });

  test('wide art fits the pedestal; portrait art keeps the full host height', () => {
    expect(stageHostSize(0.6)).toEqual({ width: 2.67 * 0.6, height: 2.67 });
    const group = stageHostSize(2.4);
    expect(group.width).toBeLessThanOrEqual(2.36 * 1.25 + 1e-9);
    expect(group.height).toBeLessThanOrEqual(2.6);
    expect(group.width / group.height).toBeCloseTo(2.4);
    expect(stageHostSize(Number.NaN).height).toBe(2.67);
  });

  test('look offsets are clamped; billboards face the camera', () => {
    expect(stageCamera({ lookX: 4 }).position).toEqual(stageCamera({ lookX: 1 }).position);
    expect(stageFacingYaw([0, 0, 0], [0, 0, 5])).toBeCloseTo(0);
    expect(stageFacingYaw([0, 0, 0], [5, 0, 0])).toBeCloseTo(Math.PI / 2);
  });

  test('a screen hit box keeps its aspect and shrinks with distance', () => {
    const near = stageBillboardRect([0, 1, 3], 1.9, 1.2, camera, 390, 844);
    const far = stageBillboardRect([0, 1, -3], 1.9, 1.2, camera, 390, 844);
    expect(near.width / near.height).toBeCloseTo(1.9 / 1.2);
    expect(far.height).toBeLessThan(near.height);
    expect(far.depth).toBeGreaterThan(near.depth);
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

describe('stage ink', () => {
  test('a pale primary is darkened until it reads at 4.5:1 on a light slab', () => {
    const ink = stageReadableInk('#9FE4CE', '#FFFCF7');
    expect(contrastRatio(ink, '#fffcf7')).toBeGreaterThanOrEqual(4.5);
    expect(ink).not.toBe('#000000');
  });

  test('an ink that already reads is kept; a dark ground lightens; non-hex passes through', () => {
    expect(stageReadableInk('#050B12', '#FFFCF7')).toBe('#050b12');
    expect(contrastRatio(stageReadableInk('#404040', '#151C22'), '#151c22')).toBeGreaterThanOrEqual(
      4.5
    );
    expect(stageReadableInk('rgba(0,0,0,0.5)', '#ffffff')).toBe('rgba(0,0,0,0.5)');
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

  test('a screen face lists working agents first, then the latest sessions', () => {
    const [panel] = stagePanels({
      ...base,
      agentsByServer: {
        a: {
          serverId: 'a',
          checkedAtMs: now,
          agents: [
            { id: '1', name: 'pane', status: 'idle', hasAgent: false },
            { id: '2', name: 'x', agentLabel: 'Codex', status: 'idle', hasAgent: true },
            { id: '3', name: 'y', agentLabel: 'Claude', status: 'working', hasAgent: true },
          ],
        },
      },
      recentEntries: ['one', 'two', 'three'].map((title, index) => ({
        key: title,
        title,
        atMs: now - index,
        destination: { type: 'pane', serverId: 'a', paneId: title },
      })) as never,
    });
    expect(panel!.face.agents.map((agent) => agent.name)).toEqual(['Claude', 'Codex']);
    expect(panel!.face.sessions).toEqual(['one', 'two']);
    expect(panel!.sessionCount).toBe(3);
  });

  test('selection falls back to the first card when the target is gone', () => {
    expect(stageSelectedIndex(servers, 'b')).toBe(1);
    expect(stageSelectedIndex(servers, 'gone')).toBe(0);
    expect(stageSelectedIndex([], undefined)).toBe(0);
  });
});
