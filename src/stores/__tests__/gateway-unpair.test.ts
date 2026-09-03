/**
 * Unpairing must never look like nothing happened.
 *
 * The store asks the gateway to drop this device's token before it forgets the
 * record. A gateway that is simply gone cannot answer, and the two requests
 * behind that ask carry an 8 s budget each: sixteen seconds in which a reader
 * who tapped Unpair sees no change at all. These tests pin the two halves of
 * the fix — the wait is capped, and an unreachable gateway still loses the
 * record.
 *
 * They drive `removeRecord` itself rather than a local copy of its race. That
 * distinction is the whole point of this file: the forgiveness is decided by
 * feeding the timeout the store invents to `describeGatewayFailure`, which
 * classifies it by *matching its message text* — the sentence
 * "Timed out waiting for the server." is forgiven only because it contains the
 * words "timed out". Rewriting that sentence would silently turn an
 * unreachable gateway back into an error toast and a record that will not go
 * away, which is precisely the reported bug. A test that reimplements the race
 * cannot see that coupling; this one breaks when it is cut.
 *
 * The native edges the store sits on — SecureStore behind the record storage,
 * fetch behind the gateway client — are the only things stubbed. Everything
 * being asserted is the shipped module.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

import type { GatewayRecord } from '@/lib/gateway-storage';

/** The two requests behind a revoke each carry this, hence the 16 s it fixes. */
const OLD_WORST_CASE_MS = 16_000;

const record: GatewayRecord = {
  serverId: 'gone-1',
  label: 'a gateway that is no longer there',
  url: 'http://10.0.0.1:23947',
  token: 'token',
  pairedAt: 0,
};

/** What the fake gateway does when asked to drop this device's token. */
let revoke: () => Promise<void> = async () => {};
let revokedFor: string[] = [];
/** Stands in for the SecureStore-backed record list. */
let stored: GatewayRecord[] = [];

const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), '');

mock.module('@lingui/core/macro', () => ({ t: tag, msg: tag, plural: tag }));
mock.module('@/lib/demo-gateway', () => ({
  demoRecord: { serverId: 'demo' },
  DEMO_SERVER_ID: 'demo',
}));
mock.module('@/lib/gateway-client', () => ({
  configureGateway: () => {},
  setGatewayLabel: async () => {},
  revokeOwnGatewayPairing: async (target: GatewayRecord) => {
    revokedFor.push(target.serverId);
    await revoke();
  },
}));
mock.module('@/lib/gateway-storage', () => ({
  clearGateway: async () => {},
  loadGateway: async () => stored[0] ?? null,
  loadGateways: async () => stored,
  removeGateway: async (serverId: string) => {
    stored = stored.filter((item) => item.serverId !== serverId);
    return stored;
  },
  renameGateway: async () => stored,
  selectGateway: async () => stored,
  updateGateway: async () => stored,
}));

const { useGatewayConnectionStore } = await import('@/stores/gateway-connection');

/** A revoke that behaves exactly like a machine that is no longer on the network. */
const neverAnswers = () => new Promise<void>(() => {});

beforeEach(() => {
  revoke = async () => {};
  revokedFor = [];
  stored = [record];
  useGatewayConnectionStore.setState({ record, records: [record], loading: false });
});

function remainingIds() {
  return useGatewayConnectionStore.getState().records.map((item) => item.serverId);
}

describe('the revoke that precedes forgetting a gateway', () => {
  test('a gateway that answers is asked first, then forgotten', async () => {
    await useGatewayConnectionStore.getState().removeRecord('gone-1');

    expect(revokedFor).toEqual(['gone-1']);
    expect(remainingIds()).toEqual([]);
  });

  test(
    'a gateway that never answers is given up on and forgotten anyway',
    async () => {
      revoke = neverAnswers;
      const started = Date.now();

      await useGatewayConnectionStore.getState().removeRecord('gone-1');
      const waited = Date.now() - started;

      // The record is gone: an unreachable gateway must not be able to pin a
      // dead pairing to the list forever.
      expect(remainingIds()).toEqual([]);
      // And the reader was released long before the two 8 s request budgets
      // behind the revoke would have elapsed. This is the reported bug.
      expect(waited).toBeLessThan(OLD_WORST_CASE_MS / 2);
      // The wait is real, though — the gateway is asked, not skipped.
      expect(revokedFor).toEqual(['gone-1']);
    },
    OLD_WORST_CASE_MS
  );

  test('a network failure is forgiven the same way an unreachable one is', async () => {
    revoke = async () => {
      throw new Error('Network request failed');
    };

    await useGatewayConnectionStore.getState().removeRecord('gone-1');

    expect(remainingIds()).toEqual([]);
  });

  test('a gateway that is there and says no still blocks the removal', async () => {
    revoke = async () => {
      throw new Error('HTTP 401: {"code":"invalid_token"}');
    };

    await expect(useGatewayConnectionStore.getState().removeRecord('gone-1')).rejects.toThrow();
    // Still listed: a server that answered and refused is not a server whose
    // token can be quietly abandoned.
    expect(remainingIds()).toEqual(['gone-1']);
  });

  test('a server fault blocks the removal too', async () => {
    revoke = async () => {
      throw new Error('HTTP 500: {"message":"boom"}');
    };

    await expect(useGatewayConnectionStore.getState().removeRecord('gone-1')).rejects.toThrow();
    expect(remainingIds()).toEqual(['gone-1']);
  });

  test('removing a record the store does not hold asks no gateway anything', async () => {
    await useGatewayConnectionStore.getState().removeRecord('not-here');

    expect(revokedFor).toEqual([]);
    expect(remainingIds()).toEqual(['gone-1']);
  });
});
