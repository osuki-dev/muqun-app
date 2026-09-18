/**
 * The follow state of the transcript, held outside React's render.
 *
 * `onScroll` fires on every frame of every drag. While the two facts it
 * produces -- is the reader at the end, and how much has landed under them --
 * lived in `useState` on the workbench, each of those frames re-rendered the
 * whole screen: the composer, the header, the sheets, the footer, and the
 * element tree of the list itself. Measured on a 200-row session, a six-drag
 * scroll re-rendered `AgentWorkbench` three times at an average of 26ms and a
 * worst case of 52ms -- three frames' worth of main-thread work handed to the
 * gesture that could least afford it.
 *
 * Nothing about those two facts is the workbench's business. Exactly one view
 * reads them, the jump-to-latest pill, so they are kept here and that pill
 * subscribes. A scroll now costs a comparison and, when the answer has
 * actually changed, one render of a pill.
 *
 * The store is deliberately dumb: no timers, no scheduling, no React. It is
 * the state machine for the affordance and nothing else, which is what makes
 * it testable without a device.
 */

import {
  isAtBottom,
  showJumpToLatest,
  TRANSCRIPT_START,
  unseenBelow,
  type ScrollGeometry,
  type TranscriptMark,
} from './transcript-scroll';

/** What the pill needs to know, and all it needs to know. */
export interface TranscriptFollowState {
  /** Whether the reader is level with the end of the transcript. */
  atBottom: boolean;
  /** How many rows have landed under them since they last were. */
  unseen: number;
  /** Whether the way back should be offered at all. */
  visible: boolean;
}

/** Level with the end, nothing waiting: where every transcript starts. */
const INITIAL: TranscriptFollowState = Object.freeze({
  atBottom: true,
  unseen: 0,
  visible: false,
});

export interface TranscriptFollow {
  /** The reader moved. */
  setGeometry(geometry: ScrollGeometry): void;
  /** The transcript changed. */
  setMark(mark: TranscriptMark): void;
  /** A different session, or the end reached deliberately. */
  reset(): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): TranscriptFollowState;
}

function derive(atBottom: boolean, unseen: number): TranscriptFollowState {
  return { atBottom, unseen, visible: showJumpToLatest(atBottom, unseen) };
}

export function createTranscriptFollow(): TranscriptFollow {
  let state = INITIAL;
  /** The transcript as it stood when the reader was last level with its end. */
  let seen: TranscriptMark = TRANSCRIPT_START;
  /** The transcript as it stands now. */
  let current: TranscriptMark = TRANSCRIPT_START;
  const listeners = new Set<() => void>();

  /*
    The identity of the snapshot is the contract `useSyncExternalStore` is
    built on: returning a fresh object for an unchanged state is an infinite
    render loop, not a wasted allocation. So the object is replaced only when
    one of its fields actually differs, and `getSnapshot` is otherwise a
    property read.
  */
  const commit = (next: TranscriptFollowState) => {
    if (
      next.atBottom === state.atBottom &&
      next.unseen === state.unseen &&
      next.visible === state.visible
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  };

  /*
    Being at the end *is* having seen it. Folding that in here rather than in
    an effect is what lets the reader reach the bottom and have the button
    clear itself without a tap, and without a render to decide it.
  */
  const recompute = (atBottom: boolean) => {
    if (atBottom) {
      seen = current;
      commit(derive(true, 0));
      return;
    }
    commit(derive(false, unseenBelow(seen, current)));
  };

  return {
    setGeometry(geometry) {
      recompute(isAtBottom(geometry));
    },
    setMark(mark) {
      current = mark;
      recompute(state.atBottom);
    },
    reset() {
      seen = current;
      commit(INITIAL);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return state;
    },
  };
}
