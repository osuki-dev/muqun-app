import { describe, expect, it } from 'bun:test';

import {
  TERMINAL_ADVANCE_RATIO,
  TERMINAL_TEXT_SIZES,
  fitFallbackToSpan,
  snapToDevicePixel,
  terminalLineHeight,
} from '@/terminal/text-scale';

describe('terminal text scale', () => {
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

  it("stays within half a device pixel of the font's true advance", () => {
    for (const ratio of RATIOS) {
      for (const size of SIZES) {
        const truth = size * TERMINAL_ADVANCE_RATIO;
        const cell = snapToDevicePixel(truth, ratio);
        expect(Math.abs(cell - truth)).toBeLessThanOrEqual(0.5 / ratio + 1e-9);
      }
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
