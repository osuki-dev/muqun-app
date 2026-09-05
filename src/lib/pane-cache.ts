/**
 * # What the reader already had, kept for the walk back
 *
 * Switching pane is the commonest thing anyone does on the terminal screen,
 * and until this module existed it cost a blank. The screen blanked `output`
 * on every `selection.paneId` change and then waited for `readPaneOutput` to
 * come back over the encrypted transport before it had a single row to draw
 * -- for a pane the reader had been looking at one second earlier, whose
 * window was still sitting in memory when it was thrown away.
 *
 * Nothing here is new terminal logic. The window this module hands back is the
 * exact string `foldPaneRead` had already folded (see the contract at the top
 * of `src/terminal/history.ts`), together with the four things that describe
 * *how deep* it is -- the line limit the reader paged to, the rows the last
 * read reached, the read envelope a range page addresses from, and whether
 * this gateway honoured a range at all. Put back together they restore the
 * window to precisely the state the fold left it in, so the refresh that
 * follows folds against it identically to the way it would have folded had
 * the pane never been left. That is the whole safety argument: the cache does
 * not merge, does not trim and does not decide anything about depth. It
 * remembers, and the same one door that has always folded reads keeps folding
 * them.
 *
 * ## Why the revision is kept beside it
 *
 * The event stream is session-wide -- `pane.updated` arrives for every pane --
 * but the gateway only inlines the *text* for the one pane the stream was
 * opened against (`stream_pane`), so there is no way to keep another pane's
 * window genuinely warm off the wire. What does arrive for every pane is its
 * revision, and that is enough to know whether what is remembered is still
 * the whole truth. So a cached window is always painted -- a second-old
 * window is a better answer than a blank one, and it is the only answer that
 * can be given inside the frame the tap happened in -- and the revision says
 * whether the read that follows is a reconciliation or a formality.
 *
 * A remembered revision never overwrites a newer one: {@link notePaneRevision}
 * only moves it forward. That is what stops a late reply from a request issued
 * before a switch from re-marking a pane as fresh at a revision the stream has
 * already moved past.
 *
 * ## Bounds
 *
 * Two of them, because either on its own has a hole. A count bound alone lets
 * four panes that have each been paged back to two thousand lines sit in
 * memory at once; a byte bound alone lets a hundred one-line panes accumulate
 * for no benefit, since only the handful either side of the selection are ever
 * switched to. Both are enforced on every write, least-recently-used first.
 *
 * A single window larger than the whole byte budget is not cached at all,
 * rather than cached by evicting everything else for it: it would empty the
 * cache to hold one pane, and the read that would have to run anyway is the
 * same read either way. Storing it is refused *and* any older copy of that
 * pane is dropped, because a window that has since grown past the budget makes
 * the copy underneath it stale.
 */

/** The window, and everything that says how deep it is. */
export interface PaneWindow {
  /**
   * What this is a window *of*, in the caller's own terms -- the format and
   * source the read was made under (`ansi`/`recent-unwrapped` for an ordinary
   * pane, `text` for an agent being read as prose, `visible` for a program
   * that draws its screen instead of printing).
   *
   * Opaque here on purpose: this module has no business knowing what an ANSI
   * window is, only that two windows of different shapes are not
   * interchangeable. It exists because a pane can change shape while nobody is
   * looking -- a shell hands its tty to an editor and the source it must be
   * read from turns with it -- and a window restored across that change would
   * put escape sequences into a reading view, or a screen into a scrollback.
   * {@link recallPaneWindow} refuses a shape it was not asked for, which turns
   * that case back into the plain miss it was before this cache existed.
   */
  shape: string;
  /** The folded window, exactly as `foldPaneRead` last left it. */
  output: string;
  /** How far back the reader had paged -- `outputLineLimitRef`. */
  lineLimit: number;
  /**
   * The gateway revision this window was actually folded to; -1 when the
   * gateway versions nothing.
   *
   * Kept apart from {@link PaneCacheEntry.seen} because one number cannot say
   * both things. This one is a fact about the text held; `seen` is a fact
   * about what the gateway has since said exists. Folding them into one field
   * makes "this pane printed while you were away" indistinguishable from "this
   * window contains what it printed", which is precisely backwards.
   */
  revision: number;
  /** Whether the pull-down had anywhere left to go. */
  canLoadEarlier: boolean;
  /** Rows the last read reached, for the plateau check in `hasEarlierAfterPage`. */
  earlierRows: number;
  /** Whether this gateway was caught ignoring a `start`/`end` range. */
  rangeUnsupported: boolean;
  /** The last read's envelope, which `paneReadRange` addresses the next page from. */
  lastRead: unknown;
}

