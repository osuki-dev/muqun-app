/**
 * How many columns and rows of terminal fit in a viewport.
 *
 * The gateway's panes tell the app their own width and the grid draws whatever
 * it is given; an SSH shell is the other way round. The PTY has no size until
 * the app names one, and the size it should name is exactly the grid
 * `SkiaTerminal` will draw into the same rectangle -- so the numbers here are
 * the canvas's own: its cell advance ratio, its row pitch, and the padding it
 * leaves around the grid. All of them are imported from the modules the
 * canvas reads them from rather than restated, so a retuned scale reaches the
 * PTY size without a second table to forget.
 *
 * Pure. The canvas measures the real cell advance off the loaded font and
 * reports it (`SkiaTerminal`'s `onCellMetrics`, backed by its
 * `measureCellWidth`); the screen passes it in here. Without one the advance
 * ratio stands in, which is the same fallback the canvas itself uses when a
 * font fails to report a width.
 *
 * That estimate used to be a constant, and it was the bundled JetBrains Mono's
 * own 0.6. A reader who puts their own face in the monospace slot has changed
 * the number it is an estimate *of* -- Iosevka advances 0.5, a Han mono face
 * 1.0 -- so `advanceRatio` is a parameter now, fed from the measurement taken
 * when the font was installed. It only decides the first frame, before the
 * canvas has measured a real cell, but the first frame is the one the shell
 * draws its prompt into: getting it wrong at 1.0 against an assumed 0.6 opens
 * the PTY at nearly twice the columns that fit, and everything the shell
 * printed before the resize landed is already wrapped to the wrong width.
 */
import {
  TERMINAL_ADVANCE_RATIO,
  TERMINAL_GRID_HORIZONTAL_PADDING,
  TERMINAL_GRID_VERTICAL_PADDING,
  snapToDevicePixel,
  terminalLineHeight,
  terminalViewportClearance,
} from '@/terminal/text-scale';

export interface TerminalGridInput {
  /** The viewport the canvas fills, in points. */
  width: number;
  height: number;
  fontSize: number;
  /** The measured cell advance, when the canvas has one. Points. */
  cellWidth?: number;
  /** The row pitch, when something other than the scale's rounding is wanted. */
  lineHeight?: number;
  /** `PixelRatio.get()`, for the fallback advance's device-pixel snap. */
  pixelRatio?: number;
  /**
   * The advance of the font's `M` as a fraction of the em, for the estimate.
   *
   * Only read when `cellWidth` is absent. The bundled font's 0.6 by default,
   * which is what every caller passed implicitly before the monospace slot
   * existed.
   */
  advanceRatio?: number;
}

export interface TerminalGrid {
  cols: number;
  rows: number;
}

/** A PTY narrower or shorter than this is not a terminal any program can use. */
export const TERMINAL_GRID_MIN_COLS = 20;
export const TERMINAL_GRID_MIN_ROWS = 4;

/** The size a shell opens at before the viewport has been measured. */
export const TERMINAL_GRID_DEFAULT: TerminalGrid = { cols: 80, rows: 24 };

/** The cell advance the canvas falls back to when the font reports nothing. */
export function fallbackTerminalCellWidth(
  fontSize: number,
  pixelRatio = 1,
  advanceRatio: number = TERMINAL_ADVANCE_RATIO
): number {
  const ratio =
    Number.isFinite(advanceRatio) && advanceRatio > 0 ? advanceRatio : TERMINAL_ADVANCE_RATIO;
  return snapToDevicePixel(Math.max(7, fontSize * ratio), pixelRatio);
}

export function terminalGridFor({
  width,
  height,
  fontSize,
  cellWidth,
  lineHeight,
  pixelRatio = 1,
  advanceRatio,
}: TerminalGridInput): TerminalGrid {
  const advance =
    cellWidth !== undefined && Number.isFinite(cellWidth) && cellWidth > 0
      ? cellWidth
      : fallbackTerminalCellWidth(fontSize, pixelRatio, advanceRatio);
  const pitch =
    lineHeight !== undefined && Number.isFinite(lineHeight) && lineHeight > 0
      ? lineHeight
      : terminalLineHeight(fontSize);
  const usableWidth = Math.max(0, width - TERMINAL_GRID_HORIZONTAL_PADDING * 2);
  // The canvas rests its last line short of the bottom edge by the clearance;
  // a PTY sized to the whole height would put its top row above the viewport.
  const usableHeight = Math.max(
    0,
    height - TERMINAL_GRID_VERTICAL_PADDING * 2 - terminalViewportClearance(pitch)
  );
  return {
    cols: Math.max(TERMINAL_GRID_MIN_COLS, Math.floor(usableWidth / advance)),
    rows: Math.max(TERMINAL_GRID_MIN_ROWS, Math.floor(usableHeight / pitch)),
  };
}

/** Whether a resize is worth sending: the PTY only cares when a number moved. */
export function terminalGridChanged(a: TerminalGrid, b: TerminalGrid): boolean {
  return a.cols !== b.cols || a.rows !== b.rows;
}
