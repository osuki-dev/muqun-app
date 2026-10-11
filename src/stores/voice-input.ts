import { create } from 'zustand';

export interface VoiceInputRequest {
  owner: object;
  context: string;
  deliver: (text: string) => void;
}

/** Ephemeral draft owner; never persisted or sent as a route parameter. */
export const useVoiceInput = create<{
  request: VoiceInputRequest | null;
}>(() => ({ request: null }));

export function claimVoiceInput(owner: object, context: string, deliver: (text: string) => void) {
  if (useVoiceInput.getState().request) return false;
  useVoiceInput.setState({ request: { owner, context, deliver } });
  return true;
}

/** Claim the result once, before a callback can start another recording. */
export function deliverVoiceInput(request: VoiceInputRequest, text: string) {
  if (useVoiceInput.getState().request !== request) return false;
  useVoiceInput.setState({ request: null });
  request.deliver(text);
  return true;
}

export function clearVoiceInput(owner: object) {
  if (useVoiceInput.getState().request?.owner === owner) {
    useVoiceInput.setState({ request: null });
  }
}
