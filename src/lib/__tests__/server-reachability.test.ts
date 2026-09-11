// What the home screen is allowed to claim about a server it is looking at.
//
// The rule these tests exist to hold down is one line long: green means the app
// got an answer, just now, from that machine. The list used to derive it from
// the age of the mirrored agent snapshot, so a server that had been powered off
// for two minutes still showed a green light -- the one thing a status light
// must never do.
import { describe, expect, test } from 'bun:test';

import {
  agentStatusesAreCurrent,
  MAX_PROBED_SERVERS,
  needsReachabilityProbe,
  reachabilityFromProbe,
  REACHABILITY_FRESH_MS,
  REACHABILITY_RECHECK_MS,
  serversToProbe,
  type ReachabilityProbe,
} from '../server-reachability';

const NOW = 1_700_000_000_000;

function probe(ok: boolean, checkedAtMs = NOW): ReachabilityProbe {
  return { serverId: 's1', ok, checkedAtMs };
}

describe('what a probe entitles the card to say', () => {
  test('a server that answered just now is live', () => {
    expect(reachabilityFromProbe(probe(true), NOW)).toBe('live');
  });

  test('a server that was asked and did not answer is offline, not unknown', () => {
    // These are different facts and the card says them differently: one is a
    // filled grey dot, the other a hollow one.
    expect(reachabilityFromProbe(probe(false), NOW)).toBe('offline');
  });

  test('a server nobody has asked is unknown', () => {
    expect(reachabilityFromProbe(undefined, NOW)).toBe('unknown');
  });

  test('an answer stops speaking for the present once it is old', () => {
    // The word on the card is ONLINE, and that word is about now. When the
    // evidence expires the app stops claiming rather than starts guessing --
    // note this lands on `unknown`, never on `offline`.
    expect(reachabilityFromProbe(probe(true, NOW), NOW + REACHABILITY_FRESH_MS)).toBe('live');
    expect(reachabilityFromProbe(probe(true, NOW), NOW + REACHABILITY_FRESH_MS + 1)).toBe(
      'unknown'
    );
    expect(reachabilityFromProbe(probe(false, NOW), NOW + REACHABILITY_FRESH_MS + 1)).toBe(
      'unknown'
    );
  });

  test('green is unreachable without a successful probe', () => {
    const everyState = [probe(false), undefined].map((value) => reachabilityFromProbe(value, NOW));
    expect(everyState).not.toContain('live');
  });
});

describe('when the list asks again', () => {
  test('a server with no answer yet is asked immediately', () => {
    expect(needsReachabilityProbe(undefined, NOW)).toBe(true);
  });

  test('a recent answer is reused rather than re-asked on every focus', () => {
    expect(needsReachabilityProbe(probe(true, NOW), NOW + REACHABILITY_RECHECK_MS - 1)).toBe(false);
  });

  test('the answer is refreshed before it can expire', () => {
    // Recheck has to come first, or the card would sit on `unknown` in the gap
    // between the answer expiring and the next probe being allowed.
    expect(REACHABILITY_RECHECK_MS).toBeLessThan(REACHABILITY_FRESH_MS);
    expect(needsReachabilityProbe(probe(true, NOW), NOW + REACHABILITY_RECHECK_MS)).toBe(true);
  });
});

describe('whether an agent status is still worth colouring in', () => {
  test('a current snapshot on a live server keeps its colours', () => {
    expect(agentStatusesAreCurrent('live', false)).toBe(true);
  });

  test('a stale snapshot loses them', () => {
    expect(agentStatusesAreCurrent('live', true)).toBe(false);
  });

  test('a machine known not to be answering has nothing current to report', () => {
    // The snapshot may be minutes old and technically fresh, but we have just
    // been told the machine is not there, so its agents are not working now.
    expect(agentStatusesAreCurrent('offline', false)).toBe(false);
  });

  test('not having asked is not evidence against the snapshot', () => {
    // Every card except the one the app is configured for sits at `unknown`.
    // Dropping their colours would say "these are stale", which is a different
    // claim and an untrue one.
    expect(agentStatusesAreCurrent('unknown', false)).toBe(true);
  });
});

describe('which servers the list is willing to ask', () => {
  const ids = (records: { serverId: string }[]) => records.map((r) => r.serverId);
  const records = [{ serverId: 'a' }, { serverId: 'b' }, { serverId: 'c' }, { serverId: 'd' }];

  test('the configured server is asked first even when another was opened later', () => {
    // It is the one the app is pointed at and the one whose workspace is
    // warmed. Losing its place to a machine that happens to have been opened
    // more recently would make the dot the reader is waiting on the last to
    // fill in.
    const order = serversToProbe(records, { a: 10, b: 9_999, c: 20 }, 'a');
    expect(ids(order)[0]).toBe('a');
  });

  test('after that, most recently viewed wins', () => {
    expect(ids(serversToProbe(records, { b: 3, c: 9, d: 5 }, 'a'))).toEqual(['a', 'c', 'd', 'b']);
  });

  test('a server never opened here sorts last but keeps the list order', () => {
    // Arbitrary order among equals would make the four probed servers change
    // from launch to launch for no reason the reader could see.
    expect(ids(serversToProbe(records, { c: 5 }))).toEqual(['c', 'a', 'b', 'd']);
  });

  test('a fresh install with no marks at all probes top-down', () => {
    expect(ids(serversToProbe(records, {}))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('the ceiling holds, so a long-lived install does not contact everything', () => {
    // The reason the fan-out is allowed at all: bounded, it is a handful of
    // machines someone uses; unbounded, it is every host they ever paired,
    // contacted on every launch.
    const many = Array.from({ length: 20 }, (_, i) => ({ serverId: `s${i}` }));
    expect(serversToProbe(many, {}).length).toBe(MAX_PROBED_SERVERS);
    expect(MAX_PROBED_SERVERS).toBeLessThan(many.length);
  });

  test('the configured server survives the ceiling however stale it is', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ serverId: `s${i}` }));
    const viewed = Object.fromEntries(many.map((r, i) => [r.serverId, i]));
    expect(ids(serversToProbe(many, viewed, 's0'))).toContain('s0');
  });

  test('a configured id that is not in the list does not invent a row', () => {
    // The caller filters out tunnelled and demo records before calling, so the
    // configured server can legitimately be absent. It must not reappear here.
    expect(ids(serversToProbe(records, {}, 'gone'))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('a nonsense mark is treated as no mark rather than as a time', () => {
    // The marks come off disk. `NaN` sorting into the middle of the list would
    // be a silent reordering with no cause the reader could ever find.
    expect(ids(serversToProbe(records, { a: Number.NaN, b: 5 }))).toEqual(['b', 'a', 'c', 'd']);
  });

  test('asking for nothing asks nothing', () => {
    expect(serversToProbe(records, {}, 'a', 0)).toEqual([]);
  });

  test('the input is not reordered under the caller', () => {
    const input = [...records];
    serversToProbe(input, { d: 9 });
    expect(ids(input)).toEqual(['a', 'b', 'c', 'd']);
  });
});
