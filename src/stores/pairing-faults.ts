import { create } from 'zustand';

import { setGatewayAuthObserver } from '@/lib/gateway-client';
import {
  classifyPairingRefusal,
  faultAfterRefusal,
  faultsAfterAnswer,
  parsePairingFaults,
  pruneFaults,
  sameFaultEntry,
  serializePairingFaults,
  type PairingFault,
  type PairingFaultEntry,
} from '@/lib/pairing-faults';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/**
 * Which paired computers have refused this device's pairing, kept across
 * launches.
 *
 * Unlike the probes, a confirmed fault is persisted on purpose: a gateway
 * that answered `device_repair_required` will answer it again on the next
 * launch, and probing it on every focus -- with a token it has already
 * refused -- is noise on the wire and a red line in every log. The remedy is
 * pairing again, which writes a record with a new `pairedAt`; an entry is
 * bound to the `pairedAt` it was heard for and stops applying the moment
 * that changes (`pruneFaults`). Any authenticated answer from the computer
 * -- a sealed response that opens, a 2xx on a route that took the token --
 * clears its entry through `noteAnswer`, and a low-rate probe keeps asking
 * while the fault stands so a forged refusal undoes itself.
 *
 * The rule itself is in `lib/pairing-faults`, including why one refusal is
 * only noted and a second one some seconds later confirms it; this is the
 * persistence and the one seam the transport needs. Not secret, so MMKV
 * rather than the keychain, and only confirmed faults reach disk.
 */
type PairingFaultsState = {
  byServer: Readonly<Record<string, PairingFaultEntry>>;
  /** A refusal heard from this computer's own gateway. */
  noteRefusal: (serverId: string, status: number, body: string, nowMs?: number) => void;
  /** The computer accepted this device's token: nothing held against it stands. */
  noteAnswer: (serverId: string) => void;
};

const STORE_ID = 'muqun.pairing-faults';
const INDEX_KEY = 'index';

type FaultStorage = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
};

const storage: FaultStorage | null = (() => {
  try {
    // Required, not imported: a Bun suite loading a store that reads this one
    // has no native MMKV, and an OTA bundle may reach a binary without it.
    // Neither is a reason not to remember within the launch.
    // oxlint-disable-next-line typescript/no-require-imports -- guarded native import, see above
    const { createMMKV } = require('react-native-mmkv') as {
      createMMKV: (options: { id: string }) => FaultStorage;
    };
    return createMMKV({ id: STORE_ID });
  } catch {
    return null;
  }
})();

function loadIndex(): Record<string, PairingFaultEntry> {
  try {
    const raw = storage?.getString(INDEX_KEY);
    return raw ? parsePairingFaults(raw) : {};
  } catch {
    return {};
  }
}

function saveIndex(byServer: Readonly<Record<string, PairingFaultEntry>>): void {
  try {
    storage?.set(INDEX_KEY, serializePairingFaults(byServer));
  } catch {
    // The in-memory index still drives this launch; the next one hears the
    // refusal again and writes it then.
  }
}

/** The record this device holds for `serverId`, if any. */
function recordFor(serverId: string) {
  return useGatewayConnectionStore.getState().records.find((entry) => entry.serverId === serverId);
}

export const usePairingFaults = create<PairingFaultsState>((set, get) => ({
  byServer: loadIndex(),

  noteRefusal(serverId, status, body, nowMs = Date.now()) {
    const refusal = classifyPairingRefusal(status, body);
    const record = recordFor(serverId);
    if (!refusal || !record) return;
    const previous = get().byServer[serverId];
    const next = faultAfterRefusal(previous, refusal, record.pairedAt, nowMs);
    if (sameFaultEntry(previous, next)) return;
    const byServer = { ...get().byServer, [serverId]: next };
    set({ byServer });
    if (previous?.fault !== next.fault) saveIndex(byServer);
  },

  noteAnswer(serverId) {
    const previous = get().byServer[serverId];
    if (!previous) return;
    const byServer = faultsAfterAnswer(get().byServer, serverId);
    set({ byServer });
    if (previous.fault) saveIndex(byServer);
  },
}));

/** The fault held against a record this device still holds, as a selector reads it. */
export function pairingFaultOf(
  state: Pick<PairingFaultsState, 'byServer'>,
  serverId: string
): PairingFault | undefined {
  return state.byServer[serverId]?.fault;
}

// A record paired again carries a new `pairedAt`, and a record removed carries
// nothing: either way the entry is about a pairing that no longer exists.
useGatewayConnectionStore.subscribe((state, previous) => {
  if (state.records === previous.records) return;
  const pruned = pruneFaults(usePairingFaults.getState().byServer, state.records);
  if (pruned === usePairingFaults.getState().byServer) return;
  usePairingFaults.setState({ byServer: pruned });
  saveIndex(pruned);
});

/** The record whose token this is; every record's token is its own. */
function recordByToken(token: string) {
  return useGatewayConnectionStore.getState().records.find((entry) => entry.token === token);
}

// The transport reports by the endpoint it spoke to, and the token is what
// identifies the record. An acceptance costs a lookup only while something
// is held against some computer, which is almost never.
if (typeof setGatewayAuthObserver === 'function') {
  setGatewayAuthObserver({
    refused(endpoint, status, body) {
      const record = recordByToken(endpoint.token);
      if (record) usePairingFaults.getState().noteRefusal(record.serverId, status, body);
    },
    accepted(endpoint) {
      if (Object.keys(usePairingFaults.getState().byServer).length === 0) return;
      const record = recordByToken(endpoint.token);
      if (record) usePairingFaults.getState().noteAnswer(record.serverId);
    },
  });
}
