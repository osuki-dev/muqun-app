/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A full-screen overlay may cover the app. It may not delete it.
 *
 * ## The rule
 *
 * Muqun draws whole-screen covers over a live interface in two places now --
 * the launch opening and the re-skin transitions -- and both are Skia canvases
 * with the app still mounted and readable underneath. A reader using a screen
 * reader must be able to reach that interface the entire time. An overlay that
 * takes the app out of the accessibility tree for the length of an animation
 * is not a transition, it is a two-second outage.
 *
 * Two spellings do exactly that, and they are banned **in the covers** --
 * which is the whole of the rule, and narrower than it first looks:
 *
 *  - `importantForAccessibility="no-hide-descendants"`, which removes a
 *    subtree, and is the one a cover is most tempted to reach for. The
 *    permitted spelling for a cover is `"no"`, which hides only the view it is
 *    written on -- the cover itself, which has nothing to announce -- and
 *    leaves everything underneath alone.
 *
 *    Note what this test does *not* say. `no-hide-descendants` is correct and
 *    used about ten times elsewhere in this app, on decorative subtrees that
 *    have nothing to announce and would otherwise be read out as noise: the
 *    glass chrome, the status dot's ring, the home hero's artwork, a sheet's
 *    ground. Hiding scenery is the prop's job. Hiding the interface is not,
 *    and the difference is whether a reader needed the thing underneath. So
 *    the scan is scoped to the files that draw over the live app, and a
 *    blanket ban would have been wrong -- it was tried first, and it failed
 *    against ten correct uses.
 *  - `accessibilityViewIsModal`, which on iOS makes every sibling of the
 *    overlay invisible to VoiceOver. It does nothing on Android (React
 *    Native's Android renderer has no implementation of the prop at all,
 *    verified by grep over `ReactAndroid`), which is precisely what makes it
 *    dangerous: a developer checking on an emulator sees no effect and ships
 *    an iOS blackout.
 *
 * ## What actually happened, since this test exists because of an
 * investigation that found something else
 *
 * The launch opening was reported as leaving the app with no accessibility
 * root for the first couple of seconds of a cold start. It does not, and no
 * accessibility flag is involved. Measured on emulator-5556, sampling the
 * window across a cold start:
 *
 *   00:45:45.506  React Native starts
 *   00:45:49.487  the opening's Skia surface appears -- `RootContent` mounts
 *   00:45:50.047  the dump returns 325 app nodes, *while the canvas animates*
 *
 * Before that mount the window holds eight nodes: the activity chrome and the
 * native splash's `ImageView`. Nothing is hidden, because nothing is there --
 * `RootContent` carries the router, Home and the overlay together, so until it
 * mounts the app has no React views to expose. Once it mounts, the whole tree
 * is available and stays available with the canvas drawing on top, which is
 * the behaviour this test pins.
 *
 * Two measurement traps found on the way, recorded so the next investigation
 * does not pay for them again:
 *
 *  - `uiautomator dump` dies with `UiAutomationService ... already registered!`
 *    whenever an agent-device session is open, because both want the one
 *    `UiAutomation` connection. It reports zero nodes when it does. Close the
 *    session before measuring, or the app looks dead when it is fine.
 *  - a dump costs about two seconds on this emulator no matter what is on
 *    screen -- the launcher measures the same -- so dump latency says nothing
 *    about the app, and a "slow snapshot" warning is not evidence of a stuck
 *    interface.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The file with its comments removed.
 *
 * The rule is about what the app *does*, not about what it explains. Both
 * banned spellings are named at length in prose here and in
 * `reskin-transition.tsx` -- describing the trap is how the next author avoids
 * it -- so a scan that could not tell a mention from a use would forbid
 * writing this note at all.
 */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

/**
 * The modules that draw a full screen of pixels over a live interface.
 *
 * Add one here when you add one to the app; that is the whole maintenance
 * burden of this file, and forgetting is the failure mode it is guarding.
 */
const COVERS = [
  join('components', 'reskin-transition.tsx'),
  join('components', 'launch-intro-scene.tsx'),
  join('components', 'launch-overlay.tsx'),
];

describe('overlay accessibility', () => {
  test('no cover takes the interface underneath out of the tree', () => {
    const offenders: string[] = [];
    for (const relative of COVERS) {
      code(join(SRC, relative))
        .split('\n')
        .forEach((line, index) => {
          if (line.includes('no-hide-descendants')) {
            offenders.push(`${relative}:${index + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  test('no cover makes itself modal to VoiceOver', () => {
    // Silent on Android, a blackout on iOS -- the worst combination for a
    // prop to have, because the emulator will never tell you.
    const offenders: string[] = [];
    for (const relative of COVERS) {
      code(join(SRC, relative))
        .split('\n')
        .forEach((line, index) => {
          if (line.includes('accessibilityViewIsModal')) {
            offenders.push(`${relative}:${index + 1} ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  test('every cover named here still exists, so the list cannot rot', () => {
    for (const relative of COVERS) {
      expect(() => code(join(SRC, relative))).not.toThrow();
    }
  });

  test('the re-skin cover hides itself and only itself', () => {
    const source = code(join(SRC, 'components', 'reskin-transition.tsx'));
    // The cover is a view with nothing to announce, so it opts itself out --
    // and opts out nothing else.
    expect(source).toContain('importantForAccessibility="no"');
    expect(source).toContain('accessible={false}');
    expect(source).not.toContain('no-hide-descendants');
    expect(source).not.toContain('accessibilityViewIsModal');
  });

  test('the re-skin cover is unmounted when its run ends', () => {
    // A canvas left mounted is a surface the compositor keeps, and an overlay
    // that outlives its animation is the outage this file is about.
    const source = code(join(SRC, 'components', 'reskin-transition.tsx'));
    expect(source).toContain('setActive(null)');
    // And its textures go back to Skia rather than waiting for a garbage
    // collector that does not know about them.
    expect(source).toContain('image?.dispose()');
  });
});
