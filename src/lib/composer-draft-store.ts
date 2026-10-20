import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * A composer's draft and caret, held outside React state.
 *
 * Both change on every keystroke. Kept in the state of the screen that owns
 * the composer, each keystroke re-rendered that whole screen -- on the
 * terminal workspace, the terminal, the key row and every chip with it, twice
 * (once for the text, once for the caret). In a store, only what subscribes
 * renders: the field reads the text, and the screen subscribes to the few
 * answers it draws from the draft (is there anything to send, is a popup
 * open), which change far less often than the text does.
 */
export interface ComposerDraft {
  text: string;
  /** Last reported caret offset; `undefined` means the end of the draft. */
  caret: number | undefined;
}

export type ComposerDraftStore = StoreApi<ComposerDraft>;

export function createComposerDraftStore(): ComposerDraftStore {
  return createStore<ComposerDraft>(() => ({ text: '', caret: undefined }));
}
