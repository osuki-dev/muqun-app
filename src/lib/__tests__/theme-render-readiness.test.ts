import { expect, test } from 'bun:test';
import {
  beginThemeRender,
  createCoverReadiness,
  waitForThemeRender,
} from '../theme-render-readiness';

test('cover readiness waits for both root and dismissible native surface', async () => {
  const gate = createCoverReadiness(['root', 'sheet']);
  let ready = false;
  void gate.promise.then(() => {
    ready = true;
  });
  gate.complete('sheet', true);
  await Promise.resolve();
  expect(ready).toBe(false);
  gate.complete('root', true);
  expect(await gate.promise).toBe(true);
});

test('a timed-out cover cannot be resurrected by a late draw', async () => {
  const gate = createCoverReadiness(['root'], 1);
  expect(await gate.promise).toBe(false);
  gate.complete('root', true);
  expect(await gate.promise).toBe(false);
});

test('the renderer barrier settles on display, failure or unmount', async () => {
  const hero = beginThemeRender('hero');
  const wallpaper = beginThemeRender('wallpaper');
  const ready = waitForThemeRender();
  hero();
  wallpaper();
  wallpaper();
  expect(await ready).toBe(true);
});

test('broken renderers cannot indefinitely retain the old screen', async () => {
  const done = beginThemeRender('broken');
  expect(await waitForThemeRender(1)).toBe(false);
  done();
  expect(await waitForThemeRender()).toBe(true);
});

test('a stale route cleanup cannot settle its replacement renderer', async () => {
  const oldRoute = beginThemeRender('route');
  const newRoute = beginThemeRender('route');
  oldRoute();
  expect(await waitForThemeRender(1)).toBe(false);
  newRoute();
  expect(await waitForThemeRender()).toBe(true);
});

test('leaving a focused route releases its pending renderer', async () => {
  const blur = beginThemeRender('focused-wallpaper');
  const waiting = waitForThemeRender();
  blur();
  expect(await waiting).toBe(true);
});
