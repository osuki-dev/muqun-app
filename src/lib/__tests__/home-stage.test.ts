import { describe, expect, test } from 'bun:test';
import {
  projectStagePoint,
  stageCamera,
  stageCoverPlane,
  stageDiveCamera,
  stageDragPosition,
  stageDrawnScreens,
  stagePane,
  stagePaneAnchor,
  stageQuadRect,
  stageSwipeTarget,
  stageViewSize,
  wrapStageIndex,
  STAGE_MAX_SCREENS,
  STAGE_PANE_DEPTH,
} from '../home-stage-geometry';
import { stageClearFraction, stageLayers } from '../home-stage-layers';
import {
  initialStageDegrade,
  recordStageFrame,
  stageEffects,
  stageIdleInterval,
  STAGE_AMBIENT_IDLE_MS,
  stepStageSpring,
  STAGE_CARD_SPRING,
  type StageDegradeState,
} from '../home-stage-motion';
import {
  stagePanels,
  stageSelectedIndex,
  stageStreakLines,
  type StageFace,
} from '../home-stage-panels';
import { stageReadableInk } from '../home-stage-ink';
import { contrastRatio } from '../../theme/contrast';

describe('cover-flow', () => {
  test('wraps an index in both directions and survives an empty list', () => {
    expect(wrapStageIndex(-1, 4)).toBe(3);
    expect(wrapStageIndex(9, 4)).toBe(1);
    expect(wrapStageIndex(3, 0)).toBe(0);
    expect(wrapStageIndex(Number.NaN, 3)).toBe(0);
  });

  test('with many computers, draws a run around the selection that stays in range', () => {
    expect(stageDrawnScreens(0, 3)).toEqual([0, 1, 2]);
    expect(stageDrawnScreens(0, 0)).toEqual([]);
    const middle = stageDrawnScreens(10, 20);
    expect(middle).toHaveLength(STAGE_MAX_SCREENS);
    expect(middle).toContain(9);
    expect(middle).toContain(10);
    expect(middle).toContain(11);
    expect(stageDrawnScreens(0, 20)[0]).toBe(0);
    expect(stageDrawnScreens(19, 20).at(-1)).toBe(19);
  });

  test('a swipe settles on the nearest pane, at least one step when long or fast, never past an end', () => {
    // Short and slow: stays.
    expect(stageSwipeTarget(1, 4, -20, -50, 400)).toBe(1);
    // Long enough for a step but not for the next pane to be nearest.
    expect(stageSwipeTarget(1, 4, -60, 0, 400)).toBe(2);
    expect(stageSwipeTarget(1, 4, 60, 0, 400)).toBe(0);
    // A fast flick steps too.
    expect(stageSwipeTarget(1, 4, -10, -900, 400)).toBe(2);
    // Dragged across two panes' worth.
    expect(stageSwipeTarget(0, 4, -400, 0, 400)).toBe(2);
    expect(stageSwipeTarget(3, 4, -400, -900, 400)).toBe(3);
    expect(stageSwipeTarget(0, 4, 300, 900, 400)).toBe(0);
    expect(stageSwipeTarget(0, 0, -300, 0, 400)).toBe(0);
  });

  test('a drag gives a little past either end and no more', () => {
    expect(stageDragPosition(0, 3, 0.1)).toBeCloseTo(-0.1 * (390 / 220));
    expect(stageDragPosition(0, 3, 5)).toBe(-0.35);
    expect(stageDragPosition(2, 3, -5)).toBe(2.35);
  });

  test('the selected pane faces the camera; neighbours stand aside, back and turned inwards', () => {
    const aspect = 390 / 844;
    const anchor = stagePaneAnchor(stageCamera(), aspect);
    const viewWidth = stageViewSize(STAGE_PANE_DEPTH, aspect).width;
    const front = stagePane(0, anchor, aspect);
    expect(front.position).toEqual(anchor);
    expect(front.yaw).toBeCloseTo(0);
    expect(front.width).toBeCloseTo(viewWidth * 0.72);
    const next = stagePane(1, anchor, aspect);
    const previous = stagePane(-1, anchor, aspect);
    expect(next.position[0] - anchor[0]).toBeCloseTo(viewWidth * 0.66);
    expect(previous.position[0] - anchor[0]).toBeCloseTo(-viewWidth * 0.66);
    expect(next.position[2]).toBeCloseTo(anchor[2] - 2.2);
    expect(next.yaw).toBeCloseTo((-48 * Math.PI) / 180);
    expect(previous.yaw).toBeCloseTo((48 * Math.PI) / 180);
    expect(next.width).toBeCloseTo(viewWidth * 0.62);
    // Halfway through a drag, halfway between.
    const half = stagePane(0.5, anchor, aspect);
    expect(half.width).toBeCloseTo(viewWidth * 0.67);
    expect(stagePane(2, anchor, aspect).width).toBeCloseTo(next.width);
  });
});

