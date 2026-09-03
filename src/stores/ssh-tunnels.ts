import { create } from 'zustand';

import { refreshGatewayBaseUrl, setGatewayTunnelResolver } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { connectSsh, describeSshFailure } from '@/lib/ssh-client';
import { compareSshHostKey } from '@/lib/ssh-hosts';
import { sshFailureLine } from '@/lib/ssh-server-text';
import {
  MAX_TUNNEL_CONNECTIONS,
  SshTunnelManager,
  type TunnelConnectionHandle,
  type TunnelRecordInput,
  type TunnelState,
} from '@/lib/ssh-tunnel';
import { useSshConnectPromptStore } from '@/stores/ssh-connect-prompt';
import { useSshHostsStore } from '@/stores/ssh-hosts';

const IDLE_STATE: TunnelState = { phase: 'idle', baseUrl: null };

/**
 * Dial one SSH host for a tunnel. Credentials come from the sealed SSH secrets
 * blob and are read only here, at connect time; host-key trust uses the same
 * TOFU + "Replace key" rules as the terminal screen (`compareSshHostKey` plus
 * the shared dialog, driven through the app-wide prompt gate). A mismatch is
 * refused unless the reader explicitly replaces the key -- never auto-accepted.
 */
async function openConnection(
  hostId: string,
  events: { onDropped: (reason: string) => void }
): Promise<TunnelConnectionHandle> {
  const hostsStore = useSshHostsStore.getState();
  const record = hostsStore.hosts.find((item) => item.id === hostId);
  if (!record) {
    throw Object.assign(new Error('This SSH host is no longer saved.'), {
      name: 'SshError',
      code: 'UNKNOWN',
    });
  }
  const credential = await hostsStore.credentialFor(record);
  if (!credential) {
    throw Object.assign(new Error('This SSH host has no saved credential.'), {
      name: 'SshError',
      code: 'KEY',
    });
  }

  const prompts = useSshConnectPromptStore.getState();
  const session = await connectSsh({
    host: record.host,
    port: record.port,
    username: record.username,
    credential,
    verifyHostKey: async (key) => {
      const verdict = compareSshHostKey(record.trustedHostKey, key);
      if (verdict === 'match') return true;
      const accepted = await prompts.askHostKey(record.host, verdict, key, record.trustedHostKey);
      if (accepted) await useSshHostsStore.getState().setTrustedHostKey(record.id, key);
      return accepted;
    },
    onKeyboardInteractive: (challenge) => prompts.askKeyboardInteractive(challenge),
    onDisconnected: (reason) => events.onDropped(reason),
    // Pin the saved key's type so a multi-key host presents the same one, exactly
    // as the terminal screen does.
    hostKeyAlgorithms: record.trustedHostKey ? [record.trustedHostKey.algorithm] : undefined,
  });
  void useSshHostsStore.getState().markConnected(record.id);

  return {
    forwardLocal: (options, forwardEvents) =>
      session.forwardLocal(
        { remoteHost: options.remoteHost, remotePort: options.remotePort, maxConnections: MAX_TUNNEL_CONNECTIONS },
        forwardEvents
      ),
    disconnect: () => session.disconnect(),
  };
}

const manager = new SshTunnelManager({
  openConnection,
  // Sanitised and credential-free: the SSH screen's own one-line formatter.
  describeFailure: (error) => sshFailureLine(describeSshFailure(error)),
});

// The one seam: the gateway client resolves a tunnelled record's base URL
// through the live forward. A direct record ignores this.
setGatewayTunnelResolver((record) => manager.baseUrl(record.serverId));

function toInput(record: GatewayRecord): TunnelRecordInput | null {
  if (!record.sshTunnel) return null;
  return {
    serverId: record.serverId,
    hostId: record.sshTunnel.hostId,
    remoteHost: record.sshTunnel.remoteHost,
    remotePort: record.sshTunnel.remotePort,
  };
}

interface SshTunnelsState {
  states: Record<string, TunnelState>;
  /** A holder wants this record's forward up; reference counted. */
  hold: (record: GatewayRecord) => void;
  /** A holder let go; the forward is torn down when the last one does. */
  release: (record: GatewayRecord) => void;
  /** Reconnect after a `down`. */
  retry: (serverId: string) => void;
  /** Close held forwards on background if the session is idle; reopen on foreground. */
  setBackgroundedIdle: (backgroundedIdle: boolean) => void;
  stateFor: (record: GatewayRecord | null | undefined) => TunnelState;
  /**
   * Resolves with the loopback base URL once a held record's forward is open,
   * or rejects with the sanitised reason once it goes down. For a flow that
   * cannot proceed without the tunnel -- pairing through it.
   */
  waitForOpen: (serverId: string) => Promise<string>;
}

export const useSshTunnelsStore = create<SshTunnelsState>((set, get) => {
  manager.onChange((serverId, state) => {
    set((current) => ({ states: { ...current.states, [serverId]: state } }));
    // If this is the record the gateway client is configured for, repoint it at
    // the (now open, or now gone) forward without a re-pair.
    refreshGatewayBaseUrl();
  });

  return {
    states: {},

    hold(record) {
      const input = toInput(record);
      if (input) manager.hold(input);
    },

    release(record) {
      if (record.sshTunnel) manager.release(record.serverId);
    },

    retry(serverId) {
      manager.retry(serverId);
    },

    setBackgroundedIdle(backgroundedIdle) {
      manager.setBackgroundedIdle(backgroundedIdle);
    },

    stateFor(record) {
      if (!record?.sshTunnel) return IDLE_STATE;
      return get().states[record.serverId] ?? manager.state(record.serverId);
    },

    waitForOpen(serverId) {
      return new Promise<string>((resolve, reject) => {
        const settle = (state: TunnelState | undefined): boolean => {
          if (state?.phase === 'open' && state.baseUrl) {
            resolve(state.baseUrl);
            return true;
          }
          if (state?.phase === 'down') {
            reject(new Error(state.reason || 'tunnel down'));
            return true;
          }
          return false;
        };
        if (settle(manager.state(serverId))) return;
        const unsubscribe = useSshTunnelsStore.subscribe((current) => {
          if (settle(current.states[serverId])) unsubscribe();
        });
      });
    },
  };
});
