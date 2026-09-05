import { TERMINAL_TEXT_SIZES } from '@/terminal/text-scale';
/**
 * How big the terminal's text is -- one rule, in one place.
 *
 * Two mechanisms decide what a reader sees. The Text size setting names a point
 * size, and it is every pane's starting point: a pane nothing has ever been
 * remembered for opens at it. The pinch scales the canvas on top of that, and
 * it is a per-pane memory rather than a session-only look: it survives leaving
 * the service screen, and it survives the app being killed and relaunched,
 * because leaving is the moment the pinch is written down
 * (`terminalScaleOnScreenLeave`) and opening is the moment it is read back
 * (`terminalScaleOnPaneOpen`), both keyed on the pane's own id.
 *
 * It does not survive the id itself going stale -- a tmux server restart hands
 * out fresh pane ids, so a pane reopened after one starts over at the
 * setting's size, indistinguishable from a pane that was never pinched. That
 * is a silent, harmless miss rather than a wrong answer: the orphaned entry is
 * never read again and ages out on its own (see
 * `TERMINAL_MAX_REMEMBERED_PANE_SCALES`).
 *
 * Both moments are named here as separate functions even though one reads the
 * memory and the other writes it, because they are separate promises and the
 * test that pins them should be able to say which one it is exercising.
 *
 * The clamps and the fit live here too, and not as loose arithmetic in the
 * canvas, because they are the same rule seen from the other end: the size the
 * setting -- or the memory -- asks for is the size a pane opens at only if
 * nothing else silently rewrites the scale afterwards.
 *
 * Neither function touches a disk. This file has a direct unit test that runs
 * under Bun, outside React Native, and the native module the app actually
 * persists through (MMKV -- the same mechanism `shortcut-usage.ts` uses for
 * another per-key, non-secret, frequently-written table) pulls in React
 * Native's own Flow-syntax sources the moment it is imported, which Bun cannot
 * parse; importing it here would take the test down with the module. So the
 * table of remembered scales is a plain argument in and a plain return value
 * out, and `skia-terminal.tsx` -- never imported by a test -- is where it is
 * actually loaded and saved.
 */

/** The three sizes the setting offers. */
export type TerminalTextSize = 'compact' | 'default' | 'large';

/**
 * The point size each setting names.
 *
 * Values inherited from the screen that used to carry them inline. They are a
 * little smaller than body text on purpose: a terminal is 80 columns wide and
 * the whole point of the compact end is fitting a wide log without panning.
 */
// The values live with the design type scale (`@/terminal/text-scale`), so a
// re-tuned scale reaches the pinch logic without a second table to forget.
export const TERMINAL_TEXT_SIZE_POINTS: Record<TerminalTextSize, number> = TERMINAL_TEXT_SIZES;

/** What the pinch indicator calls each size, matching the settings row. */
export const TERMINAL_TEXT_SIZE_NAMES: Record<TerminalTextSize, string> = {
  compact: 'Compact',
  default: 'Default',
  large: 'Large',
};

/**
 * How far out a pinch may zoom.
 *
 * Below this the glyphs stop being letters, and a pane that cannot be read is
 * not a smaller pane. Lines are never wrapped, so anything wider than the
 * viewport at this scale pans sideways instead of shrinking further.
 */
export const TERMINAL_MIN_SCALE = 0.62;

/** How far in a pinch may zoom -- roughly three words to a line at 1.8. */
export const TERMINAL_MAX_SCALE = 1.8;

/**
 * How far the fit below may zoom a pane that is narrower than the phone's grid.
 *
 * The fit exists because a pane the reader did not choose the width of --
 * tmux's third split, 36 columns of an 80-column window -- otherwise draws its
 * text across the left 40% of the phone and leaves the rest blank. Scaling it
 * up until its columns reach the edge is the whole idea, and for the panes that
 * motivated it the ratio does the work on its own: 36 columns on a 49-column
 * phone is 1.36, and nothing here binds.
 *
 * The cap is for the other end, and it is a limit on rows rather than on
 * columns. Scaling up costs vertical room in exact proportion -- at 1.6 a
 * viewport that showed 44 rows shows 27, at 2.5 it shows 17 -- and a pane's
 * shape is as much its height as its width. `TERMINAL_GRID_MIN_COLS` says a
 * 20-column pane is legal, so an uncapped fit would ask for 2.5 and hand back
 * a pane with a third of its rows: bigger, and less of the thing the reader
 * opened.
 *
 * 1.6 rather than the pinch's own 1.8 because this is a *default*, and a
 * default that opens at the outer limit of the gesture that overrides it
 * leaves the reader nowhere to go. At 1.6 the pinch still has room in both
 * directions -- 0.62 below, 1.8 above -- so a reader who disagrees with the
 * fit can say so and be remembered (see `terminalScaleOnScreenLeave`).
 *
 * A pane narrow enough to hit the cap keeps some empty width on the right.
 * That is the honest answer rather than a failure: at that point filling the
 * width and keeping the pane readable are two different requests, and the one
 * the reader made was to read the pane.
 */
