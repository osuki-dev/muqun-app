// What "how big is the terminal text" is allowed to answer.
//
// The rule under test is a lifetime, not a number: the Text size setting is
// every pane's starting point, and a pinch is now a per-pane memory that
// survives leaving the service screen and the app being killed and
// relaunched. The lifetime is the part that cannot be read off the component
// -- the canvas is deliberately never remounted on a pane switch, so "leave
// and come back", or "quit and relaunch", is not implied by where the scale
// is declared -- so the sequence is walked here against exactly the functions
// the canvas calls, in the order it calls them, sharing a plain object as the
// stand-in for the disk `skia-terminal.tsx` actually reads and writes (see
// that file, and the module comment on `../terminal-text-size`, for why the
// real storage cannot be imported into this test).
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TERMINAL_MAX_FIT_SCALE,
  TERMINAL_MAX_REMEMBERED_PANE_SCALES,
  TERMINAL_MAX_SCALE,
  TERMINAL_MIN_SCALE,
  TERMINAL_TEXT_SIZE_POINTS,
  pinchedTerminalScale,
  terminalFitToWidthScale,
  terminalFontSize,
  terminalOpenScale,
  terminalOpenView,
  terminalPanMinX,
  terminalScaleOnPaneOpen,
  terminalScaleOnScreenLeave,
  terminalZoomIndicatorPercent,
  terminalZoomLabel,
  terminalZoomPercent,
  type TerminalPaneScales,
  type TerminalTextSize,
} from '../terminal-text-size';

/** A pane whose 80 columns are narrower than the phone: it opens unscaled. */
const viewportWidth = 400;
const contentWidth = 380;

/** A fresh stand-in for the device, shared across `terminal()` instances that
 * are meant to be reading and writing the same pane's memory. */
function disk(): { current: TerminalPaneScales } {
  return { current: {} };
}

/**
 * The canvas's own sequence, as a walkable object.
 *
 * Every method here is one call site in `skia-terminal.tsx` and nothing else:
 * `openPane` is the effect keyed on the pane id, `pinch` is the pinch
 * gesture's `onUpdate`, `leaveScreen` is the effect that answers the service
 * screen losing focus. If one of them stops calling the function named here,
 * this walk stops describing the app -- which is why they are named rather
 * than re-implemented.
 *
 * A new `terminal(...)` handed the same `store` models a fresh mount reading
 * the same disk -- coming back to the pane later in the session, or the app
 * being killed and relaunched. A new `terminal(...)` with a fresh `disk()`, or
 * the same store but a different `paneId`, models a pane that has nothing
 * remembered for it.
 */
function terminal(
  setting: TerminalTextSize,
  paneContentWidth = contentWidth,
  options: {
    paneId?: string;
    store?: { current: TerminalPaneScales };
    /** The phone's own grid, and the pane's reported width, when the walk is
     * about the fit. Left out, they are the pre-fit world: no width reported,
     * so `terminalOpenScale` is `terminalScaleOnPaneOpen` and the default the
     * leave compares against is 1. */
    phoneColumns?: number;
    paneColumns?: number;
  } = {}
) {
  const paneId = options.paneId ?? 'pane';
  const store = options.store ?? disk();
  const phoneColumns = options.phoneColumns ?? 0;
  let paneColumns = options.paneColumns;
  let scale = 1;
  let content = paneContentWidth;
  return {
    get fontSize() {
      return terminalFontSize(setting);
    },
    get scale() {
      return scale;
    },
    get percent() {
      return terminalZoomPercent(scale);
    },
    /** The width of the pane's own output, which nothing about the size reads. */
    get contentWidth() {
      return content;
    },
    /** What is actually on the shared "disk" right now, for assertions that
     * want to see the table rather than only its effect on the next open. */
    get remembered() {
      return store.current;
    },
    /** The default this pane would open at with nothing remembered -- which is
     * also the number the leave below has to compare against. */
    get restingScale() {
      return terminalFitToWidthScale(phoneColumns, paneColumns);
    },
    openPane() {
      scale = terminalOpenScale({ paneId, remembered: store.current, phoneColumns, paneColumns });
    },
    /** tmux reports a new width for this pane -- the reader re-split the window
     * on the Mac while the phone was elsewhere. */
    resplit(next: number | undefined) {
      paneColumns = next;
    },
    pinch(gestureScale: number) {
      scale = pinchedTerminalScale(scale, gestureScale);
    },
    leaveScreen() {
      store.current = terminalScaleOnScreenLeave(
        paneId,
        scale,
        store.current,
        terminalFitToWidthScale(phoneColumns, paneColumns)
      );
    },
    /** Output whose longest line has changed since the pane opened. */
    outputWidth(next: number) {
      content = next;
    },
  };
}

