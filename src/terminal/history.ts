/**
 * # The pane read/hold contract
 *
 * One pane. Four things feed it, one window holds the result, and until this
 * file said so in one place each half assumed the other's shape. Cards #646,
 * #675, #712 and #721 are all the same bug seen from different sides.
 *
 * ## The window
 *
 * The reader holds one array of rows -- `[history] + [the screen as last seen]`
 * -- bounded at `maximumLines`. It has a **depth**: how far back it reaches,
 * which is what the reader paged to. Depth is the thing every one of these bugs
 * destroyed.
 *
 * ## The sources, and what each is authoritative for
 *
 * | source | shape | may | authority |
 * |---|---|---|---|
 * | HTTP refresh (`'refresh'`) | window *or* screen -- see below | place | the tail it re-sends |
 * | HTTP pagination (`'page'`) | a window read at a wider limit | place, may deepen | depth, when it actually reaches deeper |
 * | HTTP range page (`'rangePage'`) | a disjoint absolute span, `[start, end)` | place, may prepend | the exact span it was asked for |
 * | SSE inline frame (`'frame'`) | the raw screen alone | place, may never deepen | the tail it re-sends |
 * | agent/chat parts | a spliceable stream, not a rectangle | extend | its own seam ({@link mergeTerminalWindow}) |
 *
 * `'rangePage'` carries an authority no other row does: it is the one origin
 * licensed to prepend on zero overlap, because it is the one origin for which
 * zero overlap is not a surprise but the point -- the caller asked for exactly
 * the span ending where the window began, so there is no shared row for an
 * overlap check to find. It does not deepen the way `'page'` does (a
 * demonstrably-superset read replacing the window outright); it goes above
 * the window instead. See the origin's own doc below and {@link
 * foldPaneRead}. Three bugs in this file -- a widening-tail read silently
 * reversed into the past, a gap opened by a stale served start, an invariant
 * that stopped describing the guard it was documenting -- all trace back to
 * this row being missing from here.
 *
 * **Nobody is authoritative for depth except a page that demonstrably reached
 * deeper.** That single line is the contract. Everything below follows from it.
 *
 * ### Why a refresh is not authoritative, though it used to be treated as such
 *
 * An HTTP refresh returns the gateway's ring window when the ring is on, and
 * one screen when it is off -- and it has been off since 1.2.0
 * (`scrollback::SCROLLBACK_ENABLED = false`). Measured on the loopback fleet on
 * 2026-07-29, pane `wM:p1` (`max_offset_from_bottom: 0`, a Claude pane):
 *
 * ```text
 *   lines=240  -> 63 rows      lines=720 -> 63 rows      lines=2000 -> 63 rows
 * ```
 *
 * Sixty-three rows is one viewport. For exactly the panes this whole saga is
 * about, a refresh *is* a screen however deep it asks. So `replace the window
 * with the refresh` throws away every row the frames accumulated, once per
 * poll: the flicker. Reading at the reader's current depth (b633f9c) fixed the
 * request and not the answer -- the answer was never going to be deeper.
 *
 * A pane Herdr does keep scrollback for does deepen with the limit (`wM:pT`:
 * 219 / 662 / 932 rows at 240 / 720 / 2000), and plateaus below what it
 * promised, which is card #646. Both behaviours are served by the same rule:
 * take what the read covers, keep what it does not.
 *
 * ## The one operation
 *
 * There is one door -- {@link foldPaneRead} -- and it does one thing: it finds
 * where the incoming read *begins* relative to the window, and splices there.
 *
 * ```text
 *   seam >= 0   incoming starts inside the window   -> held[0..seam] ++ incoming
 *   seam <  0   incoming reaches further back       -> incoming        (deepening)
 *   no seam,    a range-addressed page, sharing no  -> incoming ++ held
 *   origin      text with the window by construction   (prepending)
 *   'rangePage'
 *   no seam,    the screen jumped further than one  -> held ++ incoming-minus-
 *   otherwise   read can follow                        what-held-already-ends-with
 * ```
 *
 * Every branch drops from the tail and appends. None splices into the middle.
 * That is what makes the window a supersequence of every read that fed it, in
 * arrival order -- invariant (a), and the reason a reordered history is now
 * unrepresentable rather than merely unobserved.
 *
 * The **deepening** branch is the only one that may reduce the rows above the
 * seam, and `origin` is the only thing that gates it: a `'frame'` is a screen,
 * a screen is never deeper than the window that contains it, so a frame is
 * refused the branch outright. That refusal is card #712 made structural. It
 * used to be a guess about lengths -- "a read at least as long as the window is
 * the authoritative one" -- which is exactly wrong for a pane whose window has
 * not yet grown past one screen, where every frame is exactly as long as the
 * window and so replaced it forever.
 *
 * **No shape is inferred from a length anywhere in this file.** The caller says
 * which source it has; the seam says where the rows go. Those are the only two
 * inputs.
 *
 * One length-based judgement survives and is deliberately not a shape test:
 * {@link hasEarlierTerminalOutput} falls back to "this read came back about as
 * long as it asked for, so there is probably more above it" when the gateway
 * reports no scroll metrics at all. That answers *is there more history*, not
 * *what shape is this*, it is only reached on gateways too old to say, and it is
 * corrected by evidence the moment a page actually comes back
 * ({@link hasEarlierAfterPage}). It decides whether an affordance is offered;
 * it never decides where a row goes.
 *
 * ## The four invariants, and where each is enforced
 *
 * - **(a) supersequence, in arrival order** -- {@link foldPaneRead} appends
 *   only, after dropping from the tail. Enforced by construction.
 * - **(b) a refresh never shrinks what the reader paged to** -- only the
 *   deepening branch may reduce rows above the seam, and only `'page'` and
 *   `'refresh'` may enter it, and only when the incoming read demonstrably
 *   covers the whole window. See {@link deepeningSeam}.
 * - **(c) furniture is never history** -- {@link furnitureRows}, the app half of
 *   the gateway's rule. An agent pins a composer to the bottom of the screen; a
 *   read that cannot be placed would otherwise stamp a copy of it into the
 *   middle of the transcript.
 * - **(d) identical adjacent blocks never accumulate** -- {@link collapseRepeat}
 *   after every fold, and {@link sanitizePaneRead} before it. The second is the
 *   only defence we have against Herdr's own duplication; see below.
 *
 * ## Herdr duplicates its own reads, and we cannot fix it there
 *
 * Measured 2026-07-29 with the gateway bypassed entirely
 * (`herdr pane read wM:pT --source recent_unwrapped --lines N`, herdr 0.7.5):
 *
 * ```text
 *   lines=240   219 rows   rows 0..21 are verbatim rows 43..64
 *   lines=480   430 rows   rows 0..25 are verbatim rows 104..129
 *   lines=960   892 rows   rows 0..4  are verbatim rows 100..104
 *   lines=2000  932 rows   clean
 * ```
 *
 * The read is stitched from two buffer segments and the head of it is a copy of
 * a block that occurs again further down -- twenty-two rows including a
 * `Crunched for 5m 43s` timer and unique git hashes, so not a coincidence and
 * not something a terminal produces. It is upstream and not ours. But a window
 * that folds it will hold it, so {@link sanitizePaneRead} drops a head that
 * repeats verbatim later in the same read. That is the whole of the defence
 * available to us, and it runs on every read from every source.
 *
 * ## The mirror
 *
 * `muqun-gateway/src/scrollback.rs` reasons the same way about the same rows and
 * says so in its own header. The two ends of one pane must not disagree about
 * where a row belongs -- when they do, the row is written twice and the reader
 * scrolls back through their own conversation past things that never happened.
 */

