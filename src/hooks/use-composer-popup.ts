import { useCallback, useMemo, useState } from 'react';
import type { TextInputKeyPressEvent, TextInputSelectionChangeEvent } from 'react-native';
import { useStore } from 'zustand';

import type { ComposerDraftStore } from '@/lib/composer-draft-store';
import { useLatestReader } from '@/hooks/use-render-refs';
import { useStoreSelector } from '@/hooks/use-store-selector';

import {
  dismissComposerPopup,
  insertComposerPick,
  readComposerPopup,
  type ComposerPopupRow,
  type ComposerPopupState,
  type ComposerTrigger,
} from '@/lib/composer-popup';

/**
 * The React side of `composer-popup.ts`: the caret, the dismissal and the
 * post-insert selection, which are the three pieces of state a pure machine
 * cannot hold for itself.
 *
 * Written as a hook rather than inside the terminal screen so that both
 * triggers -- `/` for the pane's commands, `@` for its files -- wire up the same
 * way, and so the screen's composer keeps one line per popup instead of a
 * private copy of this bookkeeping each.
 *
 * Everything it decides is still `composer-popup.ts`'s answer. What lives here
 * is only what a text input forces on us:
 *
 *  * **The caret.** React Native reports it on `onSelectionChange`, one event
 *    behind the text; until the first one arrives the machine assumes the end
 *    of the draft, which is where typing puts it.
 *  * **Dismissal.** Remembered as the offset it happened at, and forgotten the
 *    moment the draft no longer has a trigger under the caret (`no-query`) --
 *    so Esc survives further typing but not deleting the "/" and starting over.
 *  * **The caret after a pick.** Controlled for exactly as long as the draft is
 *    the one the pick produced, then handed straight back to the input. A
 *    permanently controlled `selection` fights the user on Android.
 */

export interface UseComposerPopupOptions<T> {
  draft: string;
  onDraftChange: (draft: string) => void;
  trigger: ComposerTrigger<T>;
  /** The capability gate. `false` makes the trigger character plain text. */
  enabled?: boolean;
}

/** Props to spread onto the composer's `TextInput`. */
export interface ComposerPopupInputProps {
  selection: { start: number; end: number } | undefined;
  onSelectionChange: (event: TextInputSelectionChangeEvent) => void;
  onKeyPress: (event: TextInputKeyPressEvent) => void;
}

export interface ComposerPopupController<T> {
  state: ComposerPopupState<T>;
  open: boolean;
  rows: readonly ComposerPopupRow[];
  inputProps: ComposerPopupInputProps;
  /** Insert the picked row in place of the query. */
  pick: (row: ComposerPopupRow) => void;
  /** Esc, or a tap outside. Shuts the popup for this trigger only. */
  dismiss: () => void;
}

export function useComposerPopup<T>({
  draft,
  onDraftChange,
  trigger,
  enabled = true,
}: UseComposerPopupOptions<T>): ComposerPopupController<T> {
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [pending, setPending] = useState<{ draft: string; caret: number } | null>(null);

  // Only while the input still holds exactly what the pick produced, and only
  // when the pick landed somewhere other than the end of the draft. A caret the
  // input would have put there anyway is not worth controlling for: every
  // slash-command pick is a whole-message one, and a `selection` prop that is
  // right but redundant still fights the keyboard on Android.
  const controlled =
    pending && pending.draft === draft && pending.caret !== draft.length ? pending : null;
  const effectiveCaret = controlled ? controlled.caret : caret;

  const state = useMemo(
    () => readComposerPopup({ draft, caret: effectiveCaret, dismissedAt, trigger, enabled }),
    [draft, effectiveCaret, dismissedAt, trigger, enabled]
  );

  // The trigger the dismissal belonged to is no longer in the draft, so the
  // next one typed gets a popup rather than inheriting an old Esc.
  if (dismissedAt !== null && !state.open && state.reason === 'no-query') {
    setDismissedAt(null);
  }

  const onSelectionChange = useCallback(
    (event: TextInputSelectionChangeEvent) => {
      const next = event.nativeEvent.selection.start;
      setCaret(next);
      setPending((current) => {
        if (!current) return null;
        // Either the input reached the caret we asked for, or the draft moved
        // on without us; both mean the input is back in charge.
        return current.draft === draft && current.caret !== next ? current : null;
      });
    },
    [draft]
  );

  const onKeyPress = useCallback(
    (event: TextInputKeyPressEvent) => {
      if (event.nativeEvent.key !== 'Escape') return;
      setDismissedAt((current) => dismissComposerPopup(state) ?? current);
    },
    [state]
  );

  const pick = useCallback(
    (row: ComposerPopupRow) => {
      if (!state.open) return;
      const next = insertComposerPick(draft, state.query, row);
      onDraftChange(next.draft);
      setCaret(next.caret);
      setPending({ draft: next.draft, caret: next.caret });
      // A pick is not a dismissal: the popup closes because the query is gone,
      // and the next trigger typed should open a fresh one.
      setDismissedAt(null);
    },
    [draft, onDraftChange, state]
  );

  const dismiss = useCallback(() => {
    setDismissedAt((current) => dismissComposerPopup(state) ?? current);
  }, [state]);

  return {
    state,
    open: state.open,
    rows: state.rows,
    inputProps: {
      selection: controlled ? { start: controlled.caret, end: controlled.caret } : undefined,
      onSelectionChange,
      onKeyPress,
    },
    pick,
    dismiss,
  };
}