export const TERMINAL_MAX_FIT_SCALE = 1.6;

/**
 * The scale at which a pane's own columns fill the phone's grid -- or 1 when
 * they already do, or more than do.
 *
 * The gateway reports a pane's real width and the canvas lays the snapshot out
 * at exactly that many columns, because the program on the far side hard-wrapped
 * its own text there; reflowing a 36-column pane to 49 would re-break lines
 * Claude Code and nvim had already broken. So the pane's width is fixed and the
 * only free variable is how big each column is drawn.
 *
 * Columns rather than points on purpose: both numbers are counts of the same
 * cell, so their ratio is exactly the factor that puts the pane's last column
 * where the phone's last column would have been, and it needs no cell advance,
 * no padding and no viewport to say so. It is also very slightly conservative
 * -- the phone's own column count is floored -- which is the direction to err,
 * because the alternative is a fitted pane whose right-hand column sits a
 * fraction past the edge.
 *
 * Returns 1, not a smaller number, for a pane as wide as the phone or wider.
 * Shrinking those is the question card #643 already answered: it gave panes of
 * different widths different glyph sizes under one Text size setting. A wide
 * pane keeps its 1:1 text and is read by panning across it, exactly as it is
 * today. `undefined` columns -- a gateway too old to report a width, and every
 * SSH shell, whose grid *is* the PTY and can never differ from the phone's --
 * likewise mean 1 and no fit at all.
 */
export function terminalFitToWidthScale(phoneColumns: number, paneColumns?: number): number {
  if (typeof paneColumns !== 'number' || !Number.isFinite(paneColumns) || paneColumns <= 0) {
    return 1;
  }
  if (!Number.isFinite(phoneColumns) || phoneColumns <= 0) return 1;
  if (paneColumns >= phoneColumns) return 1;
  return Math.min(phoneColumns / paneColumns, TERMINAL_MAX_FIT_SCALE);
}

/** The point size the setting names, falling back to the middle one. */
export function terminalFontSize(size: TerminalTextSize): number {
  return TERMINAL_TEXT_SIZE_POINTS[size] ?? TERMINAL_TEXT_SIZE_POINTS.default;
}

/**
 * The remembered pinch for every pane the reader has left since it was last
 * trimmed, keyed on the pane's own id (see `TERMINAL_MAX_REMEMBERED_PANE_SCALES`
 * for how that trimming works and the module comment above for why this is a
 * plain record rather than something that reaches storage itself).
 */
export type TerminalPaneScales = Readonly<Record<string, number>>;

/**
 * Long enough that nobody working across a dozen panes today loses one before
 * it is asked for again; short enough that the table backing it cannot grow
 * without bound. The same number `pane-view-mode`'s per-pane memory uses, for
 * the same reason -- panes churn, and a table that only ever grows is a leak
 * with a JSON.stringify in front of it.
 */
export const TERMINAL_MAX_REMEMBERED_PANE_SCALES = 64;

