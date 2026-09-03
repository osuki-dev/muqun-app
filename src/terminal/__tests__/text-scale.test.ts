import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  TERMINAL_ADVANCE_RATIO,
  TERMINAL_LINE_HEIGHT_RATIO,
  TERMINAL_TEXT_SIZES,
  fitFallbackToSpan,
  snapToDevicePixel,
  terminalLineHeight,
} from '@/terminal/text-scale';

describe('terminal text scale', () => {
  it('takes its three steps from the design type scale', () => {
    // caption / label / body. Not round numbers by accident -- if one of these
    // moves it should be because the design system moved.
    expect(TERMINAL_TEXT_SIZES).toEqual({ compact: 12, default: 13, large: 16 });
  });

  it('keeps the default nearer the small end: reading density won on device', () => {
    const { compact, default: base, large } = TERMINAL_TEXT_SIZES;
    // 12 / 13 / 16: 14 read a size too large in the hand (Ellen, 2026-07-27),
    // so the middle step is deliberately closer to compact than to large.
    expect(base - compact).toBeLessThanOrEqual(large - base);
  });

  it('grows strictly, smallest to largest', () => {
    const { compact, default: base, large } = TERMINAL_TEXT_SIZES;
    expect(compact).toBeLessThan(base);
    expect(base).toBeLessThan(large);
  });

  it('stays legible at the smallest step', () => {
    // Below about 11pt a monospace grid stops being readable at arm's length on
    // a phone. The previous compact step was 11.5.
    expect(TERMINAL_TEXT_SIZES.compact).toBeGreaterThanOrEqual(12);
  });

  it('derives the fallback from the default step rather than restating it', () => {
    // The regression this locks: the component's own default had drifted to
    // 13.5 while the screen passed 12.5, so "the default size" meant two
    // different things depending on where you read it.
    expect(DEFAULT_TERMINAL_FONT_SIZE).toBe(TERMINAL_TEXT_SIZES.default);
  });

  it('sets one row pitch for every step', () => {
    for (const size of Object.values(TERMINAL_TEXT_SIZES)) {
      // Rounded to a tenth of a point, so the ratio can only drift by that much.
      expect(Math.abs(terminalLineHeight(size) / size - TERMINAL_LINE_HEIGHT_RATIO)).toBeLessThan(
        0.05 / size + 1e-9
      );
    }
  });

  it('keeps leading inside the range code is normally set at', () => {
    expect(TERMINAL_LINE_HEIGHT_RATIO).toBeGreaterThanOrEqual(1.4);
    expect(TERMINAL_LINE_HEIGHT_RATIO).toBeLessThanOrEqual(1.5);
  });

  it('rounds the row pitch to a tenth, the way the renderer does', () => {
    expect(terminalLineHeight(14)).toBe(20.3);
    expect(terminalLineHeight(12)).toBe(17.4);
    expect(terminalLineHeight(16)).toBe(23.2);
  });
});

/**
 * The cell advance. These lock the rounding rule, not a particular number of
 * pixels: what must hold is that a cell edge is always on a device pixel and
 * that the cell is never narrower than the glyphs drawn into it by enough to
 * collide.
 */
