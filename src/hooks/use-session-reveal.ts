import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import type { LegendListRef } from '@legendapp/list/react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { revealRowKey } from '@/lib/session-search';
import { SESSION_REVEAL_TTL_MS, useSessionReveal } from '@/stores/session-reveal';
import type { AgentTranscriptStore } from '@/stores/agent-transcript';

/**
 * How many pages of older history a reveal may pull before it settles for
 * the newest page. A hit deep in a long session is still opened; the reader
 * is just not dragged through a minute of paging to reach it.
 */
const MAX_REVEAL_PAGES = 6;

/** Lets the list land on the opened session's newest page before moving. */
const REVEAL_SETTLE_MS = 120;

/**
 * Takes a search hit's reveal request for the session on screen: finds the
 * row, pages older history in when it is not loaded (bounded), scrolls it to
 * the upper third of the viewport and briefly marks it.
 *
 * The workbench re-renders once when a request for its session arrives and
 * once when it is let go; finding the row follows the transcript store
 * directly, so neither the workbench nor the list re-renders as it looks.
 */
export function useSessionRevealRequest({
  serverId,
  asid,
  ready,
  store,
  listRef,
  loadingEarlier,
  canLoadEarlier,
  loadEarlier,
  showFrom,
}: {
  serverId: string;
  asid: string | undefined;
  /** The session's snapshot is on screen. */
  ready: boolean;
  store: AgentTranscriptStore;
  listRef: RefObject<LegendListRef | null>;
  loadingEarlier: boolean;
  canLoadEarlier: boolean;
  loadEarlier: () => void;
  /** Widens the drawn window to start at this canonical timeline index. */
  showFrom: (index: number) => void;
}) {
  const request = useSessionReveal((state) =>
    state.pending?.serverId === serverId && state.pending.asid === asid ? state.pending : null
  );
  const reducedMotion = useReducedMotion();
  const paged = useRef<{ request: object | null; pages: number }>({ request: null, pages: 0 });
  const pageEarlier = useEffectEvent(() => {
    if (!canLoadEarlier) return false;
    loadEarlier();
    return true;
  });
  const widen = useEffectEvent((index: number) => showFrom(index));
  const scrollTo = useEffectEvent((index: number) => {
    void listRef.current?.scrollToIndex({
      index,
      animated: !reducedMotion,
      viewPosition: 0.3,
    });
  });
  useEffect(() => {
    if (!request || !ready || loadingEarlier) return;
    const settle = () => useSessionReveal.getState().settle(request);
    if (Date.now() - request.atMs > SESSION_REVEAL_TTL_MS) {
      settle();
      return;
    }
    if (paged.current.request !== request) paged.current = { request, pages: 0 };
    const reveal = (): boolean => {
      const state = store.getState();
      const key = revealRowKey(state.keys, state.rows, request.itemId, request.messageId);
      if (!key) return false;
      settle();
      // Not cancelled with this effect: settling is what ends it. The list
      // first lands on the session's newest page; the move follows that.
      setTimeout(() => {
        const index = store.getState().keys.indexOf(key);
        if (index < 0) return;
        scrollTo(index);
        store.getState().flashRow(key);
      }, REVEAL_SETTLE_MS);
      return true;
    };
    if (reveal()) return;
    const state = store.getState();
    const loaded = state.timeline.findIndex(
      (item) => item.id === request.itemId || item.message_id === request.messageId
    );
    if (state.config.windowStart > 0 && loaded < state.config.windowStart) {
      // Loaded but above the drawn window, or not loaded at all: draw the
      // whole loaded timeline in one step before asking for older pages.
      widen(Math.max(0, loaded));
    } else if (paged.current.pages >= MAX_REVEAL_PAGES || !pageEarlier()) {
      settle();
      return;
    } else {
      paged.current.pages += 1;
    }
    return store.subscribe((next, previous) => {
      if (next.keys !== previous.keys) reveal();
    });
  }, [request, ready, loadingEarlier, store]);
}
