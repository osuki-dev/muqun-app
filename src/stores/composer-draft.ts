import { create } from 'zustand';

/**
 * A sheet route cannot hand text back to the terminal through navigation, so a
 * quick action that needs an argument typed leaves it here for the composer to
 * pick up.
 */
type ComposerDraftState = {
  draft: string | null;
  prefillDraft: (draft: string) => void;
  clearDraft: () => void;
};

export const useComposerDraftStore = create<ComposerDraftState>((set) => ({
  draft: null,
  prefillDraft: (draft) => set({ draft }),
  clearDraft: () => set({ draft: null }),
}));
