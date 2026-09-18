/**
 * Getting a font, as a value a row can draw.
 *
 * Installing a font is not one wait. It is a request that has not answered
 * yet, then bytes arriving (sometimes against a known total and sometimes
 * not), then three checks that each read the whole file, then the registration
 * that makes the face reachable by name. Until this module existed the sheet
 * drew exactly one of those -- a bar, and only when the server had sent a
 * `Content-Length` -- so a reader who pasted a GitHub raw link, which streams
 * chunked, watched a row do nothing at all for eleven seconds and then change
 * its title.
 *
 * So the phases are named, and the rules about them are here rather than in
 * the component: a row that happens to be on screen is a bad place to keep the
 * one invariant this has, which is that the sequence never runs backwards.
 * Three things push events at it from three different threads of control --
 * the native download's progress callback, the checks in `user-fonts.ts`, and
 * the sheet's own registration step -- and any of them can arrive late. A
 * progress callback that lands after the sniff has started must not drag the
 * label back to "Downloading", and a bar that animates towards a smaller
 * number reads as the install undoing itself.
 *
 * `null` is the whole of "nothing is happening", and every ending -- done and
 * then settled, cancelled, failed -- returns to it. A late callback from a run
 * that is over therefore finds `null` and changes nothing, which is the same
 * invariant stated once more for the case where the run has already ended.
 *
 * Pure, and free of React Native, so `__tests__/font-install-phase.test.ts`
 * can put a whole install through it without a device.
 */

/**
 * The named steps, in the order a reader meets them.
 *
 * `connecting` and `copying` are the same beat for the two ways in: a request
 * with no answer yet, and a picked file being copied out of the system's
 * temporary inbox. They are separate words because they are different waits --
 * one is the network and one is the disk -- and a reader who picked a file off
 * their own device should not be told the app is connecting to something.
 *
 * `checking` covers the three tests in `acceptStagedFont`: the size cap, the
 * four-byte signature sniff, and the Skia parse that also measures the
 * advances. One name for the three because they are one wait from the outside,
 * and naming the sniff separately would put a word on screen for 4 ms.
 *
 * `registering` is `Font.loadAsync`, which is the step that actually changes
 * what the app draws with.
 */
export type FontInstallPhase =
  | 'connecting'
  | 'downloading'
  | 'copying'
  | 'checking'
  | 'registering'
  | 'done';

/**
 * How far through a run each phase is.
 *
 * `connecting` and `copying` share a rank because they are alternative first
 * beats rather than two steps in one sequence: no run has both.
 */
const PHASE_RANK: Record<FontInstallPhase, number> = {
  connecting: 0,
  copying: 0,
  downloading: 1,
  checking: 2,
  registering: 3,
  done: 4,
};

/** Which of the two ways in produced this run. */
export type FontInstallKind = 'download' | 'import';

/** A run in flight: what it is doing, and how much of it has arrived. */
export type FontInstallState = {
  kind: FontInstallKind;
  phase: FontInstallPhase;
  /**
   * Bytes on disk so far. Monotonic, and kept even once the transfer is over
   * so the trailing text can still say how big the thing was while it is
   * being checked.
   */
  receivedBytes: number;
  /** `null` where the server sent no `Content-Length`, which is common. */
  totalBytes: number | null;
};

/**
 * Everything that can happen to a run.
 *
 * `failed` and `cancelled` are separate events for the same result because the
 * caller distinguishes them -- a cancel is the reader's own decision and draws
 * no error sentence -- and a reducer that collapsed them here would make the
 * call site work that out twice.
 */
export type FontInstallEvent =
  | { kind: 'start'; mode: FontInstallKind }
  | { kind: 'bytes'; bytesWritten: number; totalBytes: number | null }
  | { kind: 'step'; phase: FontInstallPhase }
  | { kind: 'done' }
  | { kind: 'failed' }
  | { kind: 'cancelled' };

/**
 * The next state, or the same object when the event changes nothing.
 *
 * Identity matters: this drives React state, and a progress callback that
 * fires sixty times a second with the same two numbers should not re-render
 * the sheet sixty times.
 */
export function advanceFontInstall(
  state: FontInstallState | null,
  event: FontInstallEvent
): FontInstallState | null {
  if (event.kind === 'start') {
    return {
      kind: event.mode,
      phase: event.mode === 'download' ? 'connecting' : 'copying',
      receivedBytes: 0,
      totalBytes: null,
    };
  }

  // A run that has ended is not restarted by something that arrives late.
  if (!state) return null;

  switch (event.kind) {
    case 'failed':
    case 'cancelled':
      return null;

    case 'done':
      return state.phase === 'done' ? state : { ...state, phase: 'done' };

    case 'step': {
      if (PHASE_RANK[event.phase] <= PHASE_RANK[state.phase]) return state;
      return { ...state, phase: event.phase };
    }

    case 'bytes': {
      // The transfer is over: the checks have started, and a progress callback
      // still in flight is describing a past the reader has moved on from.
      if (PHASE_RANK[state.phase] > PHASE_RANK.downloading) return state;
      const receivedBytes = Math.max(state.receivedBytes, Math.max(0, event.bytesWritten));
      const totalBytes =
        typeof event.totalBytes === 'number' && event.totalBytes > 0 ? event.totalBytes : null;
      if (
        state.phase === 'downloading' &&
        state.receivedBytes === receivedBytes &&
        state.totalBytes === totalBytes
      ) {
        return state;
      }
      return { ...state, phase: 'downloading', receivedBytes, totalBytes };
    }
  }
}

/**
 * What the bar under the row should be: a fraction, or a segment travelling.
 *
 * The one decision the component would otherwise make inline, and the one most
 * worth testing -- "no total" is the case the old row got wrong by drawing
 * nothing, and it is reached by the most ordinary link a reader can paste.
 *
 * `done` is determinate at full whatever the run knew about its size, because
 * the last thing the bar does is fill. A travelling segment that simply
 * vanished would end the wait without ever saying it succeeded.
 */
export type FontInstallBar =
  | { mode: 'determinate'; completed: number; total: number }
  | { mode: 'indeterminate' };

export function fontInstallBar(state: FontInstallState): FontInstallBar {
  if (state.phase === 'done') {
    const total = state.totalBytes ?? 1;
    return { mode: 'determinate', completed: total, total };
  }
  if (state.phase === 'downloading' && state.totalBytes !== null) {
    return {
      mode: 'determinate',
      completed: Math.min(state.receivedBytes, state.totalBytes),
      total: state.totalBytes,
    };
  }
  return { mode: 'indeterminate' };
}

/** The percentage to put beside the phase name, or `null` when there is none. */
export function fontInstallPercent(state: FontInstallState): number | null {
  const bar = fontInstallBar(state);
  if (bar.mode !== 'determinate') return null;
  return Math.round((bar.completed / bar.total) * 100);
}

/**
 * Whether the reader can still stop this.
 *
 * Only a download, and only while the bytes are still moving. Past that the
 * work is local, measured in a few hundred milliseconds, and a Cancel that
 * appears and disappears in that time is a control nobody can hit on purpose.
 */
export function fontInstallCancellable(state: FontInstallState): boolean {
  return state.kind === 'download' && PHASE_RANK[state.phase] <= PHASE_RANK.downloading;
}
