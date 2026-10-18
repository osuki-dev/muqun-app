// What a refusal from a computer's own gateway says about the pairing, and
// how long the app holds it against the record.
//
// The rules these tests hold down: only the gateway's explicit error code is
// evidence -- a bare 426, a socket's close reason, a portal's page are not --
// and one refusal is only noted; a second one some seconds later confirms it,
// because a refusal arrives in plaintext and anyone on the path can forge one.
// The confirmed fault survives until the record is paired again (a new
// `pairedAt`) or the computer accepts the token once more, and nothing
// without a status -- a timeout, a reset -- ever gets near it.
import { describe, expect, test } from 'bun:test';

import {
  classifyPairingRefusal,
  DEVICE_REPAIR_STATUS,
  FAULT_RECHECK_MS,
  faultAfterRefusal,
  faultFor,
  faultProbeDue,
  faultsAfterAnswer,
  parsePairingFaults,
  pruneFaults,
  REFUSAL_CONFIRM_SPACING_MS,
  sameFaultEntry,
  serializePairingFaults,
  type PairingFaultEntry,
} from '../pairing-faults';

const REPAIR_BODY = JSON.stringify({
  error: {
    code: 'device_repair_required',
    message: 'pair this device again to enable encrypted transport',
  },
});
const INVALID_BODY = JSON.stringify({ error: { code: 'invalid_token', message: 'invalid token' } });
const PAIRED_AT = 1_700_000_000_000;
const T0 = 1_800_000_000_000;

describe('classifyPairingRefusal', () => {
  test('426 device_repair_required is a demand to pair again', () => {
    expect(classifyPairingRefusal(DEVICE_REPAIR_STATUS, REPAIR_BODY)).toBe('repair');
  });

  test('a 426 without the code is not evidence: a socket close, a proxy page, an empty body', () => {
    expect(classifyPairingRefusal(426, '')).toBeNull();
    expect(classifyPairingRefusal(426, '<html>Upgrade Required</html>')).toBeNull();
    expect(
      classifyPairingRefusal(426, JSON.stringify({ error: { code: 'protocol_too_old' } }))
    ).toBeNull();
  });

  test('invalid_token on 401 or 403 is a refusal of the token; other 403s are not', () => {
    expect(classifyPairingRefusal(403, INVALID_BODY)).toBe('invalid-token');
    expect(classifyPairingRefusal(401, INVALID_BODY)).toBe('invalid-token');
    expect(
      classifyPairingRefusal(403, JSON.stringify({ error: { code: 'unknown_host' } }))
    ).toBeNull();
    expect(classifyPairingRefusal(401, '<html>Sign in to the network</html>')).toBeNull();
    expect(classifyPairingRefusal(403, '')).toBeNull();
  });

  test('other statuses say nothing about the pairing, and a transient failure has none', () => {
    expect(classifyPairingRefusal(200, '')).toBeNull();
    expect(classifyPairingRefusal(404, REPAIR_BODY)).toBeNull();
    expect(classifyPairingRefusal(502, INVALID_BODY)).toBeNull();
    expect(classifyPairingRefusal(0, '')).toBeNull();
  });
});

