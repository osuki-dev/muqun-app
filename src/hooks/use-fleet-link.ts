import { useEffect, useEffectEvent } from 'react';
import { AppState } from 'react-native';

import { recordEndpoint } from '@/hooks/use-server-tasks';
import { recoverWith } from '@/lib/compiler-safe-control-flow';
import { isDemoRecord } from '@/lib/demo-gateway';
import {
  cancelPairingCode,
  fetchCapabilities,
  fetchFleetPeers,
  fetchPairedGateways,
  fetchSelfLabel,
  FLEET_PEERS_CAPABILITY,
  hasFleetPeers,
  linkPeer,
  mintPairingCode,
  movePeer,
  nameConflictOf,
  ownedBy,
  pairingsAnswer,
  planFleetLinks,
  recordedNames,
  planPeerMoves,
  revokePairing,
  sameFleetName,
  UNPAIR_STEPS,
  unlinkPeer,
  unpairComplete,
  unpairProgressAfter,
  unpairSeenDown,
  unpairStepsDue,
  type FleetComputer,
  type LinkNames,
  type NameConflict,
  type UnpairProgress,
  type UnpairStep,
} from '@/lib/fleet-peers';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useFleetUnpairs } from '@/stores/fleet-unpairs';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerReachability } from '@/stores/server-reachability';
import { probeSaysDown } from '@/lib/server-reachability';

/** The background schedule; a trigger the reader caused runs at once. */
export const FLEET_LINK_EVERY_MS = 10 * 60_000;
/** How often the schedule looks; the run itself waits out `FLEET_LINK_EVERY_MS`. */
const SCHEDULE_TICK_MS = 60_000;

/**
 * Why a run was asked for. `online` and `capabilities` only ever join a run
 * already going: they are what a run reads anyway.
 */
type Reason = 'paired' | 'online' | 'capabilities' | 'settings' | 'schedule';

/**
 * One run at a time. A trigger during a run joins it; only a change the run
 * cannot have seen -- a different set of paired computers, or the reader
 * turning a computer's switch on -- asks for one more pass after it.
 */
let running: Promise<void> | null = null;
let again = false;
/** The paired set the current (or last) run started from. */
let runPairedIds = '';
/** The computers whose `GET /api/peers` answered in the last run. */
let answeredLastRun = new Set<string>();
/** Each computer's `/health` apiVersion when its capabilities were last asked for here. */
const capabilitiesAskedAt = new Map<string, string | null>();

function pairedIds(): string {
  return linkable()
    .map((record) => record.serverId)
    .sort()
    .join('\n');
}

/**
 * Link every computer paired to this device with every other one that takes
 * work (spec §4.1): ask B for a pairing code, hand it to A under B's own
 * name. Quiet: a failure is remembered for the Settings line and tried again
 * after `LINK_RETRY_MS`; a name collision waits until a name changes. Never
 * renames or unlinks anything: another device of the reader's may hold
 * different labels and pairings, and both must be able to run this.
 */
