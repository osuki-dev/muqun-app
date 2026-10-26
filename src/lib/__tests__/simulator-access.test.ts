import { describe, expect, test } from 'bun:test';

import { probeSimulatorAccess } from '../simulator-access';
import type { GatewayRecord } from '../gateway-storage';

const record: GatewayRecord = {
  serverId: 'session-computer',
  label: 'Computer',
  url: 'https://session.example',
  token: 'session-computer-token',
  pairedAt: 1,
};

describe('simulator computer access', () => {
  test('probes the captured computer using only its own endpoint and credentials', async () => {
    const result = await probeSimulatorAccess(
      record,
      false,
      async (endpoint, _timeout, onHealth) => {
        expect(endpoint).toBe(record);
        onHealth({
          ok: true,
          serverId: record.serverId,
          transportSecurity: { protection: 'https' },
        });
        return true;
      }
    );
    expect(result).toEqual({ status: 'ready' });
  });

  test('never probes demo or SSH records, even when the saved URL appears secure', async () => {
    let calls = 0;
    const probe = async () => {
      calls += 1;
      return true;
    };
    expect(await probeSimulatorAccess(record, true, probe)).toEqual({
      status: 'blocked',
      reason: 'demo',
    });
    const tunnel = {
      ...record,
      sshTunnel: { hostId: 'host', remoteHost: '127.0.0.1', remotePort: 23847 },
    };
    expect(await probeSimulatorAccess(tunnel, false, probe)).toEqual({
      status: 'blocked',
      reason: 'ssh-tunnel',
    });
    expect(calls).toBe(0);
  });

  test('refuses another computer, malformed health and unknown transport regardless of allowed hints', async () => {
    for (const health of [
      null,
      [],
      {},
      { ok: true, serverId: 'home-computer', transportSecurity: { protection: 'https' } },
      { ok: false, serverId: record.serverId, transportSecurity: { protection: 'https' } },
      { ok: true, serverId: record.serverId, allowed: '1' },
      ...['local-only', 'unencrypted-http', 'future', 1].map((protection) => ({
        ok: true,
        serverId: record.serverId,
        allowed: '1',
        transportSecurity: { protection },
      })),
    ]) {
      const result = await probeSimulatorAccess(
        record,
        false,
        async (_record, _timeout, onHealth) => {
          onHealth(health);
          return true;
        }
      );
      expect(result.status).toBe('blocked');
    }
    expect(await probeSimulatorAccess(record, false, async () => false)).toEqual({
      status: 'offline',
    });
  });
});