export interface PaneCacheEntry extends PaneWindow {
  paneId: string;
  /**
   * The newest revision the stream or the navigator has reported for this
   * pane, folded in or not. Never below `revision`: a window cannot hold text
   * from a revision nobody has heard of.
   */
  seen: number;
}

/** Most recently used first. Immutable: every operation returns a new cache. */
export interface PaneCache {
  readonly entries: readonly PaneCacheEntry[];
}

export interface PaneCacheBounds {
  /** How many panes may be remembered at once. */
  panes: number;
  /** How many characters of window may be held across all of them. */
  characters: number;
}

/**
 * Four panes, because the ring the two-finger swipe walks is stepped one at a
 * time and a reader browsing a tab of four panes should never meet a blank;
 * beyond that the hit rate stops paying for the memory.
 *
 * A megabyte and a half, measured against the worst window the screen can
 * hold: `MAX_PANE_OUTPUT_LINES` (2000) rows of ANSI at a phone's column count
 * comes to a few hundred kilobytes, so the budget holds four ordinary panes
 * comfortably and refuses to hold four pathological ones.
 */
export const PANE_CACHE_BOUNDS: PaneCacheBounds = { panes: 4, characters: 1_500_000 };

export const emptyPaneCache: PaneCache = { entries: [] };

function windowCharacters(entry: PaneWindow): number {
  return entry.output.length;
}

/**
 * Trim to both bounds, oldest first.
 *
 * The most recently used entry survives whatever the budget says, because it
 * is the one the caller has just written and the one the next switch is most
 * likely to ask for; the byte bound is what {@link rememberPaneWindow} has
 * already refused an over-budget window against, so this can never be asked
 * to keep something it cannot afford.
 */
function trim(entries: PaneCacheEntry[], bounds: PaneCacheBounds): PaneCacheEntry[] {
  const kept = entries.slice(0, Math.max(1, bounds.panes));
  let total = 0;
  const affordable: PaneCacheEntry[] = [];
  for (const entry of kept) {
    const size = windowCharacters(entry);
    if (affordable.length > 0 && total + size > bounds.characters) break;
    total += size;
    affordable.push(entry);
  }
  return affordable;
}

/**
 * Put this pane's window at the front, replacing whatever was remembered of it.
 *
 * Called on the way out of a pane rather than on every read: what is worth
 * remembering is the window as the reader last saw it, and writing on every
 * fold would copy a string a second for a pane nobody is about to leave.
 */
export function rememberPaneWindow(
  cache: PaneCache,
  paneId: string,
  window: PaneWindow,
  bounds: PaneCacheBounds = PANE_CACHE_BOUNDS
): PaneCache {
  if (!paneId) return cache;
  const others = cache.entries.filter((entry) => entry.paneId !== paneId);
  // Over budget on its own: not stored, and the older copy goes with it -- see
  // the bounds note in this file's docblock.
  if (windowCharacters(window) > bounds.characters) {
    return others.length === cache.entries.length ? cache : { entries: others };
  }
  const held = cache.entries.find((entry) => entry.paneId === paneId);
  // A window just written is caught up with itself by definition, but it must
  // not un-hear news that arrived while it was being fetched: a prefetch reply
  // for revision 4, landing after the stream reported 7, is still a window at
  // 4 and the pane is still known to have moved on.
  const seen = Math.max(window.revision, held?.seen ?? -1);
  return { entries: trim([{ ...window, paneId, seen }, ...others], bounds) };
}

/**
 * Store a window fetched to warm a pane nobody has asked for yet.
 *
 * {@link rememberPaneWindow} with the one rule a warm-up has and a real read
 * does not: it may not make what is held shallower. A warm-up is always the
 * first page, and it exists to remove a blank -- so behind a window the reader
 * has already paged deeper there is no blank to remove, and writing over it
 * would undo their paging in a way nothing on screen explains. That was the
 * defect: page a pane five pages back, leave it, come back, and it was at one
 * page again.
 *
 * The depth held is only a reason to refuse when it is depth in *this* reading
 * of the pane; a window of another shape is a different picture, not a deeper
 * one, and does not stand in the way.
 */
