import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

import type { ToolPart } from '@/lib/agent-protocol';
import type { AgentTranscriptStore } from '@/stores/agent-transcript';

/**
 * The tool call the detail sheet is showing, and where its newer versions are.
 *
 * A route is mounted by the navigator, so the call cannot be handed to it as a
 * prop (`agent-sheet-bridge.ts` has the long version). The opener puts the part
 * here with the transcript it came from; the sheet reads the newest copy of
 * that call out of the transcript, so a running call keeps streaming in while
 * the sheet is open, and falls back to the copy it was opened with when the
 * call has left the transcript -- a detached shell, a session switched away.
 */
export interface OpenedToolCall {
  part: ToolPart;
  /** The gateway session, for reading the full output file. */
  sessionId?: string;
  /** The agent session's workspace; an output file is only offered inside it. */
  directory?: string;
  transcript?: AgentTranscriptStore;
}

interface ToolCallDetailState {
  opened: OpenedToolCall | null;
  open: (opened: OpenedToolCall) => void;
}

export const useToolCallDetailStore = create<ToolCallDetailState>((set) => ({
  opened: null,
  open: (opened) => set({ opened }),
}));

const noSubscription = () => () => {};

/** The newest copy of the opened call, or the copy it was opened with. */
export function useLiveToolPart(opened: OpenedToolCall | null): ToolPart | null {
  const transcript = opened?.transcript;
  const id = opened?.part.id;
  return useSyncExternalStore(transcript ? transcript.subscribe : noSubscription, () => {
    if (!opened) return null;
    const timeline = transcript?.getState().timeline;
    if (timeline) {
      for (let index = timeline.length - 1; index >= 0; index -= 1) {
        const part = timeline[index].part;
        if (part.type === 'tool' && part.id === id) return part;
      }
    }
    return opened.part;
  });
}
