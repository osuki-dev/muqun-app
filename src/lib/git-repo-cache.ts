/**
 * What the app knows about the directories it has looked at.
 *
 * The diff entry point has one job before it draws anything: decide whether
 * this pane is in a checkout. That answer is a property of the *directory*, not
 * of the pane -- three panes in the same repository have the same answer, and
 * the same pane in a different directory has a different one -- so the cache is
 * keyed by the cwd string. Leaving a pane and coming back is then free, and
 * switching between two panes of one repository costs one request rather than
 * two.
 *
 * Module-level rather than React state on purpose. A `useState` in the button
 * would start empty on every mount, so the icon would blink in a moment after
 * every navigation; a module map outlives the tree the way the answer does.
 *
 * The rule that keeps it from flickering is `mergeRepoEntry`: **start hidden,
 * never hide once shown for this cwd.** An unknown directory renders nothing at
 * all -- the `FileMentionPanel` discipline, "with nothing to show it renders
 * nothing" -- and a directory already known to be a repository keeps its entry
 * even while a refresh is in flight, and even if that refresh comes back
 * unable to answer. A control that appears, vanishes and reappears is worse
 * than one that is a few seconds stale.
 *
 * Pure and free of React, so the rules have a test suite rather than a screen.
 */

import type { PaneContext } from '@/lib/git-diff';

/** What is known about one working directory. */
export interface GitRepoEntry {
  /** The cwd is a checkout, so the entry point has something to open. */
  available: boolean;
  /** The badge. Zero is a real answer: a clean tree has nothing changed. */
  changedFiles: number;
  /** Which branch, for the sheet's subtitle. */
  branch: string | null;
  /** When this was last answered, in unix milliseconds. */
  atMs: number;
}

const entries = new Map<string, GitRepoEntry>();

/**
 * A ceiling on the map, because a long-lived session walks through directories
 * and nothing here is ever invalidated by time. Eviction is oldest-first by
 * insertion, which `Map` iteration already gives in order.
 */
const MAX_CACHED_DIRECTORIES = 64;

/** What the context route said, as an entry. */
export function repoEntryFromContext(context: PaneContext, atMs: number): GitRepoEntry {
  return {
    available: context.git !== null,
    changedFiles: context.git?.changedFiles ?? 0,
    branch: context.git?.branch ?? null,
    atMs,
  };
}

/**
 * The never-hide rule, written once.
 *
 * A directory that has been shown to be a repository stays one for the life of
 * the cache. A later answer that cannot see it -- a gateway that dropped the
 * request, a pane momentarily between directories, a `git` that timed out -- is
 * a failure to observe, not an observation of absence, and it must not take the
 * control out from under the reader's thumb.
 *
 * The counts still update: a refresh that says "still a repository, now with
 * two changed files" is believed in full.
 */
export function mergeRepoEntry(
  previous: GitRepoEntry | undefined,
  next: GitRepoEntry
): GitRepoEntry {
  if (!previous) return next;
  if (previous.available && !next.available) {
    return {
      available: true,
      changedFiles: previous.changedFiles,
      branch: previous.branch,
      atMs: next.atMs,
    };
  }
  return next;
}

/** What is known about this directory, or nothing at all. */
export function readGitRepo(cwd: string | null | undefined): GitRepoEntry | undefined {
  if (!cwd) return undefined;
  return entries.get(cwd);
}

/** Records an answer, applying `mergeRepoEntry`, and returns what is now known. */
export function recordGitRepo(cwd: string, entry: GitRepoEntry): GitRepoEntry {
  const merged = mergeRepoEntry(entries.get(cwd), entry);
  // Re-inserted rather than updated in place, so the eviction order below is
  // "least recently answered" rather than "first ever seen".
  entries.delete(cwd);
  entries.set(cwd, merged);
  if (entries.size > MAX_CACHED_DIRECTORIES) {
    const oldest = entries.keys().next();
    if (!oldest.done) entries.delete(oldest.value);
  }
  return merged;
}

/**
 * Drops everything. Called when the app leaves a gateway: the next one is a
 * different machine, and `/Users/x/p` on it is not the same directory.
 */
export function clearGitRepoCache(): void {
  entries.clear();
}

/** How many directories are held. Exists for the tests and for nothing else. */
export function gitRepoCacheSize(): number {
  return entries.size;
}

/** The eviction ceiling, exported so a test asserts against the real number. */
export const GIT_REPO_CACHE_LIMIT = MAX_CACHED_DIRECTORIES;