/**
 * Opening a pane starts at the size the setting names -- unless this exact
 * pane has a remembered pinch, in which case that pinch is what "this pane's
 * size" means now, until it is pinched again or its memory ages out.
 *
 * `remembered` is the table as the canvas last loaded or saved it; this
 * function only decides what a lookup against it means, so a missing entry
 * (never pinched), a stale one (the pane id came from a tmux server that has
 * since restarted and reused it for something else), or a corrupted one falls
 * back to 1 -- the setting's own size -- exactly as if nothing had ever been
 * remembered.
 *
 * It used to fit the pane's columns to the viewport first -- `max(MIN, min(1,
 * viewportWidth / contentWidth))` -- which sounds like a courtesy and was a
 * second answer to the question the setting had already answered. Content width
 * is `columns * cellWidth`, so the fit was a function of the pane's column
 * count and nothing else: on a ~400pt phone the default step fits about 45
 * columns, so a 65-column pane opened near 0.69, an 80-column pane clamped to
 * 0.62, and a 242-column pane clamped to 0.62 as well. Three panes, three glyph
 * sizes, from one setting -- and the indicator, dividing by each pane's own
 * fit, told the reader all three were 100% (card #643).
 *
 * Width is still the pan's job, not this function's: lines are never wrapped
 * and the canvas already pans sideways, so a wide table keeps its shape and is
 * read by moving across it. What changed is only that a reader who decides a
 * particular pane is worth a different size no longer has to make that
 * decision again every time they come back to it.
 *
 * A fit did come back, and #643 is not reverted: `terminalFitToWidthScale`
 * only ever scales *up*, only ever a pane the gateway reports as narrower than
 * the phone's own grid, and it is never remembered. The three panes that made
 * #643 -- 65, 80 and 242 columns on a 45-column phone -- are all wider than
 * the phone, so all three still open at 1 and the indicator still reads 100%
 * for all three. What is fitted is the case that rule had no answer for: a
 * pane whose columns do not reach the edge, which has no reason to be drawn
 * small and cannot be panned to fix it.
 */
export function terminalScaleOnPaneOpen(paneId: string, remembered: TerminalPaneScales): number {
  const value = remembered[paneId];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, value));
}

/** What a pane needs to know about itself to be opened at the right size. */
export interface TerminalOpenScaleInput {
  /** The pane whose remembered pinch is being looked up. */
  paneId: string;
  /** The table as the canvas last loaded or saved it. */
  remembered: TerminalPaneScales;
  /** Columns the phone would draw at this viewport and font (`terminalGridFor`). */
  phoneColumns: number;
  /** The pane's own width as the gateway reports it; `undefined` if it did not. */
  paneColumns?: number;
}

/**
 * The size a pane opens at: the reader's own answer if they have given one,
 * otherwise the fit, otherwise the Text size setting's 1:1.
 *
 * The two halves are `terminalScaleOnPaneOpen` and `terminalFitToWidthScale`,
 * unchanged and each still testable on its own; this is only the order they are
 * asked in. A remembered pinch wins outright -- a reader who has said what size
 * this pane should be has said it about this pane, and a default that argued
 * with them would be the app changing its mind every time they came back.
 *
 * **A fit is never written down, and that is the whole answer to "does a pane's
 * column count changing reset a remembered scale".** The fit is recomputed from
 * the pane's current width every time the pane is opened, so a reader who never
 * pinched gets a new fit the moment tmux reports a new width -- re-split the
 * window on the Mac and the phone re-fits, with nothing to invalidate, because
 * there was never a stored number to be wrong. A reader who *did* pinch has an
 * entry, and it survives the re-split, because it was a statement about how big
 * they wanted this pane's text and not about how wide the pane happened to be.
 *
 * `terminalScaleOnScreenLeave` is what keeps that true: handed the same default
 * this function just produced, it drops rather than stores a scale that has come
 * back to it (see its own note). So the one ambiguous case -- a reader who
 * pinches to within half a percent of the fit -- resolves as a fit, which draws
 * exactly what they asked for now and re-fits later. Ambiguous because the two
 * are the same number; harmless because the number is the same.
 */
export function terminalOpenScale({
  paneId,
  remembered,
  phoneColumns,
  paneColumns,
}: TerminalOpenScaleInput): number {
  const value = remembered[paneId];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return terminalScaleOnPaneOpen(paneId, remembered);
  }
  return terminalFitToWidthScale(phoneColumns, paneColumns);
}

