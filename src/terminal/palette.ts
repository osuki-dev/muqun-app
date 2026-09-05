import type { ResolvedThemeMode } from '@osuki-dev/ui';

import {
  DEFAULT_THEME_PACK_ID,
  resolveThemePack,
  themeVariant,
  type ThemePack,
} from '@/constants/theme-packs';
import { isDarkSurface, type TerminalSurface } from '@/terminal/surface';

export type TerminalTheme = {
  background: string;
  foreground: string;
  cursor: string;
  link: string;
  selection: string;
  ansi: readonly string[];
};

/**
 * What the terminal draws with before anyone has said otherwise, and what
 * `terminalIndexedColor` falls back to when it is called without a theme -- the
 * SGR parser runs on snapshots that arrive with no React context attached.
 */
export const DEFAULT_TERMINAL_THEME: TerminalTheme =
  resolveThemePack(DEFAULT_THEME_PACK_ID).dark.terminal;

/**
 * A lookup, not a mix.
 *
 * This used to assemble the ANSI row at call time by interleaving app tokens
 * with hardcoded hex, which meant the terminal's idea of "red" came from two
 * unrelated palettes and could not follow a theme anywhere. Every pack now
 * carries the sixteen colours its own project publishes, so this only has to
 * pick a side.
 */
export function createTerminalTheme(pack: ThemePack, mode: ResolvedThemeMode): TerminalTheme {
  return themeVariant(pack, mode === 'dark' ? 'dark' : 'light').terminal;
}

/**
 * The colours one pane draws with, which are the app's own only for as long as
 * the pane's program is content to print onto the app's surface.
 *
 * A full-screen program is not. It repaints an alternate screen it believes is
 * entirely its own, and with `termguicolors` every highlight group reaches us
 * as literal 24-bit RGB -- so the app owns nothing about how that pane looks
 * except the sixteen ANSI slots and the *defaults*: the colour a cell shows
 * when the program said nothing. Resolving those defaults against the app's
 * light mode is what produced the patchwork on card #685 -- the scheme's own
 * chips arrived verbatim and dark, everything the scheme left at the default
 * arrived as the app's paper, and the pane read as neither.
 *
 * So the rule this encodes, and it is the whole decision: **a pane whose
 * program owns the screen and paints in colours we never named does not follow
 * the app theme.** It gets the surface it painted, when it painted one;
 * otherwise the pack's dark side, because a scheme that leaves `Normal`
 * transparent was written for a terminal that was already dark. Nothing is
 * remapped either way -- every colour the program did name is drawn exactly as
 * it arrived, which is the other half of the same decision.
 *
 * Everything else -- a shell, an agent, and a full-screen program that stays
 * inside ANSI 16 and is therefore already wearing our palette -- gets
 * `appTheme` back by identity, so no memo downstream sees a change.
 */
export function terminalPaneTheme(
  pack: ThemePack,
  appTheme: TerminalTheme,
  surface: TerminalSurface,
  ownsScreen: boolean
): TerminalTheme {
  if (!ownsScreen || !surface.verbatim) return appTheme;
  const background = surface.background ?? themeVariant(pack, 'dark').terminal.background;
  if (background === appTheme.background) return appTheme;
  // Defaults, cursor and the ANSI row all come from whichever side of the pack
  // the adopted surface belongs to. A default-coloured glyph has to stay legible
  // on it, and taking the foreground from one side and the background from the
  // other is exactly how you get dark text on a dark screen.
  const base = themeVariant(pack, isDarkSurface(background) ? 'dark' : 'light').terminal;
  return { ...base, background };
}

export function terminalIndexedColor(
  index: number,
  theme: TerminalTheme = DEFAULT_TERMINAL_THEME
): string {
  const safeIndex = Math.max(0, Math.min(255, Math.round(index)));
  if (safeIndex < 16) return theme.ansi[safeIndex] ?? theme.foreground;
  if (safeIndex >= 232) {
    const channel = 8 + (safeIndex - 232) * 10;
    return rgb(channel, channel, channel);
  }
  const value = safeIndex - 16;
  const channel = (part: number) => (part === 0 ? 0 : 55 + part * 40);
  return rgb(
    channel(Math.floor(value / 36)),
    channel(Math.floor((value % 36) / 6)),
    channel(value % 6)
  );
}

/**
 * How neutral a background has to be before it counts as chrome rather than a
 * colour. A dark red error background is a decision; a grey is a step away from
 * whatever the program assumed its background was.
 */
const CHROME_NEUTRAL_SPREAD = 24;

/**
 * How dark a neutral background has to be to be read as "a step away from my
 * own black background" rather than as a deliberate mid grey.
 */
const CHROME_MAX_LUMA = 0.32;

/** The faintest and strongest band the rule draws, as a fraction of the way
 * from the pack's background towards its foreground. */
const CHROME_MIN_STEP = 0.05;
const CHROME_MAX_STEP = 0.16;

/** Above this the pack's own background counts as light. */
const LIGHT_SURFACE_LUMA = 0.5;

