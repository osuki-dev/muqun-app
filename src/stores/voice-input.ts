import { create } from 'zustand';

/** Ephemeral draft owner; never persisted or sent as a route parameter. */
export const useVoiceInput = create<{
  request: { owner: object; deliver: (text: string) => void } | null;
}>(() => ({ request: null }));

export function clearVoiceInput(owner: object) {
  if (useVoiceInput.getState().request?.owner === owner) {
    useVoiceInput.setState({ request: null });
  }
}
