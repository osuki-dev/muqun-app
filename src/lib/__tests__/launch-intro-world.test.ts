import { describe, expect, test } from 'bun:test';

import { bloomRadius, chooseLaunchWorld } from '../launch-intro-world';

const PAINTED = { hasArtwork: true, shaderCompiled: true, imageReady: true, deadlinePassed: false };

describe('chooseLaunchWorld', () => {
  test('a pack with a painting and a decoded image gets the shader', () => {
    expect(chooseLaunchWorld(PAINTED)).toEqual({ kind: 'painted', ready: true });
  });

  test('a load that is merely late keeps the good reveal, waiting', () => {
    // The front has somewhere to idle. Switching to the iris the instant the
    // image was not ready would throw away the reveal over a load that is
    // usually a few frames out.
    expect(chooseLaunchWorld({ ...PAINTED, imageReady: false })).toEqual({
      kind: 'painted',
      ready: false,
    });
  });

  test('only the deadline gives up on the painting', () => {
    expect(chooseLaunchWorld({ ...PAINTED, imageReady: false, deadlinePassed: true })).toEqual({
      kind: 'iris',
    });
  });

  test('a painting that lands on the deadline is still uncovered by the shader', () => {
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