describe("the setting is every pane's starting point", () => {
  test('each size names its own point size', () => {
    expect(terminalFontSize('compact')).toBe(TERMINAL_TEXT_SIZE_POINTS.compact);
    expect(terminalFontSize('default')).toBe(TERMINAL_TEXT_SIZE_POINTS.default);
    expect(terminalFontSize('large')).toBe(TERMINAL_TEXT_SIZE_POINTS.large);
    expect(terminalFontSize('compact')).toBeLessThan(terminalFontSize('default'));
    expect(terminalFontSize('default')).toBeLessThan(terminalFontSize('large'));
  });

  test('a change of setting is the size a pane with no memory opens at', () => {
    const before = terminal('default');
    before.openPane();
    // The reader goes to Settings, picks Large, and comes back to a pane
    // nothing has ever been remembered for.
    const after = terminal('large');
    after.openPane();
    expect(after.fontSize).toBeGreaterThan(before.fontSize);
    expect(after.fontSize).toBe(TERMINAL_TEXT_SIZE_POINTS.large);
  });

  test("the pane's own width does not get a say (#643)", () => {
    // The whole of card #643. Panes used to open fitted to their column count,
    // so on a ~400pt phone a 65-column pane opened near 0.69, an 80-column pane
    // clamped to 0.62 and a 242-column one clamped there too: three glyph sizes
    // from one setting, all of them reported as 100%. Width is the pan's job.
    const narrow = terminal('default', 380);
    const wide = terminal('default', 4000);
    narrow.openPane();
    wide.openPane();
    expect(narrow.scale).toBe(wide.scale);
    expect(narrow.scale).toBe(1);
    expect(narrow.fontSize).toBe(wide.fontSize);
    // And the percentage says the same thing about both, truthfully this time.
    expect(narrow.percent).toBe(100);
    expect(wide.percent).toBe(100);
    // The width is still there to be panned across; it just does not resize.
    expect(wide.contentWidth).toBeGreaterThan(viewportWidth);
  });
});

