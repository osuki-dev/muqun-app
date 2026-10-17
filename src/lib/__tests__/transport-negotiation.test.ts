import { expect, test } from 'bun:test';
import { TransportNegotiation, type TransportNegotiationIO } from '../transport-negotiation';

function fixture(versions?: number[]) {
  const calls: string[] = [];
  let pin: string | null = null;
  const io: TransportNegotiationIO = {
    readPin: async () => pin,
    writePin: async () => {
      calls.push('pin');
      pin = '2';
    },
    probe: async (version) => {
      calls.push(`health:${version}`);
      return versions ? { transport_versions: versions } : {};
    },
    requiresV2: (error) => error === 'required',
  };
  return { io, calls, pin: () => pin };
}

test('old gateways remain compatible; new gateways prove v2 before pinning and survive a cold start', async () => {
  const old = fixture();
  expect(await new TransportNegotiation().version('old', old.io)).toBe(1);
  expect(old.calls).toEqual(['health:1']);
  const latest = fixture([1, 2]);
  expect(await new TransportNegotiation().version('new', latest.io)).toBe(2);
  expect(latest.calls).toEqual(['health:1', 'health:2', 'pin']);
  latest.calls.length = 0;
  expect(await new TransportNegotiation().version('new', latest.io)).toBe(2);
  expect(latest.calls).toEqual([]);
});

test('failed pin persistence prevents the application operation after the read-only proof', async () => {
  const { io, calls } = fixture([1, 2]);
  let applications = 0;
  io.writePin = async () => {
    throw new Error('keychain locked');
  };
  await expect(
    new TransportNegotiation().version('a', io).then(() => applications++)
  ).rejects.toThrow('keychain locked');
  expect(calls).toEqual(['health:1', 'health:2']);
  expect(applications).toBe(0);
});

test('a lost v2 proof response leaves no pin and the next negotiation recovers from the server pin', async () => {
  const f = fixture([1, 2]);
  let serverPinned = false;
  let loseResponse = true;
  let applications = 0;
  f.io.probe = async (version) => {
    f.calls.push(`health:${version}`);
    if (version === 1 && serverPinned) throw 'required';
    if (version === 2) {
      serverPinned = true;
      if (loseResponse) throw new Error('lost response');
    }
    return { transport_versions: [1, 2] };
  };
  await expect(
    new TransportNegotiation().version('a', f.io).then(() => applications++)
  ).rejects.toThrow('lost response');
  expect(f.pin()).toBeNull();
  expect(applications).toBe(0);
  expect(f.calls).toEqual(['health:1', 'health:2']);
  loseResponse = false;
  f.calls.length = 0;
  expect(await new TransportNegotiation().version('a', f.io)).toBe(2);
  expect(f.calls).toEqual(['health:1', 'health:2', 'pin']);
  expect(f.pin()).toBe('2');
});

test('a forged 426 followed by a failed v2 proof cannot pin or retry an application operation', async () => {
  const f = fixture();
  let applications = 0;
  f.io.probe = async (version) => {
    f.calls.push(`health:${version}`);
    if (version === 1) throw 'required';
    throw new Error('v2 authentication failed');
  };
  const manager = new TransportNegotiation();
  await expect(manager.version('a', f.io).then(() => applications++)).rejects.toThrow(
    'v2 authentication failed'
  );
  expect(f.pin()).toBeNull();
  expect(applications).toBe(0);
  expect(f.calls).toEqual(['health:1', 'health:2']);
  // The injected refusal must not poison even the current launch's cache.
  f.io.probe = async () => ({});
  expect(await manager.version('a', f.io)).toBe(1);
});

test('concurrent callers share one negotiation, and credentials stay independent', async () => {
  const f = fixture([1, 2]);
  const manager = new TransportNegotiation();
  expect(await Promise.all([manager.version('a', f.io), manager.version('a', f.io)])).toEqual([
    2, 2,
  ]);
  expect(f.calls).toEqual(['health:1', 'health:2', 'pin']);
  const other = fixture();
  expect(await manager.version('b', other.io)).toBe(1);
});

test('legacy choices expire so upgrading a gateway is discovered', async () => {
  let now = 0;
  const f = fixture();
  const manager = new TransportNegotiation(() => now);
  await manager.version('a', f.io);
  await manager.version('a', f.io);
  expect(f.calls).toEqual(['health:1']);
  now = 60_001;
  f.io.probe = async () => ({ transport_versions: [1, 2] });
  expect(await manager.version('a', f.io)).toBe(2);
});

test('a minimum-version refusal permits only a read-only proof before pinning', async () => {
  const f = fixture();
  f.io.probe = async (version) => {
    f.calls.push(`health:${version}`);
    if (version === 1) throw 'required';
    return { transport_versions: [1, 2] };
  };
  expect(await new TransportNegotiation().version('a', f.io)).toBe(2);
  expect(f.calls).toEqual(['health:1', 'health:2', 'pin']);
});

test('unreadable pin and failed authentication never silently fall back', async () => {
  const f = fixture();
  f.io.readPin = async () => 'corrupt';
  await expect(new TransportNegotiation().version('a', f.io)).rejects.toThrow('Invalid saved');
  expect(f.calls).toEqual([]);
  f.io.readPin = async () => null;
  f.io.probe = async () => {
    throw new Error('authentication');
  };
  await expect(new TransportNegotiation().version('a', f.io)).rejects.toThrow('authentication');
  expect(f.pin()).toBeNull();
});
