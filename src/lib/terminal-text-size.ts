import { TERMINAL_GRID_HORIZONTAL_PADDING, TERMINAL_TEXT_SIZES } from '@/terminal/text-scale';
/**
 * How big the terminal's text is -- one rule, in one place.
 *
 * Two mechanisms decide what a reader sees. The Text size setting names a point
 * size, and it is every pane's starting point: a pane nothing has ever been
 * remembered for opens at it. The pinch scales the canvas on top of that, and
 * it is a per-pane memory rather than a session-only look: it survives leaving
 * the service screen, and it survives the app being killed and relaunched,
 * because the end of the pinch is the moment it is written down
 * (`terminalScaleOnPinchEnd`) and opening is the moment it is read back
 * (`terminalScaleOnPaneOpen`), both keyed on the pane's id and its column
 * count (`terminalScaleKey`).
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

/**
 * How far out a pinch may zoom.
 *
 * Below this the glyphs stop being letters, and a pane that cannot be read is
 * not a smaller pane. Lines are never wrapped, so anything wider than the
 * viewport at this scale pans sideways instead of shrinking further.
 */
export const TERMINAL_MIN_SCALE = 0.62;

/** How far in a pinch may zoom -- roughly three words to a line at 1.8. */
export const TERMINAL_MAX_SCALE = 2.4;

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
 * fit can say so and be remembered (see `terminalScaleOnPinchEnd`).
 *
 * A pane narrow enough to hit the cap keeps some empty width on the right.
 * That is the honest answer rather than a failure: at that point filling the
 * width and keeping the pane readable are two different requests, and the one
 * the reader made was to read the pane.
 */
// 2.0 (owner's call, 2026-10-06): a 40-column pane fills a tablet's width instead
// of stopping at 1.6 with an empty strip on the right; rows get larger in return,
// which is what a reader opening a narrow pane on a big screen is asking for.
export const TERMINAL_MAX_FIT_SCALE = 2.0;

/**
 * The smallest glyph the fit may draw, in points.
 *
 * The fit below shrinks text a little when that is what it takes for the last
 * column to land on the right edge -- one column's worth at most. It never
 * takes the text under this to do it: below about 10pt a phone's terminal stops
 * being something read at arm's length, and a pane one column too wide is
 * better panned than squinted at. The pinch is the reader's own choice and is
 * not held to this; only the size the app picks on its own is.
 */
export const TERMINAL_MIN_FONT_PT = 10;

/**
 * What the fit needs to know about the canvas: how wide it is, how wide a cell
 * is at the setting's size (the measured advance, `measureCellWidth`), and the
 * setting's point size itself, for `TERMINAL_MIN_FONT_PT`.
 */
export interface TerminalFitGeometry {
  viewportWidth: number;
  cellWidth: number;
  fontSize: number;
}

/**
 * The scale at which `columns` cells -- and the grid's padding on each side,
 * which the canvas transform scales with them -- span the viewport exactly.
 * `null` when the geometry is not known yet (no viewport, no measured cell).
 */
export function terminalExactFillScale(
  { viewportWidth, cellWidth }: TerminalFitGeometry,
  columns: number
): number | null {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null;
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return null;
  if (!Number.isFinite(columns) || columns <= 0) return null;
  return viewportWidth / (columns * cellWidth + TERMINAL_GRID_HORIZONTAL_PADDING * 2);
}

/**
 * How many columns this phone's grid is, and the scale at which exactly that
 * many fill the width.
 *
 * Flooring `usable width / cell` -- all this used to be -- leaves up to a whole
 * cell of empty strip down the right of every screen. Instead the grid is the
 * floored count drawn a touch larger (`n` columns at `>= 1`) or one more column
 * drawn a touch smaller (`n + 1` at `< 1`), whichever is closer to the size the
 * setting asked for, so the text never moves more than one column's worth of
 * scale away from it. The smaller answer is only taken while it keeps the text
 * at or above `TERMINAL_MIN_FONT_PT`.
 */
export function terminalPhoneGrid(geometry: TerminalFitGeometry): {
  columns: number;
  scale: number;
} {
  const usable = geometry.viewportWidth - TERMINAL_GRID_HORIZONTAL_PADDING * 2;
  const floored = Math.floor(usable / geometry.cellWidth);
  if (!Number.isFinite(floored) || floored < 1) return { columns: 0, scale: 1 };
  const up = terminalExactFillScale(geometry, floored);
  const down = terminalExactFillScale(geometry, floored + 1);
  if (up === null || down === null) return { columns: floored, scale: 1 };
  if (1 - down < up - 1 && geometry.fontSize * down >= TERMINAL_MIN_FONT_PT) {
    return { columns: floored + 1, scale: down };
  }
  return { columns: floored, scale: up };
}