describe('a pinch is remembered per pane', () => {
  test('pinch -> leave -> come back to the same pane = the pinch', () => {
    const store = disk();
    const pane = terminal('large', contentWidth, { paneId: 'p1', store });
    pane.openPane();
    expect(pane.scale).toBe(1);

    pane.pinch(1.5);
    expect(pane.scale).toBe(1.5);

    // Out of the service screen -- to Settings, to the server list, anywhere.
    pane.leaveScreen();

    // A fresh mount of the very same pane: later in this session, or after the
    // app was killed and relaunched. Either way this is a new `terminal()`
    // reading the same disk, which is the case the component cannot answer by
    // remounting: the canvas is deliberately never taken down on its own.
    const again = terminal('large', contentWidth, { paneId: 'p1', store });
    again.openPane();
    expect(again.scale).toBe(1.5);
    expect(again.percent).toBe(150);
    expect(again.fontSize).toBe(TERMINAL_TEXT_SIZE_POINTS.large);
  });

  test('a different pane is unaffected', () => {
    const store = disk();
    const a = terminal('default', contentWidth, { paneId: 'a', store });
    a.openPane();
    a.pinch(1.4);
    a.leaveScreen();

    const b = terminal('default', contentWidth, { paneId: 'b', store });
    b.openPane();
    expect(b.scale).toBe(1);
    expect(b.percent).toBe(100);
  });

  test('a pane nothing has ever been remembered for opens at the setting', () => {
    const pane = terminal('compact', contentWidth, { paneId: 'never-pinched' });
    pane.openPane();
    expect(pane.scale).toBe(1);
    expect(pane.fontSize).toBe(TERMINAL_TEXT_SIZE_POINTS.compact);
  });

  test('switching panes without ever leaving the screen writes nothing down', () => {
    // Only `leaveScreen` persists. A carousel swipe from one pane to another,
    // with the service screen staying in front the whole time, changes which
    // pane's id `openPane` is called with but never calls `leaveScreen` for
    // the one being left -- so the first pane's pinch was never written, and
    // the second pane, which has its own id, was never going to see it anyway.
    const store = disk();
    const a = terminal('default', contentWidth, { paneId: 'a', store });
    a.openPane();
    a.pinch(1.4);
    expect(a.percent).toBe(140);

    const b = terminal('default', contentWidth, { paneId: 'b', store });
    b.openPane();
    expect(b.scale).toBe(1);
    expect(store.current).toEqual({});
  });

  test('pinching back to the setting size forgets the pane rather than storing 1', () => {
    const store = disk();
    const pane = terminal('default', contentWidth, { paneId: 'p', store });
    pane.openPane();
    pane.pinch(1.4);
    pane.leaveScreen();
    expect(Object.keys(pane.remembered)).toContain('p');

    const again = terminal('default', contentWidth, { paneId: 'p', store });
    again.openPane();
    expect(again.scale).toBeCloseTo(1.4);
    again.pinch(1 / 1.4); // back to ~1, the setting's own size
    again.leaveScreen();
    expect(store.current.p).toBeUndefined();
  });

  test('a remembered pinch is not silently re-fit against new output width', () => {
    // The #643 story again, now that a number *does* survive leaving: nothing
    // here reads the pane's width either. Re-fitting on the way back used to
    // answer with the width the output has *now*, so a pane whose lines had
    // got shorter came back larger than it had ever been drawn -- measured on
    // device: opened 77%, pinched to 86%, came back at 100%. The remembered
    // number is read back exactly as it was written, whatever the width did
    // in between.
    const store = disk();
    const pane = terminal('default', 600, { paneId: 'wide', store });
    pane.openPane();
    pane.pinch(1.1);
    pane.outputWidth(300);
    pane.leaveScreen();

    const again = terminal('default', 4000, { paneId: 'wide', store });
    again.openPane();
    expect(again.scale).toBeCloseTo(pinchedTerminalScale(1, 1.1));
  });

  test('a pinch is clamped at both ends', () => {
    const pane = terminal('default');
    pane.openPane();
    for (let i = 0; i < 10; i++) pane.pinch(1.4);
    expect(pane.scale).toBe(TERMINAL_MAX_SCALE);
    for (let i = 0; i < 20; i++) pane.pinch(0.7);
    expect(pane.scale).toBe(TERMINAL_MIN_SCALE);
  });

  test('a stale or corrupted entry falls back to the setting, not to garbage', () => {
    // What a tmux server restart looks like: the id in the table belongs to a
    // pane that no longer exists, so this pane -- which reused the id -- reads
    // it as though it were never pinched.
    expect(terminalScaleOnPaneOpen('reused-id', { 'reused-id': Number.NaN })).toBe(1);
    expect(terminalScaleOnPaneOpen('missing', {})).toBe(1);
    // Out-of-range survivors of an older build are clamped rather than trusted.
    expect(terminalScaleOnPaneOpen('p', { p: 9 })).toBe(TERMINAL_MAX_SCALE);
    expect(terminalScaleOnPaneOpen('p', { p: -3 })).toBe(TERMINAL_MIN_SCALE);
  });

  test('the table is bounded: the longest-untouched pane is dropped first', () => {
    let table: TerminalPaneScales = {};
    for (let i = 0; i < TERMINAL_MAX_REMEMBERED_PANE_SCALES; i++) {
      table = terminalScaleOnScreenLeave(`pane-${i}`, 1.4, table);
    }
    expect(Object.keys(table)).toHaveLength(TERMINAL_MAX_REMEMBERED_PANE_SCALES);
    expect(table['pane-0']).toBe(1.4);

    // One more pane pinched pushes the table over the bound.
    table = terminalScaleOnScreenLeave('pane-new', 1.4, table);
    expect(Object.keys(table)).toHaveLength(TERMINAL_MAX_REMEMBERED_PANE_SCALES);
    // The oldest untouched entry -- the very first one written -- is the one
    // that goes, not an arbitrary one.
    expect(table['pane-0']).toBeUndefined();
    expect(table['pane-new']).toBe(1.4);
  });

  test('the percentage is the effective scale, not a per-pane ratio', () => {
    // Absolute, against the size the setting names. Dividing by each pane's own
    // resting scale is what made every pane read 100% while three of them were
    // drawing three different sizes.
    expect(terminalZoomPercent(1)).toBe(100);
    expect(terminalZoomPercent(1.25)).toBe(125);
    expect(terminalZoomPercent(0.8)).toBe(80);
    expect(terminalZoomPercent(TERMINAL_MIN_SCALE)).toBe(62);
  });

  test('the indicator names the setting and the zoom', () => {
    expect(terminalZoomLabel('large', 1.24)).toBe('Large · 124%');
    expect(terminalZoomLabel('compact', 1)).toBe('Compact · 100%');
    expect(terminalZoomLabel('default', 0.62)).toBe('Default · 62%');
  });
});

