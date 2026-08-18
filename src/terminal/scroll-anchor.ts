import type { TerminalLine } from '@/terminal/types';

/**
 * Keeping the reader's place when the frame underneath them changes shape.
 *
 * The pane is a fixed window over a scrollback the gateway keeps trimming: once
 * the window is full, every new line an agent prints costs one line off the top,
 * and every row the reader is actually looking at moves up by exactly that much.
 * Nothing in the transform knows that, so the content creeps upward under a
 * stationary finger -- slowly during a normal stream, and all at once when a
 * gesture that froze the frame releases into a burst's worth of dropped rows.
 *
 * There is no row id to anchor to: a refresh parses a brand-new emulator, so the
 * only continuity between two frames is what the rows look like. Row signatures
 * (the u32 the chunk planner already computes) are that: a run of them is a
 * fingerprint, and finding where the new frame's top row sits in the old frame
 * is the number of rows that rolled off.
 *
 * Deliberately Skia-free and free of React, so the arithmetic that decides where
 * the reader ends up is testable on its own.
 */

/**
 * Rows of fingerprint matched as a unit.
 *
 * One row is far too weak -- blank rows and repeated prompts collide constantly.
 * Eight consecutive rows of real terminal output is effectively unique, and
 * short enough that it survives the top of the window being close to the end of
 * the search range.
 */
export const TERMINAL_ANCHOR_PROBE_ROWS = 8;

/**
 * How far down the previous frame the probe is searched for -- the largest drop
 * this can recognise.
 *
 * Rows only roll off between two applied frames, and 256 covered the ordinary
 * poll-to-poll gap. What it did not cover is the interaction freeze: a long
 * selection drag or a held scroll on a streaming pane applies nothing until the
 * gesture ends, and then pays for the whole gesture in one frame. A pane
 * printing tens of rows a second held for ten seconds rolls past 256, the
 * probe misses, no compensation is applied, and the parked reader is carried
 * toward the bottom by exactly the missed amount -- once per burst, which on a
 * busy pane reads as the view being dragged back down every time they let go.
 *
 * 2048 rows is the same arithmetic with the freeze priced in. The scan is
 * `search x probe` 32-bit compares (16k at worst), once per applied frame,
 * beside a parse that is orders of magnitude dearer.
 */
export const TERMINAL_ANCHOR_SEARCH_ROWS = 2048;

export type TerminalScrollAnchor = {
  /** Rows in the frame this anchor was taken from. */
  rows: number;
  /** Signatures of the leading rows: the haystack the next frame is found in. */
  leading: Int32Array;
};

/**
 * How many of `lines`, counted from the end, are content rather than the
 * blank tail of a live screen nobody has written to yet.
 *
 * A pane's frame is scrollback plus however much of the live screen the read
 * captured, and the screen is a fixed grid: a shell that just opened has one
 * prompt line and the rest of the pane's rows blank underneath it, and every
 * one of those rows is in `lines` -- nothing upstream trims them. A flat
 * snapshot's frame (`parseTerminalSnapshot`'s fast path) pins its cursor row
 * to the last line the read transmitted, so `buildTerminalFrame`'s own
 * trim-to-cursor never gets to remove the blank rows below the real text,
 * because as far as that trim is concerned the cursor already sits among
 * them. Resting a pane against `lines.length` in that state rests it at the
 * bottom of the blank tail, not at the bottom of the text -- the prompt ends
 * up pinned to the top of the viewport with a screen of nothing underneath.
 *
 * `cells.length === 0` is exactly what `TerminalGrid.buildLine` already means
 * by "nothing was ever written to this row": a blank row is built with no
 * cells at all, not with cells full of spaces, so this needs no threshold of
 * its own -- it agrees with the grid.
 */
export function terminalContentRows(lines: readonly TerminalLine[]): number {
  let blank = 0;
  for (let row = lines.length - 1; row >= 0; row -= 1) {
    if (lines[row].cells.length > 0) break;
    blank += 1;
  }
  return lines.length - blank;
}

export function captureScrollAnchor(lines: readonly TerminalLine[]): TerminalScrollAnchor {
  const kept = Math.min(lines.length, TERMINAL_ANCHOR_SEARCH_ROWS + TERMINAL_ANCHOR_PROBE_ROWS);
  const leading = new Int32Array(kept);
  for (let row = 0; row < kept; row += 1) leading[row] = lines[row].signature | 0;
  return { rows: lines.length, leading };
}