/**
 * How far left the pane may be panned: the point where its last column reaches
 * the right edge, and never past it.
 *
 * `textWidth` is the drawn width of the pane's own columns plus the grid's
 * padding -- `frame.columns * cellWidth + horizontalPadding * 2` -- and
 * deliberately not the canvas's `contentWidth`, which is that number floored at
 * the viewport width so a short pane still has a full-width surface to draw on.
 *
 * For every pane wider than the viewport the two are the same number and this
 * is the arithmetic the pan has always used. They differ only for a pane
 * narrower than the phone: there `contentWidth` is the viewport, so scaling up
 * made the *surface* grow with the scale while the text stayed where it was,
 * and the reader could pan a fitted pane sideways into blank canvas. Measured
 * against the text instead, a pane too narrow to overflow simply does not pan.
 */
export function terminalPanMinX(viewportWidth: number, textWidth: number, scale: number): number {
  'worklet';
  return Math.min(0, viewportWidth - textWidth * scale);
}

/**
 * Leaving the service screen remembers the pinch this pane is showing right
 * now -- keyed on the pane's id -- so the next time this exact pane is opened,
 * whether later in this session or after the app has been killed and
 * relaunched, it opens at this size instead of back at the setting's.
 *
 * A separate moment from opening a pane, and still worth its own name for the
 * reason it always was: the canvas is deliberately never remounted on a pane
 * switch (the pane carousel would flash), so nothing about the component's
 * lifetime marks "the reader is done with this pane" on its own. Leaving the
 * screen is the moment -- and `skia-terminal.tsx` calls this from two places
 * because "leaving" is two different events depending on where the reader
 * goes: Settings and the panels sheet push over this screen and leave it
 * mounted-but-blurred, so a render with `screenFocused: false` is the moment;
 * going back to the server list pops this screen's own route instead, which
 * unmounts it without ever rendering `screenFocused: false` first (confirmed
 * live), so an unmount cleanup is the moment there. Both call sites hand the
 * same scale to the same function, so a pane the reader left twice in a row
 * -- blurred, then actually torn down -- is just this function agreeing with
 * itself.
 *
 * Pure, like its counterpart above: handed the table the canvas has, it hands
 * back the table to keep, and never touches a disk. At the setting's own size
 * there is nothing worth remembering, so the entry is dropped rather than
 * written as 1 -- a pane pinched back to default earns its slot back
 * immediately instead of occupying one with a number that would only ever
 * have been read as the fallback anyway.
 *
 * `defaultScale` is which number counts as "the size it would have opened at
 * anyway", and it is 1 -- the setting's own size, byte for byte the rule this
 * function has always applied -- for every pane except one the fit has scaled
 * up (`terminalFitToWidthScale`). For those it is the fit, and dropping there
 * rather than storing is what makes a fit a default instead of a decision: a
 * narrow pane the reader only looked at leaves nothing behind, so it is fitted
 * again from whatever width tmux reports next time, while a narrow pane the
 * reader actually pinched leaves the number they chose and keeps it through a
 * re-split. See `terminalOpenScale`, which is handed the same default. Otherwise the pane is re-inserted at
 * the end of the table, so trimming to `TERMINAL_MAX_REMEMBERED_PANE_SCALES`
 * drops whichever pane has gone longest untouched, not whichever was pinched
 * first.
 *
 * This used to reset the scale back to the setting's size instead of writing
 * it down, which was deliberate while a pane still opened fitted to its own
 * width (see the fit `terminalScaleOnPaneOpen` used to do): a remembered
 * number on top of a per-pane fit would have been two answers to the same
 * question. With the fit gone and every pane opening at 1:1, a wide pane
 * overflowing the screen is the common case rather than the rare one, and the
 * 8% between the compact and default steps of the setting is not enough of an
 * answer to it -- so the owner's answer was to pinch, once, by hand, to the
 * size a given pane actually needs, and have the app keep that answer the way
 * it keeps every other one. It still cannot survive an uninstall -- nothing
 * app-local can -- only being left, backgrounded, or killed and reopened.
 */
export function terminalScaleOnScreenLeave(
  paneId: string,
  scale: number,
  remembered: TerminalPaneScales,
  defaultScale = 1
): TerminalPaneScales {
  if (!paneId) return remembered;
  const clamped =
    Math.round(Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, scale)) * 100) / 100;
  const { [paneId]: _dropped, ...rest } = remembered;
  const resting = Number.isFinite(defaultScale) && defaultScale > 0 ? defaultScale : 1;
  if (Math.abs(clamped - Math.round(resting * 100) / 100) < 0.005) return rest;
  const entries = Object.entries(rest);
  const kept = entries.slice(
    Math.max(0, entries.length - (TERMINAL_MAX_REMEMBERED_PANE_SCALES - 1))
  );
  return { ...Object.fromEntries(kept), [paneId]: clamped };
}

