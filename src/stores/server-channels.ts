import { create } from 'zustand';

import type { GatewaySocketState } from '@/lib/gateway-socket';
import { retryHomeRefresh } from '@/lib/home-refresh-schedule';
import type { StreamChannelPhase } from '@/lib/server-reachability';

/**
 * The live channels the app holds open to each paired computer, as they are
 * right now: the agent event socket and the terminal event stream.
 *
 * The Home dot used to come from the `/health` probe alone, so a computer the
 * app was in the middle of streaming an agent session from could read "Not
 * connected" -- the probe was 45 s old and nothing re-ran it. An open channel
 * is better evidence than any probe; this is where the dot reads it from.
 * `resolveConnectionStatus` decides what the combination means.
 *
 * Memory only, like the probes: a channel describes this second.
 */
type ServerChannelsState = {
  sockets: Record<string, GatewaySocketState>;
  streams: Record<string, StreamChannelPhase>;
  setSocket: (serverId: string, state: GatewaySocketState) => void;
  /** `null` when the stream is not wanted any more. */
  setStream: (serverId: string, phase: StreamChannelPhase | null) => void;
};

export const useServerChannels = create<ServerChannelsState>((set, get) => ({
  sockets: {},
  streams: {},
  setSocket(serverId, state) {
    if (get().sockets[serverId] === state) return;
    set((current) => ({ sockets: { ...current.sockets, [serverId]: state } }));
    // The computer answered: whatever Continue's backoff held against it is over.
    if (state === 'open') retryHomeRefresh(serverId);
  },
  setStream(serverId, phase) {
    const held = get().streams[serverId];
    if (held === phase || (phase === null && held === undefined)) return;
    set((current) => {
      const streams = { ...current.streams };
      if (phase === null) delete streams[serverId];
      else streams[serverId] = phase;
      return { streams };
    });
  },
}));
