import { useCallback, useMemo, useState } from 'react';
import type {
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
  TextInputSelectionChangeEventData,
} from 'react-native';

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
  onSelectionChange: (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  onKeyPress: (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => void;
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
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
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
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
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
