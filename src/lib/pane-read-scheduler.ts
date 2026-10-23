/**
 * When to read a pane whose screen is followed for a one-line summary (the
 * Home Stage subtitle), as a pure step function so its failure modes can be
 * tested without timers or a gateway.
 *
 * The best source is no read at all: the session's event feed can carry the
 * pane's screen itself (`stream_pane`), sampled on the computer and sent only
 * when it changes. While those frames flow (`streaming`) the pane is never
 * read. Otherwise it is read:
 *
 *  - on a hint that it changed -- a `pane_updated` for it, or a feed
 *    (re)connecting, since what printed while it was down went unheard --
 *    one read at a time, the hints heard during a read coalesced into one
 *    read after it, and reads at least `minGapMs` apart;
 *  - and every `pollMs` regardless. Herdr coalesces `pane_updated` and its
 *    revision, which can stand still for minutes while a working agent's
 *    screen changes every second, so a hint never replaces the poll.
 *
 * A read that never settles is given up after `stuckMs`, so one wedged request
 * cannot stop the reads for good. The driver calls `paneReadStep` with each
 * event and the current time, starts the read it names (if any), and arranges
 * a `tick` at `wakeAtMs` (if any).
 */

/**
 * Hinted reads start at least this far apart. A read and its parse take
 * ~0.1-0.3 s, so a hinted change reaches the subtitle within about a second,
 * while a pane printing constantly costs at most one read a second.
 */
export const PANE_READ_MIN_GAP_MS = 1_000;
/** While the screen is not streamed: how often the pane is read regardless. */
export const PANE_READ_POLL_MS = 4_500;
/** A read still running after this long is given up and another may start. */
export const PANE_READ_STUCK_MS = 10_000;

export type PaneReadTiming = { minGapMs: number; pollMs: number; stuckMs: number };

const TIMING: PaneReadTiming = {
  minGapMs: PANE_READ_MIN_GAP_MS,
  pollMs: PANE_READ_POLL_MS,
  stuckMs: PANE_READ_STUCK_MS,
};

export type PaneReadState = {
  /** The feed carries the pane's screen: nothing is read. */
  streaming: boolean;
  /** A change was hinted since the last read began. */
  dirty: boolean;
  /** The read in flight, if any. */
  reading: { id: number; startedAtMs: number } | null;
  /** The newest read started: only its answer is worth showing. */
  latest: number;
  lastStartedAtMs: number;
};

export type PaneReadEvent =
  | { type: 'changed' }
  | { type: 'connected' }
  | { type: 'streaming'; on: boolean }
  | { type: 'settled'; id: number }
  | { type: 'tick' };

export type PaneReadPlan = {
  state: PaneReadState;
  /** Start this read now. */
  read?: number;
  /** Send a `tick` at this time; absent when nothing is due without an event. */
  wakeAtMs?: number;
};

/** Before anything is known: the first read is due at once. */
export function initialPaneReadState(): PaneReadState {
  return {
    streaming: false,
    dirty: true,
    reading: null,
    latest: 0,
    lastStartedAtMs: Number.NEGATIVE_INFINITY,
  };
}

function apply(state: PaneReadState, event: PaneReadEvent): PaneReadState {
  switch (event.type) {
    case 'changed':
    case 'connected':
      return { ...state, dirty: true };
    case 'streaming':
      if (event.on === state.streaming) return state;
      // Frames stopped: what changed since the last one went unseen.
      return event.on ? { ...state, streaming: true } : { ...state, streaming: false, dirty: true };
    case 'settled':
      // A read given up as stuck may still answer; the one in flight is another.
      return state.reading?.id === event.id ? { ...state, reading: null } : state;
    case 'tick':
      return state;
  }
}

export function paneReadStep(
  previous: PaneReadState,
  event: PaneReadEvent,
  nowMs: number,
  timing: PaneReadTiming = TIMING
): PaneReadPlan {
  let state = apply(previous, event);
  if (state.reading) {
    const giveUpAtMs = state.reading.startedAtMs + timing.stuckMs;
    if (nowMs < giveUpAtMs) return { state, wakeAtMs: giveUpAtMs };
    // Stuck: what it would have read is read again.
    state = { ...state, reading: null, dirty: true };
  }
  if (state.streaming) return { state };
  const dueAtMs = state.lastStartedAtMs + (state.dirty ? timing.minGapMs : timing.pollMs);
  if (nowMs < dueAtMs) return { state, wakeAtMs: dueAtMs };
  const id = state.latest + 1;
  return {
    state: {
      ...state,
      dirty: false,
      reading: { id, startedAtMs: nowMs },
      latest: id,
      lastStartedAtMs: nowMs,
    },
    read: id,
    wakeAtMs: nowMs + timing.stuckMs,
  };
}
