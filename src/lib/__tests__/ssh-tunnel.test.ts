// The tunnel manager driven against a fake SSH facade: no native module, no
// phone, no zustand -- just the state machine, its reference counting, its
// teardown and its reconnect.
import { beforeEach, describe, expect, test } from 'bun:test';

import {
  MAX_TUNNEL_CONNECTIONS,
  SshTunnelManager,
  tunnelBaseUrl,
  type TunnelConnectionHandle,
  type TunnelDeps,
  type TunnelForwardHandle,
  type TunnelRecordInput,
} from '../ssh-tunnel';

function record(serverId: string, hostId = 'host-a', remotePort = 23847): TunnelRecordInput {
  return { serverId, hostId, remoteHost: '127.0.0.1', remotePort };
}

/** A fake SSH host: connections it hands out, and hooks to drop them. */
class FakeSsh {
  connectCount = 0;
  disconnectCount = 0;
  nextPort = 40000;
  /** hostId -> the live connection's drop trigger. */
  private dropped = new Map<string, (reason: string) => void>();
  /** serverId -> the live forward's close trigger. */
  private forwardClosed = new Map<string, (reason: string) => void>();
  /** Make the next openConnection reject. */
  failNextConnect: string | null = null;

  deps(): TunnelDeps {
    return {
      openConnection: (hostId: string, events: { onDropped: (reason: string) => void }) => {
        if (this.failNextConnect) {
          const reason = this.failNextConnect;
          this.failNextConnect = null;
          return Promise.reject(new Error(reason));
        }
        this.connectCount += 1;
        this.dropped.set(hostId, events.onDropped);
        const handle: TunnelConnectionHandle = {
          forwardLocal: (opts: { remoteHost: string; remotePort: number }, fwEvents: { onClosed?: (reason: string) => void }) => {
            const port = this.nextPort++;
            // Key the close trigger by the port so two forwards on one host stay distinct.
            const forward: TunnelForwardHandle = {
              localPort: port,
              close: () => Promise.resolve(),
            };
            (forward as unknown as { remotePort: number }).remotePort = opts.remotePort;
            this.forwardClosed.set(`${hostId}:${opts.remotePort}`, fwEvents.onClosed ?? (() => {}));
            return Promise.resolve(forward);
          },
          disconnect: () => {
            this.disconnectCount += 1;
            return Promise.resolve();
          },
        };
        return Promise.resolve(handle);
      },
      describeFailure: (error) => (error instanceof Error ? error.message : String(error)),
    };
  }

  dropHost(hostId: string, reason = 'connection lost') {
    this.dropped.get(hostId)?.(reason);
    this.dropped.delete(hostId);
  }