/**
 * Which source a read arrived from. See the contract above.
 *
 * Not a shape and not a length: the caller knows which request it made, and
 * that is the only thing this can be honestly derived from.
 *
 * `'rangePage'` is `'page'`'s sibling, not a synonym: both name a fetch that
 * may claim depth, but only `'rangePage'` may be believed with zero overlap.
 * A `'page'` read is the widening tail -- a superset of the window that lost
 * its overlap only because a burst of output ran further than one read can
 * follow, in which case it is newest and belongs on top. A `'rangePage'` read
 * is a disjoint absolute span that shares no text with the window by
 * construction, so it has no overlap to lose and belongs above the window
 * instead. Collapsing the two under one origin was the bug: a widening-tail
 * read that legitimately found no overlap would have been prepended as if it
 * were older, reversing chronological order. See {@link foldPaneRead}.
 */
export type PaneReadOrigin = 'refresh' | 'page' | 'rangePage' | 'frame';

/**
 * Extend the window with a spliceable stream -- the agent/chat parts source.
 *
 * The one source that is not a rectangle. Parts arrive as a stream with a real
 * seam in it, so the longest prefix of the incoming that is a suffix of the held
 * window is a fact rather than a placement, and the remainder is appended. Its
 * authority is its own seam and nothing else: it may extend, never replace, and
 * never deepen.
 */
export function mergeTerminalWindow(
  currentOutput: string,
  latestOutput: string,
  maximumLines: number
): string {
  const incoming = sanitizePaneRead(latestOutput);
  if (!currentOutput) return trimTerminalWindow(incoming, maximumLines);
  if (!incoming) return trimTerminalWindow(currentOutput, maximumLines);

  // A merge failure must degrade to showing the fresh window, never to killing
  // the app: in a release build an exception escaping a state updater is fatal,
  // and this function concatenates the two largest strings the app handles.
  try {
    const current = terminalLines(currentOutput);
    const latest = terminalLines(incoming);
    const overlap = longestPrefixThatIsSuffix(latest, current);

    const merged = overlap > 0
      ? [...current, ...latest.slice(overlap)]
      : [
          ...current.slice(0, Math.max(0, current.length - latest.length)),
          ...latest,
        ];
    return trimTerminalWindow(collapseRepeat(merged).join('\n'), maximumLines);
  } catch {
    return trimTerminalWindow(incoming, maximumLines);
  }
}

/**
 * How much of an aligned overlap has to agree before a placement is believed.
 *
 * The same threshold the gateway's scrollback store uses (`scrollback.rs`),
 * deliberately: the two ends of one pane must not disagree about where a row
 * belongs. Exact matching is not an option for a repainting screen -- a spinner
 * or a cursor-line highlight changes a row without anything scrolling, and a
 * placement that demanded every row would read that as "nothing in common" and
 * keep the whole screen again, once per repaint.
 */
const SCREEN_MATCH_THRESHOLD = 0.8;

/**
 * Overlaps below this have to agree outright: two screens matching on one
 * blank row is not evidence of anything, and a blank-row coincidence is
 * exactly how a window grows a copy of itself.
 */
const SCREEN_MIN_MATCH_ROWS = 4;

