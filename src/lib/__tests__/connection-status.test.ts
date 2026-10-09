// What a computer's row may say, from every channel the app holds to it.
//
// Device finding: a computer streaming an agent session read "Not connected"
// on Home, because the row only listened to a `/health` probe that was 45 s
// old and never re-run. These hold down the order of evidence.
import { describe, expect, test } from 'bun:test';

import {
  authorizationFromProbe,
  REACHABILITY_FRESH_MS,
  reachabilityOfStatus,
  resolveConnectionStatus,
  resolveServerReachability,
  statusRefusesPairing,
  type ReachabilityProbe,
} from '../server-reachability';

const NOW = 1_700_000_000_000;
const ID = 'srv-a';
const fresh = (ok: boolean, extra: Partial<ReachabilityProbe> = {}): ReachabilityProbe => ({
  serverId: ID,
  ok,
  checkedAtMs: NOW - 1000,
  ...extra,
});
const stale = (ok: boolean, extra: Partial<ReachabilityProbe> = {}): ReachabilityProbe => ({
  serverId: ID,
  ok,
  checkedAtMs: NOW - REACHABILITY_FRESH_MS - 1000,
  ...extra,
});

const status = (input: Omit<Parameters<typeof resolveConnectionStatus>[0], 'serverId'>) =>
  resolveConnectionStatus({ serverId: ID, nowMs: NOW, ...input });

describe('a live channel', () => {
  test('an open agent socket is live over a stale or failed probe', () => {
    expect(status({ probe: stale(false), channels: { socket: 'open' } })).toBe('live');
    expect(status({ probe: fresh(false), channels: { socket: 'open' } })).toBe('live');
    expect(status({ probe: undefined, channels: { socket: 'open' } })).toBe('live');
  });

  test('an open terminal stream is live', () => {
    expect(status({ probe: stale(true), channels: { stream: 'open' } })).toBe('live');
  });

  test('the workspace connection is live for its own computer only', () => {
    const activeConnection = { serverId: ID, phase: 'connected' as const };
    expect(status({ probe: undefined, activeConnection })).toBe('live');
    expect(
      status({ probe: undefined, activeConnection: { ...activeConnection, serverId: 'other' } })
    ).toBe('unknown');
  });

  test('a socket mid-handshake is not yet evidence', () => {
    expect(status({ probe: undefined, channels: { socket: 'connecting' } })).toBe('unknown');
  });
});

describe('the probe', () => {
  test('fresh answers speak; stale ones do not', () => {
    expect(status({ probe: fresh(true) })).toBe('live');
    expect(status({ probe: fresh(false) })).toBe('offline');
    expect(status({ probe: stale(true) })).toBe('unknown');
    expect(status({ probe: stale(false) })).toBe('unknown');
    expect(status({ probe: undefined })).toBe('unknown');
  });

  test('a fresh answer outranks a workspace channel that gave up', () => {
    const activeConnection = { serverId: ID, phase: 'offline' as const };
    expect(status({ probe: fresh(true), activeConnection })).toBe('live');
    expect(status({ probe: stale(true), activeConnection })).toBe('offline');
  });
});

describe('a refused pairing', () => {
  test('from the socket or the probe, it is unauthorized rather than offline', () => {
    expect(status({ probe: undefined, channels: { socket: 'unauthorized' } })).toBe('unauthorized');
    expect(status({ probe: fresh(false, { unauthorized: true }) })).toBe('unauthorized');
    // A refusal is not cured by time passing.
    expect(status({ probe: stale(false, { unauthorized: true }) })).toBe('unauthorized');
  });

  test('a live channel or a fresh answer still wins', () => {
    expect(
      status({ probe: fresh(false, { unauthorized: true }), channels: { stream: 'open' } })
    ).toBe('live');
    expect(status({ probe: fresh(true), channels: { socket: 'unauthorized' } })).toBe('live');
  });

  test('401 and 403 refuse; other answers do not', () => {
    expect(statusRefusesPairing(401)).toBe(true);
    expect(statusRefusesPairing(403)).toBe(true);
    for (const other of [200, 404, 500, 502, null, undefined]) {
      expect(statusRefusesPairing(other)).toBe(false);
    }
  });
});

describe('reconnecting', () => {
  test('only the selected computer, only while a channel is mid-reconnect', () => {
    for (const channels of [
      { socket: 'backoff' },
      { socket: 'connecting' },
      { stream: 'retrying' as const },
    ]) {
      expect(status({ probe: stale(true), channels, selected: true })).toBe('reconnecting');
      expect(status({ probe: stale(true), channels, selected: false })).toBe('unknown');
    }
    expect(
      status({
        probe: undefined,
        activeConnection: { serverId: ID, phase: 'reconnecting' },
        selected: true,
      })
    ).toBe('reconnecting');
  });

  test('a dead channel with nothing retrying stays not connected', () => {
    for (const socket of ['idle', 'paused', 'superseded', 'unavailable']) {
      expect(status({ probe: stale(true), channels: { socket }, selected: true })).toBe('unknown');
    }
  });

  test('a fresh failed probe says offline even while reconnecting', () => {
    expect(status({ probe: fresh(false), channels: { socket: 'backoff' }, selected: true })).toBe(
      'offline'
    );
  });
});

describe('folding back for decisions', () => {
  test('reconnecting is unknown and unauthorized is offline', () => {
    expect(reachabilityOfStatus('reconnecting')).toBe('unknown');
    expect(reachabilityOfStatus('unauthorized')).toBe('offline');
    expect(reachabilityOfStatus('live')).toBe('live');
  });

  test('resolveServerReachability reads the channels too', () => {
    expect(resolveServerReachability(ID, stale(false), undefined, NOW, { socket: 'open' })).toBe(
      'live'
    );
    expect(
      resolveServerReachability(ID, undefined, undefined, NOW, { socket: 'unauthorized' })
    ).toBe('offline');
  });
});

describe('the socket authorization check', () => {
  test('only an answer this probe heard decides', () => {
    const before = NOW - 60_000;
    expect(authorizationFromProbe(before, fresh(true, { status: 200 }))).toBe('authorized');
    expect(authorizationFromProbe(before, fresh(false, { status: 401 }))).toBe('unauthorized');
    expect(authorizationFromProbe(before, fresh(false, { status: 403 }))).toBe('unauthorized');
    expect(authorizationFromProbe(before, fresh(false, { status: 502 }))).toBe('unknown');
  });

  test('a timed-out probe carrying an earlier 401 does not refuse', () => {
    const before = NOW - 60_000;
    expect(authorizationFromProbe(before, fresh(false, { unauthorized: true, status: null }))).toBe(
      'unknown'
    );
  });

  test('a probe that did not run (joined nothing new) says nothing', () => {
    const held = fresh(false, { unauthorized: true, status: 401 });
    expect(authorizationFromProbe(held.checkedAtMs, held)).toBe('unknown');
    expect(authorizationFromProbe(undefined, undefined)).toBe('unknown');
  });
});