/**
 * How many rows `lines` lost off the top since `previous` was captured.
 *
 * Decided purely by where the new frame's top rows sit in the old one, with no
 * row-count precondition. Row counts look stable in theory -- a full window
 * trims one row for each it gains -- but in practice they wobble by a row
 * whenever a snapshot lands mid-line, and a precondition that says "only when
 * the count matched" silently skips the compensation for exactly those frames
 * and lets the drift back in a burst at a time.
 *
 * The fingerprint is the whole guard, and it is a strict one. Returns 0 whenever
 * the answer is not certain: a top row that is not in the previous frame at all
 * (prepended history, a clear, a pane switch), a fingerprint that matches in
 * more than one place (a screenful of blank rows), or a frame too short to
 * fingerprint. Compensating for a drop that did not happen throws the reader
 * further than the drift it was meant to fix.
 */
export function measureRowsDropped(
  previous: TerminalScrollAnchor,
  lines: readonly TerminalLine[]
): number {
  if (lines.length === 0) return 0;

  const probeRows = Math.min(TERMINAL_ANCHOR_PROBE_ROWS, lines.length);
  const lastOffset = previous.leading.length - probeRows;
  if (lastOffset < 0) return 0;

  let found = -1;
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    let matched = true;
    for (let row = 0; row < probeRows; row += 1) {
      if (previous.leading[offset + row] !== (lines[row].signature | 0)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    // The top row is still the top row: nothing was dropped, and no later match
    // can change that. This is the common case, so it costs one pass of the
    // probe and no scan.
    if (offset === 0) return 0;
    if (found >= 0) return 0;
    found = offset;
  }
  return found > 0 ? found : 0;
}

/**
 * How many rows `lines` gained *above* the top since `previous` was captured,
 * or -1 when the frames cannot be aligned.
 *
 * The dual of {@link measureRowsDropped}, for the one origin that grows a frame
 * upward: a history page prepended by `foldPaneRead`'s `'rangePage'`. The
 * previous frame's top rows are fingerprinted and searched for in the new
 * frame; the offset where they reappear *is* the prepend, exactly, whatever
 * else happened to the frame.
 *
 * That last clause is the reason this exists. The obvious measure --
 * `newLength - oldLength` -- conflates the page that went in above with
 * whatever a live pane printed below while the fetch was in flight. On a
 * streaming pane the tail growth alone can be most of a screen, and a
 * compensation built from the sum overshoots downward by that much; the clamp
 * then parks the reader at the bottom, which is precisely the reported bug: a
 * pull for older history that ends with the newest line on screen.
 *
 * -1, not 0, when the probe is missing or ambiguous: the caller has a fallback
 * (the length delta) that is right for a quiet pane, and "could not tell" must
 * stay distinguishable from "measured zero" for it to know when to reach for
 * it. Ambiguity is judged as in the drop measure -- a probe that matches in
 * two places proves nothing.
 */
export function measureRowsPrepended(
  previous: TerminalScrollAnchor,
  lines: readonly TerminalLine[]
): number {
  const probeRows = Math.min(TERMINAL_ANCHOR_PROBE_ROWS, previous.leading.length);
  if (probeRows === 0 || lines.length < probeRows) return -1;

  const lastOffset = lines.length - probeRows;
  let found = -1;
  for (let offset = 0; offset <= lastOffset; offset += 1) {
    let matched = true;
    for (let row = 0; row < probeRows; row += 1) {
      if ((lines[offset + row].signature | 0) !== previous.leading[row]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    // Unlike the drop measure, a match at offset 0 does not end the scan. There
    // it means "the top row is still the top row" and nothing later can change
    // that; here the whole question is whether the top MOVED, and a probe that
    // also occurs deeper down -- a blank screen, a run of identical log lines --
    // makes offset 0 one candidate among several, not an answer. This runs once
    // per history page, not per frame, so the full scan costs nothing that
    // matters.
    if (found >= 0) return -1;
    found = offset;
  }
  return found;
}

/**
 * The highest a pane may be dragged: how far down the first row sits once the
 * reader has scrolled all the way back.
 *
 * Zero for an ordinary pane, whose first row belongs against the top edge. A
 * full-screen editor passes the height of the floating header, because its first
 * row is the one being read rather than the oldest thing it printed, and
 * edge-to-edge chrome would otherwise sit on top of it. `max(0, minimumY)` --
 * what this was before the inset existed -- is the same expression at
 * `topInset = 0`, so nothing about a scrolling pane changed.
 */
export function terminalTopStop(minimumY: number, topInset: number): number {
  'worklet';
  return Math.max(topInset, minimumY);
}

/**
 * The lowest a pane may be dragged.
 *
 * `minimumY` (`visibleHeight - contentHeight`) for every pane that prints, and
 * that is the whole of it: a stream's last line belongs against the bottom
 * edge, and dragging it above that edge would open a gap under output that has
 * more of itself coming.
 *
 * A pane that owns its screen is the one case where the bottom edge is not the
 * floor, and the reason is that its content can be SHORTER than the viewport.
 * A screen is a fixed rectangle the program repaints: an 80x24 pane -- which is
 * every session this app opens, tmux's own `default-size` -- is 24 rows tall on
 * a phone with room for forty. `minimumY` is then positive, `terminalTopStop`
 * collapses the range onto it, and the single legal position sits the editor's
 * whole screen against the bottom of the pane with half a screen of empty
 * background above it. That is what the report on card #832 looked like, and no
 * gesture could move it, because there was nowhere legal to move it to.
 *
 * So a screen-owning pane's floor is wherever `terminalRestOffset` needs to
 * put the top of its live screen. Below `minimumY` is not "past the end" for
 * such a pane: the blank it opens underneath is the part of the viewport the
 * program is not drawing into, which is the truth about a screen that does not
 * fill the phone. The blank can never run away either -- the two differ by
 * `visibleHeight - topInset - screenHeight`, which is bounded by the viewport.
 */
export function terminalBottomStop(
  minimumY: number,
  topInset: number,
  historyHeight = 0
): number {
  'worklet';
  if (topInset <= 0) return minimumY;
  return Math.min(minimumY, topInset - Math.max(0, historyHeight));
}

/**
 * Where a pane comes to rest when nothing is holding it.
 *
 * A stream rests at the bottom, following its last line -- that is `minimumY`,
 * and it is the whole story for every pane that prints. A full-screen editor
 * paints a fixed screen and has no last line to follow, so it rests with the
 * screen's first row against the inset instead: the top is the part of a TUI
 * worth anchoring, and it is the part the header was covering.
 *
 * `historyHeight` is how much content sits ABOVE that screen -- the gateway's
 * ring buffer keeps what a zero-scrollback pane showed, so the window an
 * editor pane renders is `[history] + [screen]` and the screen's first row is
 * no longer the content's first row. Anchoring the content top (what this did
 * when the two were the same row) rested the pane on the OLDEST kept frame: a
 * stale screen at rest, and every follow ease went there (card #675). At
 * `historyHeight = 0` this is exactly the old expression, which is the world
 * without a ring buffer.
 *
 * The floor is `terminalBottomStop`, not `minimumY`. Flooring at `minimumY`
 * said "a screen may never rest above the bottom edge", which is only true of
 * content taller than the viewport; for the 24-row screen in a forty-row pane
 * it overrode this whole expression with the bottom edge and produced card
 * #832. See that function for why below the bottom edge is a real position for
 * a pane whose program draws a rectangle rather than a stream.
 */
export function terminalRestOffset(
  minimumY: number,
  topInset: number,
  historyHeight = 0
): number {
  'worklet';
  if (topInset <= 0) return minimumY;
  return Math.max(
    terminalBottomStop(minimumY, topInset, historyHeight),
    topInset - Math.max(0, historyHeight)
  );
}

/**
 * The pane's scroll offset, clamped to its content.
 *
 * The terminal grows upward from the bottom, so the resting offset is
 * `visibleHeight - contentHeight`: negative once the output is taller than the
 * viewport and positive while it is still short. The upper bound is
 * `terminalTopStop` rather than 0 so the short case, where the whole content
 * fits and `minimumY` is the only legal position, does not collapse to an empty
 * range; the lower bound is `terminalBottomStop` rather than `minimumY` so the
 * one pane whose rest sits below the bottom edge -- a screen shorter than the
 * viewport -- can actually reach it.
 */
export function clampScrollOffset(
  offset: number,
  minimumY: number,
  topInset = 0,
  historyHeight = 0
): number {
  'worklet';
  return Math.max(
    terminalBottomStop(minimumY, topInset, historyHeight),
    Math.min(terminalTopStop(minimumY, topInset), offset)
  );
}

/**
 * How far past the top stop this drag is asking to go -- positive once the
 * pane would be dragged beyond `topStop` if nothing clamped it, and the signal
 * the "pull for earlier output" gesture is built on.
 *
 * Deliberately independent of where the *gesture* started. An earlier version
 * gated the pull on `gestureStartY >= -1` -- true only when the drag begins
 * already at rest against the stop -- which meant a reader who starts mid-scroll
 * and drags straight through the top in one continuous motion never has a
 * `gestureStartY` at rest: that check never opened, and the extra drag past the
 * clamp was silently absorbed as a no-op hold at the top. No pull, no
 * affordance, no request, however hard they kept pulling -- the only way to
 * trigger it was to release and start a second, separate gesture already
 * sitting at the stop.
 *
 * Comparing the unclamped candidate position (`gestureStartY + translationY`)
 * to the stop instead answers "how far past the top is this drag asking to go"
 * fresh on every frame, true the instant the drag crosses the boundary whether
 * that happens on the gesture's first frame (already resting at the top, the
 * pre-existing case, where `gestureStartY` equals `topStop` and this reduces to
 * plain `translationY`) or its fiftieth (scrolled up into it just now).
 */
export function terminalPullOvershoot(
  gestureStartY: number,
  translationY: number,
  topStop: number
): number {
  'worklet';
  return gestureStartY + translationY - topStop;
}

/**
 * How far from the resting anchor a reader still counts as following it.
 *
 * A fling that stops within a couple of lines of the anchor was aimed at the
 * anchor; anything further off is somebody reading on their own.
 */
export const TERMINAL_FOLLOW_SLACK = 42;

/**
 * Whether a pane at `offset` is still following its output.
 *
 * Distance from the resting anchor, in both directions -- and the second
 * direction is the whole point, because the first one on its own is what made
 * a pane spring back under the reader's thumb (card #828).
 *
 * For every pane that prints, `restOffset` IS `minimumY`: the lowest offset the
 * clamp allows. `offset` can then only ever be at or above it, `|offset - rest|`
 * is just `offset - rest`, and this is exactly the one-sided test it replaces --
 * asserted as a property in the tests, not merely asserted here.
 *
 * A screen-owning pane is where the two part company. It rests on the top of
 * its live screen rather than on its last line, so the anchor sits above the
 * bottom by however much the screen plus the header it clears overflows the
 * viewport:
 *
 *     restOffset - minimumY = topInset + screenHeight - visibleHeight
 *
 * On a phone that is routinely a couple of hundred points -- measured live at
 * 160pt with the ordinary dock, and far more once the key row, the pane strip,
 * an approval banner or the on-screen keyboard takes its cut of the viewport,
 * since every one of those shrinks `visibleHeight` and widens the gap by the
 * same amount. The old predicate asked only "is the offset at or below the
 * anchor", which is true across that entire overflow and everything below it,
 * so a reader dragging inside it was re-classified as following on every frame
 * of the drag: the follow ease then pulled the pane back to the anchor while
 * their finger was still on the glass. Scrolling a full-screen agent or editor
 * pane was impossible, and it read -- correctly -- as the dock being to blame.
 *
 * Being below the anchor is not "watching the screen from further down": on a
 * pane whose screen does not fit, it is the only way to read the screen's own
 * tail, and it is a position the reader chose. Following means being where the
 * pane puts itself, which is the anchor, and nowhere else.
 */
export function terminalFollowsOutput(offset: number, restOffset: number): boolean {
  'worklet';
  return Math.abs(offset - restOffset) <= TERMINAL_FOLLOW_SLACK;
}

/** A debt this small is not worth easing: below it, the caller assigns. */
const FOLLOW_STEP_ROWS = 2;
const FOLLOW_MAXIMUM_MS = 220;
const FOLLOW_MS_PER_ROW = 26;

/**
 * How long a follower's one-off catch-up to the bottom should take, or `0` for
 * "do not animate this, put the pane there".
 *
 * ## Only a debt is eased, never a step
 *
 * This used to answer for every applied frame, and returned 90ms for the
 * ordinary one- or two-row step. That is what made a streaming pane judder for
 * the whole time an agent was printing, and only then.
 *
 * The arithmetic: applied frames are throttled to one per
 * `TERMINAL_APPLIED_FRAME_MS` (`use-coalesced-value.ts`), and an agent printing
 * fast puts far more than two rows into one of those windows -- that burst is
 * the reason the throttle exists. So the duration was routinely `rows * 26`,
 * which is longer than the window, and the next frame landed while the ease was
 * still running. `withTiming` does not retarget: it cancels and starts again,
 * from wherever it had reached, over a distance measured from that partial
 * position. The pane never arrived, and re-eased ten times a second.
 *
 * It also fed itself. Being behind made the next frame's measured debt larger,
 * which made its duration longer, which put it further behind, until it pinned
 * at the cap and stayed there.
 *
 * A followed pane does not need an animation to scroll. The content is what
 * moves: rows arrive, the bottom moves down, and pinning the offset to it *is*
 * the scroll. So the ordinary step returns `0` here and the caller assigns.
 *
 * ## What the ease is still for
 *
 * The one case that is a genuine jump rather than a step: the frame that clears
 * an interaction freeze pays for everything the agent printed during the whole
 * gesture at once. Landing that instantly, right where the reader has just
 * lifted their finger, is the lurch this function was written for -- one swipe,
 * one jump, which is what made flicking through a live pane nauseating.
 *
 * That case is one-off, so it may outlast a frame interval without restarting:
 * the caller does not start a second ease over an ease already in flight.
 *
 * The duration therefore still grows with the debt and still stops at a fifth
 * of a second -- far enough to read as the page sliding, short enough that the
 * pane is not visibly chasing anything.
 */
export function followCatchUpDurationMs(distance: number, lineHeight: number): number {
  const rows = Math.abs(distance) / Math.max(1, lineHeight);
  if (rows <= FOLLOW_STEP_ROWS) return 0;
  return Math.min(FOLLOW_MAXIMUM_MS, Math.round(rows * FOLLOW_MS_PER_ROW));
}

/**
 * How often the grid applies a new snapshot, in milliseconds.
 *
 * Lives here rather than as `useCoalescedValue`'s default because the follow
 * behaviour above is reasoned against it: an animation started per applied
 * frame and lasting longer than this interval is one that restarts before it
 * lands. The coalescer is a generic hook; this is the terminal's cadence, and
 * the terminal passes it in so the two cannot drift apart in silence.
 */
export const TERMINAL_APPLIED_FRAME_MS = 100;

/**
 * How faint the "pull for earlier output" hint is when nobody is pulling.
 *
 * It used to be nothing at all: the hint's opacity was `pullDistance / 22`, so
 * it was invisible at rest and the only way to find out that a pane had more
 * history was to perform the gesture that loads it. A capability whose only
 * signal is doing it is a capability that reads as removed -- which is exactly
 * how it was reported (card #627). Faint rather than solid because it sits over
 * the output: it is an offer, not a notice.
 */
export const TERMINAL_HISTORY_HINT_REST_OPACITY = 0.42;

/** Pull, in points, at which the hint is fully lit. */
const HISTORY_HINT_REVEAL_DISTANCE = 22;

/**
 * How long the hint stays lit on arrival at a pane before fading out.
 *
 * Long enough to be read once without being looked for, short enough that it is
 * gone before it turns into furniture. The pill is an offer, and an offer that
 * is repeated forever is a nag; the gesture it describes goes on working after
 * it leaves, and pulling brings it straight back.
 */
export const TERMINAL_HISTORY_HINT_INTRO_MS = 2500;

/**
 * The hint's opacity for a given pull.
 *
 * Rests visible, brightens with the drag, and is solid while a page is in
 * flight -- so the three states the reader cares about (there is more, you are
 * asking for it, it is coming) are three different weights of the same pill.
 *
 * Applied from an animated style, hence the worklet; kept here as arithmetic so
 * the resting case can be asserted rather than eyeballed.
 *
 * `intro` is how much of the RESTING weight is still owed: 1 on arrival at a
 * pane, 0 once the pill has said its piece. A label that never leaves is read
 * as chrome rather than as an offer -- it is the same sentence on every pane
 * for as long as you look at it, and a sentence that is always there stops
 * being information. Only the resting term fades, which is the whole design:
 * the drag still lights the pill all the way to solid long after the intro is
 * over, so what the gesture answers with never changes. At `intro = 1` nothing
 * changes at all, which is what the arithmetic below is arranged to show.
 */
export function historyHintOpacity(
  pullDistance: number,
  loading: boolean,
  intro = 1
): number {
  'worklet';
  if (loading) return 1;
  const pulled = Math.max(0, pullDistance) / HISTORY_HINT_REVEAL_DISTANCE;
  // The floor the pill sits at with no finger on it. This is the part that
  // fades away.
  const rest = TERMINAL_HISTORY_HINT_REST_OPACITY * Math.max(0, Math.min(1, intro));
  // And the drag spans whatever is left between that floor and solid, so a
  // full pull is 1 whether the intro is still on screen or long gone.
  return Math.min(1, rest + pulled * (1 - rest));
}
