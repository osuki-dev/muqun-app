import { describe, expect, test } from 'bun:test';
import {
  projectStagePoint,
  stageCamera,
  stageCoverLayer,
  stageDiveCamera,
  stageDragPosition,
  stageHeroPlacement,
  stageIdleDrift,
  stageLayerCentre,
  stageOverlayBand,
  stagePaintingPlacement,
  stageSwipePan,
  stageSwipeTarget,
  stageWorldRect,
  wrapStageIndex,
  STAGE_BACKDROP_DEPTH,
  STAGE_FRAME_DEPTH,
  STAGE_FRAME_OVERSCAN,
  STAGE_HERO_DEPTH,
  STAGE_HUD_BOTTOM_PT,
  STAGE_PAINTING_DEPTH,
  STAGE_PAINTING_OVERSCAN,
  type StageArtPlacement,
  type StageViewport,
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
  stageAgentRow,
  stagePanels,
  stageSelectedIndex,
  type StageAgentLine,
} from '../home-stage-panels';

/** A phone: the foot rows (agents, sessions, composer) start 224 pt above the bottom. */
const PHONE: StageViewport = { width: 390, height: 844, inset: 47, floor: 620 };
const PHONES: StageViewport[] = [
  PHONE,
  { width: 393, height: 873, inset: 54, floor: 640 },
  { width: 360, height: 800, inset: 24, floor: 584 },
  { width: 412, height: 915, inset: 48, floor: 690 },
];
const centre = { x: 0.5, y: 0.5 };

/** Where a layer's point at `depth` lands on a phone, seen by `camera`. */
const seen = (depth: number, camera = stageCamera()) =>
  projectStagePoint(stageLayerCentre(depth), camera, PHONE.width, PHONE.height);