export function warmPaneWindow(
  cache: PaneCache,
  paneId: string,
  window: PaneWindow,
  bounds: PaneCacheBounds = PANE_CACHE_BOUNDS
): PaneCache {
  const held = cache.entries.find((entry) => entry.paneId === paneId);
  if (held && held.shape === window.shape && held.lineLimit > window.lineLimit) return cache;
  return rememberPaneWindow(cache, paneId, window, bounds);
}

/**
 * What is remembered of this pane, or `null`.
 *
 * Deliberately does not reorder: recall happens during the render that paints
 * the switch, and a lookup that rewrote the cache there would make painting a
 * frame a side effect. {@link rememberPaneWindow} on the way out is the only
 * thing that moves an entry to the front, and it is the honest signal anyway
 * -- a pane that was actually read from is a pane that was actually used.
 */
export function recallPaneWindow(
  cache: PaneCache,
  paneId: string,
  shape: string
): PaneWindow | null {
  if (!paneId) return null;
  const found = cache.entries.find((entry) => entry.paneId === paneId);
  if (!found || found.shape !== shape) return null;
  const { paneId: _id, seen: _seen, ...window } = found;
  return window;
}

/**
 * A pane the session no longer has -- closed, or moved to another session --
 * is dropped rather than left to age out, because its id can be reused.
 */
export function forgetPaneWindow(cache: PaneCache, paneId: string): PaneCache {
  const entries = cache.entries.filter((entry) => entry.paneId !== paneId);
  return entries.length === cache.entries.length ? cache : { entries };
}

/**
 * Keep only the panes the session still lists.
 *
 * The structural events say a pane closed but not always which, and the
 * navigator refresh that follows them is the reliable answer, so this is run
 * against the refreshed pane list rather than against an event payload.
 */
export function retainPanes(cache: PaneCache, paneIds: readonly string[]): PaneCache {
  const live = new Set(paneIds);
  const entries = cache.entries.filter((entry) => live.has(entry.paneId));
  return entries.length === cache.entries.length ? cache : { entries };
}

/**
 * The stream said this pane printed.
 *
 * Only the revision moves, and only forward -- the window itself stays exactly
 * as it was folded, because for a pane that is not the selected one the
 * gateway sends no text to fold. What this buys is the difference between a
 * cached window that is still the whole truth and one that has been overtaken,
 * which is what {@link paneWindowIsCurrent} answers and what lets a switch
 * back to an idle pane skip its read entirely.
 *
 * A pane that is not cached is not created here: remembering a revision for a
 * window nobody holds would claim freshness for a blank.
 */
export function notePaneRevision(cache: PaneCache, paneId: string, revision: number): PaneCache {
  let changed = false;
  const entries = cache.entries.map((entry) => {
    if (entry.paneId !== paneId || revision <= entry.seen) return entry;
    changed = true;
    // `seen` only. The window is untouched, because for a pane that is not the
    // selected one there is no text on the wire to fold -- which is the whole
    // point: this is the news that what is held has been overtaken, not a
    // repair of it.
    return { ...entry, seen: revision };
  });
  return changed ? { entries } : cache;
}

/**
 * Fold a frame the stream delivered for a pane nobody is looking at into the
 * window remembered for it.
 *
 * The one case where another pane's *text* is on the wire at all: for the
 * short interval after a switch, before the stream has been re-opened against
 * the new selection, the gateway is still inlining the pane just left. Folding
 * those frames in rather than dropping them is what makes switching straight
 * back free even while the pane is printing.
 *
 * `fold` is the caller's -- `foldPaneRead`, the same one door the selected
 * pane's own frames go through, given the same `'frame'` origin and the same
 * limit the window was read at. This module supplies no folding of its own and
 * has no opinion about the result; it decides only *whether* there is a window
 * to fold into (there is one, of the right shape, and this frame is not one
 * the cache has already moved past) and then puts the answer back where it
 * came from, revision and all.
 *
 * A pane that is not cached, one held under another shape, and a frame at a
 * revision already overtaken all leave the cache untouched -- and untouched
 * means a plain miss on the next switch, which is what every pane did before
 * any of this existed.
 */
