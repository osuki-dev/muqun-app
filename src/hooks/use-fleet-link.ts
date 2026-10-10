import { useEffect, useEffectEvent } from 'react';

import { recordEndpoint } from '@/hooks/use-server-tasks';
import { recoverWith } from '@/lib/compiler-safe-control-flow';
import { isDemoRecord } from '@/lib/demo-gateway';
import {
  failureKey,
  fetchCapabilities,
  fetchFleetPeers,
  FLEET_PEERS_CAPABILITY,
  hasFleetPeers,
  LINK_RETRY_MS,
  linkPeer,
  mintPairingCode,
  planFleetLinks,
  planRenames,
  planTombstoneUnlinks,
  renamePeer,
  unlinkPeer,
  type FleetComputer,
} from '@/lib/fleet-peers';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerReachability } from '@/stores/server-reachability';

/** The background schedule; a trigger the reader caused runs at once. */
export const FLEET_LINK_EVERY_MS = 10 * 60_000;
/** How often the schedule looks; the run itself waits out `FLEET_LINK_EVERY_MS`. */
const SCHEDULE_TICK_MS = 60_000;

type Reason = 'paired' | 'online' | 'settings' | 'unpaired' | 'schedule';

/**
 * One run at a time. A trigger during a run joins it, and one the reader
 * caused (a computer paired or unpaired mid-run) also asks for one more pass
 * after it.
 */
let running: Promise<void> | null = null;
let again = false;

/**
 * Link every computer paired to this phone with every other one that takes
 * work (spec §4.1): ask B for a pairing code, hand it to A. Also take every
 * computer the phone unpaired off the others. Quiet: a failure is remembered
 * for the Settings line and tried again after `LINK_RETRY_MS`.
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

function linkable(): GatewayRecord[] {
  return useGatewayConnectionStore
    .getState()
    .records.filter((record) => !record.sshTunnel && !isDemoRecord(record));
}

/** The record for `serverId` if the phone still holds it right now. */
function stillPaired(serverId: string): GatewayRecord | undefined {
  return linkable().find((record) => record.serverId === serverId);
}

async function runOnce(reason: Reason): Promise<void> {
  const fleet = useFleetPeers.getState();
  const nowMs = Date.now();
  // Only the schedule is held to the schedule; a trigger the reader caused
  // runs now (failed pairs still wait out LINK_RETRY_MS inside the plan).
  if (reason === 'schedule' && nowMs - fleet.lastRunMs < FLEET_LINK_EVERY_MS) return;
  fleet.ran(nowMs);
  await useServerCapabilities.getState().hydrate();
  const paired = linkable();
  // Paired again: no longer a computer to take off the others.
  useFleetPeers.getState().unbury(paired.map((record) => record.serverId));
  // A computer never opened on this phone, or upgraded since it last was,
  // has no `fleet_peers` mirrored: ask its public list once per run (§10.18).
  await Promise.all(
    paired
      .filter(
        (record) =>
          !useServerCapabilities
            .getState()
            .byServer[record.serverId]?.includes(FLEET_PEERS_CAPABILITY)
      )
      .map(async (record) => {
        const listed = await fetchCapabilities(recordEndpoint(record));
        if (listed) await useServerCapabilities.getState().record(record.serverId, listed);
      })
  );
  const capabilities = useServerCapabilities.getState().byServer;
  const records = paired.filter((record) => hasFleetPeers(capabilities[record.serverId]));
  const computers: FleetComputer[] = await Promise.all(
    records.map(async (record) => {
      const result = await fetchFleetPeers(recordEndpoint(record));
      useFleetPeers.getState().record(record.serverId, result);
      return {
        serverId: record.serverId,
        label: record.label.trim(),
        url: record.url,
        peers: result.ok ? result.peers : null,
      };
    })
  );
  useFleetPeers.getState().keepOnly(records.map((record) => record.serverId));

  await buryUnpaired(computers);

  // One pending code per computer at a time: link the pairs one after another.
  // A code minted on B and not claimed holds B for its TTL, so after one step
  // into B fails, the run leaves B alone.
  const busy = new Set<string>();
  for (const step of planFleetLinks(computers, useFleetPeers.getState().failures, nowMs)) {
    if (busy.has(step.to)) continue;
    // Checked now, not at the start: the reader may have unpaired either one
    // while this run was busy, and a computer gone from the phone is never linked.
    const from = stillPaired(step.from);
    const to = stillPaired(step.to);
    if (!from || !to) continue;
    const linked = await recoverWith(
      async () => {
        const { requestId, code } = await mintPairingCode(recordEndpoint(to), {
          name: from.label,
          serverId: from.serverId,
        });
        await linkPeer(recordEndpoint(from), {
          url: to.url,
          name: to.label.trim(),
          requestId,
          code,
        });
        return true;
      },
      () => false
    );
    if (linked) {
      useFleetPeers.getState().succeed(step.from, step.to);
      useFleetPeers.getState().record(step.from, await fetchFleetPeers(recordEndpoint(from)));
    } else {
      busy.add(step.to);
      useFleetPeers.getState().fail(step.from, step.to, Date.now());
    }
  }
  // Names follow the phone's labels (§10.16). A refusal (409: another peer
  // holds that name) waits out the retry window like a failed link.
  for (const rename of planRenames(computers)) {
    const failedAt = useFleetPeers.getState().failures[failureKey(rename.from, rename.peerId)];
    if (failedAt !== undefined && nowMs - failedAt < LINK_RETRY_MS) continue;
    const from = stillPaired(rename.from);
    if (!from) continue;
    const renamed = await renamePeer(recordEndpoint(from), rename.peerId, rename.name).then(
      () => true,
      () => false
    );
    if (renamed) useFleetPeers.getState().succeed(rename.from, rename.peerId);
    else useFleetPeers.getState().fail(rename.from, rename.peerId, Date.now());
  }
}