  closeForward(hostId: string, remotePort: number, reason = 'forward closed') {
    this.forwardClosed.get(`${hostId}:${remotePort}`)?.(reason);
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let ssh: FakeSsh;
let manager: SshTunnelManager;
const states: { serverId: string; phase: string }[] = [];

beforeEach(() => {
  ssh = new FakeSsh();
  manager = new SshTunnelManager(ssh.deps());
  states.length = 0;
  manager.onChange((serverId, state) => states.push({ serverId, phase: state.phase }));
});

describe('URL derivation', () => {
  test('the tunnel base URL is loopback with the ephemeral port', () => {
    expect(tunnelBaseUrl(40123)).toBe('http://127.0.0.1:40123');
  });
});

describe('hold and open', () => {
  test('holding a record opens a connection then a forward and reports a loopback base URL', async () => {
    manager.hold(record('s1'));
    expect(manager.state('s1').phase).toBe('connecting');
    await tick();
    const state = manager.state('s1');
    expect(state.phase).toBe('open');
    expect(/^http:\/\/127\.0\.0\.1:\d+$/.test(state.baseUrl ?? '')).toBe(true);
    expect(manager.baseUrl('s1')).toBe(state.baseUrl);
    expect(ssh.connectCount).toBe(1);
    expect(states.map((s) => s.phase)).toEqual(['connecting', 'open']);
  });

  test('two holds and one release keep the forward open', async () => {
    manager.hold(record('s1'));
    manager.hold(record('s1'));
    await tick();
    manager.release('s1');
    await tick();
    expect(manager.state('s1').phase).toBe('open');
  });
});

describe('teardown', () => {
  test('releasing the last holder closes the forward and disconnects the host', async () => {
    manager.hold(record('s1'));
    await tick();
    manager.release('s1');
    await tick();
    expect(manager.state('s1').phase).toBe('idle');
    expect(manager.baseUrl('s1')).toBeNull();
    expect(ssh.disconnectCount).toBe(1);
  });
});

describe('one host, two gateways', () => {
  test('two records over one host share the connection but get independent forwards', async () => {
    manager.hold(record('s1', 'host-a', 23847));
    manager.hold(record('s2', 'host-a', 9999));
    await tick();
    expect(ssh.connectCount).toBe(1);
    expect(manager.state('s1').phase).toBe('open');
    expect(manager.state('s2').phase).toBe('open');
    expect(manager.baseUrl('s1')).not.toBe(manager.baseUrl('s2'));
    // Releasing one leaves the other and the shared connection alive.
    manager.release('s1');
    await tick();
    expect(manager.state('s2').phase).toBe('open');
    expect(ssh.disconnectCount).toBe(0);
    manager.release('s2');
    await tick();
    expect(ssh.disconnectCount).toBe(1);
  });

  test('records on different hosts open one connection each', async () => {
    manager.hold(record('s1', 'host-a'));
    manager.hold(record('s2', 'host-b'));
    await tick();
    expect(ssh.connectCount).toBe(2);
  });
});

describe('reconnect', () => {
  test('a forward that closes under a holder goes down, and retry reopens it', async () => {
    manager.hold(record('s1', 'host-a', 23847));
    await tick();
    ssh.closeForward('host-a', 23847);
    expect(manager.state('s1').phase).toBe('down');
    expect(manager.baseUrl('s1')).toBeNull();
    manager.retry('s1');
    expect(manager.state('s1').phase).toBe('connecting');
    await tick();
    expect(manager.state('s1').phase).toBe('open');
  });

  test('the host connection dropping takes every rider down', async () => {
    manager.hold(record('s1', 'host-a', 1));
    manager.hold(record('s2', 'host-a', 2));
    await tick();
    ssh.dropHost('host-a');
    expect(manager.state('s1').phase).toBe('down');
    expect(manager.state('s2').phase).toBe('down');
  });

  test('a failed dial reports down and does not wedge the next attempt', async () => {
    ssh.failNextConnect = 'no route to host';
    manager.hold(record('s1'));
    await tick();
    expect(manager.state('s1').phase).toBe('down');
    expect(manager.state('s1').reason).toBe('no route to host');
    manager.retry('s1');
    await tick();
    expect(manager.state('s1').phase).toBe('open');
  });
});

describe('idle background', () => {
  test('backgrounding while idle closes held forwards, foregrounding reopens them', async () => {
    manager.hold(record('s1'));
    await tick();
    expect(manager.state('s1').phase).toBe('open');
    manager.setBackgroundedIdle(true);
    await tick();
    expect(manager.state('s1').phase).toBe('idle');
    expect(manager.baseUrl('s1')).toBeNull();
    manager.setBackgroundedIdle(false);
    expect(manager.state('s1').phase).toBe('connecting');
    await tick();
    expect(manager.state('s1').phase).toBe('open');
  });

  test('a hold taken while backgrounded-idle does not open until foreground', async () => {
    manager.setBackgroundedIdle(true);
    manager.hold(record('s1'));
    await tick();
    expect(manager.state('s1').phase).toBe('idle');
    manager.setBackgroundedIdle(false);
    await tick();
    expect(manager.state('s1').phase).toBe('open');
  });
});

describe('constants', () => {
  test('the connection cap stays small', () => {
    expect(MAX_TUNNEL_CONNECTIONS).toBe(8);
  });
});