/**
 * How many rows carrying something have to agree, running from the read's own
 * head, before the anchored placement is believed.
 *
 * An agent pane is not a uniformly scrolling rectangle: Claude Code pins an
 * eight-row composer under the transcript and scrolls only what is above it, so
 * the aligned overlap always mismatches by the height of the box and
 * `SCREEN_MATCH_THRESHOLD` is unreachable once the transcript moves more than
 * about nineteen rows between reads. Every frame past that point was kept whole
 * on top of a window that already held most of it. Anchoring on the run from the
 * read's head places those frames, and refuses the alignment where the pinned
 * composer merely lines up with itself -- that match sits sixty rows from the
 * head, not at it.
 *
 * The same three rows the gateway's `scrollback.rs` asks for, deliberately: the
 * two ends of one pane must not disagree about where a row belongs.
 */
const SCREEN_ANCHOR_ROWS = 3;

/** How far into the read the anchoring run may start, forgiving one row
 * repainted across the seam. */
const SCREEN_ANCHOR_SKEW = 1;

/** How far back the anchor may reach, as a multiple of the read: a screen does
 * not only move forward, and a re-wrap puts rows the window already promoted
 * into history back onto the screen. */
const SCREEN_ANCHOR_REACH = 2;

/**
 * The smallest run of rows that counts as a repeated block for invariant (d).
 *
 * Four, matching {@link SCREEN_MIN_MATCH_ROWS}: below it a repeat is a prompt
 * printed twice, which is history and must be kept. At four and up carrying
 * real text it is the buffer writing itself down again.
 */
const REPEAT_BLOCK_ROWS = 4;

/**
 * The most of a read that may be called furniture rather than history.
 *
 * A third of the read, the gateway's own cap (`scrollback.rs`): an agent's
 * composer is eight rows of sixty-five, and a pane that legitimately repaints
 * the same long tail keeps it.
 */
const FURNITURE_SHARE = 3;

/**
 * How many rows of a repeated head have to differ from each other before it is
 * called a duplicate rather than a pane repeating itself honestly.
 *
 * Three. A log line printed twenty times is one distinct row and stays; a
 * stitched transcript is twenty distinct rows and goes.
 */
const SANITIZE_MIN_DISTINCT = 3;

/**
 * How many rows carrying text a repeated tail must have before it is furniture.
 *
 * Two. One matching row is a coincidence and no matching rows is a pair of
 * screens with room at the bottom; a composer is a rule, a prompt and a mode
 * line, and never fewer than two of them survive the timer that sits among
 * them.
 */
const FURNITURE_MIN_ROWS = 2;

/**
 * How many rows of a composer may disagree outright before the run is refused.
 *
 * One: the mode-line timer. It is the row that changes on every frame whether
 * or not anything scrolled, and it is the reason an exact common suffix -- the
 * gateway's rule -- never recognises the box it was written to recognise.
 */
const FURNITURE_VOLATILE_ROWS = 1;

/**
 * Fold one read of a pane into the window the reader already has.
 *
 * The one door. See the contract at the top of this file for which source may
 * do what; this is where it is enforced.
 *
 * The read is sanitized on the way in ({@link sanitizePaneRead}), placed at the
 * seam its own head anchors, and the result is collapsed against invariant (d)
 * on the way out. Every branch drops from the tail and appends, so the window
 * stays a supersequence of everything that fed it, in arrival order.
 */
