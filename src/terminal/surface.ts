import type { TerminalFrame } from '@/terminal/types';

/**
 * Which surface a pane's own program has claimed, read off the frame.
 *
 * A shell prints lines onto the terminal's surface and the terminal owns it. A
 * full-screen program does not: it repaints an alternate screen it believes is
 * entirely its own, in colours it chose for the terminal it was configured
 * against. Those two facts are what this file separates, because the app can
 * only honour the second one if it can see it.
 *
 * Read, never guessed at from the pane's name: the frame is the only place the
 * program's own intent survives the trip through the gateway.
 */
export type TerminalSurface = {
  /**
   * The background the program has painted over most of its screen, or null
   * when most of the screen is left at the terminal's default -- which is what
   * a scheme with a transparent `Normal` produces, and it is the common case.
   */
  background: string | null;
  /**
   * Whether the frame carries colours the app's palette never named.
   *
   * The parser resolves ANSI 0-15 through the theme (hex, straight out of the
   * pack) and everything else -- 24-bit SGR and the 256-colour cube -- to an
   * `rgb(r, g, b)` string of its own. So the prefix *is* the question "did this
   * colour come from us or from the program", with no extra bookkeeping.
   */
  verbatim: boolean;
  /**
   * Whether the last read saw no verbatim colour while `verbatim` was still
   * being held -- the first of the two misses it takes to let go. See
   * `readTerminalSurface`.
   */
  verbatimMissed?: boolean;
};

const EMPTY_SURFACE: TerminalSurface = { background: null, verbatim: false };

/**
 * The band a surface has to cross to change hands, as shares of the screen.
 *
 * A bare majority flipped on the cell: a full-screen program whose paint sat
 * near half the screen -- a split, a half-filled list, a popup over the
 * editor -- swapped the whole pane between the app theme and the adopted
 * surface from one snapshot to the next, a whole-pane colour flash ten times a
 * second. So a background is adopted only once it clearly owns the screen, and
 * kept until it clearly does not: between the two thresholds the answer is
 * whatever it was.
 */
export const SURFACE_ADOPT_SHARE = 0.55;
export const SURFACE_RELEASE_SHARE = 0.45;

/**
 * Reads the surface a frame claims.
 *
 * `screenRows`, when the gateway has said how tall the pane's viewport is,
 * limits the read to the live screen at the tail of the window: the rows above
 * it are ring-buffer history, often from before the program started, and a
 * shell prompt scrolled off an hour ago has no say in what an editor's surface
 * is now.
 *
 * `previous` is the surface the pane is wearing now -- this function's own
 * answer for the last committed snapshot -- and is what the read is relative
 * to: a background is adopted above `SURFACE_ADOPT_SHARE` and released below
 * `SURFACE_RELEASE_SHARE` (see there), and verbatim colour, once seen, is let
 * go only after two snapshots in a row without any. Without `previous` the read
 * is a cold one against the adopt threshold.
 *
 * O(runs), not O(cells): a run already carries the columns it spans, so a full
 * screen costs a few hundred additions rather than one per cell. This runs once
 * per applied snapshot, beside a parse that is orders of magnitude dearer.
 */
export function readTerminalSurface(
  frame: TerminalFrame,
  screenRows = 0,
  previous?: TerminalSurface
): TerminalSurface {
  const total = frame.lines.length;
  const start = screenRows > 0 ? Math.max(0, total - screenRows) : 0;
  const rows = total - start;
  if (rows <= 0 || frame.columns <= 0) return EMPTY_SURFACE;

  const coverage = new Map<string, number>();
  let verbatim = false;
  for (let row = start; row < total; row += 1) {
    for (const run of frame.lines[row].runs) {
      const { style } = run;
      if (!verbatim && (isVerbatimColor(style.foreground) || isVerbatimColor(style.background))) {
        verbatim = true;
      }
      // An inverse run paints its *foreground* as the background, and it is
      // always an accent -- a status line, a selection, a matched bracket. It
      // can decorate a surface but it cannot be one, so it is left out of the
      // count rather than allowed to win it.
      if (style.inverse || !style.background) continue;
      coverage.set(style.background, (coverage.get(style.background) ?? 0) + runWidth(run));
    }
  }

  let widest: string | null = null;
  let painted = 0;
  for (const [color, cells] of coverage) {
    if (cells > painted) {
      painted = cells;
      widest = color;
    }
  }
  // Clearly most of the screen, so "the surface" means the thing the program
  // painted everything on rather than the widest thing it painted *onto* it.
  // Cells the program left at the default are counted against it by simply not
  // being in the map: a screen of dark chips on default ground loses here, and
  // that is the case this whole file exists for. A surface already adopted
  // keeps its claim until it has clearly lost it.
  const screen = rows * frame.columns;
  const held = previous?.background ?? null;
  const background =
    held !== null && (coverage.get(held) ?? 0) >= screen * SURFACE_RELEASE_SHARE
      ? held
      : painted > screen * SURFACE_ADOPT_SHARE
        ? widest
        : null;
  if (verbatim || !previous?.verbatim) return { background, verbatim };
  // Held through one snapshot without a verbatim colour, released on the
  // second: a program that paints truecolour on some frames and not others
  // must not flip the pane between its surface and the app's each time.
  return previous.verbatimMissed
    ? { background, verbatim: false }
    : { background, verbatim: true, verbatimMissed: true };
}

/**
 * Whether text on `color` has to be light. Rec. 601 luma rather than the WCAG
 * curve: this only ever decides which of two prepared variants to reach for,
 * and the two disagree nowhere near the threshold.
 */
export function isDarkSurface(color: string): boolean {
  const channels = parseColor(color);
  if (!channels) return true;
  const [red, green, blue] = channels;
  return red * 0.299 + green * 0.587 + blue * 0.114 < 128;
}

function runWidth(run: { startColumn: number; endColumn: number }): number {
  return Math.max(0, run.endColumn - run.startColumn);
}

function isVerbatimColor(color: string | null): boolean {
  return color !== null && color.startsWith('rgb(');
}

const RGB_PATTERN = /^rgb\((\d+), (\d+), (\d+)\)$/;

function parseColor(color: string): [number, number, number] | null {
  const rgb = RGB_PATTERN.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  if (color.length === 7 && color.startsWith('#')) {
    return [
      Number.parseInt(color.slice(1, 3), 16),
      Number.parseInt(color.slice(3, 5), 16),
      Number.parseInt(color.slice(5, 7), 16),
    ];
  }
  if (color.length === 4 && color.startsWith('#')) {
    const expand = (part: string) => Number.parseInt(part + part, 16);
    return [expand(color[1]), expand(color[2]), expand(color[3])];
  }
  return null;
}
