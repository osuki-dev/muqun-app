/**
 * Which installed themes nobody is looking at, and how much room removing them
 * would give back.
 *
 * The Storage section offers this beside Clear cache, and the two are not the
 * same kind of button. The cache is scaffolding the app can always rebuild; an
 * installed theme is somebody's import, so the rule is narrower than an
 * allow-list of directory names -- the theme currently applied is never in the
 * list, and every other custom theme is.
 *
 * "In use" is one theme, never a set. `library.selection` names either a
 * built-in pack, which owns no files at all and so leaves every custom theme
 * removable, or one installed custom theme, which is the only thing this file
 * protects. `previous` -- the Undo target -- is deliberately not protected: it
 * is a convenience that expires on its own, and a second protected id would
 * mean a reader who had tried two themes could never empty the list. Removing
 * it costs the Undo and nothing else; `ThemeRepository.remove` recomputes both
 * `selection` and `previous` against the themes that remain, so neither is ever
 * left pointing at a theme that is gone.
 *
 * Assets are content-addressed and shared: two themes carrying the same picture
 * reference one file under one name. So a file counts towards the reclaimable
 * total only when a removable theme references it and the protected theme does
 * not. Anything looser promises back bytes the app is about to keep. Files
 * nobody references at all are not counted either -- they are the garbage
 * collector's business, and it runs whether or not this button is ever pressed.
 *
 * Matching is by file name rather than by whole URI. The name is the sha-256
 * digest `theme/assets.native.ts` wrote, which identifies the bytes at least as
 * precisely as a path does and survives the thing a path does not: the library's
 * URIs were written at install time and the walk's URIs come back from the
 * filesystem, and any disagreement between the two spellings of the same
 * directory -- a moved app container, a normalised prefix -- would silently
 * under-count rather than fail.
 *
 * There are no `expo-file-system` imports below. The walk is the caller's, the
 * same way `lib/cache-storage.ts` leaves it there, so the rule that decides what
 * a reader is offered is testable without a device.
 */

import type { InstalledTheme, ThemeSelection } from '@/theme/repository';

/**
 * One file directly beneath the theme asset directory.
 *
 * The same three fields a cache-root entry carries, and for the same reason:
 * the caller reports what the filesystem said and this file decides what it
 * means.
 */
export type ThemeAssetFile = {
  /** The entry's own name, with no path in front of it. */
  name: string;
  /** Its absolute `file://` URI, as the filesystem reported it. */
  uri: string;
  /** Bytes it occupies. */
  bytes: number;
};

/** What the Remove unused themes row states, and what pressing it would do. */
export type UnusedThemes = {
  /** Every installed theme that is not the applied one, in library order. */
  removable: InstalledTheme[];
  /** Bytes held only by those themes, so only bytes removal would really free. */
  reclaimableBytes: number;
  /** `removable.length`, named because the row says it out loud. */
  count: number;
};

/** Every file name a set of themes references, ignoring the paths in front. */
function referencedNames(themes: readonly InstalledTheme[]): Set<string> {
  const names = new Set<string>();
  for (const theme of themes)
    for (const uri of Object.values(theme.assets)) {
      // The last segment, and an empty one is a URI this file has nothing to
      // say about rather than a name every entry would match.
      const name = uri.slice(uri.lastIndexOf('/') + 1);
      if (name) names.add(name);
    }
  return names;
}

/**
 * What removal would take and what it would give back.
 *
 * The applied theme is looked up by id rather than trusted from the selection
 * alone: a selection naming a theme that is not installed protects nothing,
 * which is the right answer -- there is no theme there to look at -- and is the
 * state a half-written library hydrates into.
 */
export function planUnusedThemes(
  themes: readonly InstalledTheme[],
  selection: ThemeSelection | null,
  files: readonly ThemeAssetFile[]
): UnusedThemes {
  const appliedId = selection?.kind === 'custom' ? selection.id : null;
  const applied = themes.filter((theme) => theme.id === appliedId);
  const removable = themes.filter((theme) => theme.id !== appliedId);
  const kept = referencedNames(applied);
  const doomed = referencedNames(removable);

  let reclaimableBytes = 0;
  const counted = new Set<string>();
  for (const file of files) {
    if (counted.has(file.name) || !doomed.has(file.name) || kept.has(file.name)) continue;
    counted.add(file.name);
    // A negative or non-finite size is the filesystem declining to answer, not
    // a file that gives space back.
    if (Number.isFinite(file.bytes) && file.bytes > 0) reclaimableBytes += file.bytes;
  }

  return { removable, reclaimableBytes, count: removable.length };
}
