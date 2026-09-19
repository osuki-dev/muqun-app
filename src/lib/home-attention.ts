import { createStore, type StateCreator } from 'zustand/vanilla';

import { homeTargetKey, type HomeTarget } from '@/lib/home-recents';

type OpenCodeTarget = Extract<HomeTarget, { kind: 'opencode-session' }>;

const MAX_ATTENTION_TARGETS = 24;
const MAX_REQUEST_IDS = 32;

export type HomeAttentionSnapshot = {
  target: OpenCodeTarget;
  requestIds: readonly string[];
  observedAt: number;
};

export type HomeAttentionState = {
  byTarget: Readonly<Record<string, HomeAttentionSnapshot>>;
  /** Reserve a ticket before starting an asynchronous source snapshot. */
  reserve: () => number;
  /** Only authoritative permission snapshots may publish an empty list. */
  observe: (
    target: OpenCodeTarget,
    requestIds: readonly string[],
    observedAt: number,
    ticket?: number
  ) => void;
  /** A pending event adds one exact request to the scoped target. */
  pending: (target: OpenCodeTarget, requestId: string, observedAt?: number) => void;
  /** A confirmed decision resolves only the exact request and target. */
  resolve: (target: OpenCodeTarget, requestId: string, observedAt?: number) => void;
  keepOnly: (serverIds: readonly string[]) => void;
};

/**
 * Small, process-local summaries of real requests, never a second permission
 * authority. No prompt, resources, decision callback, or credentials are copied.
 * Leaving a workbench or dismissing a toast does not assert a request resolved.
 * Consumers show observation age and open the source for a fresh decision.
 *
 * Tickets are local because Gateway sequence values can restart and are not
 * comparable across paired servers. A ticket reserved at snapshot request
 * start is the only ordering needed to reject a late response.
 */
export const homeAttentionState: StateCreator<HomeAttentionState> = (set, get) => {
  let allowedServers: Set<string> | undefined;
  let nextTicket = 0;
  /** Highest ticket rejected after a target was evicted or unpaired. */
  let evictedWatermark = 0;
  const latestTickets = new Map<string, number>();

  const reserve = (): number => {
    nextTicket += 1;
    return nextTicket;
  };

  const acceptedTicket = (suppliedTicket?: number): number => {
    const ticket = suppliedTicket ?? reserve();
    if (!Number.isSafeInteger(ticket) || ticket < 0 || ticket <= evictedWatermark) return -1;
    if (suppliedTicket !== undefined) nextTicket = Math.max(nextTicket, ticket);
    return ticket;
  };

  const publish = (
    target: OpenCodeTarget,
    key: string,
    requestIds: readonly string[],
    observedAt: number,
    ticket: number
  ): void => {
    latestTickets.set(key, ticket);
    const entries = {
      ...get().byTarget,
      [key]: { target, requestIds, observedAt },
    };
    const retained = Object.entries(entries)
      .sort(([keyA], [keyB]) => (latestTickets.get(keyB) ?? 0) - (latestTickets.get(keyA) ?? 0))
      .slice(0, MAX_ATTENTION_TARGETS);
    const retainedKeys = new Set(retained.map(([entryKey]) => entryKey));
    for (const [entryKey, entryTicket] of latestTickets) {
      if (!retainedKeys.has(entryKey)) {
        latestTickets.delete(entryKey);
        evictedWatermark = Math.max(evictedWatermark, entryTicket);
      }
    }
    set({ byTarget: Object.fromEntries(retained) });
  };

  const currentIds = (key: string): string[] => [...(get().byTarget[key]?.requestIds ?? [])];

  return {
    byTarget: {},
    reserve,
    observe(target, requestIds, observedAt, suppliedTicket) {
      if (allowedServers && !allowedServers.has(target.serverId)) return;
      if (!Number.isFinite(observedAt) || observedAt < 0) return;
      const ticket = acceptedTicket(suppliedTicket);
      if (ticket < 0) return;
      const key = homeTargetKey(target);
      if (ticket < (latestTickets.get(key) ?? 0)) return;
      publish(
        target,
        key,
        [...new Set(requestIds.filter(Boolean))].slice(0, MAX_REQUEST_IDS),
        observedAt,
        ticket
      );
    },
    pending(target, requestId, observedAt = Date.now()) {
      if (allowedServers && !allowedServers.has(target.serverId)) return;
      if (!requestId || !Number.isFinite(observedAt) || observedAt < 0) return;
      const ticket = acceptedTicket();
      if (ticket < 0) return;
      const key = homeTargetKey(target);
      if (ticket < (latestTickets.get(key) ?? 0)) return;
      const ids = currentIds(key);
      if (!ids.includes(requestId)) ids.unshift(requestId);
      publish(target, key, ids.slice(0, MAX_REQUEST_IDS), observedAt, ticket);
    },
    resolve(target, requestId, observedAt = Date.now()) {
      if (allowedServers && !allowedServers.has(target.serverId)) return;
      if (!requestId || !Number.isFinite(observedAt) || observedAt < 0) return;
      const ticket = acceptedTicket();
      if (ticket < 0) return;
      const key = homeTargetKey(target);
      if (ticket < (latestTickets.get(key) ?? 0)) return;
      const ids = currentIds(key).filter((id) => id !== requestId);
      // Keep an empty observation too: a snapshot reserved earlier cannot
      // resurrect a request resolved before its response arrives.
      publish(target, key, ids, observedAt, ticket);
    },
    keepOnly(serverIds) {
      const allowed = new Set(serverIds);
      // An authoritative inventory change closes every snapshot that was
      // already in flight. A later re-pair gets a fresh ticket.
      evictedWatermark = Math.max(evictedWatermark, nextTicket);
      allowedServers = allowed;
      const entries = Object.entries(get().byTarget);
      const retained = entries.filter(([, snapshot]) => allowed.has(snapshot.target.serverId));
      for (const [key, snapshot] of entries) {
        if (!allowed.has(snapshot.target.serverId)) {
          evictedWatermark = Math.max(evictedWatermark, latestTickets.get(key) ?? 0);
          latestTickets.delete(key);
        }
      }
      if (entries.length !== retained.length) set({ byTarget: Object.fromEntries(retained) });
    },
  };
};

export function createHomeAttentionStore() {
  return createStore<HomeAttentionState>(homeAttentionState);
}
