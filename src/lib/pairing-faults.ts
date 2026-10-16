/**
 * A paired computer that will not take this device's pairing any more, and
 * what to do about it.
 *
 * Two refusals from a record's own gateway mean the pairing itself is the
 * problem, not the network:
 *
 * - `device_repair_required` (HTTP 426): encryption was turned on for the
 *   computer after this device paired, so the record has no transport key and
 *   the gateway refuses it on every route until it is paired again.
 * - `invalid_token` (401/403): the computer no longer has this device's token
 *   -- unpaired from its side, or paired again from another device.
 *
 * Both are remembered against the pairing they were heard for, so a relaunch
 * does not go back to probing a computer that said no, and both are cleared
 * by the one thing that fixes them: pairing again, which writes a record with
 * a new `pairedAt`. A transient failure never gets here -- it has no status
 * and no body -- and a status that is not one of these says nothing.
 *
 * Pure and dependency-free so the decision has a unit test; the store that
 * persists it is `stores/pairing-faults`.
 */

import { readApiError } from './gateway-refusal';

/** What stands against a pairing: it needs re-pairing for encryption, or the token is dead. */
export type PairingFault = 'repair' | 'unauthorized';

/** One refusal, as the gateway classified it. */
export type PairingRefusal = 'repair' | 'invalid-token';

/** `Upgrade Required`, which the gateway answers for `device_repair_required` and nothing else. */
export const DEVICE_REPAIR_STATUS = 426;

/**
 * How many `invalid_token` refusals in a row make the pairing `unauthorized`.
 *
 * Two, not one: a single 403 can be a gateway mid-restart reading an empty
 * device table, and marking the pairing dead on it would stop every probe
 * until the reader paired again for nothing. Two refusals of the same token
 * with no accepted answer between them is the computer's settled opinion.
 * The count carries across launches, so a computer refusing once per launch
 * gets there too.
 */
export const INVALID_TOKEN_REFUSALS_TO_FAULT = 2;

/**
 * What a refusal from a record's own gateway says about the pairing, or
 * `null` when it says nothing about it. The code decides where there is one:
 * a 426 whose body names another code is not a repair demand. A 426 with no
 * readable body still is -- a socket upgrade carries the status and nothing
 * else, and the gateway uses that status for nothing else.
 */
export function classifyPairingRefusal(status: number, body: string): PairingRefusal | null {
  const { code } = readApiError(body);
  if (status === DEVICE_REPAIR_STATUS) {
    return code === undefined || code === 'device_repair_required' ? 'repair' : null;
  }
  // Only the code: `unknown_host` is also a 403 and pairing will not fix it,
  // and a captive portal's 401 page is not the gateway speaking at all.
  if ((status === 401 || status === 403) && code === 'invalid_token') return 'invalid-token';
  return null;
}

/** What is held against one record, keyed by the pairing it was heard for. */
export type PairingFaultEntry = {
  /** The record's `pairedAt`; a re-pair writes a new one and this entry stops applying. */
  pairedAt: number;
  fault?: PairingFault;
  /** `invalid_token` refusals heard since the computer last accepted the token. */
  invalidTokenRefusals?: number;
};

/**
 * The entry after hearing `refusal` for the pairing made at `pairedAt`.
 *
 * A repair demand is a fault at once and is never downgraded: a dead token on
 * a record that also needs a key has the same remedy. A dead token is counted
 * and becomes a fault at `INVALID_TOKEN_REFUSALS_TO_FAULT`.
 */
export function faultAfterRefusal(
  previous: PairingFaultEntry | undefined,
  refusal: PairingRefusal,
  pairedAt: number
): PairingFaultEntry {
  const base = previous?.pairedAt === pairedAt ? previous : { pairedAt };
  if (refusal === 'repair') return { ...base, fault: 'repair' };
  const invalidTokenRefusals = (base.invalidTokenRefusals ?? 0) + 1;
  const fault =
    base.fault ??
    (invalidTokenRefusals >= INVALID_TOKEN_REFUSALS_TO_FAULT ? 'unauthorized' : undefined);
  return { ...base, invalidTokenRefusals, ...(fault ? { fault } : {}) };
}

/** Whether two entries say the same thing, so an unchanged one is not written again. */
export function sameFaultEntry(
  a: PairingFaultEntry | undefined,
  b: PairingFaultEntry | undefined
): boolean {
  if (!a || !b) return a === b;
  return (
    a.pairedAt === b.pairedAt &&
    a.fault === b.fault &&
    (a.invalidTokenRefusals ?? 0) === (b.invalidTokenRefusals ?? 0)
  );
}

/** The fault held against a record, if the entry is about this pairing of it. */
export function faultFor(
  entry: PairingFaultEntry | undefined,
  record: { pairedAt: number } | undefined
): PairingFault | undefined {
  if (!entry || !record || entry.pairedAt !== record.pairedAt) return undefined;
  return entry.fault;
}

/**
 * The index without entries for pairings that no longer exist: a record
 * removed, or paired again with a new `pairedAt`. The same object when
 * nothing was stale, so a subscriber can tell.
 */
export function pruneFaults<T extends PairingFaultEntry>(
  byServer: Readonly<Record<string, T>>,
  records: readonly { serverId: string; pairedAt: number }[]
): Readonly<Record<string, T>> {
  const pairedAtOf = new Map(records.map((record) => [record.serverId, record.pairedAt]));
  const kept = Object.entries(byServer).filter(
    ([serverId, entry]) => pairedAtOf.get(serverId) === entry.pairedAt
  );
  if (kept.length === Object.keys(byServer).length) return byServer;
  return Object.fromEntries(kept);
}

/** A stored index, read back without trusting it. */
export function parsePairingFaults(value: string): Record<string, PairingFaultEntry> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const index: Record<string, PairingFaultEntry> = {};
  for (const [serverId, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!serverId || !raw || typeof raw !== 'object') continue;
    const { pairedAt, fault, invalidTokenRefusals } = raw as Record<string, unknown>;
    if (typeof pairedAt !== 'number' || !Number.isFinite(pairedAt)) continue;
    const refusals =
      typeof invalidTokenRefusals === 'number' && Number.isInteger(invalidTokenRefusals)
        ? Math.max(0, invalidTokenRefusals)
        : 0;
    index[serverId] = {
      pairedAt,
      ...(fault === 'repair' || fault === 'unauthorized' ? { fault } : {}),
      ...(refusals > 0 ? { invalidTokenRefusals: refusals } : {}),
    };
  }
  return index;
}
