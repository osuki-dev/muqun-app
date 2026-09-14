import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { WorkControllerCache } from '../work-controller-cache';
import type { GatewayRecord } from '../gateway-storage';

const record: GatewayRecord = {
  serverId: 'gateway',
  label: 'Original name',
  url: 'https://example.invalid',
  token: 'test-token',
  pairedAt: 1,
};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
test('renaming a pairing preserves its owner, unresolved guard and draft', () => {
  const cache = new WorkControllerCache<{
    captured: GatewayRecord;
    pending: string;
    draft: string;
    deactivate(): void;
  }>(digest);
  const create = (captured: GatewayRecord) => ({
    captured,
    pending: 'unconfirmed-key',
    draft: 'Retain me',
    deactivate() {},
  });
  const original = cache.get(record, 'session', create);
  const renamed = cache.get({ ...record, label: 'Renamed' }, 'session', create);
  expect(renamed).toBe(original);
  expect(renamed.captured.label).toBe('Renamed');
  expect(renamed.pending).toBe('unconfirmed-key');
  expect(renamed.draft).toBe('Retain me');
});
test('credential generation changes invalidate every old session owner', () => {
  for (const change of [
    { token: 'replacement' },
    { pairedAt: 2 },
    { transportKey: 'replacement' },
    { deviceId: 'replacement' },
    { url: 'https://other.invalid' },
    { sshTunnel: { hostId: 'host', remoteHost: 'localhost', remotePort: 80 } },
  ]) {
    let invalidated = 0;
    const cache = new WorkControllerCache(digest);
    const create = () => ({
      deactivate() {
        invalidated++;
      },
    });
    const first = cache.get(record, 'session-a', create);
    cache.get(record, 'session-b', create);
    expect(cache.get({ ...record, ...change }, 'session-a', create) === first).toBe(false);
    expect(invalidated).toBe(2);
  }
});

test('unpairing clears every session presentation while preserving pending ownership', () => {
  const create = () => ({
    draft: 'private draft',
    pending: 'durable key',
    active: true,
    deactivate() {
      this.active = false;
    },
    clearPresentation() {
      this.draft = '';
    },
  });
  const cache = new WorkControllerCache<ReturnType<typeof create>>(digest);
  const first = cache.get(record, 'one', create);
  const second = cache.get(record, 'two', create);
  cache.retain([{ ...record, label: 'Safe rename' }]);
  expect(first.draft).toBe('private draft');
  cache.retain([]);
  expect([first.draft, second.draft]).toEqual(['', '']);
  expect(first.pending).toBe('durable key');
  expect(first.active).toBe(false);
  expect(cache.get(record, 'one', create)).not.toBe(first);
});