/**
 * Where a pinch in progress has got to, clamped.
 *
 * A worklet: this runs inside the pinch's own `onUpdate`, once per frame on the
 * UI thread, and hopping to JS for a multiplication would put the zoom a frame
 * behind the fingers.
 */
export function pinchedTerminalScale(startScale: number, gestureScale: number): number {
  'worklet';
  return Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, startScale * gestureScale));
}

/**
 * The pinch as a percentage of the size the setting asked for.
 *
 * Absolute, against 1. It used to divide by the pane's own resting scale, which
 * made the number true of the pane and false of everything else: every pane
 * read 100% at rest, including the three that were drawing three different
 * sizes (card #643). A percentage that is 100 whatever it is measuring is not a
 * measurement.
 */
export function terminalZoomPercent(scale: number): number {
  'worklet';
  return Math.round(scale * 100);
}

/**
 * Where a pinch is, as the size pill has to know it.
 *
 * Three states rather than a boolean, because the recogniser's "I have started
 * watching" and "this is a pinch" are genuinely different moments and only the
 * second one is a zoom. On Android they are far apart: RNGH's
 * `PinchGestureHandler.onHandle` calls `begin()` on the first pointer of ANY
 * drag, whatever the pointer count, and only `activate()`s once the span
 * between two fingers has changed by more than the touch slop.
 *
 * Collapsing the two into one flag is what card #638 was: every one-finger
 * scroll raised the flag, the pill came up reading the resting size, and
 * because a scroll is a stream of begin/end pairs closer together than the
 * pill's hold, the hide timer was re-armed before it could ever fire and the
 * pill simply stayed on screen.
 */
export type TerminalPinchPhase = 'idle' | 'began' | 'active';

/**
 * What the size pill should read, or `null` for "not shown".
 *
 * The whole rule in one place, so the answer cannot drift from the phase: only
 * an active pinch says anything. A worklet -- the pinch's reaction reads it on
 * the UI thread, once per frame.
 */
export function terminalZoomIndicatorPercent(
  phase: TerminalPinchPhase,
  scale: number
): number | null {
  'worklet';
  if (phase !== 'active') return null;
  return terminalZoomPercent(scale);
}

/** "Large · 124%" -- the transient pinch indicator's whole text. */
export function terminalZoomLabel(size: TerminalTextSize, scale: number): string {
  const name = TERMINAL_TEXT_SIZE_NAMES[size] ?? TERMINAL_TEXT_SIZE_NAMES.default;
  return `${name} · ${terminalZoomPercent(scale)}%`;
}

/** Where a pane should be sitting when it opens, in the pane's own cells. */
export interface TerminalOpenViewInput {
  /** The pane's own grid, as the gateway reports it. Absent on an old gateway. */
  paneColumns?: number;
  paneRows?: number;
  /** The grid this phone would draw at this viewport and font, at 1:1. */
  phoneColumns: number;
  phoneRows: number;
  /**
   * The scale the pane is opening at (`terminalOpenScale`).
   *
   * The phone's grid is stated at 1:1, but the pane is drawn at this, so the
   * cells that actually fit on the glass are `phoneColumns / scale` by
   * `phoneRows / scale`. It matters: a 36-column pane fitted to 1.33x shows 20
   * of its 40 rows, not 27, and a placement computed against 27 would leave the
   * pane seven rows short of the bottom it was asked to open at.
   */
  scale?: number;
  /** The program's cursor, when the gateway reports one. Both or neither. */
  cursorColumn?: number;
  cursorRow?: number;
  /** Whether the program has taken the whole screen (`alternate_on`). */
  ownsScreen: boolean;
}

/**
 * The pane cell that should sit at the top-left of the viewport when the pane
 * opens. `{ column: 0, row: 0 }` means "exactly what this app has always done".
 */
export interface TerminalOpenView {
  column: number;
  row: number;
}

/** What a pane that should not be placed at all answers. */
const TERMINAL_OPEN_VIEW_ORIGIN: TerminalOpenView = { column: 0, row: 0 };

