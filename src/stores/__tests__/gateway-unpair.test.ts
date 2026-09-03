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
 * They drive `removeRecord` itself rather than a local copy of its race, and
 * the records it removes are real ones, sealed and unsealed by the real
 * `gateway-storage` over a fake keychain. That matters twice over:
 *
 * - The forgiveness is decided by handing the timeout the store invents to
 *   `describeGatewayFailure`, which classifies it by *matching its message
 *   text* — "Timed out waiting for the server." is forgiven only because it
 *   contains the words "timed out". Rewriting that sentence would silently turn
 *   an unreachable gateway back into an error toast and a record that will not
 *   go away, which is the reported bug. A test that reimplements the race
 *   cannot see that coupling.
 * - "The record is gone" is asserted against storage that really removed it,
 *   not a stub that agreed to say so.
 *
 * What is stubbed is the far side of the network and nothing else: the gateway
 * client, because the whole point is to control what a gateway answers — and to
 * be able to make it answer nothing at all.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

import { fakeQuickCrypto, fakeSecureStore, resetVault } from '@/lib/__tests__/gateway-vault';
import type { GatewayRecord } from '@/lib/gateway-storage';

/** The two requests behind a revoke each carry this, hence the 16 s it fixes. */
const OLD_WORST_CASE_MS = 16_000;

const SERVER_ID = 'gone-1';

/** What the fake gateway does when asked to drop this device's token. */
let revoke: () => Promise<void> = async () => {};
let revokedFor: string[] = [];

/**
 * `t` and friends compile away in the app build; under `bun test` there is no
 * macro plugin, so they have to resolve to something. The shapes match what the
 * macros actually leave behind — `t` a string, `msg` a descriptor — so that a
 * suite which reaches this replacement by accident misbehaves loudly rather
 * than subtly.
 */
const interpolate = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), '');

mock.module('@lingui/core/macro', () => ({
  t: interpolate,
  plural: interpolate,
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const message = interpolate(strings, ...values);
    return { id: message, message };
  },
}));

mock.module('expo-secure-store', () => fakeSecureStore);
mock.module('react-native-quick-crypto', () => fakeQuickCrypto);

// The offline demo is a bundled asset the store only reaches through
// `enterDemo`, which nothing here calls; importing it for real would drag in
// `expo-asset` for no gain.
mock.module('@/lib/demo-gateway', () => ({
  demoRecord: { serverId: 'demo' },
  DEMO_SERVER_ID: 'demo',
}));

// The one edge that must stay under this test's control: these three are the
// whole of what the store imports from the gateway client.
mock.module('@/lib/gateway-client', () => ({
  configureGateway: () => {},
  setGatewayLabel: async () => {},
  revokeOwnGatewayPairing: async (target: GatewayRecord) => {
    revokedFor.push(target.serverId);
    await revoke();
  },
}));

const { useGatewayConnectionStore } = await import('@/stores/gateway-connection');
const { loadGateways, removeGateway, saveGateway } = await import('@/lib/gateway-storage');

/** A revoke that behaves like a machine that is no longer on the network. */
const neverAnswers = () => new Promise<void>(() => {});

beforeEach(async () => {
  revoke = async () => {};
  revokedFor = [];
  // Through the real API as well as the vault, so a record left behind by an
  // earlier test cannot survive as a stale selection pointer.
  for (const stale of await loadGateways()) await removeGateway(stale.serverId);
  resetVault();

  const record = await saveGateway({
    kind: 'muqun-gateway',
    server_id: SERVER_ID,
    label: 'a gateway that is no longer there',
    url: 'http://10.0.0.1:23947',
    token: 'a'.repeat(43),
    device_id: 'device-1',
    transport_key: 'k'.repeat(43),
    transport: 'muqun-aes-256-gcm-v1',
  });
  useGatewayConnectionStore.setState({ record, records: [record], loading: false });
});

function remainingIds() {
  return useGatewayConnectionStore.getState().records.map((item) => item.serverId);
}

/** What survived in the keychain, read back through the real unsealing. */
async function storedIds() {
  return (await loadGateways()).map((item) => item.serverId);
}

describe('the revoke that precedes forgetting a gateway', () => {
  test('a gateway that answers is asked first, then forgotten', async () => {
    await useGatewayConnectionStore.getState().removeRecord(SERVER_ID);

    expect(revokedFor).toEqual([SERVER_ID]);
    expect(remainingIds()).toEqual([]);
    expect(await storedIds()).toEqual([]);
  });

  test(
    'a gateway that never answers is given up on and forgotten anyway',
    async () => {
      revoke = neverAnswers;
      const started = Date.now();

      await useGatewayConnectionStore.getState().removeRecord(SERVER_ID);
      const waited = Date.now() - started;

      // Gone from the list and gone from the keychain: an unreachable gateway
      // must not be able to pin a dead pairing to the app forever.
      expect(remainingIds()).toEqual([]);
      expect(await storedIds()).toEqual([]);
      // And the reader was released long before the two 8 s request budgets
      // behind the revoke would have elapsed. This is the reported bug.
      expect(waited).toBeLessThan(OLD_WORST_CASE_MS / 2);
      // The wait is real, though — the gateway is asked, not skipped.
      expect(revokedFor).toEqual([SERVER_ID]);
    },
    OLD_WORST_CASE_MS
  );

  test('a network failure is forgiven the same way an unreachable one is', async () => {
    revoke = async () => {
      throw new Error('Network request failed');
    };

    await useGatewayConnectionStore.getState().removeRecord(SERVER_ID);

    expect(remainingIds()).toEqual([]);
    expect(await storedIds()).toEqual([]);
  });

  test('a gateway that is there and says no still blocks the removal', async () => {
    revoke = async () => {
      throw new Error('HTTP 401: {"code":"invalid_token"}');
    };

    await expect(useGatewayConnectionStore.getState().removeRecord(SERVER_ID)).rejects.toThrow();
    // Still listed, and still sealed in the keychain: a server that answered
    // and refused is not one whose token can be quietly abandoned.
    expect(remainingIds()).toEqual([SERVER_ID]);
    expect(await storedIds()).toEqual([SERVER_ID]);
  });

  test('a server fault blocks the removal too', async () => {
    revoke = async () => {
      throw new Error('HTTP 500: {"message":"boom"}');
    };

    await expect(useGatewayConnectionStore.getState().removeRecord(SERVER_ID)).rejects.toThrow();
    expect(await storedIds()).toEqual([SERVER_ID]);
  });

  test('removing a record the store does not hold asks no gateway anything', async () => {
    await useGatewayConnectionStore.getState().removeRecord('not-here');

    expect(revokedFor).toEqual([]);
    expect(remainingIds()).toEqual([SERVER_ID]);
    expect(await storedIds()).toEqual([SERVER_ID]);
  });
});