/**
 * `useComposerPopup` for a draft held in a `ComposerDraftStore`.
 *
 * Same machine, same rules; the difference is who renders. The draft and the
 * caret are read from the store by a selector, and the caller re-renders only
 * when the popup's answer changes -- opening, closing, or a different query --
 * rather than on every keystroke. The caret this tracks is the store's, so
 * every reader of the draft sees the same one.
 */
export function useDraftStoreComposerPopup<T>({
  store,
  trigger,
  enabled = true,
}: {
  store: ComposerDraftStore;
  trigger: ComposerTrigger<T>;
  enabled?: boolean;
}): ComposerPopupController<T> {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [pending, setPending] = useState<{ draft: string; caret: number } | null>(null);
  const readPending = useLatestReader(pending);

  const holdsPick = useStore(
    store,
    (draft) =>
      pending !== null && pending.draft === draft.text && pending.caret !== draft.text.length
  );
  const controlled = holdsPick ? pending : null;

  const state = useStoreSelector(
    store,
    (draft) =>
      readComposerPopup({
        draft: draft.text,
        caret: controlled ? controlled.caret : draft.caret,
        dismissedAt,
        trigger,
        enabled,
      }),
    samePopupState
  );

  if (dismissedAt !== null && !state.open && state.reason === 'no-query') {
    setDismissedAt(null);
  }

  const onSelectionChange = useCallback(
    (event: TextInputSelectionChangeEvent) => {
      const next = event.nativeEvent.selection.start;
      store.setState({ caret: next });
      const current = readPending();
      // Either the input reached the caret we asked for, or the draft moved on
      // without us; both mean the input is back in charge.
      if (current && !(current.draft === store.getState().text && current.caret !== next))
        setPending(null);
    },
    [readPending, store]
  );

  const onKeyPress = useCallback(
    (event: TextInputKeyPressEvent) => {
      if (event.nativeEvent.key !== 'Escape') return;
      setDismissedAt((current) => dismissComposerPopup(state) ?? current);
    },
    [state]
  );

  const pick = useCallback(
    (row: ComposerPopupRow) => {
      if (!state.open) return;
      const next = insertComposerPick(store.getState().text, state.query, row);
      store.setState({ text: next.draft, caret: next.caret });
      setPending({ draft: next.draft, caret: next.caret });
      setDismissedAt(null);
    },
    [state, store]
  );

  const dismiss = useCallback(() => {
    setDismissedAt((current) => dismissComposerPopup(state) ?? current);
  }, [state]);

  return {
    state,
    open: state.open,
    rows: state.rows,
    inputProps: {
      selection: controlled ? { start: controlled.caret, end: controlled.caret } : undefined,
      onSelectionChange,
      onKeyPress,
    },
    pick,
    dismiss,
  };
}

/**
 * Two answers from the same trigger are the same answer when they agree on
 * whether the popup is open, why not, and the exact query: the rows are a pure
 * function of the query and the trigger.
 */
function samePopupState<T>(a: ComposerPopupState<T>, b: ComposerPopupState<T>): boolean {
  if (a.open !== b.open || a.reason !== b.reason) return false;
  if (a.query === null || b.query === null) return a.query === b.query;
  return (
    a.query.start === b.query.start && a.query.end === b.query.end && a.query.text === b.query.text
  );
}
