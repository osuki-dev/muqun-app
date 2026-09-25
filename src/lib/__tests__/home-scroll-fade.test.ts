import { expect, test } from 'bun:test';
import { homeScrollFadeOpacity } from '../home-scroll-fade';

test('scroll stages retain visible artwork until its last strip reaches the top', () => {
  expect(homeScrollFadeOpacity(-100, 600, 160)).toBe(1);
  expect(homeScrollFadeOpacity(400, 600, 160)).toBe(1);
  expect(homeScrollFadeOpacity(520, 600, 160)).toBeCloseTo(0.5);
  expect(homeScrollFadeOpacity(600, 600, 160)).toBe(0);
  expect(homeScrollFadeOpacity(1000, 600, 160)).toBe(0);
});

test('the same scroll position restores the same frame in either direction', () => {
  const offsets = [0, 460, 500, 540, 600];
  const forward = offsets.map((y) => homeScrollFadeOpacity(y, 600, 160));
  const backward = [...offsets].reverse().map((y) => homeScrollFadeOpacity(y, 600, 160));
  expect(backward.reverse()).toEqual(forward);
  expect(homeScrollFadeOpacity(80, 120, 120)).toBeLessThan(homeScrollFadeOpacity(80, 600, 160));
});

test('unmeasured sections remain visible', () => {
  expect(homeScrollFadeOpacity(100, 0, 120)).toBe(1);
  expect(homeScrollFadeOpacity(100, 600, 0)).toBe(1);
});