describe('camera and projection', () => {
  const aspect = 390 / 844;
  const camera = stageCamera();

  test('the selected pane sits below the middle of the screen, where the anchor was cast', () => {
    const anchor = stagePaneAnchor(camera, aspect);
    const at = projectStagePoint(anchor, camera, 390, 844);
    expect(at.x).toBeCloseTo(195, 3);
    // NDC -0.1 is 55 % of the way down.
    expect(at.y).toBeCloseTo(844 * 0.55, 3);
    expect(at.depth).toBeLessThanOrEqual(STAGE_PANE_DEPTH);
  });

  test('the selected pane and its reflection stay above the bottom quarter on phones and tablets', () => {
    for (const [width, height] of [
      [393, 873],
      [390, 844],
      [834, 1194],
      [1194, 834],
    ] as const) {
      const ratio = width / height;
      const pane = stagePane(0, stagePaneAnchor(camera, ratio), ratio);
      const [x, y, z] = pane.position;
      // The reflection reaches 1.03 pane heights below the pane's centre.
      const reflection = projectStagePoint([x, y - pane.height * 1.03, z], camera, width, height);
      expect(height - reflection.y).toBeGreaterThan(height * 0.1);
      const rect = stageQuadRect(pane.position, pane.width, pane.height, 0, camera, width, height);
      expect(height - (rect.y + rect.height)).toBeGreaterThan(height * 0.25);
    }
  });

  test('tilt moves the camera within its limits; behind the camera is never visible', () => {
    expect(stageCamera({ lookX: 4 }).position).toEqual(stageCamera({ lookX: 1 }).position);
    expect(stageCamera({ lookX: 1 }).position[0]).toBeCloseTo(Math.sin((5 * Math.PI) / 180) * 4);
    expect(stageCamera({ lookY: -1 }).position[1]).toBeLessThan(camera.position[1]);
    expect(projectStagePoint([0, 0, 50], camera, 390, 844).visible).toBe(false);
  });

  test('a dive ends in front of the pane, looking at it, with the pane still on screen', () => {
    const anchor = stagePaneAnchor(camera, aspect);
    expect(stageDiveCamera(camera, anchor, 0)).toBe(camera);
    const dived = stageDiveCamera(camera, anchor, 1);
    expect(dived.target).toEqual(anchor);
    const distance = Math.hypot(
      dived.position[0] - anchor[0],
      dived.position[1] - anchor[1],
      dived.position[2] - anchor[2]
    );
    expect(distance).toBeLessThan(STAGE_PANE_DEPTH);
    expect(projectStagePoint(anchor, dived, 390, 844).visible).toBe(true);
  });

  test('a side pane box is clipped to the screen; a pane entirely off screen is not visible', () => {
    const anchor = stagePaneAnchor(camera, aspect);
    const front = stagePane(0, anchor, aspect);
    const frontRect = stageQuadRect(front.position, front.width, front.height, 0, camera, 390, 844);
    expect(frontRect.visible).toBe(true);
    expect(frontRect.width / frontRect.height).toBeCloseTo(1 / 0.625, 1);
    const side = stagePane(1, anchor, aspect);
    const sideRect = stageQuadRect(
      side.position,
      side.width,
      side.height,
      side.yaw,
      camera,
      390,
      844
    );
    expect(sideRect.visible).toBe(true);
    expect(sideRect.x + sideRect.width).toBeLessThanOrEqual(390);
    expect(sideRect.depth).toBeGreaterThan(frontRect.depth);
    const gone = stageQuadRect([40, 0, -12], 2, 1, 0, camera, 390, 844);
    expect(gone.visible).toBe(false);
  });

  test('a cover layer covers its overscan whatever the picture, and its focal shift keeps it', () => {
    for (const ratio of [0.4, 1, 2.5]) {
      const plane = stageCoverPlane(ratio, 60, 1.22, aspect, { x: 0, y: 1 });
      const view = stageViewSize(60, aspect);
      expect(plane.width / plane.height).toBeCloseTo(ratio);
      expect(plane.width / 2 - Math.abs(plane.shiftX)).toBeGreaterThanOrEqual(
        (view.width * 1.22) / 2 - 1e-9
      );
      expect(plane.height / 2 - Math.abs(plane.shiftY)).toBeGreaterThanOrEqual(
        (view.height * 1.22) / 2 - 1e-9
      );
    }
    expect(stageCoverPlane(2.5, 60, 1.22, aspect, { x: 0, y: 0.5 }).shiftX).toBeGreaterThan(0);
    expect(stageCoverPlane(2.5, 60, 1.22, aspect).shiftX).toBe(0);
  });
});