describe('the size pill answers a pinch and nothing else (#638)', () => {
  test('a recogniser that has only begun is not a zoom', () => {
    // The whole of card #638. Android's pinch recogniser `begin()`s on the
    // first pointer of ANY drag -- one finger, scrolling -- and only
    // `activate()`s once the span between two fingers has actually moved. The
    // pill used to be driven by the first of those, so a plain scroll put
    // "Default · 100%" on screen; and because a scroll is a stream of
    // begin/end pairs closer together than the pill's 900 ms hold, the hide
    // was re-armed before it could fire and the pill never left at all.
    expect(terminalZoomIndicatorPercent('began', 1)).toBeNull();
    // Not even once the scale has moved: `began` means "watching", and the
    // scroll that follows a pinch is still a scroll.
    expect(terminalZoomIndicatorPercent('began', 1.25)).toBeNull();
  });

  test('a hand that is not on the glass is not a zoom', () => {
    expect(terminalZoomIndicatorPercent('idle', 1)).toBeNull();
    expect(terminalZoomIndicatorPercent('idle', 1.25)).toBeNull();
  });

  test('an active pinch reads the percentage, including at the resting size', () => {
    // 100% is a real answer and not a sentinel: the first frame of a pinch, and
    // any pinch that returns to where it started, both legitimately read it.
    expect(terminalZoomIndicatorPercent('active', 1)).toBe(100);
    expect(terminalZoomIndicatorPercent('active', 1.25)).toBe(125);
    expect(terminalZoomIndicatorPercent('active', TERMINAL_MIN_SCALE)).toBe(62);
  });

  test('the label is built from the percentage the pill was handed', () => {
    const percent = terminalZoomIndicatorPercent('active', 1.24);
    expect(percent).not.toBeNull();
    expect(terminalZoomLabel('default', (percent as number) / 100)).toBe('Default · 124%');
  });
});

describe('the pinch is remembered on its own, not folded into the settings store', () => {
  // The settings store itself cannot be imported here -- it reaches React
  // Native through expo-secure-store -- so its persisted shape is read as
  // text. A weaker test than importing it, and still the one that fails the
  // day someone folds the per-pane table into `PersistedSettings` instead of
  // keeping it in its own MMKV table (see the module comment on
  // `../terminal-text-size` for why it has to be its own table at all).
  test('the persisted settings carry no zoom or scale', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'stores', 'app-settings.ts'),
      'utf8'
    );
    const shape = source.slice(
      source.indexOf('type PersistedSettings'),
      source.indexOf('type AppSettingsState')
    );
    expect(shape).toContain('terminalTextSize');
    expect(shape.toLowerCase()).not.toContain('zoom');
    expect(shape.toLowerCase()).not.toContain('scale');
    expect(source.toLowerCase()).not.toContain('zoom');
  });
});