export function foldPaneRead(
  currentOutput: string,
  latestOutput: string,
  origin: PaneReadOrigin,
  maximumLines: number,
  ownsScreen = false
): string {
  const incoming = sanitizePaneRead(latestOutput);
  if (!currentOutput) return trimTerminalWindow(incoming, maximumLines);
  if (!incoming) return trimTerminalWindow(currentOutput, maximumLines);

  // A pane that owns the screen (an editor's alternate-screen redraw --
  // `isFullScreenTuiPane` in `terminal-keys.ts`) has no scrollback to fold
  // against: `history_size` measures 0 on every such pane, confirmed live
  // (card #795). Every read of one is the *whole* of its current screen, not
  // a tail of a log that grew, so the placement heuristics below -- built for
  // a pane that prints and scrolls, where "nothing overlapped" correctly means
  // "the output moved on and this is next" -- draw the wrong conclusion from
  // the same evidence here: nvim's statusline or cursor line changing enough
  // to defeat the overlap search is not the screen moving on, it is the same
  // screen repainted, and appending the fresh read under the stale one is
  // exactly the two-stacked-frames bug the card reported. A screen-owning read
  // replaces outright -- there is nothing above it this pane is responsible
  // for keeping.
  if (ownsScreen) return trimTerminalWindow(incoming, maximumLines);

  // A fold failure must degrade to showing the fresh read, never to killing the
  // app: in a release build an exception escaping a state updater is fatal, and
  // this function concatenates the two largest strings the app handles.
  try {
    const held = terminalLines(currentOutput);
    const latest = terminalLines(incoming);

    // Deepening first, and only for a source allowed to claim depth. A read
    // that reaches further back than the window covers everything the window
    // holds, so taking it whole loses nothing -- that is the one and only way
    // rows above a seam may go away, and invariant (b) is exactly the statement
    // that nothing else may enter here. Named explicitly rather than as
    // `!== 'frame'`: that spelling also admits `'rangePage'`, whose entire
    // premise is the opposite of this branch's -- it is a disjoint span that
    // shares no text with the window BY CONSTRUCTION, not a superset read that
    // happened to reach past the window's own head, and it is handled on its
    // own terms below, in the zero-overlap branch, once every other
    // explanation for "nothing overlapped" has been asked and declined.
    // Reaching this branch at all needs `latest.length > held.length` and the
    // whole window to appear verbatim inside the older page, which a
    // range-addressed fetch sized to one page is never long enough to
    // satisfy against an already-paged window -- effectively unreachable --
    // but "effectively" is not "provably", and the guard should say what it
    // means rather than lean on that.
    if ((origin === 'page' || origin === 'refresh') && deepeningSeam(held, latest)) {
      return trimTerminalWindow(collapseRepeat(latest).join('\n'), maximumLines);
    }

    let placed = held;
    let overlap = screenPlacement(placed, latest);
    if (overlap === 0) {
      // Nothing was believed: the screen moved further than one read can be
      // followed. Before concluding that, take the furniture off -- because the
      // furniture is what was hiding the seam.
      //
      // Measured by the soak against a live pane, eleven folds in: the window
      // ended `«002420» Update(...)` followed by the pinned composer, and the
      // read began `«002420» Update(...)`. The true seam is one row wide and
      // sits *under* seven rows of chrome, so no alignment could reach it and
      // the read went on top whole -- putting row 2420 in twice. Dropping the
      // chrome first and asking again finds it exactly.
      const furniture = furnitureRows(placed, latest);
      if (furniture > 0) {
        placed = placed.slice(0, placed.length - furniture);
        overlap = screenPlacement(placed, latest);
      }
    }
    // Still nothing. Either the screen ran further than a read can be followed
    // -- in which case this read is the newest thing there is and goes on top --
    // or it is a photograph of a screen the window has already scrolled past, in
    // which case appending it would walk the transcript backwards. Only ask now,
    // because a backward jump *within* a placement's reach is a re-wrap and has
    // already been handled above by taking those rows back down.
    if (overlap === 0 && staleRead(placed, latest)) {
      return trimTerminalWindow(currentOutput, maximumLines);
    }
    // A range-addressed page shares no text with the window by construction:
    // the caller asked for exactly the span that ends where the window begins,
    // so there is no row for an overlap check to find -- not a weaker signal,
    // no signal at all. `'rangePage'` is the one origin licensed to be believed
    // on that basis, and every other explanation for "nothing overlapped" has
    // already been asked and declined above (deepening, furniture, staleness),
    // so what is left goes above the window rather than on top of it, which is
    // where the newest-thing-on-top fallback below would otherwise put it.
    //
    // `'page'` -- the widening tail -- does NOT get this branch, deliberately:
    // it is a superset read, and losing its overlap means a burst of output
    // outran what one read can follow, not that it reaches further back. That
    // read is the newest thing there is and belongs on top, which is exactly
    // the fallback this guards. Collapsing `'page'` and `'rangePage'` into one
    // origin here was the bug a review caught: a widening-tail read that
    // legitimately found no overlap was being prepended as if it were older,
    // reversing the transcript's chronological order without any error.
    if (overlap === 0 && origin === 'rangePage') {
      return trimTerminalWindow(collapseRepeat([...latest, ...held]).join('\n'), maximumLines);
    }
    // Whatever the placement decided, rows the window verbatim already ends
    // with are not written down a second time. This is the last guard and it is
    // unconditional: appending rows that are already there, already in this
    // order, cannot be right whatever anything else thought.
    const skip = overlap > 0 ? 0 : alreadyHeld(placed, latest);
    const merged = [...placed.slice(0, placed.length - overlap), ...latest.slice(skip)];
    return trimTerminalWindow(collapseRepeat(merged).join('\n'), maximumLines);
  } catch {
    return trimTerminalWindow(incoming, maximumLines);
  }
}

/**
 * Fold an SSE inline frame. {@link foldPaneRead} with the source it can only
 * ever have; kept as its own name because that is what the stream handler has.
 */
export function applyTerminalFrame(
  currentOutput: string,
  latestOutput: string,
  maximumLines: number,
  ownsScreen = false
): string {
  return foldPaneRead(currentOutput, latestOutput, 'frame', maximumLines, ownsScreen);
}

/**
 * Whether this read is older than the window it is being folded into.
 *
 * Two sources feed one pane and they race. An HTTP refresh is issued, takes a
 * second to come back, and in that second the event stream has already painted
 * three frames past it. The read that lands is then a photograph of a screen the
 * window has scrolled beyond -- and every rule in this file was written on the
 * assumption that a read is *news*.
 *
 * Found by the soak, twice over, in one run: as a backwards jump in the row
 * stamps (`«96837» follows «96889»`) and as an agent's composer stranded in the
 * middle of the transcript, which is the same event described by two different
 * invariants. The stale screen could not be placed -- its content sits a hundred
 * rows back, further than {@link SCREEN_ANCHOR_REACH} lets a placement reach --
 * so it was appended whole, chrome and all, and the next live frame appended
 * after *that*.
 *
 * The test is exact and cheap: find where this read's head sits in the window.
 * If it is found, and the window carries on past where this read ends by more
 * than a placement could ever have reached, then the window already holds
 * everything this read has and newer renderings of it besides. There is nothing
 * to add. Drop it.
 *
 * Asked only after every placement has declined, which is what keeps it from
 * eating the case it looks exactly like: a pane whose long line re-wrapped, or
 * whose tool block collapsed, really does put earlier rows back on screen, and
 * those rows must be taken back down rather than ignored. That jump is small --
 * within {@link SCREEN_ANCHOR_REACH} reads -- and the anchored placement has
 * already handled it by the time this runs. A stale HTTP read is a whole second
 * of output behind, far outside that reach, which is the difference between the
 * two and the reason this is safe.
 */
