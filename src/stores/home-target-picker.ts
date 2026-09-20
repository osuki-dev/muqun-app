import { create } from 'zustand';

import type { ServerReachability } from '@/lib/server-reachability';

type HomeTargetPickerState = {
  openRequestId: number | null;
  selectedServerId: string | null;
  completedRequestId: number | null;
  completedServerId: string | null;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  begin: (
    selectedServerId: string | undefined,
    reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>
  ) => number;
  choose: (requestId: number, serverId: string) => void;
  updateReachability: (
    requestId: number,
    reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>
  ) => void;
  close: (requestId: number) => void;
};

let nextRequestId = 0;

/**
 * The Home target sheet returns a target without selecting the live gateway.
 * Keeping that handoff in a tiny store lets the route use the native sheet
 * presentation while the Home command keeps its own route-only selection.
 */
export const useHomeTargetPicker = create<HomeTargetPickerState>((set, get) => ({
  openRequestId: null,
  selectedServerId: null,
  completedRequestId: null,
  completedServerId: null,
  reachabilityByServer: {},

  begin(selectedServerId, reachabilityByServer) {
    const requestId = ++nextRequestId;
    set({
      openRequestId: requestId,
      selectedServerId: selectedServerId ?? null,
      completedRequestId: null,
      completedServerId: null,
      reachabilityByServer: { ...reachabilityByServer },
    });
    return requestId;
  },

  choose(requestId, serverId) {
    if (get().openRequestId !== requestId) return;
    set({ selectedServerId: serverId });
  },

  updateReachability(requestId, reachabilityByServer) {
    if (get().openRequestId !== requestId) return;
    set({ reachabilityByServer: { ...reachabilityByServer } });
  },

  close(requestId) {
    if (get().openRequestId !== requestId) return;
    set({
      openRequestId: null,
      completedRequestId: requestId,
      completedServerId: get().selectedServerId,
    });
  },
}));