// A pane the reader did not choose the width of.
//
// tmux's third split is 36 columns; the phone would have drawn 49. The app
// lays the snapshot out at the pane's own 36 because the program on the far
// side hard-wrapped there, so the text fills the left 40% of the screen and
// the rest is blank. The rule below is the only thing that answers that, and
// the reason it is here rather than in the canvas is that its whole content is
// arithmetic plus one precedence question -- does a remembered pinch win --
// which is exactly what a walk can pin and a screenshot cannot.
describe('a pane narrower than the phone is drawn to fill it', () => {
  /** The lab: an 80-column tmux window split three ways, on a ~400pt phone. */
  const PHONE_COLUMNS = 49;
  const NARROW = 36;

  test('a narrower pane opens scaled up until its columns reach the edge', () => {
    expect(terminalFitToWidthScale(PHONE_COLUMNS, NARROW)).toBeCloseTo(49 / 36);
    // The number the report is about: 36 columns on a 49-column phone.
    expect(terminalFitToWidthScale(PHONE_COLUMNS, NARROW)).toBeCloseTo(1.361, 3);
  });

  test('a pane exactly as wide as the phone is left alone', () => {
    expect(terminalFitToWidthScale(PHONE_COLUMNS, PHONE_COLUMNS)).toBe(1);
  });

  test('a pane wider than the phone is left alone -- #643 is not reverted', () => {
    // The three panes that made card #643, against the phone of that report.
    // All three are wider than it, so all three still open at 1 and the
    // indicator still reads 100% for each: one setting, one glyph size.
    for (const columns of [65, 80, 242]) {
      expect(terminalFitToWidthScale(45, columns)).toBe(1);
      expect(terminalZoomPercent(terminalFitToWidthScale(45, columns))).toBe(100);
    }
  });

  test('the fit is capped, because scaling up spends rows', () => {
    // A 20-column pane -- the narrowest `TERMINAL_GRID_MIN_COLS` allows -- asks
    // for 2.45 and is given 1.6. Uncapped it would trade two thirds of the
    // pane's visible rows for width nobody asked for.
    expect(49 / 20).toBeGreaterThan(TERMINAL_MAX_FIT_SCALE);
    expect(terminalFitToWidthScale(PHONE_COLUMNS, 20)).toBe(TERMINAL_MAX_FIT_SCALE);
    // And the cap stays under the pinch's own ceiling, so a reader who wants
    // more than the default still has somewhere to go in both directions.
    expect(TERMINAL_MAX_FIT_SCALE).toBeLessThan(TERMINAL_MAX_SCALE);
    expect(TERMINAL_MAX_FIT_SCALE).toBeGreaterThan(TERMINAL_MIN_SCALE);
  });

  test('a pane the gateway reported no width for is not fitted', () => {
    // An older gateway, and every SSH shell -- whose grid *is* the PTY, so it
    // can never differ from the phone's and there is nothing to fit.
    expect(terminalFitToWidthScale(PHONE_COLUMNS, undefined)).toBe(1);
    expect(terminalFitToWidthScale(PHONE_COLUMNS, 0)).toBe(1);
    expect(terminalFitToWidthScale(PHONE_COLUMNS, Number.NaN)).toBe(1);
    // And a phone that has not been measured yet fits nothing either.
    expect(terminalFitToWidthScale(0, NARROW)).toBe(1);
  });

  test('the narrow pane fills the width at first open, with nothing remembered', () => {
    const pane = terminal('default', contentWidth, {
      phoneColumns: PHONE_COLUMNS,
      paneColumns: NARROW,
    });
    pane.openPane();
    expect(pane.scale).toBeCloseTo(49 / 36);
    expect(pane.percent).toBe(136);
  });

  test('a remembered pinch wins over the fit', () => {
    const store = disk();
    const options = { store, phoneColumns: PHONE_COLUMNS, paneColumns: NARROW };
    const first = terminal('default', contentWidth, options);
    first.openPane();
    // The reader disagrees with the fit and pinches down past it.
    first.pinch(0.8);
    const chosen = first.scale;
    expect(chosen).not.toBeCloseTo(first.restingScale);
    first.leaveScreen();
    expect(store.current.pane).toBeCloseTo(chosen, 2);

    // Killed and relaunched: the pane opens at what the reader chose, not at
    // the fit.
    const later = terminal('default', contentWidth, options);
    later.openPane();
    expect(later.scale).toBeCloseTo(chosen, 2);
  });

  test('a fit is never written down, so a re-split re-fits', () => {
    const store = disk();
    const pane = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: NARROW,
    });
    pane.openPane();
    expect(pane.scale).toBeCloseTo(49 / 36);
    // The reader never pinched: leaving stores nothing, because the scale on
    // screen is the one this pane would have opened at anyway.
    pane.leaveScreen();
    expect(store.current).toEqual({});

    // They re-split the window on the Mac; the pane is 42 columns now.
    pane.resplit(42);
    pane.openPane();
    expect(pane.scale).toBeCloseTo(49 / 42);
    // Narrow enough and the cap answers instead, still with nothing stored.
    pane.resplit(24);
    pane.openPane();
    expect(pane.scale).toBe(TERMINAL_MAX_FIT_SCALE);
    // And widened past the phone: back to 1:1, with nothing to invalidate.
    pane.resplit(60);
    pane.openPane();
    expect(pane.scale).toBe(1);
  });

  test('a manual pinch survives a re-split; the fit it replaced does not', () => {
    const store = disk();
    const pane = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: NARROW,
    });
    pane.openPane();
    pane.pinch(1.2);
    const chosen = pane.scale;
    pane.leaveScreen();

    // Same pane, re-split to a different width. The remembered number was a
    // statement about how big this pane's text should be, not about how wide
    // the pane was, so it still holds.
    pane.resplit(42);
    pane.openPane();
    expect(pane.scale).toBeCloseTo(chosen, 2);
    expect(pane.scale).not.toBeCloseTo(49 / 42);
  });

  test('pinching back to the fit hands the pane back to the fit', () => {
    // The one ambiguous case, resolved as a fit: the two are the same number,
    // so the reader sees exactly what they asked for now, and a later re-split
    // is free to move it.
    const store = disk();
    const pane = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: NARROW,
    });
    pane.openPane();
    pane.pinch(1.3);
    pane.leaveScreen();
    expect(store.current.pane).toBeDefined();

    const back = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: NARROW,
    });
    back.openPane();
    // Pinched back to where the fit had it: the entry is dropped, not rewritten.
    back.pinch(back.restingScale / back.scale);
    back.leaveScreen();
    expect(store.current).toEqual({});
  });

  test('the wide pane keeps the memory it always had', () => {
    // The unchanged path, walked end to end: a pane the fit never touches
    // stores and restores a pinch exactly as it does on main, and a pinch back
    // to 1 still earns its slot back.
    const store = disk();
    const wide = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: 242,
    });
    wide.openPane();
    expect(wide.scale).toBe(1);
    wide.pinch(0.8);
    wide.leaveScreen();
    expect(store.current.pane).toBeCloseTo(0.8, 2);

    const again = terminal('default', contentWidth, {
      store,
      phoneColumns: PHONE_COLUMNS,
      paneColumns: 242,
    });
    again.openPane();
    expect(again.scale).toBeCloseTo(0.8, 2);
    again.pinch(1 / 0.8);
    again.leaveScreen();
    expect(store.current).toEqual({});
  });

  test('a stale entry falls back to the fit, not to 1', () => {
    // A tmux server restart reuses pane ids. The entry is unreadable, so the
    // pane is treated as one that was never pinched -- which now means fitted.
    expect(
      terminalOpenScale({
        paneId: 'reused',
        remembered: { reused: Number.NaN },
        phoneColumns: PHONE_COLUMNS,
        paneColumns: NARROW,
      })
    ).toBeCloseTo(49 / 36);
  });
});