function staleRead(held: string[], incoming: string[]): boolean {
  const reach = incoming.length * SCREEN_ANCHOR_REACH;
  const latest = held.length - reach;
  for (let start = 0; start < latest; start += 1) {
    if (held[start] !== incoming[0]) continue;
    let matched = 0;
    for (let step = 0; start + step < held.length && step < incoming.length; step += 1) {
      if (held[start + step] !== incoming[step]) break;
      if (incoming[step].trim() !== '') matched += 1;
      if (matched >= SCREEN_ANCHOR_ROWS) return true;
    }
  }
  return false;
}

/**
 * Whether the incoming read reaches further back than the window does -- i.e.
 * the window's own head sits inside it, and everything below that head is
 * re-sent.
 *
 * This is the only licence in the file to drop rows above a seam, so it is
 * deliberately hard to get: the window's first {@link SCREEN_ANCHOR_ROWS} rows
 * carrying text must appear in the read, in order, at an offset, and the read
 * must run to its own end from there. A read that merely *looks* long does not
 * qualify -- length is not evidence of depth, which is the whole of card #712.
 */
function deepeningSeam(held: string[], incoming: string[]): boolean {
  if (incoming.length <= held.length) return false;
  const probe = held.slice(0, Math.min(held.length, incoming.length));
  for (let offset = 1; offset + held.length <= incoming.length; offset += 1) {
    let carried = 0;
    let agreed = true;
    for (let row = 0; row < probe.length; row += 1) {
      if (incoming[offset + row] !== probe[row]) {
        agreed = false;
        break;
      }
      if (probe[row].trim() !== '') carried += 1;
    }
    if (agreed && carried >= SCREEN_ANCHOR_ROWS) return true;
  }
  return false;
}

/**
 * The pinned furniture at the bottom of the window: the rows this read ends
 * with that the window already ends with too.
 *
 * Invariant (c). An agent pins a composer under the transcript -- a rule, the
 * prompt row, the mode line -- and scrolls only what is above it. When a read
 * cannot be placed and goes on top whole, that box lands in the middle of the
 * transcript, and the reader scrolls back through their own conversation past
 * prompt boxes that were never there. The rows are furniture, not history, so
 * the copy the window is holding comes off before the new one goes on.
 *
 * The gateway keeps the previous frame to compute this. Here the window's own
 * tail *is* the previous frame, so no state is needed for the same answer.
 *
 * Agreement is **scored**, not demanded, for the same reason the placement
 * scores it -- and this is the part the gateway's exact `common_suffix` gets
 * wrong. A composer is not a still image: the mode line carries a timer
 * (`4m 46s · ↓ 2.9k tokens`) that changes on every single frame. An exact
 * common suffix therefore stops at the first row above that timer and finds
 * nothing worth calling furniture, so the rule silently never fires on the one
 * pane it was written for. Scoring at {@link SCREEN_MATCH_THRESHOLD} steps over
 * the volatile row and recognises the box.
 */
function furnitureRows(held: string[], incoming: string[]): number {
  const cap = Math.min(held.length, Math.floor(incoming.length / FURNITURE_SHARE));
  let matched = 0;
  let carried = 0;
  let best = 0;
  for (let rows = 1; rows <= cap; rows += 1) {
    const heldRow = held[held.length - rows];
    if (heldRow === incoming[incoming.length - rows]) {
      matched += 1;
      // A tail of blank rows is not a composer, it is room at the bottom of two
      // screens, and dropping it would eat the transcript above it.
      if (heldRow.trim() !== '') carried += 1;
    }
    // A ratio alone is too tight at the top of the scan, and the top of the
    // scan is where the volatile row usually is: `terminalLines` drops a
    // trailing blank, so a composer's last row is its mode line and its timer
    // is the very first thing compared. Three rows agreeing out of four is 0.75
    // and would be refused by the threshold, which is the whole box lost to one
    // ticking clock. One row is allowed to disagree outright; past that the
    // ratio takes over.
    const missed = rows - matched;
    const allowed = Math.max(FURNITURE_VOLATILE_ROWS, rows * (1 - SCREEN_MATCH_THRESHOLD));
    if (missed <= allowed && carried >= FURNITURE_MIN_ROWS) best = rows;
  }
  return best;
}

/**
 * Invariant (d): a block of rows immediately followed by a verbatim copy of
 * itself is written down once.
 *
 * The last defence, and the one that does not care how the duplicate got there
 * -- a placement that believed the wrong seam, a read Herdr stitched badly, a
 * gateway ring that was switched on again. Bounded to blocks of at least
 * {@link REPEAT_BLOCK_ROWS} rows carrying text, because two identical prompts
 * in a row are history and a session that ran the same command twice must still
 * be able to say so.
 */
function collapseRepeat(rows: string[]): string[] {
  const widest = Math.floor(rows.length / 2);
  for (let block = widest; block >= REPEAT_BLOCK_ROWS; block -= 1) {
    const head = rows.length - 2 * block;
    let same = true;
    let carried = 0;
    for (let step = 0; step < block; step += 1) {
      if (rows[head + step] !== rows[head + block + step]) {
        same = false;
        break;
      }
      if (rows[head + step].trim() !== '') carried += 1;
    }
    if (same && carried >= REPEAT_BLOCK_ROWS) return rows.slice(0, head + block);
  }
  return rows;
}

