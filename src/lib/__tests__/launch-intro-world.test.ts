import { describe, expect, test } from 'bun:test';

import { bloomRadius, chooseLaunchWorld, worldFit } from '../launch-intro-world';

const PAINTED = { hasArtwork: true, shaderCompiled: true, imageReady: true, deadlinePassed: false };

describe('chooseLaunchWorld', () => {
  test('a pack with a painting and a decoded image gets the shader', () => {
    expect(chooseLaunchWorld(PAINTED)).toEqual({ kind: 'painted', ready: true });
  });

  test('a decode that is merely late keeps the good reveal, waiting', () => {
    // The front has somewhere to idle. Switching to the iris the instant the
    // image was not ready would throw away the reveal over a decode that is
    // usually a few frames out.
    expect(chooseLaunchWorld({ ...PAINTED, imageReady: false })).toEqual({
      kind: 'painted',
      ready: false,
    });
  });

  test('only the deadline gives up on Skia', () => {
    expect(chooseLaunchWorld({ ...PAINTED, imageReady: false, deadlinePassed: true })).toEqual({
      kind: 'iris',
    });
  });

  test('a decode that lands on the deadline is still drawn by the shader', () => {
    expect(chooseLaunchWorld({ ...PAINTED, deadlinePassed: true })).toEqual({
      kind: 'painted',
      ready: true,
    });
  });

  test('a pack that is a palette and nothing else gets the palette field', () => {
    expect(chooseLaunchWorld({ ...PAINTED, hasArtwork: false })).toEqual({ kind: 'palette' });
    // It has nothing to wait for, so the deadline cannot change its mind.
    expect(
      chooseLaunchWorld({ ...PAINTED, hasArtwork: false, imageReady: false, deadlinePassed: true })
    ).toEqual({ kind: 'palette' });
  });

  test('a device whose Skia would not compile the effect still opens', () => {
    expect(chooseLaunchWorld({ ...PAINTED, shaderCompiled: false })).toEqual({ kind: 'iris' });
    expect(chooseLaunchWorld({ ...PAINTED, shaderCompiled: false, hasArtwork: false })).toEqual({
      kind: 'plain',
    });
  });
});

describe('worldFit', () => {
  const screen = { width: 400, height: 800 };

  test('cover fills the screen and crops the long axis', () => {
    const fit = worldFit(screen, { width: 1000, height: 1000 }, 'cover', undefined);
    expect(fit.scale).toBe(0.8);
    // 800 wide against a 400 screen, centred: 200 points hang off each side.
    expect(fit.x).toBe(-200);
    expect(fit.y).toBe(0);
  });

  test('the author focal point chooses which part of the crop survives', () => {
    const fit = worldFit(screen, { width: 1000, height: 1000 }, 'cover', { x: 0.45, y: 0.78 });
    expect(fit.x).toBeCloseTo(-180, 5);
    expect(fit.y).toBe(0);
  });

  test('contain fits inside and leaves paper, and tile is drawn as contain', () => {
    const contain = worldFit(screen, { width: 1000, height: 1000 }, 'contain', undefined);
    expect(contain.scale).toBe(0.4);
    expect(contain.x).toBe(0);
    expect(contain.y).toBe(200);
    expect(worldFit(screen, { width: 1000, height: 1000 }, 'tile', undefined)).toEqual(contain);
  });

  test('no fit at all is cover, which is what Home draws', () => {
    expect(worldFit(screen, { width: 1000, height: 1000 }, undefined, undefined)).toEqual(
      worldFit(screen, { width: 1000, height: 1000 }, 'cover', undefined)
    );
  });

  test('a decoder that reported nothing still yields a usable fit', () => {
    const fit = worldFit(screen, { width: 0, height: Number.NaN }, 'cover', undefined);
    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(fit.scale).toBeGreaterThan(0);
  });
});

describe('bloomRadius', () => {
  test('from the centre it is half the diagonal', () => {
    expect(bloomRadius({ width: 600, height: 800 }, { x: 300, y: 400 })).toBe(500);
  });

  test('from a hero near the top it is the far corner, not the near one', () => {
    // Home keeps its picture at the top of the page, so once the hero has
    // landed the bottom corners are a good deal further away than the top.
    expect(bloomRadius({ width: 600, height: 800 }, { x: 300, y: 100 })).toBe(Math.hypot(300, 700));
  });
});