/**
 * Take every unpaired computer off every computer that answered. A tombstone
 * goes once every linkable computer has answered and holds no row of it; a
 * computer that did not answer keeps it for the next run.
 */
async function buryUnpaired(computers: readonly FleetComputer[]): Promise<void> {
  const tombstones = useFleetPeers.getState().tombstones;
  if (tombstones.length === 0) return;
  const left = new Set<string>();
  const removed = new Set<string>();
  for (const step of planTombstoneUnlinks(computers, tombstones)) {
    const from = stillPaired(step.from);
    const done =
      from !== undefined &&
      (await unlinkPeer(recordEndpoint(from), step.peerId).then(
        () => true,
        () => false
      ));
    if (done) removed.add(failureKey(step.from, step.peerId));
    else left.add(step.serverId);
  }
  for (const computer of computers) {
    const answer = computer.peers;
    // Silent: it may still hold any of them.
    if (!answer) {
      for (const id of tombstones) left.add(id);
      continue;
    }
    useFleetPeers.getState().setPeers(computer.serverId, {
      ...answer,
      peers: answer.peers.filter(
        (peer) => !removed.has(failureKey(computer.serverId, peer.peerId))
      ),
    });
  }
  useFleetPeers.getState().unbury(tombstones.filter((id) => !left.has(id)));
}

/**
 * The phone is forgetting `serverId`: every other computer forgets it too,
 * through their own credentials. Remembered until every one of them has, so
 * a computer asleep right now is cleaned on a later run.
 */
export async function unlinkEverywhere(serverId: string): Promise<void> {
  useFleetPeers.getState().bury(serverId);
  await reconcileFleet({ reason: 'unpaired' });
}

/**
 * The reconciler's triggers: a computer paired, a computer came online, one
 * started advertising `fleet_peers`, and the schedule.
 */
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
  const fleetIds = useServerCapabilities((state) =>
    Object.entries(state.byServer)
      .filter(([, names]) => hasFleetPeers(names))
      .map(([serverId]) => serverId)
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
    if (fleetIds) run('online');
  }, [fleetIds]);
  useEffect(() => {
    const timer = setInterval(() => run('schedule'), SCHEDULE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
