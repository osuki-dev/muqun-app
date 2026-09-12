import { create } from 'zustand';

/**
 * A request to open the assistant strip on a particular terminal.
 *
 * Quick actions and shortcuts live on other screens; the strip lives in the
 * workspace. This is the handoff between them, in the shape `composer-draft`
 * already uses for a prefilled line: written by the sheet on its way out, read
 * once by the workspace it was addressed to, and cleared. A request for a pane
 * that is not on screen is left alone until it is -- it is never applied to
 * whichever terminal happens to be in front.
 */
export type ComposerAssignmentRequest = {
  serverId: string;
  paneId: string;
  /** Pre-choose a new assistant of this kind; otherwise the reader picks. */
  kind?: string;
  /** Text to put in the composer: what the reader wrote in the shortcut. */
  prompt?: string;
  /**
   * A bundled instruction set behind the shortcut, e.g. theme authoring. Its
   * text is several kilobytes and is appended at send, never shown in the
   * field -- the strip names it, the composer stays the reader's own words.
   */
  command?: { name: string; description?: string; instructions?: string };
};

type ComposerAssignmentState = {
  request: ComposerAssignmentRequest | null;
  request_: (next: ComposerAssignmentRequest) => void;
  clear: () => void;
};

export const useComposerAssignmentStore = create<ComposerAssignmentState>((set) => ({
  request: null,
  request_: (next) => set({ request: next }),
  clear: () => set({ request: null }),
}));
