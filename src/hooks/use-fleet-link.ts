import { useEffect, useEffectEvent } from 'react';

import { recordEndpoint } from '@/hooks/use-server-tasks';
import { recoverWith } from '@/lib/compiler-safe-control-flow';
import { isDemoRecord } from '@/lib/demo-gateway';
import {
  fetchCapabilities,
  fetchFleetPeers,
  hasFleetPeers,
  linkPeer,
  mintPairingCode,
  planFleetLinks,
  planRenames,
  renamePeer,
  unlinkPeer,
  type FleetComputer,
} from '@/lib/fleet-peers';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerReachability } from '@/stores/server-reachability';

/** The background schedule; a trigger the reader caused runs at once. */
export const FLEET_LINK_EVERY_MS = 10 * 60_000;

type Reason = 'paired' | 'online' | 'settings' | 'schedule';

/**
 * One run at a time. A trigger during a run joins it, and one the reader
 * caused (a computer paired mid-run) also asks for one more pass after it.
 */
let running: Promise<void> | null = null;
let again = false;

/**
 * Link every computer paired to this phone with every other one that takes
 * work (spec §4.1): ask B for a pairing code, hand it to A. Quiet: a failure
 * is remembered for the Settings line and tried again after `LINK_RETRY_MS`.
 */
export function reconcileFleet(opts: { reason: Reason }): Promise<void> {
  if (running) {
    if (opts.reason !== 'schedule') again = true;
    return running;
  }
  running = (async () => {
    await runOnce(opts.reason).catch(() => undefined);
    while (again) {
      again = false;
      await runOnce('settings').catch(() => undefined);
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

function linkable() {
  return useGatewayConnectionStore
    .getState()
    .records.filter((record) => !record.sshTunnel && !isDemoRecord(record));
}

async function runOnce(reason: Reason): Promise<void> {
  const fleet = useFleetPeers.getState();
  const nowMs = Date.now();
  // Only the schedule is held to the schedule; a trigger the reader caused
  // runs now (failed pairs still wait out LINK_RETRY_MS inside the plan).
  if (reason === 'schedule' && nowMs - fleet.lastRunMs < FLEET_LINK_EVERY_MS) return;
  fleet.ran(nowMs);
  await useServerCapabilities.getState().hydrate();
  // A computer never opened on this phone has no capabilities mirrored yet:
  // ask its public list once, so it is linked all the same (§10.18).
  const paired = linkable();
  await Promise.all(
    paired
      .filter((record) => !useServerCapabilities.getState().byServer[record.serverId])
      .map(async (record) => {
        const listed = await fetchCapabilities(recordEndpoint(record));
        if (listed) await useServerCapabilities.getState().record(record.serverId, listed);
      })
  );
  const capabilities = useServerCapabilities.getState().byServer;
  const records = paired.filter((record) => hasFleetPeers(capabilities[record.serverId]));
  const computers: FleetComputer[] = await Promise.all(
    records.map(async (record) => {
      const answer = await fetchFleetPeers(recordEndpoint(record));
      if (answer) useFleetPeers.getState().setPeers(record.serverId, answer);
      return { serverId: record.serverId, label: record.label, url: record.url, peers: answer };
    })
  );
  useFleetPeers.getState().keepOnly(records.map((record) => record.serverId));
  // One pending code per computer at a time: link the pairs one after another.
  for (const step of planFleetLinks(computers, useFleetPeers.getState().failures, nowMs)) {
    const from = records.find((record) => record.serverId === step.from);
    const to = records.find((record) => record.serverId === step.to);
    if (!from || !to) continue;
    const linked = await recoverWith(
      async () => {
        const { requestId, code } = await mintPairingCode(recordEndpoint(to), from.label);
        await linkPeer(recordEndpoint(from), { url: to.url, name: to.label, requestId, code });
        return true;
      },
      () => false
    );
    if (linked) {
      useFleetPeers.getState().succeed(step.from, step.to);
      const answer = await fetchFleetPeers(recordEndpoint(from));
      if (answer) useFleetPeers.getState().setPeers(step.from, answer);
    } else {
      useFleetPeers.getState().fail(step.from, step.to, Date.now());
    }
  }
  // Names follow the phone's labels (§10.16); a refusal (409: another peer
  // holds that name) is left for the next run, quietly.
  for (const rename of planRenames(computers)) {
    const from = records.find((record) => record.serverId === rename.from);
    if (!from) continue;
    await renamePeer(recordEndpoint(from), rename.peerId, rename.name).catch(() => undefined);
  }
}

/**
 * The phone is forgetting `serverId`: every other computer forgets it too.
 * Best effort, through the other computers' own credentials.
 */
export async function unlinkEverywhere(serverId: string): Promise<void> {
  const capabilities = useServerCapabilities.getState().byServer;
  const others = linkable().filter(
    (record) => record.serverId !== serverId && hasFleetPeers(capabilities[record.serverId])
  );
  await Promise.all(
    others.map(async (record) => {
      const endpoint = recordEndpoint(record);
      const answer = await fetchFleetPeers(endpoint);
      const gone = answer?.peers.filter((peer) => peer.serverId === serverId) ?? [];
      for (const peer of gone) await unlinkPeer(endpoint, peer.peerId).catch(() => undefined);
      if (answer && gone.length > 0) {
        useFleetPeers.getState().setPeers(record.serverId, {
          ...answer,
          peers: answer.peers.filter((peer) => peer.serverId !== serverId),
        });
      }
    })
  );
}

/** The reconciler's triggers: a computer paired, a computer came online, every 10 minutes. */
export function useFleetLink(): void {
  const serverIds = useGatewayConnectionStore((state) =>
    state.records.map((record) => record.serverId).join('\n')
  );
  const liveIds = useServerReachability((state) =>
    Object.values(state.probes)
      .filter((probe) => probe.ok)
      .map((probe) => probe.serverId)
      .sort()
      .join('\n')
  );
  const run = useEffectEvent((reason: Reason) => {
    void reconcileFleet({ reason });
  });
  // The first run on mount is the `paired` trigger; it is also the one that
  // links two computers paired before this build was installed.
  useEffect(() => {
    if (serverIds) run('paired');
  }, [serverIds]);
  useEffect(() => {
    if (liveIds) run('online');
  }, [liveIds]);
  useEffect(() => {
    const timer = setInterval(() => run('schedule'), FLEET_LINK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);
}
