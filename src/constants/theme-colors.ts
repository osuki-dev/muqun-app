/**
 * The two palettes, as data.
 *
 * Split out of `theme.ts` so that the values can be read without pulling in
 * `@osuki-dev/ui` -- and through it React Native -- which is what
 * `__tests__/theme-light-levels.test.ts` needs in order to measure them. The
 * type import is erased at compile time, so this file costs nothing at runtime
 * and can be imported from anywhere, including a bare `bun test` process. It is
 * the same shape `theme-packs.ts` takes on the themes branch, for the same
 * reason.
 *
 * These are the Osuki design specification (https://osuki.dev/design.md)
 * expressed as an override on the library's own palette, so the spec lands
 * app-side and the package stays untouched.
 *
 * Where the spec names a role the library does not carry -- `accent-pressed`,
 * `interactive-pressed` -- the role is dropped rather than invented: nothing in
 * this app draws a pressed fill, and an unused token is a token that drifts.
 * Where the library carries a role the spec does not name -- the `subtle` and
 * `disabled` text tiers, the raised surface, the strong border -- the value is
 * derived from the spec's own neighbours rather than left at the library
 * default, which was mixed for a different background.
 */

import type { Colors } from '@osuki-dev/ui';

/**
 * Light.
 *
 * The canvas is the spec's warm cream, which is the one value that pulls the
 * whole scale off the library's cool neutrals: a surface mixed for `#FCFBFA`
 * reads grey-green on `#F7F3EC`. A card lifts toward white, which is the
 * opposite of the library default.
 *
 * The scale below descends -- card, canvas, raised, border, borderStrong -- and
 * that ordering is the point. It used to break at the third rung: `#FBF7F1` sat
 * *between* canvas and card at 1.07:1 off white, so every fill that had to read
 * as a step down from a card instead dissolved into it. The tab pill, the switch
 * track, the drawer's unselected rows and the glass fallback all lost their
 * footing at once, because all of them are one token.
 *
 * The reason it was parked there is worth writing down, because it is the
 * constraint anyone retuning this will hit again: with `textMuted` at `#667085`,
 * a fill any darker than the canvas drops muted body text under 4.5:1 -- the
 * break-even ground is luminance 0.900 and the canvas is already 0.899. The
 * hierarchy could not be fixed without moving the ink. So the ink moved: muted
 * and subtle each go down far enough to hold their old footing on the *new*
 * raised fill, which as a side effect retires the long-recorded 4.4977 miss of
 * `textMuted` on the canvas.
 *
 * Hues are the canvas's own (~H36-38) rather than the library's blue-grey
 * (~H220-228). A cool neutral on cream does not read as a quieter version of the
 * background, it reads as a different material -- which is what the glass
 * fallback looked like before this.
 *
 * Every pair below is pinned with its measured ratio in
 * `__tests__/theme-light-levels.test.ts`; change a value here and that test
 * names the pair that moved.
 */
export const lightColors: Partial<Colors> = {
  background: '#F7F3EC',
  surface: '#FFFFFF',
  // The recessed fill: troughs, chips, code blocks, unselected pills, the glass
  // fallback. A step *below* both canvas and card -- 1.23:1 off white, 1.11:1
  // off the cream -- because in a light UI whose card is already `#FFFFFF`,
  // down is the only direction with any room left in it.
  surfaceRaised: '#ECE7DF',
  // Holds its old 1.13:1 footing on the raised fill, which is the pairing that
  // would otherwise inverted into a halo, and gains on the card (1.22 -> 1.39)
  // where the cool hairline was close to invisible.
  border: '#E0DAD1',
  // Also the switch track, which is the job that sets the value: white thumb on
  // this reads 1.94:1, against 1.58:1 before.
  borderStrong: '#C2B9AE',
  text: '#050B12',
  // Down from `#667085` so muted body text clears 4.5:1 on the raised fill
  // (4.68) as well as on the canvas (5.21) and the card (5.77).
  textMuted: '#5D6679',
  // Not in the spec. Down from `#737C8C` by the same reasoning, chosen to land
  // on the new raised fill at 3.93:1 -- exactly where it sat on the old one, so
  // the caption tier keeps its weight relative to the surface it is printed on.
  textSubtle: '#6A7281',
  // Unchanged: disabled controls are exempt from the contrast bar, and this is
  // the tier the disabled switch row now greys its label to as well.
  textDisabled: '#A7ADB8',
  primary: '#FF5A4A',
  // Dark ink, not white. White on the accent measures 3.1:1; the ink measures
  // 6.3:1 and is the only choice that clears 4.5:1 on a button label.
  onPrimary: '#050B12',
  primarySubtle: 'rgba(255, 90, 74, 0.14)',
  danger: '#D93025',
  dangerSubtle: 'rgba(217, 48, 37, 0.12)',
  success: '#1F9D6B',
  warning: '#D98A1F',
  // The spec's `interactive` / `link` / `focus-ring`, which share one value.
  info: '#3E63FF',
};

/**
 * Dark.
 *
 * Surfaces run lighter than the canvas, as they do in any dark UI. The spec's
 * note that "dark mode uses lightened variants for readability" is why the
 * status colours here are not the light ones reused.
 */
export const darkColors: Partial<Colors> = {
  background: '#050B12',
  surface: '#0B111A',
  // One step above the surface, on the line the spec draws from `#050B12` to
  // `#0B111A`.
  surfaceRaised: '#131B26',
  border: '#1C2532',
  borderStrong: '#2E3A4A',
  text: '#FCFBFA',
  textMuted: '#B6BDC8',
  textSubtle: '#8B95A5',
  textDisabled: '#6B7585',
  primary: '#FF5A4A',
  onPrimary: '#050B12',
  primarySubtle: 'rgba(255, 90, 74, 0.24)',
  danger: '#F2554A',
  dangerSubtle: 'rgba(242, 85, 74, 0.16)',
  success: '#34C08B',
  warning: '#F0A93C',
  info: '#6B87FF',
};