export function foldPaneFrame(
  cache: PaneCache,
  paneId: string,
  shape: string,
  revision: number,
  fold: (held: string, lineLimit: number) => string,
  bounds: PaneCacheBounds = PANE_CACHE_BOUNDS
): PaneCache {
  const found = cache.entries.find((entry) => entry.paneId === paneId);
  if (!found || found.shape !== shape) return cache;
  if (!paneReadIsCurrent(cache, paneId, revision)) return cache;
  const output = fold(found.output, found.lineLimit);
  const next = revision < 0 ? found.revision : Math.max(found.revision, revision);
  if (output === found.output && next === found.revision) return cache;
  const { paneId: _id, seen: _seen, ...window } = found;
  // Through `rememberPaneWindow`, so the bounds are enforced on a window that
  // has just grown and `seen` is reconciled in the one place that owns it.
  return rememberPaneWindow(cache, paneId, { ...window, output, revision: next }, bounds);
}

/**
 * Whether what is remembered of this pane is still everything the gateway has.
 *
 * `false` for a pane that is not cached, and for one whose remembered window
 * predates a revision the navigator or the stream has since reported. A pane
 * that never carried a revision (`-1` on either side) is never called current,
 * because there is nothing to compare and guessing wrong here shows the reader
 * stale output indefinitely.
 */
export function paneWindowIsCurrent(cache: PaneCache, paneId: string, revision: number): boolean {
  const found = cache.entries.find((entry) => entry.paneId === paneId);
  if (!found || found.revision < 0 || revision < 0) return false;
  return found.revision >= Math.max(found.seen, revision);
}

/**
 * Whether a read that has just landed still has anything to say about a
 * cached pane.
 *
 * The screen's own `isCurrentRequest` already refuses a reply for a pane that
 * is no longer selected; this is the same question for the panes nobody is
 * looking at, where there is no selection to compare against. A reply is
 * refused when the cache has moved past it -- a prefetch issued at revision 4
 * landing after the stream reported 7 would otherwise write a window three
 * revisions behind and mark it as the truth.
 *
 * An answer carrying no revision (`-1`) is accepted: a gateway that does not
 * version its panes gives no grounds to refuse one, and the alternative is
 * never caching anything on those gateways at all.
 */
export function paneReadIsCurrent(cache: PaneCache, paneId: string, revision: number): boolean {
  if (revision < 0) return true;
  const found = cache.entries.find((entry) => entry.paneId === paneId);
  return !found || revision >= found.revision;
}

/**
 * One warming request per neighbour, and only for neighbours worth warming.
 *
 * The ring is the tab's panes in the order the strip draws them, so the two
 * neighbours are the two panes a swipe can reach in one gesture. A neighbour
 * whose cached window is already current is skipped -- the point of the
 * prefetch is to remove the blank, and there is no blank to remove there --
 * and so is the selection itself, which the screen is already reading.
 *
 * The ring wraps, so a tab of two panes yields one neighbour rather than the
 * same pane twice.
 */
export function panePrefetchTargets(
  paneIds: readonly string[],
  selectedPaneId: string,
  cache: PaneCache,
  revisionOf: (paneId: string) => number
): string[] {
  const index = paneIds.indexOf(selectedPaneId);
  if (index < 0 || paneIds.length < 2) return [];
  const size = paneIds.length;
  const candidates = [paneIds[(index + 1) % size], paneIds[(index - 1 + size) % size]];
  const targets: string[] = [];
  for (const paneId of candidates) {
    if (paneId === selectedPaneId || targets.includes(paneId)) continue;
    if (paneWindowIsCurrent(cache, paneId, revisionOf(paneId))) continue;
    targets.push(paneId);
  }
  return targets;
}

/**
 * Whether a prefetch issued under `generation` may still be written.
 *
 * Prefetches are cancelled by being outrun rather than by an abort: the
 * request is in flight over a transport that charges for the round trip
 * whether or not anyone reads the answer, so tearing the socket down buys
 * nothing a stale check does not. The screen bumps the generation on every
 * selection change, which is what makes a burst of swipes cost one useful
 * warm-up at the end rather than one per pane passed through.
 */
export function panePrefetchAccepted(generation: number, currentGeneration: number): boolean {
  return generation === currentGeneration;
}