describe('computers', () => {
  test('wraps an index in both directions and survives an empty list', () => {
    expect(wrapStageIndex(-1, 4)).toBe(3);
    expect(wrapStageIndex(9, 4)).toBe(1);
    expect(wrapStageIndex(3, 0)).toBe(0);
    expect(wrapStageIndex(Number.NaN, 3)).toBe(0);
  });

  test('a swipe settles on the nearest computer, at least one step when long or fast, never past an end', () => {
    // Short and slow: stays.
    expect(stageSwipeTarget(1, 4, -20, -50, 400)).toBe(1);
    // Long enough for a step but not for the next to be nearest.
    expect(stageSwipeTarget(1, 4, -60, 0, 400)).toBe(2);
    expect(stageSwipeTarget(1, 4, 60, 0, 400)).toBe(0);
    // A fast flick steps too.
    expect(stageSwipeTarget(1, 4, -10, -900, 400)).toBe(2);
    // Dragged across two computers' worth.
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

  test('each computer looks in from its own place on one track; a swipe travels it continuously', () => {
    expect(stageSwipePan(0, 1)).toBe(0);
    expect(stageSwipePan(0, 0)).toBe(0);
    // Two: half a pan either side of the middle. Three: the whole track.
    expect(stageSwipePan(0, 2)).toBeCloseTo(-0.5);
    expect(stageSwipePan(1, 2)).toBeCloseTo(0.5);
    expect([0, 1, 2].map((flow) => stageSwipePan(flow, 3))).toEqual([-1, 0, 1]);
    // Many: smaller steps on the same track, never past it.
    expect(stageSwipePan(1, 9) - stageSwipePan(0, 9)).toBeCloseTo(0.25);
    expect(stageSwipePan(-0.35, 9)).toBe(-1);
    expect(stageSwipePan(8.35, 9)).toBe(1);
    // Halfway through a swipe, halfway between.
    expect(stageSwipePan(0.5, 3)).toBeCloseTo(-0.5);
    expect(stageSwipePan(Number.NaN, 3)).toBe(0);
  });
});

describe('camera and parallax', () => {
  test('at rest, a layer at any depth sits where it was laid out', () => {
    for (const depth of [STAGE_BACKDROP_DEPTH, STAGE_HERO_DEPTH, STAGE_FRAME_DEPTH]) {
      const at = seen(depth);
      expect(at.x).toBeCloseTo(195, 3);
      expect(at.y).toBeCloseTo(422, 3);
    }
  });

  test('tilt and a pan slide every layer the same way, the nearer the further', () => {
    for (const camera of [
      stageCamera({ lookX: 1, lookY: 1 }),
      stageCamera({ lookX: -1 }),
      stageCamera({ pan: 1 }),
    ]) {
      const shift = (depth: number) => {
        const moved = seen(depth, camera);
        const rest = seen(depth);
        return { x: moved.x - rest.x, y: moved.y - rest.y };
      };
      const order = [
        STAGE_BACKDROP_DEPTH,
        STAGE_PAINTING_DEPTH,
        STAGE_HERO_DEPTH,
        STAGE_FRAME_DEPTH,
      ];
      const shifts = order.map(shift);
      for (let index = 1; index < shifts.length; index += 1) {
        expect(Math.abs(shifts[index]!.x)).toBeGreaterThan(Math.abs(shifts[index - 1]!.x));
        expect(Math.sign(shifts[index]!.x)).toBe(Math.sign(shifts[0]!.x));
      }
    }
    // Soft: at full tilt the hero moves about 12 pt, the wallpaper a third of that.
    const tilted = stageCamera({ lookX: 1 });
    const hero = Math.abs(seen(STAGE_HERO_DEPTH, tilted).x - 195);
    expect(hero).toBeGreaterThan(8);
    expect(hero).toBeLessThan(16);
    expect(Math.abs(seen(STAGE_BACKDROP_DEPTH, tilted).x - 195)).toBeLessThan(hero / 2.5);
  });

  test("the frame's overscan covers full tilt and the whole pan at once", () => {
    const worst = stageCamera({ lookX: 1, lookY: 1, pan: 1 });
    const shift = Math.abs(seen(STAGE_FRAME_DEPTH, worst).x - 195);
    expect(shift).toBeLessThan((PHONE.width * (STAGE_FRAME_OVERSCAN - 1)) / 2);
    // Inputs past their range are held at it.
    expect(stageCamera({ lookX: 4, pan: 9 }).position).toEqual(
      stageCamera({ lookX: 1, pan: 1 }).position
    );
  });

  test('the idle drift is slow and small, and holds where the ambient clock holds', () => {
    expect(stageIdleDrift(0)).toEqual(stageIdleDrift(0));
    for (let t = 0; t < 60; t += 0.7) {
      const [x, y] = stageIdleDrift(t);
      expect(Math.abs(x)).toBeLessThanOrEqual(0.22);
      expect(Math.abs(y)).toBeLessThanOrEqual(0.14);
      // A 20 fps frame moves it by a sliver of a look.
      const [nx, ny] = stageIdleDrift(t + 0.05);
      expect(Math.abs(nx - x) + Math.abs(ny - y)).toBeLessThan(0.01);
    }
    expect(stageIdleDrift(Number.NaN)).toEqual(stageIdleDrift(0));
  });

  test('a dive pushes the camera straight in towards the art, which grows', () => {
    const camera = stageCamera();
    expect(stageDiveCamera(camera, 0)).toBe(camera);
    const dived = stageDiveCamera(camera, 1);
    expect(dived.target).toEqual(camera.target);
    const near = projectStagePoint(stageLayerCentre(STAGE_HERO_DEPTH), dived, 390, 844);
    expect(near.x).toBeCloseTo(195, 3);
    expect(near.y).toBeCloseTo(422, 3);
    expect(near.depth).toBeLessThan(STAGE_HERO_DEPTH * 0.7);
    expect(projectStagePoint([0, 0, 50], camera, 390, 844).visible).toBe(false);
  });

  test('a theme plane hung in the world projects back onto its box at rest', () => {
    const box = { x: 40, y: 120, width: 300, height: 200 };
    const camera = stageCamera();
    for (const depth of [STAGE_HERO_DEPTH, STAGE_PAINTING_DEPTH]) {
      const placed = stageWorldRect(box, depth, PHONE);
      const [x, y, z] = placed.position;
      const corner = (u: number, v: number) =>
        projectStagePoint([x + u * placed.width, y + v * placed.height, z], camera, 390, 844);
      const topLeft = corner(-0.5, 0.5);
      const bottomRight = corner(0.5, -0.5);
      // The camera looks a little down, so the plane leans: within a few points.
      expect(Math.abs(topLeft.x - box.x)).toBeLessThan(3);
      expect(Math.abs(bottomRight.x - topLeft.x - box.width)).toBeLessThan(4);
      expect(Math.abs(topLeft.y - box.y)).toBeLessThan(3);
      expect(Math.abs(bottomRight.y - topLeft.y - box.height)).toBeLessThan(3);
    }
  });
});

describe('theme layout', () => {
  const hudBottom = (viewport: StageViewport) => viewport.inset + STAGE_HUD_BOTTOM_PT;
  /** Where the art is still whole: its plane down to where its foot starts to fade. */
  const body = (art: StageArtPlacement) =>
    art.plane.y + art.plane.height * Math.min(1, art.fade.from);
  const foot = (art: StageArtPlacement) => art.plane.y + art.plane.height;

  test('a cover layer fits its picture as CSS object-fit and object-position do', () => {
    const aspect = 390 / 844;
    // A wide picture covering a tall view: the slack is cropped by the focal point.
    const left = stageCoverLayer(
      { aspect: 2, fit: 'cover', focal: { x: 0, y: 0.5 } },
      48,
      1.22,
      aspect
    );
    expect(left.uv.x).toBeCloseTo(0);
    expect(left.uv.height).toBeCloseTo(1);
    const right = stageCoverLayer({ aspect: 2, focal: { x: 1, y: 0.5 } }, 48, 1.22, aspect);
    expect(right.uv.x + right.uv.width).toBeCloseTo(1);
    const middle = stageCoverLayer({ aspect: 2, fit: 'tile', focal: centre }, 48, 1.22, aspect);
    expect(middle.uv.x + middle.uv.width / 2).toBeCloseTo(0.5);
    // Contained: the whole picture, its slack placed by the focal point.
    const top = stageCoverLayer(
      { aspect: 2, fit: 'contain', focal: { x: 0.5, y: 0 } },
      48,
      1,
      aspect
    );
    expect(top.uv.x).toBeCloseTo(0);
    expect(top.uv.width).toBeCloseTo(1);
    expect(top.uv.y).toBeCloseTo(0);
    expect(top.uv.height).toBeGreaterThan(1);
  });

  test('a sky painting fills the window from the top down to the foot rows, its top kept', () => {
    for (const viewport of PHONES) {
      const art = stagePaintingPlacement({ aspect: 0.9, fit: 'cover', focal: centre }, viewport);
      // The band is the view plus the painting's overscan, bleeding past the top.
      expect(art.box.width).toBeCloseTo(viewport.width * STAGE_PAINTING_OVERSCAN);
      expect(art.plane.y).toBeLessThan(0);
      expect(art.uv.y).toBeCloseTo(0);
      // Grown to reach the foot rows: whole down to just above them, fading behind them.
      expect(body(art)).toBeGreaterThan(viewport.floor - 60);
      expect(body(art)).toBeLessThan(viewport.floor);
      expect(foot(art)).toBeGreaterThan(viewport.floor);
      expect(art.fade.to).toBe(1);
      // Its sides cropped around the focal point, never more than the zoom allows.
      expect(art.uv.width).toBeLessThan(1);
      expect(art.uv.x).toBeCloseTo((1 - art.uv.width) / 2);
      expect(art.uv.width).toBeGreaterThan(1 / 1.5);
    }
    // A focal point to the left keeps the left.
    const left = stagePaintingPlacement({ aspect: 1, fit: 'cover', focal: { x: 0, y: 0 } }, PHONE);
    expect(left.uv.x).toBeCloseTo(0);
    // A wide one grows only so far, then ends short of the foot rows, fading over its end.
    const wider = stagePaintingPlacement({ aspect: 1.6, fit: 'cover', focal: centre }, PHONE);
    expect(wider.drawn.width).toBeCloseTo(390 * STAGE_PAINTING_OVERSCAN * 1.5);
    expect(foot(wider)).toBeLessThan(PHONE.floor);
    expect(foot(wider) - body(wider)).toBeGreaterThan(60);
    // Contained: its whole width at its natural height, fading over its own last part.
    const wide = stagePaintingPlacement({ aspect: 2, fit: 'contain', focal: centre }, PHONE);
    expect(wide.uv).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(foot(wide)).toBeLessThan(PHONE.floor);
    expect(wide.fade.from).toBeGreaterThan(0.6);
    expect(wide.fade.from).toBeLessThan(0.75);
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

  test('a figure stands large on the foot rows, tucked under the name, at its focal x', () => {
    for (const viewport of PHONES) {
      const art = stageHeroPlacement(hero({ focal: { x: 0.62, y: 0.2 } }), viewport);
      // Tucked 35 % into the name's 36 pt line, which ends 63 pt below the inset.
      expect(art.box.y).toBeCloseTo(viewport.inset + 63 - 36 * 0.35);
      expect(art.box.width).toBe(viewport.width);
      // A tall figure: as tall as the box, the whole picture, its feet behind the foot rows.
      expect(art.uv).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      expect(art.drawn.height).toBeCloseTo(art.box.height);
      expect(art.drawn.height).toBeGreaterThan(viewport.height * 0.6);
      expect(foot(art)).toBeGreaterThan(viewport.floor);
      expect(body(art)).toBeGreaterThan(viewport.floor - 60);
      expect(body(art)).toBeLessThan(viewport.floor);
      // The side slack split 62:38 like object-position.
      const slack = viewport.width - art.drawn.width;
      expect(art.drawn.x).toBeCloseTo(slack * 0.62);
      expect(art.edges).toEqual({ x: 0, y: 0 });
    }
  });

  test('a wide contained figure grows a little past the width and still stands on the foot rows', () => {
    const art = stageHeroPlacement(hero({ aspect: 1.5, focal: { x: 0.3, y: 0.5 } }), PHONE);
    expect(art.drawn.width).toBeGreaterThan(390);
    expect(art.drawn.width).toBeLessThanOrEqual(390 * 1.3 + 1e-6);
    expect(art.drawn.x).toBeCloseTo((390 - art.drawn.width) * 0.3);
    expect(art.drawn.y + art.drawn.height).toBeCloseTo(art.box.y + art.box.height);
    expect(foot(art)).toBeGreaterThan(PHONE.floor);
  });

  test("a covered figure fills its box, cropped at its focal x and keeping its top, as Editorial's", () => {
    const art = stageHeroPlacement(hero({ fit: 'cover', focal: { x: 0.58, y: 0.35 } }), PHONE);
    expect(art.uv.y).toBeCloseTo(0);
    expect(art.plane).toEqual(art.box);
    const wide = stageHeroPlacement(
      hero({ aspect: 2, fit: 'cover', focal: { x: 0.25, y: 0 } }),
      PHONE
    );
    expect(wide.uv.width).toBeLessThan(1);
    expect(wide.uv.x).toBeCloseTo((1 - wide.uv.width) * 0.25);
    // Without a fit, Editorial covers too.
    expect(stageHeroPlacement(hero({ fit: undefined, aspect: 1 }), PHONE).plane).toEqual(
      stageHeroPlacement(hero({ fit: undefined, aspect: 1 }), PHONE).box
    );
  });

  test('an inset picture is centred, larger, between the HUD and the foot rows', () => {
    for (const viewport of PHONES) {
      const room = { top: hudBottom(viewport), bottom: viewport.floor };
      const cut = stageHeroPlacement(
        hero({ box: 'standard', feather: 'inset', aspect: 1.5 }),
        viewport
      );
      expect(cut.box.y).toBeGreaterThan(room.top);
      expect(cut.box.y + cut.box.height).toBeLessThan(room.bottom);
      // Centred in the room, and wider than the view (its sides cropped).
      const middle = cut.box.y + cut.box.height / 2;
      expect(middle).toBeCloseTo((room.top + 8 + room.bottom - 8) / 2);
      expect(cut.drawn.width).toBeGreaterThan(viewport.width);
      expect(cut.plane.y + cut.plane.height * cut.fade.from).toBeCloseTo(
        cut.plane.y + cut.plane.height * 0.72
      );
      // A tall picture is limited by the room's height instead.
      const tall = stageHeroPlacement(
        hero({ box: 'standard', feather: 'inset', aspect: 0.6 }),
        viewport
      );
      expect(tall.box.height).toBeCloseTo(room.bottom - 8 - (room.top + 8));
      expect(tall.drawn.height).toBeCloseTo(tall.box.height);
    }
    const framed = stageHeroPlacement(
      hero({ box: 'standard', feather: 'framed', aspect: 1.4 }),
      PHONE
    );
    expect(framed.fade.from).toBeGreaterThan(1);
    expect(framed.edges).toEqual({ x: 0.22, y: 0.32 });
  });

  test("the overlay band sits under the HUD and a figure's face, over the foot rows", () => {
    for (const viewport of PHONES) {
      const figure = stageHeroPlacement(hero(), viewport);
      const bands = [
        { band: stageOverlayBand({ kind: 'hero', placement: figure }, viewport), plane: figure },
        {
          band: stageOverlayBand(
            {
              kind: 'hero',
              placement: stageHeroPlacement(hero({ box: 'standard', feather: 'inset' }), viewport),
            },
            viewport
          ),
          plane: null,
        },
        {
          band: stageOverlayBand(
            {
              kind: 'painting',
              placement: stagePaintingPlacement(
                { aspect: 1, fit: 'cover', focal: centre },
                viewport
              ),
            },
            viewport
          ),
          plane: null,
        },
        { band: stageOverlayBand(null, viewport), plane: null },
      ];
      for (const { band, plane } of bands) {
        expect(band.top).toBeGreaterThan(hudBottom(viewport));
        expect(band.bottom).toBeLessThan(viewport.floor);
        // Room for a two-line card with its actions.
        expect(band.bottom - band.top).toBeGreaterThanOrEqual(120);
        if (plane) {
          // Clear of the head: well into the figure's visible body.
          const shown = Math.max(plane.plane.y, hudBottom(viewport));
          expect(band.top).toBeGreaterThan(shown + (viewport.floor - shown) * 0.3);
        }
      }
    }
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

  test('never climbs back, and stops at low rather than going static', () => {
    const budget = createStageFrameBudget();
    run(budget, 30, 2100);
    expect(run(budget, 1000 / 60, 20_000, 2100)).toBe('reduced');
    expect(run(budget, 30, 29_000, 20_000)).toBe('low');
    expect(run(budget, 1000 / 60, 40_000, 29_000)).toBe('low');
    expect(lowestStageQuality('reduced', 'full')).toBe('reduced');
    expect(lowestStageQuality('reduced', 'low')).toBe('low');
  });

  test('each rung costs less; Reduce Motion stills everything', () => {
    const gpu = { gpuAvailable: true, reducedMotion: false };
    expect(stageEffects('full', gpu)).toMatchObject({
      particles: true,
      particleShare: 1,
      maxDpr: 1.5,
      frameIntervalMs: 0,
    });
    expect(stageEffects('reduced', gpu)).toMatchObject({
      particles: true,
      particleShare: 0.5,
      maxDpr: 1.25,
      frameIntervalMs: 0,
    });
    // The cheapest 3D rung: no particles, 1x, 30 fps.
    expect(stageEffects('low', gpu)).toMatchObject({
      particles: false,
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

  test('agents count and order: waiting first, then running, then the rest; a plain pane is no agent', () => {
    const [panel] = stagePanels({
      ...base,
      agentsByServer: mirror([
        agent('1', 'idle'),
        agent('2', 'working'),
        agent('3', 'idle', { pendingUserInput: true }),
        agent('4', 'working'),
        agent('5', 'done', { paneId: 'p5' }),
        { ...agent('6', 'working'), hasAgent: false },
      ]),
      recentEntries: [
        { key: 's', title: 's', atMs: now, destination: { type: 'pane', serverId: 'a' } },
      ] as never,
    });
    expect(panel!.workingCount).toBe(2);
    expect(panel!.needsYouCount).toBe(1);
    expect(panel!.working && panel!.attention).toBe(true);
    expect(panel!.agents.map((line) => [line.key, line.name, line.mark])).toEqual([
      ['3', 'Agent 3', 'needs-you'],
      ['2', 'Agent 2', 'working'],
      ['4', 'Agent 4', 'working'],
      ['1', 'Agent 1', 'idle'],
      ['5', 'Agent 5', 'idle'],
    ]);
    // A tap on an orb lands on its pane when the mirror knows it.
    expect(panel!.agents.find((line) => line.key === '5')?.paneId).toBe('p5');
    expect('paneId' in panel!.agents[0]!).toBe(false);
    // Session titles are the strip's: never an agent's.
    expect(JSON.stringify(panel!.agents)).not.toContain('"s"');
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
    expect(panel!.agents.map((line) => line.mark)).toEqual(['needs-you']);
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
    expect(panel!.agents.map((line) => line.activity)).toEqual([
      'running tests',
      // No task: the pane title, which is more than the agent's name.
      'pane 2',
      // A title that repeats the agent's name keeps only what follows it.
      'review',
      // Idle: no activity.
      undefined,
    ]);
  });

  test('an offline computer has no agents and runs nothing, whatever its mirror last saw', () => {
    const panels = stagePanels({
      ...base,
      agentsByServer: {
        b: { serverId: 'b', checkedAtMs: now - 7000, agents: [agent('2', 'working')] },
      },
    });
    expect(panels[1]!.agents).toEqual([]);
    expect(panels[1]!.working).toBe(false);
    expect(panels[1]!.lastSeenMs).toBe(now - 7000);
  });

  test('selection falls back to the first card when the target is gone', () => {
    expect(stageSelectedIndex(servers, 'b')).toBe(1);
    expect(stageSelectedIndex(servers, 'gone')).toBe(0);
    expect(stageSelectedIndex([], undefined)).toBe(0);
  });
});

describe("the HUD's agents' row", () => {
  const line = (key: string, mark: StageAgentLine['mark'], paneId?: string): StageAgentLine => ({
    key,
    name: `agent-${key}`,
    mark,
    status: mark === 'working' ? 'working' : mark === 'needs-you' ? 'blocked' : 'idle',
    ...(paneId ? { paneId } : {}),
  });

  test('one chip per agent: waiting first, then working, then idle, each in the order given', () => {
    const row = stageAgentRow({
      tone: 'online',
      agents: [
        line('i1', 'idle'),
        line('w1', 'working', 'p1'),
        line('n1', 'needs-you'),
        line('i2', 'idle'),
        line('w2', 'working'),
        line('n2', 'needs-you', 'p9'),
      ],
    });
    expect(row.kind).toBe('agents');
    if (row.kind !== 'agents') return;
    expect(row.chips.map((chip) => chip.key)).toEqual(['n1', 'n2', 'w1', 'w2', 'i1', 'i2']);
    // The pane a tap opens rides along; none when unknown.
    expect(row.chips.find((chip) => chip.key === 'w1')?.paneId).toBe('p1');
    expect(row.chips.find((chip) => chip.key === 'n1')?.paneId).toBeUndefined();
  });

  test('names a state only when it is not idle', () => {
    const row = stageAgentRow({
      tone: 'warning',
      agents: [line('a', 'idle'), line('b', 'working'), line('c', 'needs-you')],
    });
    if (row.kind !== 'agents') throw new Error('expected chips');
    expect(Object.fromEntries(row.chips.map((chip) => [chip.key, chip.word]))).toEqual({
      a: null,
      b: 'working',
      c: 'needs-you',
    });
    expect(stageAgentRow({ tone: 'online', agents: [] })).toEqual({ kind: 'agents', chips: [] });
  });

  test('an offline computer is one "last seen" line, whatever its agents were', () => {
    expect(
      stageAgentRow({ tone: 'offline', lastSeenMs: 42, agents: [line('a', 'working')] })
    ).toEqual({ kind: 'offline', lastSeenMs: 42 });
    expect(stageAgentRow({ tone: 'offline', agents: [] })).toEqual({ kind: 'offline' });
    // Unknown reachability is not offline: what is known shows.
    expect(stageAgentRow({ tone: 'unknown', agents: [line('a', 'idle')] }).kind).toBe('agents');
  });
});
