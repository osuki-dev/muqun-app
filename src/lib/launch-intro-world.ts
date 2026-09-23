/**
 * What the launch opening reveals, and how the reveal falls back.
 *
 * The opening's one picture is the pack's world arriving. Three things have to
 * be true for that to be drawn the intended way -- the runtime effect has to
 * have compiled, the pack has to have painted a world, and that painting has
 * to have loaded -- and each of them can independently not be. This module is
 * the decision, kept away from the drawing so it is a table a test can read
 * rather than a chain of ternaries in a render.
 *
 * Free of every React, React Native and Skia import, so `bun test` can load it.
 */

/** What the front has behind it. */
export type LaunchWorld =
  /**
   * The pack's painting, on its own image layer, uncovered by the runtime
   * effect. `ready` is false while the load is still out: the front idles as a
   * breathing ring around the hero and the cover stays closed, so what the
   * reader sees is the frame they were already looking at rather than a new
   * one with a hole in it and nothing behind the hole.
   */
  | { kind: 'painted'; ready: boolean }
  /** No painting to wait for: a field built from the pack's own three tones. */
  | { kind: 'palette' }
  /**
   * The runtime effect is unavailable, or the painting did not arrive in time.
   * A Reanimated circular iris over an ordinary image: a clean edge instead of
   * an inked one, and no shader at all.
   */
  | { kind: 'iris' }
  /**
   * Nothing to reveal and nothing to reveal it with -- a palette pack on a
   * device whose Skia would not compile the effect. The pack's paper, its
   * hero and its prompt, and the cross-fade. Rare, and deliberately not an
   * error: a launch that still shows the right colours and the right picture
   * has lost an animation, not a screen.
   */
  | { kind: 'plain' };

export type LaunchWorldInput = {
  /** Whether the pack resolved a wallpaper slot to a file the app owns. */
  hasArtwork: boolean;
  /** Whether `Skia.RuntimeEffect.Make` returned a program at module load. */
  shaderCompiled: boolean;
  /** Whether the image layer has reported that it has the painting. */
  imageReady: boolean;
  /** Whether the front has waited as long as the budget allows. */
  deadlinePassed: boolean;
  /**
   * Whether the opening has already given up on the painting once.
   *
   * The reveal is a decision made *during* an animation, so it has to be
   * monotonic: a painting that arrives a frame after the front gave up on it
   * must not yank the iris back out mid-flight. Without this, a slow load
   * produced `iris` at the deadline and `painted` the moment it finished,
   * which is two reveals in one second and a visible cut between them.
   */
  irisLatched: boolean;
};

/**
 * Pick the reveal.
 *
 * The order matters and is the order of the things that can go wrong, worst
 * first. Note that a pack with artwork whose decode is merely *late* still
 * returns `painted`: the front has somewhere to idle, and switching to the
 * iris the instant the image is not ready would throw away the good reveal
 * over a load that is usually a few frames out. Only the deadline gives up.
 */
export function chooseLaunchWorld(input: LaunchWorldInput): LaunchWorld {
  if (!input.shaderCompiled) return input.hasArtwork ? { kind: 'iris' } : { kind: 'plain' };
  if (!input.hasArtwork) return { kind: 'palette' };
  // Once given up on, stays given up on. See `irisLatched`.
  if (input.irisLatched) return { kind: 'iris' };
  if (input.imageReady) return { kind: 'painted', ready: true };
  return input.deadlinePassed ? { kind: 'iris' } : { kind: 'painted', ready: false };
}

/** Keep the revealed world intact while its overlay fades into Home. */
export function launchWorldHole(phase: string, world: LaunchWorld): 'closed' | 'field' | 'through' {
  if (phase === 'native') return 'closed';
  if (world.kind === 'palette') return 'field';
  return world.kind === 'painted' && world.ready ? 'through' : 'closed';
}

/** A rectangle in window points. */
export type Box = { width: number; height: number };

/**
 * The radius the front has to reach for the world to have covered the screen,
 * measured from wherever the hero happens to be.
 *
 * The hero is centred at launch, so this is usually half the diagonal -- but
 * on a landscape tablet, or once Home has published a hero band at the top of
 * the page, the centre is not the centre, and the far corner is further than
 * the near one by a good deal. Taking the largest of the four corners is what
 * keeps the last corner from being reached a beat after the rest.
 */
export function bloomRadius(screen: Box, centre: { x: number; y: number }): number {
  const xs = [centre.x, screen.width - centre.x];
  const ys = [centre.y, screen.height - centre.y];
  const dx = Math.max(Math.abs(xs[0] ?? 0), Math.abs(xs[1] ?? 0));
  const dy = Math.max(Math.abs(ys[0] ?? 0), Math.abs(ys[1] ?? 0));
  return Math.hypot(dx, dy);
}