/**
 * Which corner of a pane the reader is put in front of when it opens.
 *
 * The problem this answers is not width and not height but *area*. A tmux
 * window at 359x82 -- one editor, no splits -- is 29,000 cells; the phone's
 * grid is about 50x30. Drawn 1:1 and parked at the origin, which is what the
 * canvas does today, the reader is shown the top-left 5% of the pane: rows 1-30
 * of 82 and columns 1-50 of 359. nvim's dashboard is centred around row 41,
 * its status line is row 82, and anything right-aligned is three hundred
 * columns away, so the one screen the reader is given is the one part of the
 * pane the program deliberately left empty.
 *
 * Scaling cannot fix it and this function does not try: fitting 359 columns
 * into 50 is 0.14x, a 1.8pt font, and fitting both axes is the same 0.14x. A
 * pane bigger than the phone can only be read by moving around it, so the
 * question worth answering is where to start.
 *
 * **Only a pane that owns the screen is placed.** A shell is a stream: its
 * newest line is the point, the canvas already rests it at the bottom, and
 * `followOutput` keeps it there -- placing it anywhere else would be arguing
 * with the reason it is on screen. An editor is a picture, and which part of
 * the picture the reader lands on is a real choice with no default.
 *
 * **A pane that fits is not placed either**, on either axis, so every pane
 * small enough to be seen whole opens exactly where it opens today.
 *
 * Otherwise:
 * - **The cursor, when the gateway reports one**, centred in the viewport and
 *   clamped inside the pane. It is the best available answer to "where is the
 *   program actually working": nvim's cursor is in the file, an agent's is at
 *   its prompt. Centred rather than cornered because a cursor at the edge of
 *   the screen shows the reader half the context.
 * - **Bottom-left otherwise.** Not the origin, which is the corner that is
 *   empty in every full-screen program worth opening: nvim's status and message
 *   line, a shell's prompt, and an agent's newest output all live on the last
 *   row, and the left is where a line starts. It is the corner most likely to
 *   be carrying the thing that changed most recently.
 *
 * Pure, and in cells rather than points: the canvas owns the cell advance, the
 * row pitch, the padding and the clamps, and a rule expressed in points could
 * not be checked against a pane's geometry without restating all four.
 */
export function terminalOpenView({
  paneColumns,
  paneRows,
  phoneColumns,
  phoneRows,
  scale = 1,
  cursorColumn,
  cursorRow,
  ownsScreen,
}: TerminalOpenViewInput): TerminalOpenView {
  if (!ownsScreen) return TERMINAL_OPEN_VIEW_ORIGIN;
  const columns =
    Number.isFinite(paneColumns) && (paneColumns ?? 0) > 0 ? (paneColumns as number) : 0;
  const rows = Number.isFinite(paneRows) && (paneRows ?? 0) > 0 ? (paneRows as number) : 0;
  if (columns <= 0 || rows <= 0) return TERMINAL_OPEN_VIEW_ORIGIN;
  if (!Number.isFinite(phoneColumns) || !Number.isFinite(phoneRows)) {
    return TERMINAL_OPEN_VIEW_ORIGIN;
  }
  const drawnScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const visibleColumns = Math.max(0, phoneColumns) / drawnScale;
  const visibleRows = Math.max(0, phoneRows) / drawnScale;
  const spareColumns = Math.max(0, columns - visibleColumns);
  const spareRows = Math.max(0, rows - visibleRows);
  if (spareColumns === 0 && spareRows === 0) return TERMINAL_OPEN_VIEW_ORIGIN;

  const hasCursor =
    typeof cursorColumn === 'number' &&
    Number.isFinite(cursorColumn) &&
    typeof cursorRow === 'number' &&
    Number.isFinite(cursorRow);
  if (!hasCursor) {
    // Bottom-left: the last row of the pane at the bottom of the viewport.
    // Rounded up, because a partly visible row at the top is a row the reader
    // can read, while stopping short leaves the last row half off the bottom.
    return { column: 0, row: Math.ceil(spareRows) };
  }
  const clamp = (value: number, limit: number) => Math.max(0, Math.min(limit, Math.round(value)));
  return {
    column: clamp((cursorColumn as number) - visibleColumns / 2, spareColumns),
    row: clamp((cursorRow as number) - visibleRows / 2, spareRows),
  };
}