/**
 * What a read says, with Herdr's own duplication of it taken back out.
 *
 * Herdr stitches `recent_unwrapped` from two buffer segments and, measured on
 * herdr 0.7.5, hands back a read whose *head* is a verbatim copy of a block
 * further down it -- twenty-two rows at `lines=240`, twenty-six at `lines=480`.
 * See the table in the contract above. Fold that and the window holds it; there
 * is nowhere else we can stand.
 *
 * Only a head that repeats *later in the same read* is dropped, and only when
 * the repeat carries {@link REPEAT_BLOCK_ROWS} rows of text of which at least
 * {@link SANITIZE_MIN_DISTINCT} are different from each other. That last clause
 * is what separates this from a pane doing its job: a log printing one line
 * over and over, or a screen of identical box-drawing, repeats itself honestly
 * and must be left alone. Twenty-two rows of transcript carrying a `5m 43s`
 * timer and a git hash do not repeat by chance.
 *
 * The longest such repeat wins, not the nearest -- a short accidental match at
 * a small distance must not decide the cut. Everything below the head is left
 * exactly as it arrived: a read is still the best account of the pane that
 * exists, and this is a repair, not an opinion.
 */
export function sanitizePaneRead(output: string): string {
  if (!output) return output;
  try {
    const rows = terminalLines(output);
    if (rows.length < 2 * REPEAT_BLOCK_ROWS) return output;
    let cut = 0;
    for (let distance = 1; distance < rows.length; distance += 1) {
      let run = 0;
      const carried = new Set<string>();
      while (distance + run < rows.length && rows[run] === rows[distance + run]) {
        if (rows[run].trim() !== '') carried.add(rows[run]);
        run += 1;
      }
      if (run <= cut) continue;
      const substantial = rows.slice(0, run).filter((row) => row.trim() !== '').length;
      if (
        run >= REPEAT_BLOCK_ROWS
        && substantial >= REPEAT_BLOCK_ROWS
        && carried.size >= SANITIZE_MIN_DISTINCT
      ) cut = run;
    }
    return cut > 0 ? rows.slice(cut).join('\n') : output;
  } catch {
    return output;
  }
}

/**
 * Where a shorter read sits against the end of the window: how many held rows
 * it re-sends, or 0 where nothing is believed.
 *
 * The anchored run answers first. It compares candidate alignments against each
 * other rather than taking the widest one to clear a bar, which is what lets a
 * pinned composer stop hiding the seam -- and what stops a screen with a
 * repeating shape from clearing `SCREEN_MATCH_THRESHOLD` at full overlap by
 * lining its own period up with itself, taking the whole history with it. The
 * scored alignment answers where the anchor finds nothing, keeping the tolerance
 * the anchor is too strict for on the reads it has already declined to explain.
 */
function screenPlacement(held: string[], incoming: string[]): number {
  const anchored = anchoredPlacement(held, incoming);
  if (anchored > 0) return anchored;
  const widest = Math.min(held.length, incoming.length);
  for (let overlap = widest; overlap >= 1; overlap -= 1) {
    if (rowsAgree(held, incoming, overlap)) return overlap;
  }
  return 0;
}

/**
 * How many rows carrying something agree, running from incoming row `skew` until
 * the first disagreement. Blank rows hold a run together but never count for
 * one: thirty aligned blank rows say only that both screens have room at the
 * bottom.
 */
function anchorScore(held: string[], incoming: string[], overlap: number, skew: number): number {
  if (overlap <= skew) return 0;
  const start = held.length - overlap + skew;
  let score = 0;
  for (let step = 0; start + step < held.length && skew + step < incoming.length; step += 1) {
    if (held[start + step] !== incoming[skew + step]) break;
    if (incoming[skew + step].trim() !== '') score += 1;
  }
  return score;
}

/**
 * The overlap whose anchored run carries the most, or 0 where none carries
 * `SCREEN_ANCHOR_ROWS`. Ties go to the wider overlap: the alignment that
 * re-sends more of the window is the one that grows it less.
 */
function anchoredPlacement(held: string[], incoming: string[]): number {
  const reach = Math.min(held.length, incoming.length * SCREEN_ANCHOR_REACH);
  let bestScore = 0;
  let best = 0;
  for (let overlap = 1; overlap <= reach; overlap += 1) {
    let score = 0;
    for (let skew = 0; skew <= SCREEN_ANCHOR_SKEW; skew += 1) {
      const scored = anchorScore(held, incoming, overlap, skew);
      if (scored > score) score = scored;
    }
    if (score >= SCREEN_ANCHOR_ROWS && score >= bestScore) {
      bestScore = score;
      best = overlap;
    }
  }
  return best;
}

/** How much of the read the window already ends with, exactly. */
function alreadyHeld(held: string[], incoming: string[]): number {
  const widest = Math.min(held.length, incoming.length);
  for (let count = widest; count >= 1; count -= 1) {
    let same = true;
    for (let step = 0; step < count; step += 1) {
      if (held[held.length - count + step] !== incoming[step]) {
        same = false;
        break;
      }
    }
    if (same) return count;
  }
  return 0;
}

/** Whether the last `overlap` held rows are the first `overlap` incoming ones,
 * allowing for the cells a repaint changed without scrolling. */
function rowsAgree(held: string[], incoming: string[], overlap: number): boolean {
  const start = held.length - overlap;
  let agreed = 0;
  for (let row = 0; row < overlap; row += 1) {
    if (held[start + row] === incoming[row]) agreed += 1;
  }
  if (overlap < SCREEN_MIN_MATCH_ROWS) return agreed === overlap;
  return agreed >= overlap * SCREEN_MATCH_THRESHOLD;
}

export function terminalOutputLineCount(output: string): number {
  return output ? terminalLines(output).length : 0;
}

