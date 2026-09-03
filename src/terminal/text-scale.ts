import type { TerminalTextSize } from '@/stores/app-settings';

/**
 * How large the terminal draws its text, in points.
 *
 * The three steps are the design system's own type scale
 * (https://osuki.dev/design.md) rather than hand-picked numbers: caption, label
 * and body. Taking them from the scale is what makes the terminal agree with the
 * rest of the app -- the label size here is the label size on a settings row --
 * and it makes the steps even, which the previous 11.5 / 12.5 / 14.5 was not.
 *
 * The default is the label tier. The old default of 12.5 sat below the caption
 * size, i.e. the terminal's *normal* reading size was smaller than the smallest
 * text the design system defines, and compact's 11.5 sat under the ~11pt that is
 * legible at arm's length on a phone.
 *
 * The cost is columns. A monospace advance is close to 0.6em, so on a 402pt-wide
 * phone (~378pt of content) the steps fit roughly 52 / 45 / 39 columns against
 * the old 54 / 50 / 43. Nothing here reaches the 80 columns a desktop terminal
 * assumes at any size, so the grid already wraps and pans; the trade buys
 * legibility in the case that is actually common.
 *
 * The spec's CLI rule -- "no font sizes in terminals" -- is about driving a real
 * terminal emulator, where the size belongs to the user's terminal. This is a
 * grid the app draws itself, so the app has to choose.
 */
export const TERMINAL_TEXT_SIZES: Record<TerminalTextSize, number> = {
  /** caption */
  compact: 12,
  /** Between caption and label: 14 read a size too large on device. */
  default: 13,
  /** body */
  large: 16,
};

/**
 * What the terminal draws at when nothing asks for a size.
 *
 * Derived, not restated. It used to be its own literal (13.5) and had drifted
 * away from the value the screen actually passed (12.5), so the number in the
 * component and the number on screen disagreed by a point and a half.
 */
export const DEFAULT_TERMINAL_FONT_SIZE = TERMINAL_TEXT_SIZES.default;

/**
 * Line height, as a multiple of the font size.
 *
 * One ratio for every step, because the grid's row pitch has to be predictable.
 * The spec's tiers vary (caption 1.35, label 1.45, body 1.6) and the terminal
 * takes label's 1.45: it is the tier the default size comes from, it sits inside
 * the 1.4-1.5 that code is normally set at, and body's 1.6 would spend about an
 * eighth of the visible rows on leading in a view whose whole job is showing as
 * much scrollback as it can.
 *
 * Letter-spacing is deliberately absent and must stay so. Glyphs are placed
 * against a cell advance measured from the font, so any tracking would walk the
 * text off the grid it is drawn on -- and the spec only tracks display and
 * heading anyway, never text at these sizes.
 */
export const TERMINAL_LINE_HEIGHT_RATIO = 1.45;

/** The row pitch for a given size, rounded the way the renderer rounds it. */
export function terminalLineHeight(fontSize: number): number {
  return Math.round(fontSize * TERMINAL_LINE_HEIGHT_RATIO * 10) / 10;
}

/**
 * The advance of the bundled JetBrains Mono, as a fraction of the font size.
 *
 * Read from the font's own `hmtx` (599.999/1000 units per em), not guessed. It
 * is here so a test can state the true cell width for a size without loading
 * Skia, and so the renderer's fallback -- when a font fails to report a width at
 * all -- is the same number rather than a nearby one.
 */
export const TERMINAL_ADVANCE_RATIO = 0.6;

/**
 * The margin the grid keeps between the canvas edge and its first column and
 * row, in points. The canvas draws with these, and the SSH grid sizing
 * (`@/lib/ssh-grid-metrics`) subtracts them, so they live here rather than as
 * two private constants that would have to agree by luck.
 */
export const TERMINAL_GRID_HORIZONTAL_PADDING = 7;
export const TERMINAL_GRID_VERTICAL_PADDING = 8;