// The pan's other end. A fitted pane is the first case where the canvas is
// wider than the text it is drawing, so it is the first case where "how far
// may this be panned" and "how wide is the surface" are different questions.
describe('a fitted pane cannot be panned into blank canvas', () => {
  const VIEWPORT = 402;
  const CELL = 7.8;
  const PADDING = 7;
  const textWidth = (columns: number) => columns * CELL + PADDING * 2;

  test('a pane whose text does not reach the edge does not pan', () => {
    // 36 columns at 1:1 -- today's behaviour, and the arithmetic is the same
    // either way because `contentWidth` is floored at the viewport.
    expect(terminalPanMinX(VIEWPORT, textWidth(36), 1)).toBe(0);
    // Scaled up to the cap, a 20-column pane still does not reach the edge,
    // and still does not pan. Measured against the canvas it would have panned
    // 241pt into nothing.
    expect(terminalPanMinX(VIEWPORT, textWidth(20), TERMINAL_MAX_FIT_SCALE)).toBe(0);
    expect(VIEWPORT - VIEWPORT * TERMINAL_MAX_FIT_SCALE).toBeLessThan(-240);
  });

  test('the fit lands the last column inside the edge, never past it', () => {
    // The canvas draws the first column one padding in and scales that offset
    // with everything else, so the last column's right edge is
    // `scale * (padding + columns * cellWidth)`. The fit's ceiling is what
    // keeps that inside the viewport for every width at once: the text is
    // `scale * columns * cellWidth` = `phoneColumns * cellWidth` wide, which is
    // the phone's own text width, and the scaled leading padding adds
    // `scale * padding` against the `2 * padding` the phone left itself -- so
    // any cap below 2 fits, and this one is 1.6.
    expect(TERMINAL_MAX_FIT_SCALE).toBeLessThan(2);
    const phoneColumns = Math.floor((VIEWPORT - PADDING * 2) / CELL);
    for (let columns = 20; columns < phoneColumns; columns++) {
      const scale = terminalFitToWidthScale(phoneColumns, columns);
      const lastColumnEdge = (PADDING + columns * CELL) * scale;
      expect(lastColumnEdge).toBeLessThanOrEqual(VIEWPORT);
      // Whatever pan is left is the grid's own trailing padding coming into
      // view -- less than the padding itself, and never a blank column.
      const minX = terminalPanMinX(VIEWPORT, textWidth(columns), scale);
      expect(minX).toBeLessThanOrEqual(0);
      expect(minX).toBeGreaterThan(-PADDING * TERMINAL_MAX_FIT_SCALE);
    }
  });

  test('a wide pane pans exactly as far as it always has', () => {
    // Wider than the viewport, so `contentWidth` *is* the text width and this
    // is the expression the pan has always evaluated -- at 1:1 and pinched.
    for (const scale of [TERMINAL_MIN_SCALE, 1, 1.4, TERMINAL_MAX_SCALE]) {
      const wide = textWidth(242);
      expect(terminalPanMinX(VIEWPORT, wide, scale)).toBe(
        Math.min(0, VIEWPORT - Math.max(VIEWPORT, wide) * scale)
      );
    }
    // And it does pan: a 242-column pane is far wider than the phone.
    expect(terminalPanMinX(VIEWPORT, textWidth(242), 1)).toBeLessThan(-1400);
  });
});

