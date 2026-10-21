import { describe, expect, test } from 'bun:test';
import {
  projectStagePoint,
  stageCamera,
  stageCoverLayer,
  stageDiveCamera,
  stageDragPosition,
  stageDrawnScreens,
  stageFaceHeight,
  stageHeroPlacement,
  stageHostTarget,
  stagePaintingPlacement,
  stagePane,
  stagePaneAnchor,
  stageQuadRect,
  stageSwipeTarget,
  stageViewSize,
  stageWorldRect,
  wrapStageIndex,
  STAGE_FACE_CELL_HEIGHT,
  STAGE_FACE_CELL_WIDTH,
  STAGE_FACE_LINE_STEP,
  STAGE_FACE_MAX_ROWS,
  STAGE_FACE_MIN_ROWS,
  STAGE_FACE_SIDE_HEIGHT,
  STAGE_HERO_DEPTH,
  STAGE_HUD_BOTTOM_PT,
  STAGE_MAX_SCREENS,
  STAGE_PAINTING_OVERSCAN,
  STAGE_PANE_DEPTH,
} from '../home-stage-geometry';
import { stageClearFraction, stageComposition } from '../home-stage-layers';
import {
  createStageFrameBudget,
  lowestStageQuality,
  recordStageFrame,
  stageEffects,
  stageIdleInterval,
  STAGE_AMBIENT_IDLE_MS,
  stepStageSpring,
  STAGE_CARD_SPRING,
  type StageFrameBudget,
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

  test('a face is as tall as its rows: the name and two rows at least, the whole cell at most', () => {
    expect(stageFaceHeight(0)).toBe(stageFaceHeight(STAGE_FACE_MIN_ROWS));
    expect(stageFaceHeight(STAGE_FACE_MAX_ROWS)).toBe(STAGE_FACE_CELL_HEIGHT);
    expect(stageFaceHeight(9)).toBe(STAGE_FACE_CELL_HEIGHT);
    expect(stageFaceHeight(3) - stageFaceHeight(2)).toBe(STAGE_FACE_LINE_STEP);
    // The shortest front face is still taller than a side face.
    expect(stageFaceHeight(STAGE_FACE_MIN_ROWS)).toBeGreaterThan(STAGE_FACE_SIDE_HEIGHT);
  });

  test('a pane fits its face and hangs from the tallest pane top; a side pane fits its name', () => {
    const aspect = 390 / 844;
    const anchor = stagePaneAnchor(stageCamera(), aspect);
    const top = (pane: ReturnType<typeof stagePane>) => pane.position[1] + pane.height / 2;
    const tall = stagePane(0, anchor, aspect);
    const short = stagePane(0, anchor, aspect, stageFaceHeight(2));
    expect(tall.height).toBeCloseTo(tall.width * 0.625);
    expect(short.width).toBeCloseTo(tall.width);
    expect(short.height).toBeCloseTo((tall.width * stageFaceHeight(2)) / STAGE_FACE_CELL_WIDTH);
    expect(top(short)).toBeCloseTo(top(tall));
    // Never lower than the tallest pane reaches.
    expect(short.position[1] - short.height / 2).toBeGreaterThan(
      tall.position[1] - tall.height / 2
    );
    // At the side every pane is as tall as a side face, whatever its front says.
    const sideTall = stagePane(1, anchor, aspect);
    const sideShort = stagePane(1, anchor, aspect, stageFaceHeight(2));
    expect(sideTall.height).toBeCloseTo(sideShort.height);
    expect(sideTall.height).toBeCloseTo(
      (sideTall.width * STAGE_FACE_SIDE_HEIGHT) / STAGE_FACE_CELL_WIDTH
    );
    expect(top(sideShort)).toBeCloseTo(top(stagePane(1, anchor, aspect, STAGE_FACE_SIDE_HEIGHT)));
    // Halfway through a drag, halfway between the two heights.
    const half = stagePane(0.5, anchor, aspect, STAGE_FACE_CELL_HEIGHT);
    expect(half.height).toBeCloseTo(
      (half.width * (STAGE_FACE_CELL_HEIGHT + STAGE_FACE_SIDE_HEIGHT)) / 2 / STAGE_FACE_CELL_WIDTH
    );
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

  test('a theme plane hung in the world projects back onto its box at rest', () => {
    const viewport = { width: 390, height: 844, inset: 47 };
    const box = { x: 40, y: 120, width: 300, height: 200 };
    const placed = stageWorldRect(box, STAGE_HERO_DEPTH, viewport);
    const rect = stageQuadRect(placed.position, placed.width, placed.height, 0, camera, 390, 844);
    // The camera looks a little down, so the plane leans: within a few points.
    expect(Math.abs(rect.x - box.x)).toBeLessThan(3);
    expect(Math.abs(rect.width - box.width)).toBeLessThan(4);
    expect(Math.abs(rect.y - box.y)).toBeLessThan(3);
    expect(Math.abs(rect.height - box.height)).toBeLessThan(3);
  });
});

describe('theme layout', () => {
  const viewport = { width: 390, height: 844, inset: 47 };
  const aspect = 390 / 844;
  const centre = { x: 0.5, y: 0.5 };

  test('a cover layer fits its picture as CSS object-fit and object-position do', () => {
    // A wide picture covering a tall view: the slack is cropped by the focal point.
    const left = stageCoverLayer(
      { aspect: 2, fit: 'cover', focal: { x: 0, y: 0.5 } },
      60,
      1.22,
      aspect
    );
    expect(left.uv.x).toBeCloseTo(0);
    expect(left.uv.height).toBeCloseTo(1);
    const right = stageCoverLayer({ aspect: 2, focal: { x: 1, y: 0.5 } }, 60, 1.22, aspect);
    expect(right.uv.x + right.uv.width).toBeCloseTo(1);
    const middle = stageCoverLayer({ aspect: 2, fit: 'tile', focal: centre }, 60, 1.22, aspect);
    expect(middle.uv.x + middle.uv.width / 2).toBeCloseTo(0.5);
    // Contained: the whole picture, its slack placed by the focal point.
    const top = stageCoverLayer(
      { aspect: 2, fit: 'contain', focal: { x: 0.5, y: 0 } },
      60,
      1,
      aspect
    );
    expect(top.uv.x).toBeCloseTo(0);
    expect(top.uv.width).toBeCloseTo(1);
    expect(top.uv.y).toBeCloseTo(0);
    expect(top.uv.height).toBeGreaterThan(1);
  });

  test('a sky painting spans the band at full width, its top kept, fading from 68 % of the 2D cover box', () => {
    const art = stagePaintingPlacement(
      { aspect: 0.95, fit: 'cover', focal: { x: 0.5, y: 0 } },
      viewport
    );
    // All of the painting's width shows; the band is the view plus the painting's overscan.
    expect(art.uv.x).toBeCloseTo(0);
    expect(art.uv.width).toBeCloseTo(1);
    expect(art.uv.y).toBeCloseTo(0);
    expect(art.plane.width).toBeCloseTo(390 * STAGE_PAINTING_OVERSCAN);
    // The band is the 2D cover box (0.9 of the width) at the band's width.
    expect(art.box.height / art.box.width).toBeCloseTo(0.9);
    expect(art.plane.y + art.plane.height).toBeCloseTo(art.box.y + art.box.height);
    const fadeAt = art.plane.y + art.plane.height * art.fade.from;
    expect(fadeAt).toBeCloseTo(art.box.y + art.box.height * 0.68);
    expect(art.fade.to).toBeCloseTo(1);
    // A wide contain painting keeps its natural height: nothing cropped, the band ends where it does.
    const wide = stagePaintingPlacement({ aspect: 2, fit: 'contain', focal: centre }, viewport);
    expect(wide.uv).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  const hero = (
    overrides: Partial<Parameters<typeof stageHeroPlacement>[0]> = {}
  ): Parameters<typeof stageHeroPlacement>[0] => ({
    aspect: 0.6,
    fit: 'contain',
    focal: centre,
    box: 'cover',
    feather: 'cover',
    ...overrides,
  });

  test('a figure stands in the 2D cover box under the name, at its focal point', () => {
    const art = stageHeroPlacement(hero({ focal: { x: 0.62, y: 0.35 } }), viewport);
    expect(art.box.width).toBe(390);
    expect(art.box.height).toBeCloseTo(351);
    // Tucked 35 % into the name's 36 pt line, which ends 63 pt below the inset.
    expect(art.box.y).toBeCloseTo(47 + 63 - 36 * 0.35);
    // Contained: the whole figure, the side slack split 62:38 like object-position.
    expect(art.uv.x).toBeCloseTo(0);
    expect(art.uv.width).toBeCloseTo(1);
    expect(art.uv.height).toBeCloseTo(1);
    expect(art.drawn.height).toBeCloseTo(351);
    const slack = 390 - art.drawn.width;
    expect(art.drawn.x).toBeCloseTo(slack * 0.62);
    expect(art.plane.y + art.plane.height * art.fade.from).toBeCloseTo(art.box.y + 351 * 0.68);
    expect(art.edges).toEqual({ x: 0, y: 0 });
  });

  test("a covered figure is cropped at its focal x, keeping its top, as Editorial's", () => {
    const art = stageHeroPlacement(hero({ fit: 'cover', focal: { x: 0.58, y: 0.35 } }), viewport);
    expect(art.uv.y).toBeCloseTo(0);
    expect(art.uv.height).toBeLessThan(1);
    expect(art.uv.width).toBeCloseTo(1);
    expect(art.plane).toEqual(art.box);
    // A wide figure is cropped at the sides, around its focal x.
    const wide = stageHeroPlacement(
      hero({ aspect: 2, fit: 'cover', focal: { x: 0.25, y: 0 } }),
      viewport
    );
    expect(wide.uv.width).toBeLessThan(1);
    expect(wide.uv.x).toBeCloseTo((1 - wide.uv.width) * 0.25);
    // Without a fit, Editorial covers too.
    expect(stageHeroPlacement(hero({ fit: undefined }), viewport).uv.height).toBeLessThan(1);
  });

  test('an inset picture is smaller, below the HUD; a cut-out fades at 72 %, a painting at every edge', () => {
    const cut = stageHeroPlacement(
      hero({ box: 'standard', feather: 'inset', aspect: 1.4 }),
      viewport
    );
    expect(cut.box.height).toBe(195);
    expect(cut.box.y).toBeGreaterThan(47 + STAGE_HUD_BOTTOM_PT);
    expect(cut.plane.height).toBeLessThan(
      stageHeroPlacement(hero({ aspect: 1.4 }), viewport).plane.height
    );
    expect(cut.plane.y + cut.plane.height * cut.fade.from).toBeCloseTo(cut.box.y + 195 * 0.72);
    const framed = stageHeroPlacement(
      hero({ box: 'standard', feather: 'framed', aspect: 1.4 }),
      viewport
    );
    expect(framed.fade.from).toBeGreaterThan(1);
    expect(framed.edges).toEqual({ x: 0.22, y: 0.32 });
  });

  test('every role has a new-task target below the HUD and above the panes', () => {
    const pane = stagePane(0, stagePaneAnchor(stageCamera(), aspect), aspect);
    const paneTop = stageQuadRect(
      pane.position,
      pane.width,
      pane.height,
      0,
      stageCamera(),
      390,
      844
    ).y;
    const hud = 47 + STAGE_HUD_BOTTOM_PT;
    const targets = [
      stageHostTarget({ kind: 'hero', placement: stageHeroPlacement(hero(), viewport) }, viewport),
      stageHostTarget(
        {
          kind: 'hero',
          placement: stageHeroPlacement(hero({ box: 'standard', feather: 'inset' }), viewport),
        },
        viewport
      ),
      stageHostTarget(
        {
          kind: 'painting',
          placement: stagePaintingPlacement({ aspect: 1, fit: 'cover', focal: centre }, viewport),
        },
        viewport
      ),
      stageHostTarget(null, viewport),
    ];
    for (const { rect, hint } of targets) {
      expect(rect.width).toBeGreaterThan(80);
      expect(rect.height).toBeGreaterThan(48);
      expect(rect.y + rect.height).toBeGreaterThan(hud + 48);
      // The hint chip hangs above its point: the point stays clear of the HUD.
      expect(hint.y).toBeGreaterThanOrEqual(hud + 44);
      expect(hint.y).toBeLessThan(paneTop);
    }
    // The painting's target starts below the HUD, the synthetic one ends above the panes.
    expect(targets[2]!.rect.y).toBe(hud);
    expect(targets[3]!.rect.y + targets[3]!.rect.height).toBeLessThan(paneTop);
  });
});

describe('composition', () => {
  test('counts near-transparent pixels as clear', () => {
    expect(stageClearFraction(new Uint8Array([0, 13, 14, 255]))).toBe(0.5);
    expect(stageClearFraction(new Uint8Array([]))).toBe(0);
  });

  const art = (clear: number | null, extra = {}) => ({ uri: 'art', clear, aspect: 0.9, ...extra });
  const wall = (clear: number | null, extra = {}) => ({
    uri: 'wall',
    clear,
    aspect: 0.5,
    ...extra,
  });
  const pick = (composition: ReturnType<typeof stageComposition>) => ({
    role: composition.role,
    backdrop: composition.backdrop?.uri ?? null,
    painting: composition.painting?.uri ?? null,
    hero: composition.hero?.uri ?? null,
    frame: composition.frame?.uri ?? null,
  });

  test('a cover header over a painting is the sky: the painting a band, the wallpaper its base or frame', () => {
    expect(
      pick(stageComposition({ coverHeader: true, artwork: art(0), wallpaper: wall(0) }))
    ).toEqual({
      role: 'sky',
      backdrop: 'wall',
      painting: 'art',
      hero: null,
      frame: null,
    });
    // A painting never drops the wallpaper, and an edge-only one frames it.
    expect(
      pick(stageComposition({ coverHeader: true, artwork: art(0.1), wallpaper: wall(0.4) }))
    ).toEqual({
      role: 'sky',
      backdrop: null,
      painting: 'art',
      hero: null,
      frame: 'wall',
    });
  });

  test('a cover header over a cut-out is the figure in the cover box', () => {
    const figure = stageComposition({ coverHeader: true, artwork: art(0.6), wallpaper: wall(0) });
    expect(pick(figure)).toEqual({
      role: 'figure',
      backdrop: 'wall',
      painting: null,
      hero: 'art',
      frame: null,
    });
    expect(figure.hero).toMatchObject({ box: 'cover', feather: 'cover', cutout: true });
    expect(
      pick(stageComposition({ coverHeader: true, artwork: art(0.6), wallpaper: wall(0.3) }))
    ).toMatchObject({ role: 'figure', backdrop: null, frame: 'wall' });
  });

  test('a standard header insets its artwork; a painting there is framed, never the backdrop', () => {
    const cut = stageComposition({ coverHeader: false, artwork: art(0.5), wallpaper: wall(0) });
    expect(pick(cut)).toMatchObject({ role: 'inset', backdrop: 'wall', hero: 'art' });
    expect(cut.hero).toMatchObject({ box: 'standard', feather: 'inset', cutout: true });
    const opaque = stageComposition({ coverHeader: false, artwork: art(0) });
    expect(pick(opaque)).toMatchObject({
      role: 'inset',
      backdrop: null,
      painting: null,
      hero: 'art',
    });
    expect(opaque.hero).toMatchObject({ feather: 'framed', cutout: false });
  });

  test('without artwork the wallpaper is the world, or its frame when only edges', () => {
    expect(pick(stageComposition({ coverHeader: true, wallpaper: wall(0) }))).toEqual({
      role: 'world',
      backdrop: 'wall',
      painting: null,
      hero: null,
      frame: null,
    });
    expect(pick(stageComposition({ coverHeader: false, wallpaper: wall(0.4) }))).toMatchObject({
      role: 'world',
      backdrop: null,
      frame: 'wall',
    });
    expect(pick(stageComposition({ coverHeader: false }))).toMatchObject({
      role: 'world',
      backdrop: null,
    });
    // The thresholds are exclusive.
    expect(
      pick(stageComposition({ coverHeader: true, artwork: art(0.15), wallpaper: wall(0.25) }))
    ).toMatchObject({ role: 'sky', backdrop: 'wall', frame: null });
  });

  test("keeps each slot's fit, focal point and opacity, clamped, with CSS defaults", () => {
    const composed = stageComposition({
      coverHeader: true,
      artwork: art(0.6, { fit: 'cover', focal: { x: 0.58, y: 2 }, opacity: 0.8 }),
      wallpaper: wall(0, { fit: 'cover', opacity: 0.45 }),
    });
    expect(composed.hero).toMatchObject({
      fit: 'cover',
      focal: { x: 0.58, y: 1 },
      opacity: 0.8,
      aspect: 0.9,
    });
    expect(composed.backdrop).toMatchObject({ focal: { x: 0.5, y: 0.5 }, opacity: 0.45 });
    expect(
      stageComposition({ coverHeader: false, wallpaper: { uri: 'w', clear: 0 } }).backdrop
    ).toMatchObject({
      aspect: 1,
      opacity: 1,
      fit: undefined,
    });
  });

  test('waits while a picture that might be used is still being measured', () => {
    expect(
      stageComposition({ coverHeader: true, artwork: art(null), wallpaper: wall(0) })
    ).toMatchObject({
      ready: false,
      backdrop: null,
      painting: null,
      hero: null,
    });
    expect(
      stageComposition({ coverHeader: true, artwork: art(0.5), wallpaper: wall(null) }).ready
    ).toBe(false);
    expect(stageComposition({ coverHeader: true, wallpaper: wall(0) }).ready).toBe(true);
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

  /** Frames of `frameMs` from `fromMs` until `untilMs`; returns the last quality. */
  const run = (
    budget: StageFrameBudget,
    frameMs: number | ((index: number) => number),
    untilMs: number,
    fromMs = 0
  ) => {
    let now = fromMs;
    let quality = budget.quality;
    for (let index = 0; now < untilMs; index += 1) {
      const ms = typeof frameMs === 'number' ? frameMs : frameMs(index);
      now += ms;
      quality = recordStageFrame(budget, { nowMs: now, frameMs: ms });
    }
    return quality;
  };

  test('steps down one rung when a two-second window runs over budget', () => {
    expect(run(createStageFrameBudget(), 30, 1900)).toBe('full');
    expect(run(createStageFrameBudget(), 30, 2100)).toBe('reduced');
    expect(run(createStageFrameBudget(), 1000 / 60, 20_000)).toBe('full');
  });

  test('judges the 90th percentile, not the average', () => {
    // One frame in five misses vsync: the average is fine, the reader sees stutter.
    expect(run(createStageFrameBudget(), (i) => (i % 5 === 0 ? 34 : 16), 2100)).toBe('reduced');
    // One in twenty is a hiccup, not a trend.
    expect(run(createStageFrameBudget(), (i) => (i % 20 === 0 ? 40 : 16), 10_000)).toBe('full');
  });

  test('stalls, pauses and sparse frames are not evidence', () => {
    const budget = createStageFrameBudget();
    expect(recordStageFrame(budget, { nowMs: 0, frameMs: 900 })).toBe('full');
    // Slow frames in short bursts with pauses between never fill a window.
    for (let burst = 0; burst < 10; burst += 1) run(budget, 30, burst * 3000 + 900, burst * 3000);
    expect(budget.quality).toBe('full');
    // Too few frames to judge.
    expect(run(createStageFrameBudget(), 200, 5000)).toBe('full');
  });

  test('never climbs back, and ends static', () => {
    const budget = createStageFrameBudget();
    run(budget, 30, 2100);
    expect(run(budget, 1000 / 60, 20_000, 2100)).toBe('reduced');
    expect(run(budget, 30, 29_000, 20_000)).toBe('static');
    expect(run(budget, 1000 / 60, 40_000, 29_000)).toBe('static');
    expect(lowestStageQuality('reduced', 'full')).toBe('reduced');
    expect(lowestStageQuality('reduced', 'low')).toBe('low');
  });

  test('each rung costs less; Reduce Motion stills everything', () => {
    const gpu = { gpuAvailable: true, reducedMotion: false };
    expect(stageEffects('full', gpu)).toMatchObject({
      particles: true,
      particleShare: 1,
      reflections: true,
      shimmer: true,
      maxDpr: 1.5,
      frameIntervalMs: 0,
    });
    expect(stageEffects('reduced', gpu)).toMatchObject({
      particles: true,
      particleShare: 0.5,
      reflections: false,
      shimmer: true,
      maxDpr: 1.25,
      frameIntervalMs: 0,
    });
    expect(stageEffects('low', gpu)).toMatchObject({
      particles: false,
      reflections: false,
      shimmer: false,
      maxDpr: 1,
      frameIntervalMs: 1000 / 30,
    });
    expect(stageEffects('full', gpu).glideIntervalMs).toBe(1000 / 30);
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
    expect(quiet[0]!.face).toEqual({
      kind: 'quiet',
      idle: ['Agent 1'],
      lastActivityMs: now - 5000,
    });
    expect(quiet[1]!.face).toEqual({ kind: 'offline' });
    const bare = stagePanels({
      ...base,
      agentsByServer: {
        b: { serverId: 'b', checkedAtMs: now - 7000, agents: [agent('2', 'working')] },
      },
    });
    expect(bare[0]!.face).toEqual({ kind: 'quiet', idle: [] });
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