/**
 * The scale at which a pane's own columns fill the canvas edge to edge -- or 1
 * when the pane is wider than that and is read by panning.
 *
 * The gateway reports a pane's real width and the canvas lays the snapshot out
 * at exactly that many columns, because the program on the far side hard-wrapped
 * its own text there; reflowing a 36-column pane to 49 would re-break lines
 * Claude Code and nvim had already broken. So the pane's width is fixed and the
 * only free variable is how big each column is drawn.
 *
 * Exact, rather than the ratio of two column counts it used to be. The ratio
 * (`phoneColumns / paneColumns`) put the pane's last column where the phone's
 * *floored* last column would have been -- up to a cell short of the edge, and
 * the scale multiplied the shortfall, so a fitted pane carried an empty strip
 * down its right side. This lands the right padding on the right edge, a mirror
 * of the left.
 *
 * Three cases:
 * - **Narrower than the canvas** -- scaled up until it fills it, capped at
 *   `TERMINAL_MAX_FIT_SCALE`.
 * - **One column over** -- the pane is the `n + 1` that `terminalPhoneGrid`
 *   could also have picked, so it is drawn a touch smaller rather than panned
 *   for a single column, as long as that keeps the text at or above
 *   `TERMINAL_MIN_FONT_PT`. An SSH shell `terminalPhoneGrid` sized to `n + 1`
 *   rests here too.
 * - **Wider than that** -- 1, and the pane pans. Shrinking those is the
 *   question card #643 already answered: it gave panes of different widths
 *   different glyph sizes under one Text size setting.
 *
 * `undefined` columns (a gateway too old to report a width) and a canvas not
 * measured yet both mean 1: no fit at all.
 */
export function terminalFitToWidthScale(
  geometry: TerminalFitGeometry,
  paneColumns?: number
): number {
  if (typeof paneColumns !== 'number') return 1;
  const exact = terminalExactFillScale(geometry, paneColumns);
  if (exact === null) return 1;
  if (exact >= 1) return Math.min(exact, TERMINAL_MAX_FIT_SCALE);
  const oneColumnOver =
    (paneColumns - 1) * geometry.cellWidth <=
    geometry.viewportWidth - TERMINAL_GRID_HORIZONTAL_PADDING * 2;
  if (oneColumnOver && geometry.fontSize * exact >= TERMINAL_MIN_FONT_PT) return exact;
  return 1;
}

/**
 * The scale a mirror of a pane rests at: Home's reply drawer, a glance at a
 * pane the reader is not driving. Always the pane's own width against this
 * canvas, never a pinch remembered from the terminal screen.
 *
 * - **Narrower than the canvas**: scaled up to fill it, capped at
 *   `TERMINAL_MAX_FIT_SCALE` (as `terminalFitToWidthScale`).
 * - **Wider**: scaled down to fill it, but never below `TERMINAL_MIN_FONT_PT`;
 *   whatever is still too wide at that size pans. Card #643's one-size rule is
 *   about the terminal screen, where the reader reads at the setting's size; a
 *   glance is better served by seeing more of the pane at once.
 *
 * `undefined` columns or an unmeasured canvas mean 1: no fit at all.
 */
export function terminalMirrorFitScale(
  geometry: TerminalFitGeometry,
  paneColumns?: number
): number {
  if (typeof paneColumns !== 'number' || !(paneColumns > 0)) return 1;
  const exact = terminalExactFillScale(geometry, paneColumns);
  if (exact === null) return 1;
  if (exact >= 1) return Math.min(exact, TERMINAL_MAX_FIT_SCALE);
  const floor = Math.min(1, TERMINAL_MIN_FONT_PT / geometry.fontSize);
  return Math.max(exact, floor);
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
 * Where a pane's pinch is filed: its id and the column count it was pinched
 * at (home-dispatch-ux §10). A pinch is a statement about this pane at this
 * width; when tmux reports another width the entry no longer matches, the
 * pane opens at the fit again (`terminalFitToWidthScale`), and the next pinch
 * replaces the old entry. A pane whose width was never reported files under
 * its id alone.
 */
export function terminalScaleKey(paneId: string, columns?: number): string {
  return columns !== undefined && Number.isFinite(columns) && columns > 0
    ? `${paneId}@${columns}`
    : paneId;
}

function isPaneKey(key: string, paneId: string): boolean {
  return key === paneId || key.startsWith(`${paneId}@`);
}

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
export function terminalScaleOnPaneOpen(
  paneId: string,
  remembered: TerminalPaneScales,
  columns?: number
): number {
  const value = remembered[terminalScaleKey(paneId, columns)];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, value));
}