/**
 * Prefer Herdr's terminal scroll metrics over counting returned newlines.
 *
 * A `lines=240` pane read is a terminal-row limit, while `recent-unwrapped`
 * may contain fewer logical newline-delimited lines. Treating that smaller
 * count as end-of-history hides pagination for agents whose output wraps more
 * heavily. Older gateways may not include scroll metrics, so keep a tolerant
 * near-limit fallback for them.
 */
export function hasEarlierTerminalOutput(
  output: string,
  requestedLines: number,
  maximumLines: number,
  scroll: unknown
): boolean {
  if (requestedLines >= maximumLines) return false;

  const totalRows = terminalScrollbackRows(scroll);
  if (totalRows !== null) return totalRows > requestedLines;

  return terminalOutputLineCount(output) >= Math.max(1, requestedLines - 1);
}

/**
 * The absolute range a read came back with, or null where the gateway did not
 * say -- herdr panes and gateways older than range addressing.
 *
 * Null is the signal to fall back to measuring; a present range is a fact and
 * replaces the measurement entirely. That trade only holds because a present
 * range is now believed unconditionally: herdr no longer sends one at all
 * (it could never honour a requested span, so any range it sent could only
 * describe a tail it happened to serve, indistinguishable from the range
 * actually asked for), so every `range` reaching here now means the same one
 * thing across both backends -- the backend served the span it was asked
 * for -- rather than sometimes meaning that and sometimes meaning "here is
 * some tail, good luck". A stronger claim is worth a second fence: a `range`
 * that is internally incoherent (`start` past `end`, or either past `total`)
 * is not a span any backend could have honestly served, so it is treated the
 * same as no range rather than handed on as a fact a caller like
 * {@link nextPageRange} would place absolute trust in.
 *
 * `read` is a network payload, so this is total: a missing `range`, a `range`
 * that is `null` or not an object, fields that are missing or not finite
 * numbers (a string, `null`, `NaN`, `Infinity`), and now a `start`/`end`/
 * `total` that does not satisfy `start <= end <= total` either, all read as
 * "no range" rather than throwing or handing a broken fact on to a caller
 * that trusts this completely.
 */
export function paneReadRange(
  read: unknown
): { start: number; end: number; total: number } | null {
  if (typeof read !== 'object' || read === null) return null;
  const range = (read as { range?: unknown }).range;
  if (typeof range !== 'object' || range === null) return null;
  const { start, end, total } = range as Record<string, unknown>;
  if (
    typeof start !== 'number' || !Number.isFinite(start)
    || typeof end !== 'number' || !Number.isFinite(end)
    || typeof total !== 'number' || !Number.isFinite(total)
  ) {
    return null;
  }
  if (start > end || end > total) return null;
  return { start, end, total };
}

/**
 * The same question, asked again once a page has actually come back.
 *
 * `max_offset_from_bottom` is a display-row count and it is not a promise about
 * what `output` will hand over. Measured on the loopback fleet (card #646): a
 * pane claiming 2765 rows plateaued at 992 returned lines, so the reader could
 * pull at 1200, 1440, 1680 and 1920 and get zero new bytes each time while the
 * affordance went on promising more.
 *
 * The app cannot fix the metric -- it is herdr's -- but it does not have to go
 * on believing it after the evidence has arrived. A page that came back no
 * longer than the one before it did not reach any further back, and that is a
 * fact about this pane rather than a guess about which agent is running.
 *
 * A reported {@link paneReadRange} answers the question outright and skips the
 * measuring entirely -- the measuring above exists because herdr's row count
 * could not be trusted and there was no other signal; where there is one, it is
 * not a tiebreaker, it is the answer. `read` is optional and trailing so every
 * existing call site -- herdr panes, and any gateway older than range
 * addressing, both of which never send a `range` -- takes exactly the path it
 * takes today.
 */
export function hasEarlierAfterPage(
  output: string,
  requestedLines: number,
  maximumLines: number,
  scroll: unknown,
  previousRows: number,
  read?: unknown
): boolean {
  const range = paneReadRange(read);
  if (range) return range.start > 0;

  if (terminalOutputLineCount(output) <= previousRows) return false;
  return hasEarlierTerminalOutput(output, requestedLines, maximumLines, scroll);
}

/**
 * The page immediately above the one already held.
 *
 * Pages are disjoint: the previous page starts where this one ends, so a page
 * costs its own lines rather than every line beneath it. Null means the held
 * page already begins at the oldest line.
 */
export function nextPageRange(
  range: { start: number },
  pageSize: number
): { start: number; end: number } | null {
  if (range.start <= 0) return null;
  return { start: Math.max(0, range.start - pageSize), end: range.start };
}

