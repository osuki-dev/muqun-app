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
  TERMINAL_MAX_REMEMBERED_PANE_SCALES,
  TERMINAL_MAX_SCALE,
  TERMINAL_MIN_SCALE,
  TERMINAL_TEXT_SIZE_POINTS,
  pinchedTerminalScale,
  terminalFontSize,
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
  options: { paneId?: string; store?: { current: TerminalPaneScales } } = {}
) {
  const paneId = options.paneId ?? 'pane';
  const store = options.store ?? disk();
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
    openPane() {
      scale = terminalScaleOnPaneOpen(paneId, store.current);
    },
    pinch(gestureScale: number) {
      scale = pinchedTerminalScale(scale, gestureScale);
    },
    leaveScreen() {
      store.current = terminalScaleOnScreenLeave(paneId, scale, store.current);
    },
    /** Output whose longest line has changed since the pane opened. */
    outputWidth(next: number) {
      content = next;
    },
  };
}

describe('the setting is every pane\'s starting point', () => {
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

  test('the pane\'s own width does not get a say (#643)', () => {
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
