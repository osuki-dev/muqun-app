import { expect, test } from 'bun:test';
import { orientationPolicy } from '../orientation-lock';

test('phones lock to portrait whichever way the window is turned', () => {
  expect(orientationPolicy(393, 852)).toBe('portrait');
  expect(orientationPolicy(852, 393)).toBe('portrait');
  expect(orientationPolicy(411, 914)).toBe('portrait');
});

test('tablets lock to landscape even while booting in a portrait window', () => {
  expect(orientationPolicy(800, 1280)).toBe('landscape');
  expect(orientationPolicy(1280, 800)).toBe('landscape');
  expect(orientationPolicy(820, 1180)).toBe('landscape');
});

test('the tablet line is the shorter side at 600dp', () => {
  expect(orientationPolicy(599, 1200)).toBe('portrait');
  expect(orientationPolicy(600, 960)).toBe('landscape');
});

test('unusable metrics fall back to the phone policy', () => {
  expect(orientationPolicy(0, 0)).toBe('portrait');
  expect(orientationPolicy(NaN, 1280)).toBe('portrait');
});