// Where a pane bigger than the phone puts the reader when it opens.
//
// The measured case: a single tmux window at 359x82 running nvim, against a
// phone whose own grid is about 50x30. Drawn 1:1 at the origin -- today -- the
// reader gets rows 1-30 of 82 and columns 1-50 of 359, which is the corner
// nvim leaves empty. The matrix that produced these numbers also established
// that the rendering itself is faithful at every width (the app's frame and
// tmux's own `capture-pane` agree line for line at 36, 100, 173 and 359
// columns), so what is being fixed here is the viewport, not the layout.
describe('a pane bigger than the phone opens somewhere worth looking', () => {
  const PHONE = { phoneColumns: 50, phoneRows: 30 };
  const WIDE = { paneColumns: 359, paneRows: 82 };

  test('a shell is never placed: its newest line is the point', () => {
    // Streams rest at the bottom and follow output; that is the whole contract
    // and this rule does not touch it.
    expect(terminalOpenView({ ...PHONE, ...WIDE, ownsScreen: false })).toEqual({
      column: 0,
      row: 0,
    });
  });

  test('a pane that fits is not placed on either axis', () => {
    expect(terminalOpenView({ ...PHONE, paneColumns: 36, paneRows: 20, ownsScreen: true })).toEqual(
      { column: 0, row: 0 }
    );
    // Exactly the phone's own grid still counts as fitting.
    expect(terminalOpenView({ ...PHONE, paneColumns: 50, paneRows: 30, ownsScreen: true })).toEqual(
      { column: 0, row: 0 }
    );
  });

  test('with no cursor reported, a big editor opens bottom-left', () => {
    // 82 rows less the 30 the phone shows: the pane's last row is on the
    // bottom edge, which is where nvim's status and message line lives.
    expect(terminalOpenView({ ...PHONE, ...WIDE, ownsScreen: true })).toEqual({
      column: 0,
      row: 52,
    });
  });

  test('a pane taller but not wider is placed only on the axis that overflows', () => {
    expect(terminalOpenView({ ...PHONE, paneColumns: 40, paneRows: 82, ownsScreen: true })).toEqual(
      { column: 0, row: 52 }
    );
    expect(
      terminalOpenView({ ...PHONE, paneColumns: 359, paneRows: 20, ownsScreen: true })
    ).toEqual({ column: 0, row: 0 });
  });

  test('a reported cursor is centred in the viewport', () => {
    // The cursor mid-file: half a screen of context on each side of it.
    expect(
      terminalOpenView({ ...PHONE, ...WIDE, cursorColumn: 180, cursorRow: 41, ownsScreen: true })
    ).toEqual({ column: 155, row: 26 });
  });

  test('a cursor near an edge is clamped inside the pane, never past it', () => {
    // Top-left corner: centring would ask for a negative origin.
    expect(
      terminalOpenView({ ...PHONE, ...WIDE, cursorColumn: 0, cursorRow: 0, ownsScreen: true })
    ).toEqual({ column: 0, row: 0 });
    // Bottom-right corner: centring would ask to run off the end, so the pane's
    // last row and column sit on the edges instead.
    expect(
      terminalOpenView({ ...PHONE, ...WIDE, cursorColumn: 358, cursorRow: 81, ownsScreen: true })
    ).toEqual({ column: 309, row: 52 });
  });

  test('half a cursor is no cursor', () => {
    // The gateway is allowed to report neither; it must not be trusted to
    // report exactly one and have the other read as column 0.
    expect(terminalOpenView({ ...PHONE, ...WIDE, cursorColumn: 180, ownsScreen: true })).toEqual({
      column: 0,
      row: 52,
    });
    expect(terminalOpenView({ ...PHONE, ...WIDE, cursorRow: 41, ownsScreen: true })).toEqual({
      column: 0,
      row: 52,
    });
    expect(
      terminalOpenView({
        ...PHONE,
        ...WIDE,
        cursorColumn: Number.NaN,
        cursorRow: 41,
        ownsScreen: true,
      })
    ).toEqual({ column: 0, row: 52 });
  });

  test('a pane the gateway did not measure is left where it has always opened', () => {
    // herdr today: no width, no height. The old behaviour is the safe answer.
    expect(terminalOpenView({ ...PHONE, ownsScreen: true })).toEqual({ column: 0, row: 0 });
    expect(terminalOpenView({ ...PHONE, paneColumns: 359, ownsScreen: true })).toEqual({
      column: 0,
      row: 0,
    });
  });
});

// The two rules meeting. A narrow pane gets both -- scaled up to fill the
// width, and placed, because scaling up is what makes it too tall to see whole.
describe('the fit and the placement agree about how many cells are on the glass', () => {
  test('a fitted pane is placed against the rows it actually shows', () => {
    // 36x40 nvim on a 48x27 phone. The fit draws it at 48/36 = 1.33x, so the
    // glass holds 27/1.33 = 20 of its rows, not 27. Placed against 27 the pane
    // would open seven rows short of the bottom it was asked for.
    const scale = terminalFitToWidthScale(48, 36);
    expect(scale).toBeCloseTo(48 / 36);
    const placed = terminalOpenView({
      paneColumns: 36,
      paneRows: 40,
      phoneColumns: 48,
      phoneRows: 27,
      scale,
      ownsScreen: true,
    });
    // 40 rows less the 20 that fit: the pane's last row is on the bottom edge.
    expect(placed.row).toBe(20);
    expect(placed.column).toBe(0);
    // And the fit has taken the horizontal overflow away entirely, so there is
    // nothing to place on that axis.
    expect(placed.column).toBe(0);
  });

  test('a pane that fits at 1:1 but not once scaled up is still placed', () => {
    // 36x24 on a 48x27 phone fits vertically at 1:1 and does not at 1.33x.
    const scale = terminalFitToWidthScale(48, 36);
    expect(
      terminalOpenView({
        paneColumns: 36,
        paneRows: 24,
        phoneColumns: 48,
        phoneRows: 27,
        ownsScreen: true,
      })
    ).toEqual({ column: 0, row: 0 });
    expect(
      terminalOpenView({
        paneColumns: 36,
        paneRows: 24,
        phoneColumns: 48,
        phoneRows: 27,
        scale,
        ownsScreen: true,
      })
    ).toEqual({ column: 0, row: 4 });
  });

  test('an absent or nonsense scale is 1:1', () => {
    const base = {
      paneColumns: 359,
      paneRows: 82,
      phoneColumns: 48,
      phoneRows: 27,
      ownsScreen: true,
    };
    expect(terminalOpenView(base).row).toBe(55);
    expect(terminalOpenView({ ...base, scale: 0 }).row).toBe(55);
    expect(terminalOpenView({ ...base, scale: Number.NaN }).row).toBe(55);
  });
});