export function reconcileFleet(opts: { reason: Reason }): Promise<void> {
  if (running) {
    if (opts.reason === 'settings' || (opts.reason === 'paired' && pairedIds() !== runPairedIds)) {
      again = true;
    }
    return running;
  }
  if (opts.reason === 'online' || opts.reason === 'capabilities') return Promise.resolve();
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

/** The record for `serverId` if the device still holds it right now. */
function stillPaired(serverId: string): GatewayRecord | undefined {
  return linkable().find((record) => record.serverId === serverId);
}

/**
 * Home's probe says this computer is down: nothing to ask it this run. A
 * computer that answered and refused our token (401/403) is not down: it is
 * there, and the token may be one replaced since -- a computer paired again --
 * so the run asks it, and the answer it gets is the one that counts.
 */
function knownDown(serverId: string): boolean {
  return probeSaysDown(useServerReachability.getState().probes[serverId]);
}

/** The apiVersion the last `/health` of this computer gave, when Home read one. */
function probedApiVersion(serverId: string): string | null {
  const health = useServerReachability.getState().probes[serverId]?.health as
    | { apiVersion?: unknown }
    | null
    | undefined;
  return typeof health?.apiVersion === 'string' ? health.apiVersion : null;
}

/**
 * Ask `/api/capabilities` of a computer only when the device knows nothing of
 * it (never opened here, §10.18) or its gateway changed version since it was
 * last asked. Home's own probes record what `/health` lists; an older gateway
 * is not asked again on every run.
 */
function needsCapabilities(record: GatewayRecord): boolean {
  if (knownDown(record.serverId)) return false;
  const cached = useServerCapabilities.getState().byServer[record.serverId];
  if (cached?.includes(FLEET_PEERS_CAPABILITY)) return false;
  const version = probedApiVersion(record.serverId);
  if (!capabilitiesAskedAt.has(record.serverId)) return cached === undefined || version !== null;
  return version !== null && capabilitiesAskedAt.get(record.serverId) !== version;
}

async function runOnce(reason: Reason): Promise<void> {
  // Not while in the background (a headless wake): the next foreground run will.
  if (AppState.currentState !== 'active' && reason === 'schedule') return;
  const fleet = useFleetPeers.getState();
  const nowMs = Date.now();
  // Only the schedule is held to the schedule; a trigger the reader caused
  // runs now (failed pairs still wait out LINK_RETRY_MS inside the plan).
  if (reason === 'schedule' && nowMs - fleet.lastRunMs < FLEET_LINK_EVERY_MS) return;
  fleet.ran(nowMs);
  runPairedIds = pairedIds();
  await useServerCapabilities.getState().hydrate();
  const paired = linkable();
  await Promise.all(
    paired.filter(needsCapabilities).map(async (record) => {
      capabilitiesAskedAt.set(record.serverId, probedApiVersion(record.serverId));
      const listed = await fetchCapabilities(recordEndpoint(record));
      if (listed) await useServerCapabilities.getState().record(record.serverId, listed);
    })
  );
  const capabilities = useServerCapabilities.getState().byServer;
  const records = paired.filter((record) => hasFleetPeers(capabilities[record.serverId]));
  const computers: FleetComputer[] = await Promise.all(
    records.map(async (record) => {
      // One Home already knows is down keeps what it last said, unread.
      const result = knownDown(record.serverId)
        ? null
        : await fetchFleetPeers(recordEndpoint(record));
      if (result) useFleetPeers.getState().record(record.serverId, result);
      return {
        serverId: record.serverId,
        label: record.label.trim(),
        url: record.url,
        peers: result?.ok ? result.peers : null,
      };
    })
  );
  answeredLastRun = new Set(
    computers.filter((computer) => computer.peers).map((computer) => computer.serverId)
  );
  useFleetPeers.getState().keepOnly(records.map((record) => record.serverId));

  // Each computer's own label, asked at most once a run: the name its peers
  // know it by is its own, never this device's label for it.
  const labels = new Map<string, Promise<string | null>>();
  const labelOf = (record: GatewayRecord) => {
    let label = labels.get(record.serverId);
    if (!label) {
      label = fetchSelfLabel(recordEndpoint(record));
      labels.set(record.serverId, label);
    }
    return label;
  };

  await followUpUnpairs(computers);
  await settleConflicts(computers, labelOf);

  // One pending code per computer at a time: link the pairs one after another.
  // A code minted on B and not claimed is given back at once, so B is free
  // for the next pair; after one step into B fails, the run leaves B alone.
  const busy = new Set<string>();
  const { failures, conflicts } = useFleetPeers.getState();
  for (const step of planFleetLinks(computers, failures, nowMs, conflicts)) {
    if (busy.has(step.to)) continue;
    // Checked now, not at the start: the reader may have unpaired either one
    // while this run was busy, and a computer gone from the device is never linked.
    const from = stillPaired(step.from);
    const to = stillPaired(step.to);
    if (!from || !to) continue;
    const [fromName, toName] = await Promise.all([labelOf(from), labelOf(to)]);
    if (!fromName || !toName) {
      busy.add(step.to);
      useFleetPeers.getState().fail(step.from, step.to, Date.now());
      continue;
    }
    const outcome = await linkPair(from, to, fromName, toName);
    if (outcome === 'linked') {
      // What this device named the link on each side: the only names an
      // unpair may later match an older gateway's id-less rows and logins by.
      useFleetUnpairs.getState().linked(step.from, step.to, fromName, toName);
      useFleetPeers.getState().succeed(step.from, step.to);
      useFleetPeers.getState().record(step.from, await fetchFleetPeers(recordEndpoint(from)));
      continue;
    }
    busy.add(step.to);
    if (outcome === 'failed') {
      useFleetPeers.getState().fail(step.from, step.to, Date.now());
      continue;
    }
    const holder =
      outcome === 'peer'
        ? computers
            .find((entry) => entry.serverId === step.from)
            ?.peers?.peers.find((peer) => sameName(peer.name, toName))
        : undefined;
    useFleetPeers.getState().conflict(step.from, step.to, {
      name: toName,
      against: outcome,
      with: outcome === 'self' ? fromName : (holder?.name ?? toName),
      fromName,
      // Held under a server id this device does not know: an older entry for
      // the same machine, from before a reinstall.
      ...(holder && !linkable().some((record) => record.serverId === holder.serverId)
        ? { stale: true }
        : {}),
    });
  }

  // A peer that moved: told its address on this device, when it cannot be
  // reached at the one it has (and the gateway proves the new one first).
  for (const move of planPeerMoves(computers, useFleetPeers.getState().failures, nowMs)) {
    const from = stillPaired(move.from);
    if (!from) continue;
    const moved = await movePeer(recordEndpoint(from), move.peerId, move.url).then(
      () => true,
      () => false
    );
    if (moved) {
      useFleetPeers.getState().succeed(move.from, move.peerId);
      useFleetPeers.getState().record(move.from, await fetchFleetPeers(recordEndpoint(from)));
    } else {
      useFleetPeers.getState().fail(move.from, move.peerId, Date.now());
    }
  }
}

const sameName = sameFleetName;

/**
 * Mint a code on `to`, hand it to `from`. A code `from` did not claim is
 * given back on `to` so its one pending slot frees now, not when the code
 * expires; one past its lifetime is gone already and never used.
 */
async function linkPair(
  from: GatewayRecord,
  to: GatewayRecord,
  fromName: string,
  toName: string
): Promise<'linked' | 'failed' | 'self' | 'peer'> {
  const minted = await mintPairingCode(recordEndpoint(to), {
    name: fromName,
    serverId: from.serverId,
  }).catch(() => null);
  if (!minted) return 'failed';
  const mintedAtMs = Date.now();
  return recoverWith(
    async (): Promise<'linked' | 'failed' | 'self' | 'peer'> => {
      await linkPeer(recordEndpoint(from), {
        url: to.url,
        name: toName,
        requestId: minted.requestId,
        code: minted.code,
      });
      return 'linked';
    },
    async (failure) => {
      if (Date.now() - mintedAtMs < minted.expiresInMs) {
        await cancelPairingCode(recordEndpoint(to), minted.requestId);
      }
      return nameConflictOf(failure) ?? 'failed';
    }
  );
}

/**
 * Let go of every name collision whose names changed since: B's own label,
 * A's own label (`self`), or A no longer holding a peer by that name
 * (`peer`). Only the colliding pairs are asked anything.
 */
async function settleConflicts(
  computers: readonly FleetComputer[],
  labelOf: (record: GatewayRecord) => Promise<string | null>
): Promise<void> {
  const entries = Object.entries(useFleetPeers.getState().conflicts);
  for (const [key, conflict] of entries) {
    const [fromId = '', toId = ''] = key.split('\n');
    const from = stillPaired(fromId);
    const to = stillPaired(toId);
    if (!from || !to) continue;
    if (!(await stillColliding(conflict, from, to, computers, labelOf))) {
      useFleetPeers.getState().clearConflict(key);
    }
  }
}

async function stillColliding(
  conflict: NameConflict,
  from: GatewayRecord,
  to: GatewayRecord,
  computers: readonly FleetComputer[],
  labelOf: (record: GatewayRecord) => Promise<string | null>
): Promise<boolean> {
  const toName = await labelOf(to);
  // Not answering: nothing is known to have changed.
  if (toName === null) return true;
  if (toName !== conflict.name) return false;
  if (conflict.against === 'self') {
    const fromName = await labelOf(from);
    return fromName === null || sameName(fromName, toName);
  }
  const held = computers.find((entry) => entry.serverId === from.serverId)?.peers;
  return held === null || held === undefined
    ? true
    : held.peers.some((peer) => sameName(peer.name, toName));
}

/** What one computer's cleanup did: the steps confirmed. */
type UnlinkPass = {
  done: UnpairStep[];
  /** Its rows or logins carry no server id and none could be told apart. */
  needsNewerGateway: boolean;
};
const NO_PASS: UnlinkPass = { done: [], needsNewerGateway: false };

/**
 * Take `goneId` off one computer through its own credentials, running only
 * `steps`: its peer rows there (the gateway also asks it to revoke this
 * computer's token), and its gateway login there. Rows and logins are
 * matched by server id, or, from an older gateway that does not send one, by
 * the name this device itself gave that link on this computer (`recorded`),
 * when nothing else there shares it (`ownedBy`) -- never by a name an answer
 * supplied. A step that did not answer, failed, or could not be told apart
 * is not done.
 */
async function unlinkOn(
  record: GatewayRecord,
  goneId: string,
  recorded: LinkNames | undefined,
  steps: readonly UnpairStep[]
): Promise<UnlinkPass> {
  const endpoint = recordEndpoint(record);
  const pass: UnlinkPass = { done: [], needsNewerGateway: false };
  if (steps.includes('rows')) {
    const answer = await fetchFleetPeers(endpoint);
    if (answer.ok) {
      const { matched, undecided } = ownedBy(
        [
          ...answer.peers.peers,
          ...(answer.peers.unidentified ?? []).map((row) => ({ ...row, serverId: null })),
        ],
        goneId,
        recordedNames(recorded?.row)
      );
      let ok = !undecided;
      if (undecided) pass.needsNewerGateway = true;
      const removed = new Set<string>();
      for (const row of matched) {
        const done = await unlinkPeer(endpoint, row.peerId).then(
          () => true,
          () => false
        );
        if (done) removed.add(row.peerId);
        else ok = false;
      }
      useFleetPeers.getState().setPeers(record.serverId, {
        ...answer.peers,
        peers: answer.peers.peers.filter((peer) => !removed.has(peer.peerId)),
      });
      if (ok) pass.done.push('rows');
    }
  }
  if (steps.includes('logins')) {
    const listed = await fetchPairedGateways(endpoint);
    const logins = pairingsAnswer(
      listed,
      listed === 'no-route' ? await fetchCapabilities(endpoint) : null
    );
    // No answer is a step not done, never "no logins".
    if (logins !== null) {
      const { matched, undecided } = ownedBy(logins, goneId, recordedNames(recorded?.login));
      let ok = !undecided;
      if (undecided) pass.needsNewerGateway = true;
      for (const login of matched) {
        const revoked = await revokePairing(endpoint, login.deviceId).then(
          () => true,
          () => false
        );
        if (!revoked) ok = false;
      }
      if (ok) pass.done.push('logins');
    }
  }
  return pass;
}

/**
 * This device is about to unpair `leaving` (A5 D6), and still holds its
 * token: unlink it on both sides, in order --
 *
 * 1. on every other computer this device holds, its rows and login there;
 * 2. on `leaving` itself, its rows for those computers (so it stops listing
 *    them) and their logins there, with its own token, before that token is
 *    dropped.
 *
 * What could not be done is kept (`useFleetUnpairs`): a computer that was
 * down or refused is cleaned when it next answers, only the steps still
 * undone, by the names this device gave its links; one `leaving` still
 * lists, or may still hold a login of, is said on that computer's Settings
 * line, since this device can no longer reach `leaving` once it is unpaired.
 * This is this device finishing its own unpair, never a set-difference
 * unlink, so another device that keeps the computer paired is never fought.
 */
export async function unlinkBeforeUnpair(leaving: GatewayRecord): Promise<void> {
  // After any run in flight, so it cannot link the computer back meanwhile.
  await running?.catch(() => undefined);
  // Read before deciding who is pending: an unhydrated store would say nobody is.
  await useServerCapabilities.getState().hydrate();
  const capabilities = useServerCapabilities.getState().byServer;
  const others = linkable().filter(
    (record) => record.serverId !== leaving.serverId && hasFleetPeers(capabilities[record.serverId])
  );
  const leavingUp = !knownDown(leaving.serverId);
  const endpoint = recordEndpoint(leaving);
  // What this device named each link it made, kept with the record so the
  // follow-up has them after the computer is gone from this device.
  const recorded = useFleetUnpairs.getState().linkNames;
  const pending: string[] = [];
  const progress: Record<string, UnpairProgress> = {};
  const linkNames: Record<string, LinkNames> = {};
  for (const record of others) {
    const names = recorded[record.serverId]?.[leaving.serverId];
    if (knownDown(record.serverId)) {
      pending.push(record.serverId);
      if (names) linkNames[record.serverId] = names;
      continue;
    }
    const pass = await unlinkOn(record, leaving.serverId, names, UNPAIR_STEPS).catch(
      (): UnlinkPass => NO_PASS
    );
    const after = unpairProgressAfter(
      undefined,
      pass.done,
      record.pairedAt,
      pass.needsNewerGateway
    );
    if (unpairComplete(after)) continue;
    pending.push(record.serverId);
    progress[record.serverId] = after;
    if (names) linkNames[record.serverId] = names;
  }
  const otherIds = new Set(others.map((record) => record.serverId));
  let stillListedBy: string[] = [];
  if (hasFleetPeers(capabilities[leaving.serverId])) {
    const answer = leavingUp ? await fetchFleetPeers(endpoint) : null;
    // The others it was linked with, as far as anyone here knows: its rows,
    // and theirs naming it.
    const linkedWith = new Set([
      ...(answer?.ok
        ? answer.peers.peers
        : (useFleetPeers.getState().byServer[leaving.serverId]?.peers ?? [])
      )
        .filter((peer) => otherIds.has(peer.serverId))
        .map((peer) => peer.serverId),
      ...others
        .filter((record) =>
          useFleetPeers
            .getState()
            .byServer[record.serverId]?.peers.some((peer) => peer.serverId === leaving.serverId)
        )
        .map((record) => record.serverId),
    ]);
    if (answer?.ok) {
      for (const peer of answer.peers.peers.filter((entry) => otherIds.has(entry.serverId))) {
        const done = await unlinkPeer(endpoint, peer.peerId).then(
          () => true,
          () => false
        );
        if (!done) stillListedBy.push(peer.serverId);
      }
      // And the other computers' logins into it (a link it no longer lists
      // can still have left one), with its own token while it lasts.
      const listed = await fetchPairedGateways(endpoint);
      const logins = pairingsAnswer(
        listed,
        listed === 'no-route' ? await fetchCapabilities(endpoint) : null
      );
      if (logins === null) {
        // Not read: whoever it was linked with may still be logged in there.
        stillListedBy.push(...linkedWith);
      } else {
        for (const record of others) {
          const { matched, undecided } = ownedBy(
            logins,
            record.serverId,
            recordedNames(recorded[leaving.serverId]?.[record.serverId]?.login)
          );
          // Cannot be told apart: it may still be logged in there.
          if (undecided && linkedWith.has(record.serverId)) stillListedBy.push(record.serverId);
          for (const login of matched) {
            const revoked = await revokePairing(endpoint, login.deviceId).then(
              () => true,
              () => false
            );
            if (!revoked) stillListedBy.push(record.serverId);
          }
        }
      }
    } else {
      // Not answering: what it listed when it last did is what it may still list.
      stillListedBy = [...linkedWith];
    }
  }
  if (pending.length > 0 || stillListedBy.length > 0) {
    useFleetUnpairs.getState().put({
      serverId: leaving.serverId,
      label: leaving.label.trim(),
      atMs: Date.now(),
      pending,
      stillListedBy: [...new Set(stillListedBy)],
      ...(Object.keys(progress).length ? { progress } : {}),
      ...(Object.keys(linkNames).length ? { linkNames } : {}),
    });
  }
}

/**
 * The follow-up of this device's unfinished unpairings: each pending computer
 * that answered this pass runs only the steps still undone there, and is
 * dropped from the record only once every step is confirmed
 * (`removalOutcome`). A step that keeps failing stops being tried after
 * UNPAIR_STEP_ATTEMPTS passes, until that computer is seen down or is paired
 * again; the other way out is the 30-day prune.
 */
async function followUpUnpairs(computers: readonly FleetComputer[]): Promise<void> {
  const unpairs = useFleetUnpairs.getState();
  unpairs.prune(
    linkable().map((record) => record.serverId),
    Date.now()
  );
  for (const entry of useFleetUnpairs.getState().entries) {
    for (const computerId of entry.pending) {
      const progress = entry.progress?.[computerId];
      if (!computers.some((computer) => computer.serverId === computerId && computer.peers)) {
        const unparked = unpairSeenDown(progress);
        if (unparked !== progress) {
          useFleetUnpairs.getState().setProgress(entry.serverId, computerId, unparked);
        }
        continue;
      }
      const record = stillPaired(computerId);
      if (!record) continue;
      const steps = unpairStepsDue(progress, record.pairedAt);
      if (steps.length === 0) continue;
      const pass = await unlinkOn(
        record,
        entry.serverId,
        entry.linkNames?.[computerId],
        steps
      ).catch((): UnlinkPass => NO_PASS);
      const after = unpairProgressAfter(
        progress,
        pass.done,
        record.pairedAt,
        pass.needsNewerGateway
      );
      if (unpairComplete(after)) useFleetUnpairs.getState().settle(entry.serverId, computerId);
      else useFleetUnpairs.getState().setProgress(entry.serverId, computerId, after);
    }
  }
  useFleetUnpairs.getState().prune(
    linkable().map((record) => record.serverId),
    Date.now()
  );
}

/**
 * The reconciler's triggers: the paired set (once per Home mount, and when it
 * changes), a computer answering that did not answer the last run, one
 * starting to advertise `fleet_peers`, and the schedule. Only the first and
 * the schedule start a run; the others join one, so a cold start costs one
 * pass however the probes land.
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
  // A fleet computer that answers now and did not in the last run (it came
  // back, or just started advertising `fleet_peers`), when no run is going:
  // the one thing that run could not have linked.
  const runForReturned = useEffectEvent((ids: string) => {
    if (running) return;
    const capabilities = useServerCapabilities.getState().byServer;
    const returned = ids
      .split('\n')
      .some(
        (id) =>
          id &&
          stillPaired(id) &&
          hasFleetPeers(capabilities[id]) &&
          !knownDown(id) &&
          !answeredLastRun.has(id)
      );
    if (returned && useFleetPeers.getState().lastRunMs > 0)
      void reconcileFleet({ reason: 'settings' });
  });
  // The first run on mount is the `paired` trigger; it is also the one that
  // links two computers paired before this build was installed.
  useEffect(() => {
    if (serverIds) run('paired');
  }, [serverIds]);
  useEffect(() => {
    if (liveIds) runForReturned(liveIds);
  }, [liveIds]);
  useEffect(() => {
    if (fleetIds) {
      run('capabilities');
      runForReturned(fleetIds);
    }
  }, [fleetIds]);
  useEffect(() => {
    const timer = setInterval(() => run('schedule'), SCHEDULE_TICK_MS);
    return () => clearInterval(timer);
  }, []);
}
