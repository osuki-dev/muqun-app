import { create } from 'zustand';

import { configureGateway, revokeOwnGatewayPairing, setGatewayLabel } from '@/lib/gateway-client';
import { demoRecord, DEMO_SERVER_ID } from '@/lib/demo-gateway';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  clearGateway,
  loadGateway,
  loadGateways,
  removeGateway,
  renameGateway,
  selectGateway,
  updateGateway,
  type GatewayRecord,
} from '@/lib/gateway-storage';

interface GatewayConnectionState {
  record: GatewayRecord | null;
  records: GatewayRecord[];
  loading: boolean;
  hydrate: () => Promise<void>;
  setRecord: (record: GatewayRecord | null) => void;
  selectRecord: (serverId: string) => Promise<boolean>;
  /** Enter the offline demo. The demo record is never persisted. */
  enterDemo: () => void;
  renameRecord: (serverId: string, label: string) => Promise<void>;
  /**
   * Rename and/or repoint a record. Distinct from `renameRecord`, which the
   * home card's quick inline rename still uses -- this is the Settings edit
   * form, and it is the one path that may also change `url`.
   */
  editRecord: (serverId: string, changes: { label?: string; url?: string }) => Promise<void>;
  removeRecord: (serverId: string) => Promise<void>;
  disconnect: () => Promise<void>;
}

let selectionRequestId = 0;
let selectionQueue: Promise<unknown> = Promise.resolve();

/**
 * Serialize every record read-modify-write behind one chain. Storage helpers all
 * load → mutate → save the same SecureStore key, so two overlapping mutations
 * (rename one card while a delete/select is still flushing) could otherwise lose
 * an update. One failed task must not wedge the chain, so the tail always
 * settles regardless of outcome.
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = selectionQueue.then(task);
  selectionQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export const useGatewayConnectionStore = create<GatewayConnectionState>((set, get) => ({
  record: null,
  records: [],
  loading: true,

  async hydrate() {
    const requestId = selectionRequestId;
    const [record, records] = await Promise.all([loadGateway(), loadGateways()]);
    if (requestId !== selectionRequestId) return;
    configureGateway(record);
    set({ record, records, loading: false });
  },

  setRecord(record) {
    selectionRequestId += 1;
    configureGateway(record);
    set((state) => ({
      record,
      loading: false,
      records: record
        ? [record, ...state.records.filter((item) => item.serverId !== record.serverId)]
        : state.records,
    }));
  },

  enterDemo() {
    // A transient, unsaved record: it drives the UI while demo mode is on and
    // vanishes on disconnect, so it never joins the real server list.
    selectionRequestId += 1;
    configureGateway(demoRecord);
    set({ record: demoRecord, loading: false });
  },

  async selectRecord(serverId) {
    // Only the latest select should win; earlier queued selects short-circuit.
    // Rename/remove/disconnect don't touch this counter, so they never cancel a
    // pending select — FIFO ordering alone keeps them consistent.
    const requestId = ++selectionRequestId;
    return enqueue(async () => {
      if (requestId !== selectionRequestId) return false;
      if (serverId === DEMO_SERVER_ID) {
        configureGateway(demoRecord);
        set({ record: demoRecord, loading: false });
        return true;
      }
      const record = await selectGateway(serverId);
      const records = await loadGateways();
      if (requestId !== selectionRequestId || !record) return false;
      configureGateway(record);
      set({ record, records, loading: false });
      return true;
    });
  },

  async renameRecord(serverId, label) {
    await enqueue(async () => {
      const records = await renameGateway(serverId, label);
      set((state) => ({
        records,
        record:
          state.record?.serverId === serverId
            ? (records.find((item) => item.serverId === serverId) ?? state.record)
            : state.record,
      }));
    });
    // Push the new name to the gateway so its push notifications use it too, but
    // only for the server we're actually connected to. Offline is fine.
    if (get().record?.serverId === serverId) {
      try {
        await setGatewayLabel(label);
      } catch {
        // The local rename already succeeded; the gateway just keeps its old
        // label until the next successful rename while connected.
      }
    }
  },

  async editRecord(serverId, changes) {
    await enqueue(async () => {
      const records = await updateGateway(serverId, changes);
      set((state) => ({
        records,
        record:
          state.record?.serverId === serverId
            ? (records.find((item) => item.serverId === serverId) ?? state.record)
            : state.record,
      }));
      // The address may have just changed under a connection that is already
      // open; repoint it immediately rather than leaving in-flight and future
      // requests aimed at the address this record no longer claims.
      if (get().record?.serverId === serverId) {
        configureGateway(records.find((item) => item.serverId === serverId) ?? null);
      }
    });
    // Same best-effort push as `renameRecord`: only for the server this
    // device is actually connected to, and only when the label changed.
    if (changes.label !== undefined && get().record?.serverId === serverId) {
      try {
        await setGatewayLabel(changes.label);
      } catch {
        // The local edit already succeeded; the gateway just keeps its old
        // label until the next successful rename while connected.
      }
    }
  },

  async removeRecord(serverId) {
    const recordToRemove = get().records.find((item) => item.serverId === serverId);
    if (!recordToRemove) return;

    // Keep both sides consistent when the gateway can answer: forget the
    // local credential only after it has removed the matching device token
    // and its push registration. But a record whose gateway no longer exists
    // -- the disposable leftovers this feature exists to let a reader clear
    // out -- can never answer that request; it times out, every time,
    // forever. Refusing to ever forget a pairing nothing will ever ask about
    // again is worse than the server-side state it would otherwise be
    // guarding, so only unreachability gets this pass. A gateway that is
    // there and says no -- bad auth, a real server error -- still blocks the
    // removal below exactly as before.
    try {
      await revokeOwnGatewayPairing(recordToRemove);
    } catch (error) {
      const { kind } = describeGatewayFailure(error);
      if (kind !== 'timeout' && kind !== 'network') throw error;
    }

    // Always applies: the write is queued, not gated on a request id, so a
    // concurrent select can never make the delete silently no-op.
    await enqueue(async () => {
      const removedCurrent = get().record?.serverId === serverId;
      const records = await removeGateway(serverId);
      // Only tear down the live connection if we removed the server it points
      // at; deleting some other card must not knock the user out of a session.
      const nextRecord = removedCurrent ? await loadGateway() : get().record;
      if (removedCurrent) configureGateway(nextRecord);
      set({ records, record: nextRecord, loading: false });
    });
  },

  async disconnect() {
    await enqueue(async () => {
      await clearGateway();
      const [record, records] = await Promise.all([loadGateway(), loadGateways()]);
      configureGateway(record);
      set({ record, records, loading: false });
    });
  },
}));
