import { describe, expect, test } from 'bun:test';
import {
  TERMINAL_MAX_FIT_SCALE,
  TERMINAL_MIN_FONT_PT,
  terminalExactFillScale,
  terminalMirrorFitScale,
  terminalOpenScale,
} from './terminal-text-size';

// A 411pt phone at the default 13pt step (the measured cell on Android).
const phone = { viewportWidth: 411, cellWidth: 7.619047619047619, fontSize: 13 };

describe('terminalMirrorFitScale', () => {
  test('a narrower pane fills the canvas edge to edge', () => {
    const scale = terminalMirrorFitScale(phone, 43);
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeCloseTo(terminalExactFillScale(phone, 43) as number, 6);
  });

  test('a tiny pane stops at the fit cap', () => {
    expect(terminalMirrorFitScale(phone, 12)).toBe(TERMINAL_MAX_FIT_SCALE);
  });

  test('a wider pane shrinks to fill when that stays readable', () => {
    const scale = terminalMirrorFitScale(phone, 60);
    expect(scale).toBeLessThan(1);
    expect(scale * phone.fontSize).toBeGreaterThanOrEqual(TERMINAL_MIN_FONT_PT);
    expect(scale).toBeCloseTo(terminalExactFillScale(phone, 60) as number, 6);
  });

  test('a much wider pane stops at the smallest readable size and pans', () => {
    expect(terminalMirrorFitScale(phone, 200)).toBeCloseTo(TERMINAL_MIN_FONT_PT / 13, 6);
  });

  test('a setting already below the readable floor is never shrunk', () => {
    expect(terminalMirrorFitScale({ ...phone, fontSize: 9 }, 200)).toBe(1);
  });

  test('no reported width or no measured canvas means no fit', () => {
    expect(terminalMirrorFitScale(phone, undefined)).toBe(1);
    expect(terminalMirrorFitScale(phone, 0)).toBe(1);
    expect(terminalMirrorFitScale({ ...phone, viewportWidth: 0 }, 43)).toBe(1);
  });
});

describe('terminalOpenScale', () => {
  const open = (remembered: Record<string, number>, paneColumns?: number) =>
    terminalOpenScale({ paneId: 'w1:p1', remembered, fit: phone, paneColumns });

  test('a pane with nothing remembered opens at the fit', () => {
    expect(open({}, 43)).toBeCloseTo(terminalExactFillScale(phone, 43) as number, 6);
  });

  test('a remembered zoom-in at this width wins over the fit', () => {
    expect(open({ 'w1:p1@43': 1.6 }, 43)).toBe(1.6);
  });

  test('a remembered zoom-out never leaves a narrow pane short of the right edge', () => {
    expect(open({ 'w1:p1@43': 0.62 }, 43)).toBeCloseTo(
      terminalExactFillScale(phone, 43) as number,
      6
    );
  });

  test('a remembered zoom-out across a wide pane is kept', () => {
    expect(open({ 'w1:p1@86': 0.62 }, 86)).toBe(0.62);
  });

  test('a pinch made at another width is not applied', () => {
    expect(open({ 'w1:p1@86': 1.6 }, 43)).toBeCloseTo(
      terminalExactFillScale(phone, 43) as number,
      6
    );
  });
});
