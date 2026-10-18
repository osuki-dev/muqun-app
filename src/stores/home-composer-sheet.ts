import { create } from 'zustand';

import type { ModelRef } from '@/lib/agent-session';

/**
 * The model picker, opened from Home's dock rather than from a session.
 *
 * `/agent-model` is a sheet route and reads its selection and handler from the
 * agent sheet bridge, which belongs to whichever workbench is mounted -- on a
 * Pad that can be a session retained behind Home. Home has no session yet, so
 * it opens the same route with `owner=home` and hands the route its choice and
 * its handler here instead; the workbench's bridge is never touched.
 */
interface HomeComposerSheetState {
  selectedModel?: ModelRef;
  onSelectModel: ((model: ModelRef) => void) | null;
  open: (selectedModel: ModelRef | undefined, onSelectModel: (model: ModelRef) => void) => void;
  /** Forget the handler, if it is still the one this caller registered. */
  release: (onSelectModel: (model: ModelRef) => void) => void;
}

export const useHomeComposerSheet = create<HomeComposerSheetState>((set, get) => ({
  selectedModel: undefined,
  onSelectModel: null,
  open: (selectedModel, onSelectModel) => set({ selectedModel, onSelectModel }),
  release: (onSelectModel) => {
    if (get().onSelectModel === onSelectModel)
      set({ selectedModel: undefined, onSelectModel: null });
  },
}));