/** What a pane needs to know about itself to be opened at the right size. */
export interface TerminalOpenScaleInput {
  /** The pane whose remembered pinch is being looked up. */
  paneId: string;
  /** The table as the canvas last loaded or saved it. */
  remembered: TerminalPaneScales;
  /** The canvas the pane is fitted into (`terminalFitToWidthScale`). */
  fit: TerminalFitGeometry;
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
 * **A fit is never written down**, and a pinch is filed with the column count
 * it was made at (`terminalScaleKey`). So a width change -- the window re-split
 * on the Mac, `tmux resize-window` -- reaches neither: the fit is recomputed
 * from the pane's new width, and a pinch made at the old width no longer
 * matches and is not applied (home-dispatch-ux §10). The reader pinches again
 * if the new width wants another size.
 *
 * `terminalScaleOnPinchEnd` is what keeps that true: handed the same default
 * this function just produced, it drops rather than stores a scale that has come
 * back to it (see its own note). So the one ambiguous case -- a reader who
 * pinches to within half a percent of the fit -- resolves as a fit, which draws
 * exactly what they asked for now and re-fits later. Ambiguous because the two
 * are the same number; harmless because the number is the same. *
 * One floor on a remembered pinch: it never opens the pane narrower than the
 * view. A pinch out on a pane already narrower than the phone shows only empty
 * width beside it, and once remembered it opened that pane half-empty for
 * good -- on Home's drawer as well as here -- which reads as broken rather than
 * as a choice. Zooming in, and zooming out across a pane wider than the view,
 * are kept exactly as pinched.
 */
export function terminalOpenScale({
  paneId,
  remembered,
  fit,
  paneColumns,
}: TerminalOpenScaleInput): number {
  const value = remembered[terminalScaleKey(paneId, paneColumns)];
  if (typeof value === 'number' && Number.isFinite(value)) {
    const pinched = terminalScaleOnPaneOpen(paneId, remembered, paneColumns);
    // Never narrower than the view: a pinch may zoom in, or out across a wide
    // pane, but a remembered one that would leave the pane's last column short
    // of the right edge opens at the scale that puts it there instead.
    const exact = typeof paneColumns === 'number' ? terminalExactFillScale(fit, paneColumns) : null;
    if (exact === null) return pinched;
    return Math.max(pinched, Math.min(exact, TERMINAL_MAX_FIT_SCALE));
  }
  return terminalFitToWidthScale(fit, paneColumns);
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
 * The end of a pinch remembers the scale the reader chose for this pane at
 * this width, and nothing else ever writes the table (home-dispatch-ux §10).
 * Leaving the screen, switching panes and unmounting used to write whatever
 * scale the canvas held, which could be an incidental one -- a fit, or a
 * scale carried over from another pane before the switch render applied --
 * and was sometimes filed under the next pane's id. Only the gesture knows
 * the reader meant it.
 *
 * Pure: handed the table, it hands back the table to keep. Every earlier
 * entry for this pane goes (any width), so a pane has one remembered pinch.
 * A scale at the pane's resting size (`defaultScale`: 1, or the fit for a
 * narrow pane) is not remembered, so pinching back to it hands the pane back
 * to the fit. The newest entry goes last, so trimming to
 * `TERMINAL_MAX_REMEMBERED_PANE_SCALES` drops the longest-untouched pane.
 */
export function terminalScaleOnPinchEnd(
  paneId: string,
  scale: number,
  remembered: TerminalPaneScales,
  defaultScale = 1,
  columns?: number
): TerminalPaneScales {
  if (!paneId) return remembered;
  const clamped =
    Math.round(Math.max(TERMINAL_MIN_SCALE, Math.min(TERMINAL_MAX_SCALE, scale)) * 100) / 100;
  const rest = Object.entries(remembered).filter(([key]) => !isPaneKey(key, paneId));
  const resting = Number.isFinite(defaultScale) && defaultScale > 0 ? defaultScale : 1;
  if (Math.abs(clamped - Math.round(resting * 100) / 100) < 0.005) {
    return rest.length === Object.keys(remembered).length ? remembered : Object.fromEntries(rest);
  }
  const kept = rest.slice(Math.max(0, rest.length - (TERMINAL_MAX_REMEMBERED_PANE_SCALES - 1)));
  return { ...Object.fromEntries(kept), [terminalScaleKey(paneId, columns)]: clamped };
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
