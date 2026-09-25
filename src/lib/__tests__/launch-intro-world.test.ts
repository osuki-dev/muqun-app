import { describe, expect, test } from 'bun:test';

import { bloomRadius, chooseLaunchWorld, launchWorldHole } from '../launch-intro-world';

describe('launch exit preserves the revealed world', () => {
  test('palette does not flash back to paper at the start of the exit fade', () => {
    const world = chooseLaunchWorld({
      hasArtwork: false,
      shaderCompiled: true,
      imageReady: false,
      deadlinePassed: false,
      irisLatched: false,
    });
    expect(launchWorldHole('native', world)).toBe('closed');
    expect(launchWorldHole('visible', world)).toBe('field');
    expect(launchWorldHole('exiting', world)).toBe('field');
  });

  test('a decoded wallpaper stays revealed while fading into Home', () => {
    expect(launchWorldHole('native', { kind: 'painted', ready: true })).toBe('closed');
    expect(launchWorldHole('visible', { kind: 'painted', ready: true })).toBe('through');
    expect(launchWorldHole('exiting', { kind: 'painted', ready: true })).toBe('through');
  });

  test('a missing image never creates an empty hole during exit', () => {
    expect(launchWorldHole('exiting', { kind: 'painted', ready: false })).toBe('closed');
    expect(launchWorldHole('exiting', { kind: 'plain' })).toBe('closed');
    expect(launchWorldHole('exiting', { kind: 'iris' })).toBe('closed');
  });
});

const PAINTED = {
  hasArtwork: true,
  shaderCompiled: true,
  imageReady: true,
  deadlinePassed: false,
  irisLatched: false,
};

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

describe('chooseLaunchWorld, over a whole launch', () => {
  /**
   * The reveal is a decision made *during* an animation, so what matters is
   * not each answer on its own but the sequence of them. These three walk the
   * three ways a cold pack's painting can behave, and the property they hold
   * is the same one every time: the reveal never becomes *less* conservative,
   * because that is what a hard cut looks like from the inside.
   *
   * This is the bug that reached a frame sheet. A pack whose wallpaper was not
   * already in the image cache spent the whole bloom in `painted, ready:false`
   * -- the cover closed over paper -- and then the painting arrived and the
   * cover came off in one frame. The reader saw a splash screen and then,
   * abruptly, a world.
   */
  const cold = { hasArtwork: true, shaderCompiled: true, imageReady: false, deadlinePassed: false };

  test('the painting arrives inside the cap: the front waits, then reveals it', () => {
    let latched = false;
    const step = (over: Partial<typeof cold> & { irisLatched?: boolean }) => {
      const next = chooseLaunchWorld({ ...cold, irisLatched: latched, ...over });
      if (next.kind === 'iris') latched = true;
      return next;
    };
    // The rim breathes around the hero while the load is out.
    expect(step({})).toEqual({ kind: 'painted', ready: false });
    // It lands before the cap, and the bloom runs against the real painting.
    expect(step({ imageReady: true })).toEqual({ kind: 'painted', ready: true });
    // And nothing later takes it away.
    expect(step({ imageReady: true, deadlinePassed: true })).toEqual({
      kind: 'painted',
      ready: true,
    });
  });

  test('the painting never arrives: the iris runs instead, and keeps running', () => {
    let latched = false;
    const step = (over: Partial<typeof cold>) => {
      const next = chooseLaunchWorld({ ...cold, irisLatched: latched, ...over });
      if (next.kind === 'iris') latched = true;
      return next;
    };
    expect(step({})).toEqual({ kind: 'painted', ready: false });
    expect(step({ deadlinePassed: true })).toEqual({ kind: 'iris' });
    expect(step({ deadlinePassed: true })).toEqual({ kind: 'iris' });
  });

  test('the painting arrives after the cap: the iris keeps it, rather than cutting', () => {
    // The one that matters. A painting that lands a frame after the front gave
    // up on it must not yank the iris back out: that is two reveals in one
    // second with a cut between them.
    let latched = false;
    const step = (over: Partial<typeof cold>) => {
      const next = chooseLaunchWorld({ ...cold, irisLatched: latched, ...over });
      if (next.kind === 'iris') latched = true;
      return next;
    };
    expect(step({})).toEqual({ kind: 'painted', ready: false });
    expect(step({ deadlinePassed: true })).toEqual({ kind: 'iris' });
    expect(step({ deadlinePassed: true, imageReady: true })).toEqual({ kind: 'iris' });
  });

  test('a source that only resolves after the first frame still gets a reveal', () => {
    // A custom pack's file URI can arrive a commit late, so the first render
    // sees no artwork at all. That must open as a palette world and then take
    // the painting when it appears -- never sit on `waiting` forever.
    let latched = false;
    const step = (over: Partial<typeof cold>) => {
      const next = chooseLaunchWorld({ ...cold, irisLatched: latched, ...over });
      if (next.kind === 'iris') latched = true;
      return next;
    };
    expect(step({ hasArtwork: false })).toEqual({ kind: 'palette' });
    expect(step({ imageReady: true })).toEqual({ kind: 'painted', ready: true });
  });

  test('the reveal is never less conservative than it has already been', () => {
    // The property behind all of the above, stated once: `iris` is a one-way
    // door for as long as the opening lasts.
    for (const imageReady of [false, true]) {
      for (const deadlinePassed of [false, true]) {
        expect(
          chooseLaunchWorld({ ...cold, imageReady, deadlinePassed, irisLatched: true }).kind
        ).toBe('iris');
      }
    }
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
