/**
 * Where the app is in one session's event sequence, and whether it owes a
 * catch-up it could not make yet.
 *
 * Two facts, and both of them were bugs before they were a module.
 *
 * The **sequence** was assigned from the snapshot -- `lastSeq = snap.seq` --
 * rather than raised to it. A snapshot is a request, and a request can answer
 * after the stream has already delivered frames past the point it describes;
 * assigning then walked the marker *backwards*, and the next catch-up asked for
 * a stretch of history it already had.
 *
 * The **debt** did not exist at all. `catchUp` no-ops while the marker is zero,
 * which is correct -- there is nothing to catch up from -- but on entry the
 * stream connects before the snapshot lands, so the connect-time catch-up hit
 * exactly that case and was dropped on the floor. Everything the gateway
 * emitted between the snapshot being taken and the stream's first frame was
 * then lost until the reader left the screen and came back. Asking too early
 * now leaves a debt, and the snapshot pays it.
 *
 * Pure, and therefore testable: the workbench keeps one of these in a ref.
 */
export interface CatchUpState {
  /** The highest sequence number seen for this session. */
  seq: number;
  /** A catch-up was asked for before there was anywhere to ask from. */
  owed: boolean;
}

export const CATCH_UP_START: CatchUpState = Object.freeze({ seq: 0, owed: false });

/** The highest sequence seen. A late answer never rewinds it. */
export function advanceSeq(state: CatchUpState, seq: number): CatchUpState {
  if (!Number.isFinite(seq) || seq <= state.seq) return state;
  return { seq, owed: state.owed };
}

/**
 * A request to fill the gap -- a stream (re)connect, or a return to the
 * foreground.
 *
 * `from` is the sequence to ask the gateway from, or `null` when there is
 * nothing to ask from yet, in which case the debt is remembered and the next
 * snapshot pays it.
 */
export function askCatchUp(state: CatchUpState): { state: CatchUpState; from: number | null } {
  if (state.seq > 0) {
    return { state: state.owed ? { seq: state.seq, owed: false } : state, from: state.seq };
  }
  return { state: state.owed ? state : { seq: state.seq, owed: true }, from: null };
}

/**
 * A snapshot landed at `seq`. Raises the marker, and pays an owed catch-up once
 * -- `from` is the sequence to ask from, or `null` when nothing was owed.
 */
export function snapshotSettled(
  state: CatchUpState,
  seq: number
): { state: CatchUpState; from: number | null } {
  const next = advanceSeq(state, seq);
  if (!next.owed) return { state: next, from: null };
  return { state: { seq: next.seq, owed: false }, from: next.seq > 0 ? next.seq : null };
}
