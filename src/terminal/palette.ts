import type { ResolvedThemeMode } from '@osuki-dev/ui';

import {
  DEFAULT_THEME_PACK_ID,
  resolveThemePack,
  themeVariant,
  type ThemeAppearance,
} from '@/constants/theme-packs';
import { isDarkSurface, type TerminalSurface } from '@/terminal/surface';

export type TerminalTheme = {
  background: string;
  backgroundOpacity?: number;
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
export function createTerminalTheme(pack: ThemeAppearance, mode: ResolvedThemeMode): TerminalTheme {
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
  pack: ThemeAppearance,
  appTheme: TerminalTheme,
  surface: TerminalSurface,
  ownsScreen: boolean
): TerminalTheme {
  if (!ownsScreen || !surface.verbatim) return appTheme;
  const background = surface.background ?? themeVariant(pack, 'dark').terminal.background;
  if (
    background === appTheme.background &&
    (surface.background == null || (appTheme.backgroundOpacity ?? 1) === 1)
  )
    return appTheme;
  // Defaults, cursor and the ANSI row all come from whichever side of the pack
  // the adopted surface belongs to. A default-coloured glyph has to stay legible
  // on it, and taking the foreground from one side and the background from the
  // other is exactly how you get dark text on a dark screen.
  const base = themeVariant(pack, isDarkSurface(background) ? 'dark' : 'light').terminal;
  return adoptedPaneTheme(
    base,
    background,
    surface.background == null ? appTheme.backgroundOpacity : 1
  );
}

/**
 * One object per adopted (variant, background, opacity), handed back by
 * identity for as long as those three stay put.
 *
 * Identity is the contract downstream: the block cache keys every recording on
 * `renderingIdentity(paneTheme)`, so a fresh object per call -- which is what
 * a bare spread is, and this runs once per applied snapshot -- made every block
 * of an adopted pane stale ten times a second. A whole re-record per frame on
 * exactly the panes (editors, TUIs) that repaint the most.
 *
 * Keyed by the variant's own terminal object, so a theme pack change starts a
 * fresh map and the old one goes with the pack. Bounded because a program can
 * paint as many backgrounds as it likes over a session; a pane only ever
 * alternates between a handful, so clearing at the cap costs one re-record.
 */
const adoptedPaneThemes = new WeakMap<TerminalTheme, Map<string, TerminalTheme>>();
const ADOPTED_PANE_THEME_LIMIT = 32;

function adoptedPaneTheme(
  base: TerminalTheme,
  background: string,
  backgroundOpacity: number | undefined
): TerminalTheme {
  let byColor = adoptedPaneThemes.get(base);
  if (!byColor) {
    byColor = new Map();
    adoptedPaneThemes.set(base, byColor);
  }
  const key = `${background}|${backgroundOpacity ?? ''}`;
  let theme = byColor.get(key);
  if (!theme) {
    if (byColor.size >= ADOPTED_PANE_THEME_LIMIT) byColor.clear();
    theme = { ...base, background, backgroundOpacity };
    byColor.set(key, theme);
  }
  return theme;
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

export function terminalRgbColor(red: number, green: number, blue: number): string {
  return rgb(clampChannel(red), clampChannel(green), clampChannel(blue));
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value || 0)));
}

function rgb(red: number, green: number, blue: number): string {
  return `rgb(${red}, ${green}, ${blue})`;
}
