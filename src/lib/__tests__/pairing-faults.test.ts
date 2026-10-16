// What a refusal from a computer's own gateway says about the pairing, and
// how long the app holds it against the record.
//
// The rule these tests hold down: a 426 `device_repair_required` marks the
// pairing as needing to be made again, the mark survives until the record is
// paired again (a new `pairedAt`) or the computer accepts the token once more,
// and nothing without a status -- a timeout, a reset -- ever gets near it.
import { describe, expect, test } from 'bun:test';

import {
  classifyPairingRefusal,
  DEVICE_REPAIR_STATUS,
  faultAfterRefusal,
  faultFor,
  parsePairingFaults,
  pruneFaults,
  type PairingFaultEntry,
} from '../pairing-faults';

const REPAIR_BODY = JSON.stringify({
  error: {
    code: 'device_repair_required',
    message: 'pair this device again to enable encrypted transport',
  },
});
const PAIRED_AT = 1_700_000_000_000;

describe('classifyPairingRefusal', () => {
  test('426 device_repair_required is a demand to pair again', () => {
    expect(classifyPairingRefusal(DEVICE_REPAIR_STATUS, REPAIR_BODY)).toBe('repair');
  });

  test('a 426 with no readable body -- a socket upgrade -- still is', () => {
    expect(classifyPairingRefusal(426, '')).toBe('repair');
    expect(classifyPairingRefusal(426, '<html>Upgrade Required</html>')).toBe('repair');
  });

  test('a 426 that names another code is not', () => {
    expect(
      classifyPairingRefusal(426, JSON.stringify({ error: { code: 'protocol_too_old' } }))
    ).toBeNull();
  });

  test('other statuses say nothing about the pairing here', () => {
    expect(classifyPairingRefusal(200, '')).toBeNull();
    expect(classifyPairingRefusal(404, REPAIR_BODY)).toBeNull();
    expect(classifyPairingRefusal(502, '')).toBeNull();
  });
});

describe('what is held against a record', () => {
  test('a repair demand is remembered against the pairing it was heard for', () => {
    const entry = faultAfterRefusal(undefined, 'repair', PAIRED_AT);
    expect(entry).toEqual({ pairedAt: PAIRED_AT, fault: 'repair' });
    expect(faultFor(entry, { pairedAt: PAIRED_AT })).toBe('repair');
  });

  test('pairing again clears it: a new pairedAt is a new pairing', () => {
    const entry: PairingFaultEntry = { pairedAt: PAIRED_AT, fault: 'repair' };
    expect(faultFor(entry, { pairedAt: PAIRED_AT + 1 })).toBeUndefined();
    expect(faultFor(entry, undefined)).toBeUndefined();
    // A refusal heard against the new pairing starts from nothing old.
    expect(faultAfterRefusal(entry, 'repair', PAIRED_AT + 1)).toEqual({
      pairedAt: PAIRED_AT + 1,
      fault: 'repair',
    });
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

  test('a stored index is read back without trusting it', () => {
    expect(
      parsePairingFaults(
        JSON.stringify({
          osk: { pairedAt: PAIRED_AT, fault: 'repair' },
          odd: { pairedAt: 'soon', fault: 'repair' },
          weird: { pairedAt: PAIRED_AT, fault: 'cursed' },
          '': { pairedAt: PAIRED_AT, fault: 'repair' },
        })
      )
    ).toEqual({
      osk: { pairedAt: PAIRED_AT, fault: 'repair' },
      weird: { pairedAt: PAIRED_AT },
    });
    expect(parsePairingFaults('not json')).toEqual({});
    expect(parsePairingFaults('[]')).toEqual({});
  });
});