describe('what is held against a record', () => {
  test('a single device_repair_required -- forged or real -- is noted, not written', () => {
    const once = faultAfterRefusal(undefined, 'repair', PAIRED_AT, T0);
    expect(once.fault).toBeUndefined();
    expect(once.pending).toEqual({ fault: 'repair', atMs: T0 });
    expect(faultFor(once, { pairedAt: PAIRED_AT })).toBeUndefined();
    expect(serializePairingFaults({ osk: once })).toBe('{}');
  });

  test('a second one at least the spacing later confirms it', () => {
    const once = faultAfterRefusal(undefined, 'repair', PAIRED_AT, T0);
    // The catalog and push registration asking a second later are the same moment.
    const soon = faultAfterRefusal(once, 'repair', PAIRED_AT, T0 + 1_000);
    expect(soon).toEqual(once);
    const confirmed = faultAfterRefusal(once, 'repair', PAIRED_AT, T0 + REFUSAL_CONFIRM_SPACING_MS);
    expect(confirmed).toEqual({ pairedAt: PAIRED_AT, fault: 'repair' });
    expect(faultFor(confirmed, { pairedAt: PAIRED_AT })).toBe('repair');
    expect(serializePairingFaults({ osk: confirmed })).toBe(
      JSON.stringify({ osk: { pairedAt: PAIRED_AT, fault: 'repair' } })
    );
  });

  test('invalid_token is held to the same two-step', () => {
    const once = faultAfterRefusal(undefined, 'invalid-token', PAIRED_AT, T0);
    expect(once.fault).toBeUndefined();
    expect(
      faultAfterRefusal(once, 'invalid-token', PAIRED_AT, T0 + REFUSAL_CONFIRM_SPACING_MS).fault
    ).toBe('unauthorized');
    // A different kind of refusal starts its own count.
    const mixed = faultAfterRefusal(once, 'repair', PAIRED_AT, T0 + REFUSAL_CONFIRM_SPACING_MS);
    expect(mixed.fault).toBeUndefined();
    expect(mixed.pending?.fault).toBe('repair');
  });

  test('a confirmed repair demand is never downgraded; a confirmed dead token can become one', () => {
    const repair: PairingFaultEntry = { pairedAt: PAIRED_AT, fault: 'repair' };
    expect(faultAfterRefusal(repair, 'invalid-token', PAIRED_AT, T0)).toBe(repair);
    const dead: PairingFaultEntry = { pairedAt: PAIRED_AT, fault: 'unauthorized' };
    const noted = faultAfterRefusal(dead, 'repair', PAIRED_AT, T0);
    expect(noted.fault).toBe('unauthorized');
    expect(
      faultAfterRefusal(noted, 'repair', PAIRED_AT, T0 + REFUSAL_CONFIRM_SPACING_MS).fault
    ).toBe('repair');
  });

  test('pairing again clears it: a new pairedAt is a new pairing', () => {
    const entry: PairingFaultEntry = { pairedAt: PAIRED_AT, fault: 'repair' };
    expect(faultFor(entry, { pairedAt: PAIRED_AT + 1 })).toBeUndefined();
    expect(faultFor(entry, undefined)).toBeUndefined();
    expect(faultAfterRefusal(entry, 'repair', PAIRED_AT + 1, T0)).toEqual({
      pairedAt: PAIRED_AT + 1,
      pending: { fault: 'repair', atMs: T0 },
    });
  });

  test('any answer that takes the token clears what was held, confirmed or noted', () => {
    const once = faultAfterRefusal(undefined, 'repair', PAIRED_AT, T0);
    const confirmed = faultAfterRefusal(once, 'repair', PAIRED_AT, T0 + REFUSAL_CONFIRM_SPACING_MS);
    const byServer = { osk: confirmed, mini: once };
    expect(faultsAfterAnswer(byServer, 'osk')).toEqual({ mini: once });
    expect(faultsAfterAnswer(byServer, 'mini')).toEqual({ osk: confirmed });
    expect(faultsAfterAnswer(byServer, 'other')).toBe(byServer);
    // And the next refusal starts over: one answer, noted, not written.
    expect(faultAfterRefusal(undefined, 'repair', PAIRED_AT, T0 + 60_000).fault).toBeUndefined();
  });

  test('a computer with a fault is still asked once a launch and every few minutes', () => {
    expect(faultProbeDue(undefined, T0)).toBe(true);
    expect(faultProbeDue(T0, T0 + 1_000)).toBe(false);
    expect(faultProbeDue(T0, T0 + FAULT_RECHECK_MS)).toBe(true);
  });

  test('pruning drops entries for records gone or paired again, and keeps the object otherwise', () => {
    const byServer = {
      osk: { pairedAt: PAIRED_AT, fault: 'repair' as const },
      mini: { pairedAt: PAIRED_AT, fault: 'repair' as const },
      gone: { pairedAt: PAIRED_AT, fault: 'repair' as const },
    };
    expect(
      pruneFaults(byServer, [
        { serverId: 'osk', pairedAt: PAIRED_AT },
        { serverId: 'mini', pairedAt: PAIRED_AT + 5 },
      ])
    ).toEqual({ osk: byServer.osk });
    const unchanged = pruneFaults(byServer, [
      { serverId: 'osk', pairedAt: PAIRED_AT },
      { serverId: 'mini', pairedAt: PAIRED_AT },
      { serverId: 'gone', pairedAt: PAIRED_AT },
    ]);
    expect(unchanged).toBe(byServer);
  });

  test('an unchanged entry is recognised, so nothing is written for it', () => {
    const entry: PairingFaultEntry = {
      pairedAt: PAIRED_AT,
      pending: { fault: 'repair', atMs: T0 },
    };
    expect(sameFaultEntry(entry, { ...entry, pending: { fault: 'repair', atMs: T0 } })).toBe(true);
    expect(sameFaultEntry(entry, { ...entry, pending: { fault: 'repair', atMs: T0 + 1 } })).toBe(
      false
    );
    expect(sameFaultEntry(entry, { pairedAt: PAIRED_AT, fault: 'repair' })).toBe(false);
    expect(sameFaultEntry(undefined, undefined)).toBe(true);
    expect(sameFaultEntry(entry, undefined)).toBe(false);
  });

  test('a stored index is read back without trusting it, and only confirmed faults come back', () => {
    expect(
      parsePairingFaults(
        JSON.stringify({
          osk: { pairedAt: PAIRED_AT, fault: 'repair' },
          odd: { pairedAt: 'soon', fault: 'repair' },
          weird: { pairedAt: PAIRED_AT, fault: 'cursed' },
          noted: { pairedAt: PAIRED_AT, pending: { fault: 'repair', atMs: T0 } },
          '': { pairedAt: PAIRED_AT, fault: 'repair' },
        })
      )
    ).toEqual({ osk: { pairedAt: PAIRED_AT, fault: 'repair' } });
    expect(parsePairingFaults('not json')).toEqual({});
    expect(parsePairingFaults('[]')).toEqual({});
  });
});