/**
 * The part of the canvas height the grid does not rest in, in points. Output
 * resting flush against the dock reads as clipped, so the canvas keeps its
 * last line a couple of lines short of the bottom edge (see
 * `animatedVisibleHeight` in `skia-terminal.tsx`). A caller fitting a PTY
 * into that canvas has to leave the same room, or the top row of a full
 * screen sits above the viewport.
 */
export function terminalViewportClearance(lineHeight: number): number {
  return lineHeight * 1.8 - 14;
}

/**
 * Rounds a horizontal length onto the device pixel grid.
 *
 * The renderer's single horizontal rounding step, and the reason cell positions
 * cannot drift. `measureCellWidth` puts the cell advance through here once;
 * every column position is then `column * cellWidth`, a multiplication of an
 * exact multiple of `1/ratio`, so every cell edge lands on a whole device pixel
 * and column 200 is as exact as column 1. Nothing downstream rounds again.
 *
 * Rounding to a whole *point* instead -- which is what an SkFont does by default
 * when linear metrics are off -- is the bug this replaces: a point is not a unit
 * the screen has, and the error is unbounded relative to the pixel grid. At 14pt
 * it made the cell 0.4pt narrower than the glyphs drawn into it.
 */
export function snapToDevicePixel(value: number, ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return value;
  return Math.round(value * ratio) / ratio;
}

/**
 * Sub-pixel slack before a fallback glyph counts as too wide for its cells.
 *
 * A shaper's width and `columns * cellWidth` are two different accumulations of
 * the same font metrics, so they land a rounding error apart even when the
 * glyph fits exactly. Scaling on that error would visibly wobble every CJK
 * glyph between frames for no reason; a twentieth of a point is well under a
 * device pixel at any ratio and well over any accumulated float error.
 */
const FIT_TOLERANCE = 0.05;

/**
 * Where a fallback-shaped grapheme is drawn inside the cells the grid gave it.
 *
 * The batched path pins glyphs to cells itself, but anything the bundled font
 * cannot draw -- CJK, emoji, and the East Asian *ambiguous* characters agents
 * love (`①` U+2460..U+24FF, which JetBrains Mono Nerd Font has no glyph for) --
 * goes through a shaped paragraph instead, and a paragraph draws at the
 * fallback font's own advance. `layout(maxWidth)` does not constrain that: it
 * only says where to break lines, and one grapheme is unbreakable. So a system
 * font that renders `①` fullwidth (1em) puts it in a cell that is 0.6em wide
 * and the glyph laps over its neighbour -- which is the overlap between the
 * circled digits and the Latin text after them.
 *
 * Two cases, and they are the same rule as the batched path's centring term
 * (see `drawRunCells`), extended to the one case that term cannot express:
 *
 * - **Narrower than its span** -- an ordinary CJK glyph in its two cells, or a
 *   narrow fallback in one. Centre it. Left-aligning, which is what this did,
 *   hangs every wide glyph off the left edge of its pair of cells and leaves
 *   the gap on the right.
 * - **Wider than its span** -- compress it horizontally onto the span. The
 *   alternative is a clip, and a clipped `①` is a broken arc with a digit
 *   falling out of it; a compressed one is an ellipse that still reads as the
 *   character. Compression is horizontal only on purpose: scaling both axes
 *   would keep the circle round but drop the glyph to 60% of the size of the
 *   text beside it and off the baseline rhythm every other row is drawn on.
 *
 * Both are pure geometry against a measured width, so the grid stays the
 * gateway's: nothing here changes what column a character occupies, only how
 * the ink is fitted into the columns it was already given. Widening the cell or
 * re-classifying the character would move every cell after it on the row and
 * disagree with the wrapping herdr already applied.
 */
export function fitFallbackToSpan(
  naturalWidth: number,
  span: number
): { offsetX: number; scaleX: number } {
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 0 || span <= 0) {
    return { offsetX: 0, scaleX: 1 };
  }
  if (naturalWidth <= span + FIT_TOLERANCE) {
    return { offsetX: (span - naturalWidth) / 2, scaleX: 1 };
  }
  return { offsetX: 0, scaleX: span / naturalWidth };
}
