/**
 * Which tab of the themes sheet a reader was last looking at, for this session.
 *
 * A reader who closes the sheet and opens it again a minute later is usually
 * coming back to the same list -- the gallery they were browsing, the theme of
 * their own they were comparing -- so the sheet reopens where they left it.
 * Only for the session: the next launch starts from the sheet's own default,
 * which is Mine, or the gallery for a reader who has no themes of their own.
 */
export type ThemeTab = 'mine' | 'builtin' | 'gallery';

let sessionTab: ThemeTab | null = null;

/** `null` until a tab has been chosen in this session. */
export function loadThemeTab(): ThemeTab | null {
  return sessionTab;
}

export function saveThemeTab(tab: ThemeTab): void {
  sessionTab = tab;
}
