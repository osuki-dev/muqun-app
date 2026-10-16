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
 * by the things that disprove them: pairing again, which writes a record with
 * a new `pairedAt`, or the computer accepting the token once more.
 *
 * ## Why one refusal is not enough
 *
 * A refusal arrives in plaintext by design -- the gateway cannot seal an
 * answer to a device it refuses -- so anyone on the path can forge one. A
 * forged 426 that the app believed at once would park the computer behind
 * "pair again" and lure the reader into pairing over the path the forger
 * controls. So a refusal has to be the gateway's own: the explicit error code
 * in the body, never a bare status and never a socket's close reason; it has
 * to be heard twice, on two requests at least `REFUSAL_CONFIRM_SPACING_MS`
 * apart, before anything is written down; and whatever is written is undone
 * by any authenticated success from the same computer, which a low-rate probe
 * keeps asking for while the fault stands (`faultProbeDue`). A transient
 * failure never gets near any of this -- it has no status and no body.
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
 * How far apart two refusals must be before they count as the computer's
 * settled opinion rather than one moment's answer heard several times: the
 * health probe, the catalog and push registration all ask within a second of
 * a launch, and a gateway mid-restart can refuse all three.
 */
export const REFUSAL_CONFIRM_SPACING_MS = 5_000;

/**
 * How often a computer with a fault held against it is still asked, so that
 * a refusal that was forged, or a gateway rolled back to accepting the
 * token, clears itself without the reader doing anything.
 */
export const FAULT_RECHECK_MS = 5 * 60 * 1000;

/**
 * What a refusal from a record's own gateway says about the pairing, or
 * `null` when it says nothing about it.
 *
 * The explicit code decides, and only the code: a 426 with no readable body
 * -- a socket upgrade, a proxy's page -- is not evidence, because the status
 * alone is exactly what a forger can produce without knowing anything.
 * `unknown_host` is also a 403 and pairing will not fix it, and a captive
 * portal's 401 page is not the gateway speaking at all.
 */
export function classifyPairingRefusal(status: number, body: string): PairingRefusal | null {
  const { code } = readApiError(body);
  if (status === DEVICE_REPAIR_STATUS && code === 'device_repair_required') return 'repair';
  if ((status === 401 || status === 403) && code === 'invalid_token') return 'invalid-token';
  return null;
}

/** The fault a refusal would establish. */
export function faultOfRefusal(refusal: PairingRefusal): PairingFault {
  return refusal === 'repair' ? 'repair' : 'unauthorized';
}

/** What is held against one record, keyed by the pairing it was heard for. */
export type PairingFaultEntry = {
  /** The record's `pairedAt`; a re-pair writes a new one and this entry stops applying. */
  pairedAt: number;
  /** The confirmed fault, the only part that is persisted. */
  fault?: PairingFault;
  /**
   * The first refusal of its kind, waiting for a second one far enough after
   * it. Held for this launch only: on its own it is one answer, not a fact.
   */
  pending?: { fault: PairingFault; atMs: number };
};

/**
 * The entry after hearing `refusal` at `nowMs` for the pairing made at
 * `pairedAt`.
 *
 * The first refusal of a kind is noted and nothing more. A second one at
 * least `REFUSAL_CONFIRM_SPACING_MS` later confirms it; one sooner is the
 * same moment answering again and changes nothing. A repair demand confirmed
 * is never downgraded by a dead token: a record that needs a key has the
 * same remedy either way.
 */
export function faultAfterRefusal(
  previous: PairingFaultEntry | undefined,
  refusal: PairingRefusal,
  pairedAt: number,
  nowMs: number
): PairingFaultEntry {
  const base: PairingFaultEntry = previous?.pairedAt === pairedAt ? previous : { pairedAt };
  const fault = faultOfRefusal(refusal);
  if (base.fault === 'repair' || base.fault === fault) return base;
  const pending = base.pending;
  if (pending?.fault === fault && nowMs - pending.atMs >= REFUSAL_CONFIRM_SPACING_MS) {
    const { pending: _pending, ...rest } = base;
    return { ...rest, fault };
  }
  if (pending?.fault === fault) return base;
  return { ...base, pending: { fault, atMs: nowMs } };
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
    a.pending?.fault === b.pending?.fault &&
    a.pending?.atMs === b.pending?.atMs
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
 * The index after the computer accepted this device's token: nothing held
 * against that pairing stands, confirmed or merely noted. The same object
 * when nothing was held.
 */
export function faultsAfterAnswer<T extends PairingFaultEntry>(
  byServer: Readonly<Record<string, T>>,
  serverId: string
): Readonly<Record<string, T>> {
  if (!(serverId in byServer)) return byServer;
  const { [serverId]: _cleared, ...rest } = byServer;
  return rest;
}

/**
 * Whether a computer with a fault held against it is due its low-rate probe:
 * never asked this launch, or not for `FAULT_RECHECK_MS`. The probe is how a
 * forged refusal, or a gateway that accepts the token again, clears itself.
 */
export function faultProbeDue(lastCheckedAtMs: number | undefined, nowMs: number): boolean {
  return lastCheckedAtMs === undefined || nowMs - lastCheckedAtMs >= FAULT_RECHECK_MS;
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

/** What is written to disk: confirmed faults only; a pending refusal is this launch's. */
export function serializePairingFaults(
  byServer: Readonly<Record<string, PairingFaultEntry>>
): string {
  const persisted: Record<string, { pairedAt: number; fault: PairingFault }> = {};
  for (const [serverId, entry] of Object.entries(byServer)) {
    if (entry.fault) persisted[serverId] = { pairedAt: entry.pairedAt, fault: entry.fault };
  }
  return JSON.stringify(persisted);
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
    const { pairedAt, fault } = raw as Record<string, unknown>;
    if (typeof pairedAt !== 'number' || !Number.isFinite(pairedAt)) continue;
    if (fault !== 'repair' && fault !== 'unauthorized') continue;
    index[serverId] = { pairedAt, fault };
  }
  return index;
}