describe('layers', () => {
  test('counts near-transparent pixels as clear', () => {
    expect(stageClearFraction(new Uint8Array([0, 13, 14, 255]))).toBe(0.5);
    expect(stageClearFraction(new Uint8Array([]))).toBe(0);
  });

  const art = (clear: number | null) => ({ uri: 'art', clear });
  const wall = (clear: number | null) => ({ uri: 'wall', clear });

  test('a cut-out is the hero in front of a full-scene wallpaper', () => {
    expect(stageLayers({ artwork: art(0.6), wallpaper: wall(0) })).toEqual({
      ready: true,
      backdrop: 'wall',
      hero: 'art',
      frame: null,
    });
  });

  test('a full painting is the backdrop, whatever the wallpaper; an edge-only wallpaper frames it', () => {
    expect(stageLayers({ artwork: art(0.1), wallpaper: wall(0) })).toMatchObject({
      backdrop: 'art',
      hero: null,
      frame: null,
    });
    expect(stageLayers({ artwork: art(0), wallpaper: wall(0.4) })).toMatchObject({
      backdrop: 'art',
      frame: 'wall',
    });
  });

  test('an edge-only wallpaper is never the backdrop; with nothing else the colours are', () => {
    expect(stageLayers({ artwork: art(0.5), wallpaper: wall(0.3) })).toEqual({
      ready: true,
      backdrop: null,
      hero: 'art',
      frame: 'wall',
    });
    expect(stageLayers({})).toEqual({ ready: true, backdrop: null, hero: null, frame: null });
    // The thresholds are exclusive.
    expect(stageLayers({ artwork: art(0.15), wallpaper: wall(0.25) })).toMatchObject({
      backdrop: 'art',
      frame: null,
    });
  });

  test('waits while a picture that might be used is still being measured', () => {
    expect(stageLayers({ artwork: art(null), wallpaper: wall(0) }).ready).toBe(false);
    expect(stageLayers({ artwork: art(0.5), wallpaper: wall(null) })).toEqual({
      ready: false,
      backdrop: null,
      hero: null,
      frame: null,
    });
    expect(stageLayers({ wallpaper: wall(0) })).toMatchObject({ ready: true, backdrop: 'wall' });
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

  test('effects drop the motes first, then the sheen; Reduce Motion stills everything', () => {
    const gpu = { gpuAvailable: true, reducedMotion: false };
    expect(stageEffects('full', gpu)).toMatchObject({ particles: true, shimmer: true });
    expect(stageEffects('no-particles', gpu)).toMatchObject({ particles: false, shimmer: true });
    expect(stageEffects('capped', gpu)).toMatchObject({
      shimmer: false,
      frameIntervalMs: 1000 / 30,
    });
    expect(stageEffects('full', { gpuAvailable: false, reducedMotion: false }).gpu).toBe(false);
    expect(stageEffects('full', { gpuAvailable: true, reducedMotion: true })).toMatchObject({
      particles: true,
      pulse: false,
      tilt: false,
      idleIntervalMs: null,
    });
  });
});

describe('idle policy', () => {
  const effects = stageEffects('full', { gpuAvailable: true, reducedMotion: false });

  test('ambient motion runs at the idle rate, then stops drawing', () => {
    expect(stageIdleInterval(effects, 0)).toBe(effects.idleIntervalMs);
    expect(stageIdleInterval(effects, STAGE_AMBIENT_IDLE_MS - 1)).toBe(effects.idleIntervalMs);
    expect(stageIdleInterval(effects, STAGE_AMBIENT_IDLE_MS)).toBeNull();
  });

  test('a scene without ambient motion never idles on a timer', () => {
    const calm = stageEffects('full', { gpuAvailable: true, reducedMotion: true });
    expect(stageIdleInterval(calm, 0)).toBeNull();
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

  const agent = (
    id: string,
    status: 'working' | 'blocked' | 'idle' | 'done',
    extra: Record<string, unknown> = {}
  ) => ({ id, name: `pane ${id}`, agentLabel: `Agent ${id}`, status, hasAgent: true, ...extra });
  const mirror = (agents: readonly ReturnType<typeof agent>[], checkedAtMs = now) => ({
    a: { serverId: 'a', checkedAtMs, agents: [...agents] },
  });

  test('a busy face counts and orders: waiting first, then running, then the rest, overflow last', () => {
    const [panel] = stagePanels({
      ...base,
      agentsByServer: mirror([
        agent('1', 'idle'),
        agent('2', 'working'),
        agent('3', 'idle', { pendingUserInput: true }),
        agent('4', 'working'),
        agent('5', 'done'),
        { ...agent('6', 'working'), hasAgent: false },
      ]),
      recentEntries: [
        { key: 's', title: 's', atMs: now, destination: { type: 'pane', serverId: 'a' } },
      ] as never,
    });
    expect(panel!.workingCount).toBe(2);
    expect(panel!.needsYouCount).toBe(1);
    expect(panel!.working && panel!.attention).toBe(true);
    expect(panel!.face).toMatchObject({ kind: 'busy', more: 2 });
    const face = panel!.face as Extract<StageFace, { kind: 'busy' }>;
    expect(face.agents.map((line) => [line.name, line.mark])).toEqual([
      ['Agent 3', 'needs-you'],
      ['Agent 2', 'working'],
      ['Agent 4', 'working'],
    ]);
    // Session titles are the strip's: never on the face.
    expect(JSON.stringify(panel!.face)).not.toContain('"s"');
    expect(stageStreakLines(panel!.face)).toBe(0b110);
  });

  test('a native request and its blocked pane are one wait, not two', () => {
    const [panel] = stagePanels({
      ...base,
      agentsByServer: mirror([agent('1', 'blocked')]),
      attention: {
        k: { target: { serverId: 'a' } as never, requestIds: ['r'], observedAt: now },
      },
    });
    expect(panel!.needsYouCount).toBe(1);
    expect(panel!.workingCount).toBe(0);
    expect(stageStreakLines(panel!.face)).toBe(0);
  });

  test("activity comes from the agent's open task in its own shell, never for an idle agent", () => {
    const task = (
      taskId: string,
      binding: Record<string, unknown>,
      extra: Record<string, unknown>
    ) => ({
      taskId,
      state: 'working',
      kind: 'delegation',
      goal: 'g',
      binding: { kind: 'pane', sessionId: 'x', ...binding },
      updatedMs: now,
      ...extra,
    });
    const [panel] = stagePanels({
      ...base,
      agentsByServer: mirror([
        agent('1', 'working', { paneId: 'p1', shellPid: 10 }),
        agent('2', 'working', { paneId: 'p2', shellPid: 20 }),
        agent('3', 'idle', { paneId: 'p3' }),
        { ...agent('4', 'working'), name: 'Agent 4 · review' },
      ]),
      tasks: {
        a: {
          fetchedAt: now,
          tasks: [
            task('t1', { paneId: 'p1', shellPid: 10 }, { progress: ' running tests ', title: 'T' }),
            // A pane id reused by another shell is not this agent's task.
            task('t2', { paneId: 'p2', shellPid: 99 }, { progress: 'stale shell' }),
            task('t3', { paneId: 'p3' }, { progress: 'old' }),
            task(
              't4',
              { paneId: 'p1' },
              { progress: 'finished', state: 'done', updatedMs: now + 1 }
            ),
          ],
        },
      } as never,
    });
    const face = panel!.face as Extract<StageFace, { kind: 'busy' }>;
    expect(face.agents.map((line) => line.activity)).toEqual([
      'running tests',
      // No task: the pane title, which is more than the agent's name.
      'pane 2',
      // A title that repeats the agent's name keeps only what follows it.
      'review',
      // Idle: no activity.
      undefined,
    ]);
  });

  test('quiet and offline faces say when only from a real time', () => {
    const quiet = stagePanels({
      ...base,
      agentsByServer: mirror([agent('1', 'idle')]),
      recentEntries: [
        { key: 'x', title: 'x', atMs: now - 5000, destination: { type: 'pane', serverId: 'a' } },
        { key: 'y', title: 'y', atMs: now - 9000, destination: { type: 'pane', serverId: 'a' } },
      ] as never,
    });
    expect(quiet[0]!.face).toEqual({ kind: 'quiet', lastActivityMs: now - 5000 });
    expect(quiet[1]!.face).toEqual({ kind: 'offline' });
    const bare = stagePanels({
      ...base,
      agentsByServer: {
        b: { serverId: 'b', checkedAtMs: now - 7000, agents: [agent('2', 'working')] },
      },
    });
    expect(bare[0]!.face).toEqual({ kind: 'quiet' });
    // Offline: what the mirror last saw running is not running now.
    expect(bare[1]!.face).toEqual({ kind: 'offline', lastSeenMs: now - 7000 });
    expect(bare[1]!.working).toBe(false);
    const repair = stagePanels({
      ...base,
      connectionStatuses: { a: 'repair', b: 'offline' },
      agentsByServer: {},
    });
    expect(repair[0]!.face).toEqual({ kind: 'status' });
  });

  test('selection falls back to the first card when the target is gone', () => {
    expect(stageSelectedIndex(servers, 'b')).toBe(1);
    expect(stageSelectedIndex(servers, 'gone')).toBe(0);
    expect(stageSelectedIndex([], undefined)).toBe(0);
  });
});
