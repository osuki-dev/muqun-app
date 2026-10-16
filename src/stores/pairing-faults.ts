import { create } from 'zustand';

import { setGatewayRefusalObserver } from '@/lib/gateway-client';
import {
  classifyPairingRefusal,
  faultAfterRefusal,
  parsePairingFaults,
  pruneFaults,
  sameFaultEntry,
  type PairingFault,
  type PairingFaultEntry,
} from '@/lib/pairing-faults';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/**
 * Which paired computers have refused this device's pairing, kept across
 * launches.
 *
 * Unlike the probes, this is persisted on purpose: a gateway that answered
 * `device_repair_required` will answer it again on the next launch, and
 * probing it anyway -- with a token it has already refused -- is noise on the
 * wire and a red line in every log. The remedy is pairing again, which writes
 * a record with a new `pairedAt`; an entry is bound to the `pairedAt` it was
 * heard for and stops applying the moment that changes (`faultFor`,
 * `pruneFaults`). A computer that accepts the token again -- the gateway was
 * rolled back, say -- clears its entry through `noteAnswer`.
 *
 * The rule itself is in `lib/pairing-faults`; this is the persistence and the
 * one seam the transport needs. Not secret, so MMKV rather than the keychain.
 */
type PairingFaultsState = {
  byServer: Readonly<Record<string, PairingFaultEntry>>;
  /** A refusal heard from this computer's own gateway. */
  noteRefusal: (serverId: string, status: number, body: string) => void;
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
    storage?.set(INDEX_KEY, JSON.stringify(byServer));
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

  noteRefusal(serverId, status, body) {
    const refusal = classifyPairingRefusal(status, body);
    const record = recordFor(serverId);
    if (!refusal || !record) return;
    const previous = get().byServer[serverId];
    const next = faultAfterRefusal(previous, refusal, record.pairedAt);
    if (sameFaultEntry(previous, next)) return;
    const byServer = { ...get().byServer, [serverId]: next };
    set({ byServer });
    saveIndex(byServer);
  },

  noteAnswer(serverId) {
    if (!get().byServer[serverId]) return;
    const byServer = { ...get().byServer };
    delete byServer[serverId];
    set({ byServer });
    saveIndex(byServer);
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

// The transport reports refusals by the endpoint it spoke to; the token is
// what identifies the record, because every record's token is its own.
if (typeof setGatewayRefusalObserver === 'function') {
  setGatewayRefusalObserver((endpoint, status, body) => {
    const record = useGatewayConnectionStore
      .getState()
      .records.find((entry) => entry.token === endpoint.token);
    if (record) usePairingFaults.getState().noteRefusal(record.serverId, status, body);
  });
}
