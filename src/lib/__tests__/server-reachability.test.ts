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
  needsReachabilityProbe,
  reachabilityFromProbe,
  REACHABILITY_FRESH_MS,
  REACHABILITY_RECHECK_MS,
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
    expect(reachabilityFromProbe(probe(true, NOW), NOW + REACHABILITY_FRESH_MS + 1)).toBe('unknown');
    expect(reachabilityFromProbe(probe(false, NOW), NOW + REACHABILITY_FRESH_MS + 1)).toBe(
      'unknown'
    );
  });

  test('green is unreachable without a successful probe', () => {
    const everyState = [probe(false), undefined].map((value) =>
      reachabilityFromProbe(value, NOW)
    );
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