/**
 * Where the window itself begins, right now -- asked fresh from the pane
 * record's own scroll metrics rather than remembered from whatever a past
 * page happened to report.
 *
 * Named for the role this was first written for -- the one read that cannot
 * carry a `range` to say so: every pane's first page, where the gateway's
 * tail read deliberately omits `range` (fetching it would cost a subprocess
 * the tail path is not allowed to spend), and there is nothing for {@link
 * paneReadRange} to read yet. It has since become the answer for every page,
 * not only the first: a *served* range is a fact about the instant that read
 * landed, and goes stale the moment a single `'refresh'` or `'frame'` fold
 * runs afterwards and evicts a paged-in line off the top to hold the window
 * at its cap -- the next page asked from that memory targets the span above
 * the line eviction just took, not above where the window now begins, and
 * `foldPaneRead` prepends it there anyway (a `'rangePage'` shares no text
 * with the window by construction, so it has no overlap to notice the gap
 * with). This has no such memory to go stale: `total = max_offset_from_bottom
 * + viewport_rows` ({@link terminalScrollbackRows}) is the pane's own account
 * of how long it is *as of this call*, and `currentLimit` is how many
 * trailing lines the window is held to -- once a page has been pulled the
 * window sits at exactly that many lines, so `total - currentLimit` is the
 * absolute line it begins at whether this is the first call or the
 * hundredth. Feed that into {@link nextPageRange} and every page, not only
 * the first, falls out of the same live formula.
 *
 * `terminalViewportRows` is asked too, and required, though only `total`
 * (which already folds `viewport_rows` in) is used arithmetically --
 * `terminalScrollbackRows` already needs both underlying fields to answer at
 * all, so this adds no live number of its own. It is kept as an explicit,
 * literal reading of "use them [both]; if either is unavailable, fall back"
 * rather than a silent reliance on one function's internals. `null` -- seed
 * nothing, fall back to the last served range and then to the widening-tail
 * request -- wherever either metric is missing.
 */
export function seedPageRange(scroll: unknown, currentLimit: number): { start: number } | null {
  const total = terminalScrollbackRows(scroll);
  const viewport = terminalViewportRows(scroll);
  if (total === null || viewport === null) return null;
  return { start: Math.max(0, total - currentLimit) };
}

function trimTerminalWindow(output: string, maximumLines: number): string {
  return terminalLines(output).slice(-Math.max(1, maximumLines)).join('\n');
}

function terminalLines(output: string): string[] {
  const lines = output.replace(/\r\n|\r/gu, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * How many rows of scrollback Herdr says this pane holds, or `null` where the
 * gateway did not report it.
 *
 * Exported because it is the one honest answer to "is there more above this
 * window", and the raw view is not the only view that has to ask: the chat view
 * pages the same pane through a different endpoint and must use the same
 * metric, or the two views disagree about when history has run out.
 */
/**
 * How many rows of this pane are the live screen, off the same metric.
 *
 * This is what separates a ring window's history from the screen at its tail:
 * a full-screen program repaints exactly its viewport, so the last
 * `viewport_rows` rows of whatever window the gateway serves are the program's
 * screen and everything above them is kept history. `null` where the gateway
 * did not say, which downstream must treat as "the whole window is screen" --
 * the world before the ring buffer existed.
 */
export function terminalViewportRows(scroll: unknown): number | null {
  if (!scroll || typeof scroll !== 'object' || Array.isArray(scroll)) return null;
  const value = (scroll as Record<string, unknown>).viewport_rows;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}

/**
 * Whether this pane's program has taken the whole screen, off the same metric.
 *
 * tmux's `#{alternate_on}`. This is the *surface* question -- does the program
 * paint a rectangle it believes is entirely its own -- and it is true of an
 * editor and of an agent alike.
 *
 * Deliberately not the same question as "is this an editor", which is
 * `isFullScreenTuiPane` on the pane's `foreground_command`. Card #795 measured
 * `alternate_on` at 1 for nvim *and* for claude, so one predicate cannot answer
 * both: the editor one decides the key row and the mode, this one decides what
 * the surface is. Using the editor predicate for the surface is what left an
 * agent's pane sliding under the floating header.
 *
 * `null` where the gateway did not say, which downstream must read as "we do
 * not know" rather than as `false` -- an older gateway sends no such field, and
 * against one of those the caller keeps whatever it did before this existed.
 */
export function terminalOwnsScreen(scroll: unknown): boolean | null {
  if (!scroll || typeof scroll !== 'object' || Array.isArray(scroll)) return null;
  const value = (scroll as Record<string, unknown>).alternate_on;
  return typeof value === 'boolean' ? value : null;
}

export function terminalScrollbackRows(scroll: unknown): number | null {
  if (!scroll || typeof scroll !== 'object' || Array.isArray(scroll)) return null;
  const value = scroll as Record<string, unknown>;
  const maximumOffset = value.max_offset_from_bottom;
  const viewportRows = value.viewport_rows;
  if (
    typeof maximumOffset !== 'number'
    || !Number.isFinite(maximumOffset)
    || maximumOffset < 0
    || typeof viewportRows !== 'number'
    || !Number.isFinite(viewportRows)
    || viewportRows < 0
  ) return null;
  return Math.floor(maximumOffset) + Math.floor(viewportRows);
}

/**
 * Longest prefix of `head` that is also a suffix of `tail` -- the number of
 * lines the incoming window re-sends from the tail of what we already have.
 *
 * The old loop tried every overlap size and compared it line by line, which is
 * O(n * m) on two ~2000-line windows. This is the KMP failure-function trick:
 * run the prefix function over `head + SENTINEL + tail` and read the border at
 * the end. The sentinel (a unique object that equals no line string) stops any
 * match from crossing the seam, so the border can only be a prefix of `head`
 * that is a suffix of `tail`. O(n + m), one pass, no per-size rescan.
 */
function longestPrefixThatIsSuffix(head: string[], tail: string[]): number {
  const sentinel = {};
  const sequence: (string | object)[] = [...head, sentinel, ...tail];
  const failure = new Int32Array(sequence.length);
  let length = 0;
  for (let index = 1; index < sequence.length; index += 1) {
    while (length > 0 && sequence[index] !== sequence[length]) length = failure[length - 1];
    if (sequence[index] === sequence[length]) length += 1;
    failure[index] = length;
  }
  // The final border cannot exceed head.length (the sentinel blocks it), so it
  // is already the overlap we want.
  return failure[sequence.length - 1];
}