describe('cell advance rounding', () => {
  // Every device pixel ratio the app actually ships against: iOS 2x and 3x,
  // and the fractional Android densities (xhdpi 2.0, 420dpi 2.625, 440dpi 2.75,
  // xxhdpi 3.0, 560dpi 3.5).
  const RATIOS = [2, 2.625, 2.75, 3, 3.5];
  const SIZES = Object.values(TERMINAL_TEXT_SIZES);

  it('states the bundled font advance as the font itself reports it', () => {
    // JetBrains Mono's hmtx gives 599.999/1000 units per em. Read, not guessed.
    expect(TERMINAL_ADVANCE_RATIO).toBeCloseTo(0.6, 5);
  });

  it('puts every cell edge on a whole device pixel', () => {
    for (const ratio of RATIOS) {
      for (const size of SIZES) {
        const cell = snapToDevicePixel(size * TERMINAL_ADVANCE_RATIO, ratio);
        // The property that matters: any column's x is `column * cell`, so if
        // one cell is a whole number of device pixels then all of them are.
        for (const column of [1, 2, 39, 80, 200]) {
          const devicePixels = column * cell * ratio;
          expect(Math.abs(devicePixels - Math.round(devicePixels))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('never lets rounding error accumulate across a line', () => {
    for (const ratio of RATIOS) {
      for (const size of SIZES) {
        const cell = snapToDevicePixel(size * TERMINAL_ADVANCE_RATIO, ratio);
        // The error against the ideal grid is per-cell and constant, so at
        // column N it is N times a fixed amount -- it must not be worse than
        // that, which is what an accumulating (summed) layout would produce.
        const perCell = cell - size * TERMINAL_ADVANCE_RATIO;
        for (const column of [1, 10, 100]) {
          const ideal = column * size * TERMINAL_ADVANCE_RATIO;
          expect(column * cell - ideal).toBeCloseTo(column * perCell, 9);
        }
      }
    }
  });

  it("stays within half a device pixel of the font's true advance", () => {
    for (const ratio of RATIOS) {
      for (const size of SIZES) {
        const truth = size * TERMINAL_ADVANCE_RATIO;
        const cell = snapToDevicePixel(truth, ratio);
        expect(Math.abs(cell - truth)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
      }
    }
  });

  it('beats rounding the advance to a whole point at the default size', () => {
    // The regression, stated as a number. An SkFont without linear metrics
    // reports whole-point advances; at the current default the true advance is
    // fractional, so whole-point rounding always mismeasures the cell. (At the
    // old 12.5 default the same rounding left 0.5pt of slack; at 14 it went
    // 0.4pt tight. 13 keeps a fractional advance, so the guard still bites.)
    const size = TERMINAL_TEXT_SIZES.default;
    const truth = size * TERMINAL_ADVANCE_RATIO;
    const hinted = Math.round(truth);
    expect(Math.abs(truth - hinted)).toBeGreaterThan(0.05);
    for (const ratio of RATIOS) {
      const cell = snapToDevicePixel(truth, ratio);
      // "Never worse": at some ratios the device grid lands exactly on the
      // whole point (13pt at dpr 2), where snapping ties hinting.
      expect(Math.abs(cell - truth)).toBeLessThanOrEqual(Math.abs(hinted - truth));
    }
  });

  it('leaves a length alone when the ratio is not usable', () => {
    expect(snapToDevicePixel(8.4, 0)).toBe(8.4);
    expect(snapToDevicePixel(8.4, Number.NaN)).toBe(8.4);
  });
});

/**
 * Fitting a fallback-shaped glyph to the cells the grid gave it.
 *
 * The regression these lock is the one the user photographed: `①agents` drawn
 * with the circled digit lapping over the `a`. `①` is East Asian *ambiguous*,
 * so the gateway laid it out one column wide and so does `graphemeWidth`; the
 * bundled Nerd Font has no glyph for it, so it shapes against a system font
 * that draws it fullwidth. The cell is 0.6em, the ink is 1em, and `layout()`
 * does not bound ink. Nothing here may change the *column* it occupies -- that
 * would move every cell after it on the row and disagree with the wrapping
 * herdr already applied -- so the ink is fitted to the columns instead.
 */
describe('fallback glyph fit', () => {
  const cell = snapToDevicePixel(TERMINAL_TEXT_SIZES.default * TERMINAL_ADVANCE_RATIO, 3);

  it('never lets a fallback glyph paint past its own cells', () => {
    // Every size, against the widths system fallback fonts actually produce:
    // fullwidth (1em), the bundled advance (0.6em), and an emoji that overshoots
    // its two cells.
    for (const size of Object.values(TERMINAL_TEXT_SIZES)) {
      const cellWidth = snapToDevicePixel(size * TERMINAL_ADVANCE_RATIO, 3);
      for (const columns of [1, 2]) {
        const span = columns * cellWidth;
        for (const natural of [size, size * TERMINAL_ADVANCE_RATIO, size * 1.2, size * 2.4]) {
          const { offsetX, scaleX } = fitFallbackToSpan(natural, span);
          expect(offsetX + natural * scaleX).toBeLessThanOrEqual(span + 1e-9);
          expect(offsetX).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('compresses a fullwidth glyph into the one column it was given', () => {
    // U+2460 in Noto Sans CJK: 1em of ink in a 0.6em cell.
    const { offsetX, scaleX } = fitFallbackToSpan(TERMINAL_TEXT_SIZES.default, cell);
    expect(offsetX).toBe(0);
    expect(scaleX).toBeCloseTo(cell / TERMINAL_TEXT_SIZES.default, 6);
    expect(scaleX).toBeLessThan(1);
  });

  it('centres a glyph narrower than its span instead of hanging it off the left', () => {
    // An ordinary CJK glyph: 1em of ink in two 0.6em cells. Left-aligning left
    // the slack on the right, which is what made a CJK column look ragged.
    const span = 2 * cell;
    const { offsetX, scaleX } = fitFallbackToSpan(TERMINAL_TEXT_SIZES.default, span);
    expect(scaleX).toBe(1);
    expect(offsetX).toBeCloseTo((span - TERMINAL_TEXT_SIZES.default) / 2, 9);
  });

  it('does not scale on a rounding error', () => {
    // The shaper's width and `columns * cellWidth` accumulate the same metrics
    // differently. A glyph that fits must not be squeezed -- and re-squeezed by
    // a different hair next frame -- because the two disagree in the ninth
    // decimal place.
    const { offsetX, scaleX } = fitFallbackToSpan(cell + 1e-9, cell);
    expect(scaleX).toBe(1);
    expect(Math.abs(offsetX)).toBeLessThan(1e-6);
  });

  it('leaves the glyph alone when there is nothing to measure', () => {
    // A Skia build that reports no width, or a zero-width span: draw at the
    // cell origin at full size rather than divide by zero and lose the row.
    expect(fitFallbackToSpan(0, cell)).toEqual({ offsetX: 0, scaleX: 1 });
    expect(fitFallbackToSpan(Number.NaN, cell)).toEqual({ offsetX: 0, scaleX: 1 });
    expect(fitFallbackToSpan(cell, 0)).toEqual({ offsetX: 0, scaleX: 1 });
  });
});