/**
 * The channels of a colour the *program* named, or `null` for one of ours.
 *
 * Deliberately only `rgb(...)`: that is the form `terminalIndexedColor` and
 * `terminalRgbColor` produce for the 256-colour cube, the greyscale ramp and
 * truecolour -- the absolute colours a program asks for by number. The sixteen
 * ANSI slots come back as the pack's own hex and are already wearing our
 * palette, so they are not this rule's business and are left alone by not
 * being recognised here at all.
 */
function namedColorChannels(color: string): [number, number, number] | null {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function anyColorChannels(color: string): [number, number, number] | null {
  const named = namedColorChannels(color);
  if (named) return named;
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return hex ? [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)] : null;
}

function channelLuma([red, green, blue]: [number, number, number]): number {
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
}

/** Whether this theme draws on a light surface. */
export function isLightTerminalSurface(theme: TerminalTheme): boolean {
  const surface = anyColorChannels(theme.background);
  return surface !== null && channelLuma(surface) > LIGHT_SURFACE_LUMA;
}

/**
 * Re-express a background a program painted against an assumed dark terminal so
 * it keeps meaning the same thing on a light one.
 *
 * Captured from a real Claude Code session (v2.1.260) driven through seven tool
 * calls: the only background it emits across a whole transcript is
 * `ESC[48;5;237m` on the row carrying the reader's own prompt, with
 * `ESC[38;5;231m` text on it. Index 237 of the greyscale ramp is
 * `rgb(58, 58, 58)` and index 231 is white -- against the dark pack's `#08111B`
 * that is the faint input row it meant, and against the light pack's `#F7F3EC`
 * it is a solid black bar with white text, which is what the maintainer's phone
 * showed.
 *
 * The mistake is obeying a relative instruction absolutely. The program is not
 * asking for `rgb(58, 58, 58)`; it is asking for "a little away from the
 * background", having assumed what the background is. So the same instruction
 * is honoured against the surface it actually lands on: a step from the pack's
 * background towards its foreground, sized by how big a step the program asked
 * for, bounded so a band stays a band and never becomes a second background.
 * How far the program stepped from its background is how far the band steps
 * from ours -- the magnitude survives, the direction flips, because the surface
 * did.
 *
 * What it does not touch, each for its own reason:
 *
 * - Anything on a dark pack, where the program's assumption was right.
 * - Any of the sixteen ANSI slots, which already come from the pack (see
 *   {@link namedColorChannels}).
 * - Anything with colour in it. {@link CHROME_NEUTRAL_SPREAD} is that line.
 * - A near-white background on a dark pack. The same shape of bug, but a bright
 *   background is usually a highlight that has to stand out, and flattening it
 *   would cost more than it saved.
 */
export function terminalChromeBackground(color: string, theme: TerminalTheme): string {
  const channels = namedColorChannels(color);
  if (!channels) return color;
  if (!isLightTerminalSurface(theme)) return color;
  const [red, green, blue] = channels;
  if (Math.max(red, green, blue) - Math.min(red, green, blue) > CHROME_NEUTRAL_SPREAD) return color;
  const luma = channelLuma(channels);
  if (luma > CHROME_MAX_LUMA) return color;
  const surface = anyColorChannels(theme.background);
  const ink = anyColorChannels(theme.foreground);
  if (!surface || !ink) return color;
  // How big a step the program asked for, carried across to this surface. The
  // floor keeps the faintest chrome visible; the ceiling keeps the strongest
  // from reading as a second background.
  const step = CHROME_MIN_STEP + (luma / CHROME_MAX_LUMA) * (CHROME_MAX_STEP - CHROME_MIN_STEP);
  const mix = (from: number, to: number) => Math.round(from + (to - from) * step);
  return rgb(mix(surface[0], ink[0]), mix(surface[1], ink[1]), mix(surface[2], ink[2]));
}

/**
 * The other half of {@link terminalChromeBackground}: the text the program put
 * *on* that background.
 *
 * A program picks the pair together. Claude Code's prompt row is
 * `48;5;237` with `38;5;231` on it -- a near-black bar carrying white text,
 * which is legible exactly because the bar is dark. Re-expressing the bar
 * against a cream surface and leaving the text alone trades a black band for
 * white-on-cream, which is worse: the band is gone and so is the text. Measured
 * on the phone, which is how this was caught.
 *
 * So a foreground only moves when its background moved, and only when it is the
 * kind of foreground that was chosen for contrast rather than for meaning: a
 * near-neutral light one becomes the pack's own ink. A coloured foreground is
 * carrying information -- a red, a green, a status hue -- and is left alone,
 * because a band that has become light is still a light band and a saturated
 * colour still reads on it.
 */
export function terminalChromeForeground(color: string, theme: TerminalTheme): string {
  const channels = namedColorChannels(color);
  if (!channels) return color;
  if (!isLightTerminalSurface(theme)) return color;
  const [red, green, blue] = channels;
  if (Math.max(red, green, blue) - Math.min(red, green, blue) > CHROME_NEUTRAL_SPREAD) return color;
  // Only text that was light *because its background was dark*.
  if (channelLuma(channels) < 1 - CHROME_MAX_LUMA) return color;
  return theme.foreground;
}

export function terminalRgbColor(red: number, green: number, blue: number): string {
  return rgb(clampChannel(red), clampChannel(green), clampChannel(blue));
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value || 0)));
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${red}, ${green}, ${blue})`;
}