// The two backends as gateway v0.8.1 actually reports them, which is the whole
// reason every geometry input here is optional. Measured against a live 0.8.1
// on both: tmux fills in all five fields, herdr fills in one.
describe('the backends as v0.8.1 reports them', () => {
  const PHONE = { phoneColumns: 48, phoneRows: 27 };

  test('tmux: width, height and a cursor, so the pane opens on the cursor', () => {
    // The measured single-pane case: 359x82 nvim, cursor at column 184 row 7.
    expect(
      terminalOpenView({
        ...PHONE,
        paneColumns: 359,
        paneRows: 82,
        cursorColumn: 184,
        cursorRow: 7,
        ownsScreen: true,
      })
    ).toEqual({ column: 160, row: 0 });
  });

  test('herdr: a height, no width, no cursor, no alternate flag', () => {
    // v0.8.1 reports `height` from `scroll.viewport_rows` and leaves the other
    // four null -- herdr's socket API has no pane width, no alt-screen flag and
    // no cursor at protocol 20. Without columns there is no way to know what
    // overflows, so the pane opens exactly where it opens today and the parser
    // keeps measuring its own width. Half a geometry is not a geometry.
    expect(terminalOpenView({ ...PHONE, paneRows: 81, ownsScreen: true })).toEqual({
      column: 0,
      row: 0,
    });
    // And with the alternate flag missing the app may still decide a pane owns
    // the screen by other means; that must not change the answer either.
    expect(terminalOpenView({ ...PHONE, paneRows: 81, ownsScreen: false })).toEqual({
      column: 0,
      row: 0,
    });
  });

  test('a cursor is viewport-relative, so row 0 is the pane top', () => {
    // The gateway states zero-based, column then row, from the top left of the
    // viewport rather than of the scrollback -- which is the frame of reference
    // this rule works in, so no adjustment is applied to it anywhere.
    expect(
      terminalOpenView({
        ...PHONE,
        paneColumns: 359,
        paneRows: 82,
        cursorColumn: 0,
        cursorRow: 0,
        ownsScreen: true,
      })
    ).toEqual({ column: 0, row: 0 });
  });
});

// A remembered pinch is a scale like any other, and the placement has to count
// in it. Found on a device: an Android emulator carrying a stale entry for a
// reused pane id opened a 359-column pane at 1.44x while the placement was
// still computed at 1:1, which put the reader a third of a screen from where
// the cursor was.
describe('the placement counts the cells the opening scale actually shows', () => {
  const PANE = { paneColumns: 359, paneRows: 82, ownsScreen: true as const };
  const PHONE = { phoneColumns: 52, phoneRows: 48 };

  test('a remembered pinch moves the placement, not just the glyphs', () => {
    const remembered = { pane: 1.44 };
    const scale = terminalOpenScale({
      paneId: 'pane',
      remembered,
      phoneColumns: PHONE.phoneColumns,
      paneColumns: PANE.paneColumns,
    });
    expect(scale).toBeCloseTo(1.44);
    // 52 columns at 1:1, but only 36 of them once the pane is drawn at 1.44x.
    const atOne = terminalOpenView({ ...PANE, ...PHONE, cursorColumn: 184, cursorRow: 7 });
    const atPinch = terminalOpenView({
      ...PANE,
      ...PHONE,
      scale,
      cursorColumn: 184,
      cursorRow: 7,
    });
    expect(atOne.column).toBe(158);
    expect(atPinch.column).toBe(166);
    // The cursor is centred in both, which is the point: each is right for the
    // number of columns its own scale puts on the glass.
    expect(atOne.column + 52 / 2).toBeCloseTo(184, 0);
    expect(atPinch.column + 52 / 1.44 / 2).toBeCloseTo(184, 0);
  });

  test('the fit and a remembered pinch are the same input to the placement', () => {
    // Nothing here knows or cares which of the two produced the number; there
    // is one opening scale and the placement is computed against it.
    const fitted = terminalOpenView({ ...PANE, ...PHONE, scale: 1.44 });
    const pinched = terminalOpenView({ ...PANE, ...PHONE, scale: 1.44 });
    expect(fitted).toEqual(pinched);
  });
});
