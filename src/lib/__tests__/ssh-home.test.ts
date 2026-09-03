/**
 * The home screen's view of the saved SSH hosts: which rows, in what order,
 * and what each one says about itself.
 */
import { describe, expect, test } from 'bun:test';

import { sortSshHomeHosts, sshHomeAge, sshHomeRows, sshHomeSubtitle } from '@/lib/ssh-home';
import type { SshHostRecord } from '@/lib/ssh-hosts';

const NOW = 1_800_000_000_000;

function host(overrides: Partial<SshHostRecord> & { id: string }): SshHostRecord {
  return {
    label: overrides.id,
    host: 'example.test',
    port: 22,
    username: 'me',
    auth: { type: 'password' },
    createdAt: NOW - 86_400_000,
    ...overrides,
  };
}

const demo = host({ id: 'demo', label: 'Demo shell', host: 'demo.invalid', username: 'demo', createdAt: 0 });

describe('sshHomeRows', () => {
  test('is empty with no hosts and no demo, so the section stays hidden', () => {
    expect(sshHomeRows([], null)).toEqual([]);
  });

  test('lists the saved hosts when there is no demo', () => {
    const rows = sshHomeRows([host({ id: 'a' })], null);
    expect(rows.map((row) => row.id)).toEqual(['a']);
  });

  test('pins the demo host above the saved ones while the demo is on', () => {
    const rows = sshHomeRows([host({ id: 'a', lastConnectedAt: NOW })], demo);
    expect(rows.map((row) => row.id)).toEqual(['demo', 'a']);
  });

  test('shows the demo host alone while the demo is on and nothing is saved', () => {
    expect(sshHomeRows([], demo).map((row) => row.id)).toEqual(['demo']);
  });

  test('does not mutate the list it is handed', () => {
    const hosts = [host({ id: 'b' }), host({ id: 'a' })];
    sshHomeRows(hosts, null);
    expect(hosts.map((row) => row.id)).toEqual(['b', 'a']);
  });
});

describe('sortSshHomeHosts', () => {
  test('puts the most recently connected host first', () => {
    const rows = sortSshHomeHosts([
      host({ id: 'old', label: 'Alpha', lastConnectedAt: NOW - 60_000 }),
      host({ id: 'new', label: 'Zulu', lastConnectedAt: NOW }),
      host({ id: 'never', label: 'Mid' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['new', 'old', 'never']);
  });

  test('orders hosts never connected to by label', () => {
    const rows = sortSshHomeHosts([
      host({ id: 'c', label: 'charlie' }),
      host({ id: 'a', label: 'alpha' }),
      host({ id: 'b', label: 'Bravo' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  test('breaks a tied label on the newer record', () => {
    const rows = sortSshHomeHosts([
      host({ id: 'older', label: 'same', createdAt: 10 }),
      host({ id: 'newer', label: 'same', createdAt: 20 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['newer', 'older']);
  });
});

describe('sshHomeSubtitle', () => {
  test('is user@host, with the port only when it is not the default', () => {
    expect(sshHomeSubtitle({ username: 'test', host: '127.0.0.1', port: 22 })).toBe('test@127.0.0.1');
    expect(sshHomeSubtitle({ username: 'test', host: '127.0.0.1', port: 2232 })).toBe('test@127.0.0.1:2232');
  });
});

describe('sshHomeAge', () => {
  test('is never for a host that has not been connected to', () => {
    expect(sshHomeAge({}, NOW)).toEqual({ unit: 'never' });
    expect(sshHomeAge({ lastConnectedAt: 0 }, NOW)).toEqual({ unit: 'never' });
    expect(sshHomeAge({ lastConnectedAt: Number.NaN }, NOW)).toEqual({ unit: 'never' });
  });

  test('buckets the age into now, minutes, hours and days', () => {
    expect(sshHomeAge({ lastConnectedAt: NOW - 30_000 }, NOW)).toEqual({ unit: 'now' });
    expect(sshHomeAge({ lastConnectedAt: NOW - 5 * 60_000 }, NOW)).toEqual({ unit: 'minute', value: 5 });
    expect(sshHomeAge({ lastConnectedAt: NOW - 3 * 3_600_000 }, NOW)).toEqual({ unit: 'hour', value: 3 });
    expect(sshHomeAge({ lastConnectedAt: NOW - 2 * 86_400_000 }, NOW)).toEqual({ unit: 'day', value: 2 });
  });

  test('treats a timestamp from the future as just now', () => {
    expect(sshHomeAge({ lastConnectedAt: NOW + 60_000 }, NOW)).toEqual({ unit: 'now' });
  });
});
