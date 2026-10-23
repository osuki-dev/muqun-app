import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useLatestReader } from '@/hooks/use-render-refs';
import { agentRequestErrorDetail } from '@/lib/agent-request-error';
import {
  getAgentSessionSnapshot,
  openAgentSessionStream,
  type AgentDomainEvent,
  type AgentSessionSnapshot,
} from '@/lib/agent-session';
import { readPaneOutput } from '@/lib/gateway-client';
import { WS_EVENTS_CAPABILITY } from '@/lib/gateway-socket';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import { goneSessionKey } from '@/lib/home-continue';
import { sameComputer } from '@/lib/home-composer';
import {
  applyHomeThreadEvent,
  EMPTY_HOME_THREAD_LIVE,
  homeThreadEnded,
  homeThreadKey,
  homeThreadLiveFromSnapshot,
  homeThreadPaneAnswers,
  homeThreadPanePolls,
  homeThreadResolved,
  homeThreadState,
  homeThreadTask,
  type HomeThreadFacts,
  type HomeThreadLive,
  type HomeThreadState,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import { paneAgentRead } from '@/lib/pane-agent-line';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useGoneAgentSessions } from '@/stores/gone-agent-sessions';
import { useHomeThreadLive, useHomeThreads } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * At most four store updates a second while a reply streams: the dock reads
 * the state at a glance, and every token re-rendering it is wasted work.
 */
const HOME_THREAD_PUBLISH_MS = 250;
/** How long a dropped event stream waits before it is opened again. */
const HOME_THREAD_STREAM_RETRY_MS = 5_000;
/**
 * At most one read of a pane's screen per two seconds on events (targeted,
 * status changed, Home back in front): a burst of them is one read.
 */
const HOME_THREAD_PANE_READ_MS = 2_000;
/** After a send, the first read of the pane: time for the agent to take the message. */
const HOME_THREAD_PANE_FIRST_READ_MS = 1_500;
/** Then, while its reply is awaited or its agent works, every few seconds. */
export const HOME_THREAD_PANE_POLL_MS = 3_000;
/** A subscription confirmed this soon after a read does not read again. */
const HOME_THREAD_SUBSCRIBE_READ_FRESH_MS = 5_000;
/** Rows of the pane's visible screen read: the agent's last message is near the bottom. */
const HOME_THREAD_PANE_ROWS = 80;

/**
 * Follows one agent session over the stream its own screen uses -- the
 * computer's socket where it has `ws_events`, else the session's event stream,
 * reopened after a drop -- with a snapshot read on subscribe, resync and
 * reconnect; no polling. Reads and streams go through the selected computer:
 * nothing starts unless it is `serverId`, and everything heard is dropped
 * unless that is still the very connection this started on. Returns the stop.
 */
export function followHomeSession({
  serverId,
  sessionId,
  asid,
  onSnapshot,
  onEvent,
  onNotFound,
}: {
  serverId: string;
  sessionId: string;
  asid: string;
  onSnapshot: (snapshot: AgentSessionSnapshot) => void;
  /** Events about this session; `agent.resync` is answered with a read instead. */
  onEvent: (event: AgentDomainEvent) => void;
  onNotFound?: () => void;
}): () => void {
  const owner = useGatewayConnectionStore.getState().record;
  if (owner?.serverId !== serverId) return () => {};
  const owns = () => {
    const now = useGatewayConnectionStore.getState().record;
    return sameComputer(now, owner) && now?.deviceId === owner.deviceId;
  };
  let active = true;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let reading = false;
  let readAgain = false;
  let readStartedAtMs = 0;
  let closeStream: (() => void) | null = null;
  let releaseSocket: (() => void) | null = null;

  const read = () => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    readStartedAtMs = Date.now();
    void getAgentSessionSnapshot(sessionId, asid)
      .then(
        (snapshot) => {
          if (active && owns()) onSnapshot(snapshot);
        },
        (failure: unknown) => {
          if (active && owns() && agentRequestErrorDetail(failure).status === 404) onNotFound?.();
        }
      )
      .finally(() => {
        reading = false;
        if (readAgain && active) {
          readAgain = false;
          read();
        }
      });
  };
  // The read a (re)subscription asks for, unless one was just made: the
  // subscribe lands moments after the first read is sent, and both answered
  // with the whole transcript -- 1.8 MB opened and parsed twice on the JS
  // thread, on every return to Home. Nothing is missed by skipping it: the
  // events arrive live from the subscription on.
  const readOnSubscribe = () => {
    if (Date.now() - readStartedAtMs < HOME_THREAD_SUBSCRIBE_READ_FRESH_MS) return;
    read();
  };
  const heard = (event: AgentDomainEvent) => {
    if (!active || !owns() || (event.asid && event.asid !== asid)) return;
    if (event.type === 'agent.resync') read();
    else onEvent(event);
  };
  const connectStream = () => {
    closeStream = openAgentSessionStream({
      asid,
      sessionId,
      onEvent: heard,
      onConnected: readOnSubscribe,
      onError: reconnect,
      onClose: reconnect,
    });
  };
  function reconnect() {
    closeStream?.();
    closeStream = null;
    if (!active || retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (active && owns()) connectStream();
    }, HOME_THREAD_STREAM_RETRY_MS);
  }
  const wsEvents =
    useServerCapabilities.getState().byServer[serverId]?.includes(WS_EVENTS_CAPABILITY) === true;
  if (wsEvents) {
    releaseSocket = gatewaySocketFor(serverId).watch(asid, {
      onSubscribed: readOnSubscribe,
      onEvent: heard,
      onResync: read,
      // The socket cannot carry it: the session's own stream does, as on its screen.
      onUnavailable: () =>
        queueMicrotask(() => {
          releaseSocket?.();
          releaseSocket = null;
          if (active && !closeStream) connectStream();
        }),
    });
  } else {
    connectStream();
  }
  read();
  return () => {
    active = false;
    if (retryTimer) clearTimeout(retryTimer);
    releaseSocket?.();
    closeStream?.();
  };
}

/**
 * Keeps the target's live store fed, and lets the target go when its
 * conversation ends. Renders nothing, so what it hears re-renders only what
 * reads the store. A session is followed with `followHomeSession`. Only while
 * `enabled`: Home in front, its computer selected.
 */
export function HomeThreadFeed({
  target,
  enabled,
  inFront = enabled,
}: {
  target: HomeThreadTarget;
  /** The app is in front and the target's computer is selected. */
  enabled: boolean;
  /**
   * Home itself is in front. A session is followed while Home is merely
   * mounted -- the subscription is cheap and its events keep the live state
   * current -- so coming back from the terminal does not re-read the whole
   * transcript. The pane reads below still wait for Home to be in front.
   */
  inFront?: boolean;
}) {
  const key = homeThreadKey(target);
  const { serverId } = target;
  useEffect(() => {
    useHomeThreadLive.getState().reset(key);
  }, [key]);

  const sessionId = target.kind === 'session' ? target.sessionId : undefined;
  const asid = target.kind === 'session' ? target.asid : undefined;
  useEffect(() => {
    if (!enabled || !sessionId || !asid) return;
    const current = useHomeThreadLive.getState();
    let live: HomeThreadLive = current.key === key ? current.live : EMPTY_HOME_THREAD_LIVE;
    let active = true;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    const publish = () => {
      publishTimer = null;
      if (active) useHomeThreadLive.getState().publish(key, live);
    };
    const release = followHomeSession({
      serverId,
      sessionId,
      asid,
      onSnapshot: (snapshot) => {
        live = homeThreadLiveFromSnapshot(snapshot);
        if (publishTimer) clearTimeout(publishTimer);
        publish();
      },
      onEvent: (event) => {
        live = applyHomeThreadEvent(live, event);
        if (!publishTimer) publishTimer = setTimeout(publish, HOME_THREAD_PUBLISH_MS);
      },
      onNotFound: () => useHomeThreadLive.getState().markNotFound(key),
    });
    return () => {
      active = false;
      if (publishTimer) clearTimeout(publishTimer);
      release();
    };
  }, [enabled, key, serverId, sessionId, asid]);

  // A pane has no transcript: whether its agent is at work is read off its
  // screen (the terminal screen's own read) when it becomes the target, when
  // its status changes and when Home is back in front; and, after a send,
  // again until the reply shows and the agent is done (bounded, see below).
  const paneId = target.kind === 'pane' ? target.paneId : undefined;
  const paneSessionId = useServerAgents((state) =>
    target.kind === 'pane' ? (target.sessionId ?? state.byServer[serverId]?.sessionId) : undefined
  );
  const paneStatus = useServerAgents((state) => {
    if (target.kind !== 'pane') return undefined;
    const row = state.byServer[serverId]?.agents.find((agent) => agent.paneId === target.paneId);
    return row ? `${row.status}:${row.pendingUserInput === true}` : undefined;
  });
  const paneReadAtMs = useRef(0);
  const sentAtMs = target.sentAtMs;
  const readTarget = useLatestReader(target);
  useEffect(() => {
    if (!enabled || !inFront || !paneId || !paneSessionId) return;
    const owner = useGatewayConnectionStore.getState().record;
    if (owner?.serverId !== serverId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // After a send the pane is read again until its reply shows and its agent
    // is done (`homeThreadPanePolls`), never past the window; otherwise once.
    const followUp = (seen: ReturnType<typeof paneAgentRead> | undefined) => {
      if (!active) return;
      const stored = useHomeThreads.getState().byServer[serverId];
      const latest = stored && homeThreadKey(stored) === key ? stored : readTarget();
      const mirror = useServerAgents
        .getState()
        .byServer[serverId]?.agents.find((agent) => agent.paneId === paneId);
      const polls = homeThreadPanePolls({
        target: latest,
        nowMs: Date.now(),
        answered: Boolean(seen?.line) && homeThreadPaneAnswers(seen?.prompt, latest.lastSent),
        working: seen?.busy === true || mirror?.status === 'working',
      });
      if (polls) timer = setTimeout(readPane, HOME_THREAD_PANE_POLL_MS);
    };
    const readPane = () => {
      timer = null;
      paneReadAtMs.current = Date.now();
      void readPaneOutput(paneSessionId, paneId, 'text', HOME_THREAD_PANE_ROWS, 'visible').then(
        (output) => {
          const now = useGatewayConnectionStore.getState().record;
          if (!active || !sameComputer(now, owner) || now?.deviceId !== owner.deviceId) return;
          const seen = paneAgentRead(output);
          const store = useHomeThreadLive.getState();
          if (store.key === key) {
            const { paneBusy, ...rest } = store.live;
            if ((paneBusy === true) !== seen.busy)
              store.publish(key, { ...rest, ...(seen.busy ? { paneBusy: true } : {}) });
            else store.markLoaded(key);
          }
          followUp(seen);
        },
        // A pane that cannot be read says nothing; its mirror says whether it is gone.
        () => {
          if (active) useHomeThreadLive.getState().markLoaded(key);
          followUp(undefined);
        }
      );
    };
    const sinceSend = sentAtMs === undefined ? Infinity : Date.now() - sentAtMs;
    const waitMs =
      sinceSend < HOME_THREAD_PANE_FIRST_READ_MS
        ? HOME_THREAD_PANE_FIRST_READ_MS - sinceSend
        : paneReadAtMs.current + HOME_THREAD_PANE_READ_MS - Date.now();
    if (waitMs > 0) timer = setTimeout(readPane, waitMs);
    else readPane();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, inFront, key, serverId, paneId, paneSessionId, paneStatus, sentAtMs, readTarget]);

  // When the conversation has ended the target goes with it; a task the
  // gateway has bound since becomes the session or pane it runs in.
  const task = useServerTasksStore((state) => homeThreadTask(target, state.index[serverId]?.tasks));
  const goneSession = useGoneAgentSessions((state) =>
    target.kind === 'session'
      ? state.keys.has(goneSessionKey(serverId, target.asid, target.agentId)) ||
        state.keys.has(goneSessionKey(serverId, target.asid))
      : false
  );
  const notFound = useHomeThreadLive(
    (state) => state.key === key && (state.notFound || state.live.deleted === true)
  );
  const agentIds = useAgents((state) =>
    state.index.servers[serverId]?.agents?.agents
      .flatMap((agent) => [agent.id, agent.kind])
      .join('\u0000')
  );
  const panes = useServerAgents((state) =>
    target.kind === 'pane' ? state.byServer[serverId] : undefined
  );
  const ended = homeThreadEnded(target, {
    goneSession,
    notFound,
    ...(agentIds ? { agentIds: agentIds.split('\u0000') } : {}),
    ...(panes ? { panes } : {}),
    ...(task ? { task } : {}),
  });
  useEffect(() => {
    if (ended) {
      useHomeThreads.getState().clear(target.serverId, target);
      return;
    }
    // Store writes only on a real change: the resolved target replaces the
    // stored one, so this does not run again for it.
    const resolved = homeThreadResolved(target, task);
    if (resolved !== target) useHomeThreads.getState().update(target, resolved);
  }, [ended, target, task]);
  return null;
}

/**
 * What the stores say right now about whether `target` has ended, for a
 * decision taken outside render ("Reply from Home" on a card).
 */
export function homeThreadFactsNow(target: HomeThreadTarget): HomeThreadFacts {
  const { serverId } = target;
  const task = homeThreadTask(target, useServerTasksStore.getState().index[serverId]?.tasks);
  const gone = useGoneAgentSessions.getState().keys;
  const agents = useAgents.getState().index.servers[serverId]?.agents?.agents;
  const panes = useServerAgents.getState().byServer[serverId];
  return {
    goneSession:
      target.kind === 'session' &&
      (gone.has(goneSessionKey(serverId, target.asid, target.agentId)) ||
        gone.has(goneSessionKey(serverId, target.asid))),
    ...(agents ? { agentIds: agents.flatMap((agent) => [agent.id, agent.kind]) } : {}),
    ...(panes ? { panes } : {}),
    ...(task ? { task } : {}),
  };
}

/** The target's live state: the dock's grabber tint and the drawer's state word. */
export function useHomeThreadState(target: HomeThreadTarget): HomeThreadState {
  // One word read across three stores, so the drawer re-renders when the word
  // changes -- not on each of the live part's publishes (up to four a second
  // while a reply streams), each task frame or each pane pass.
  const read = () => homeThreadStateNow(target);
  return useSyncExternalStore(subscribeHomeThreadStateInputs, read, read);
}

function homeThreadStateNow(target: HomeThreadTarget): HomeThreadState {
  const key = homeThreadKey(target);
  const liveState = useHomeThreadLive.getState();
  const live = liveState.key === key ? liveState.live : undefined;
  const task = homeThreadTask(target, useServerTasksStore.getState().index[target.serverId]?.tasks);
  const pane =
    target.kind === 'pane'
      ? useServerAgents
          .getState()
          .byServer[target.serverId]?.agents.find((agent) => agent.paneId === target.paneId)
      : undefined;
  const paneBusy = target.kind === 'pane' && live?.paneBusy === true;
  return homeThreadState({
    ...(target.kind === 'session' && live ? { live } : {}),
    ...(task ? { task } : {}),
    ...(pane || paneBusy
      ? {
          pane: {
            ...(pane ? { status: pane.status, pendingUserInput: pane.pendingUserInput } : {}),
            busy: paneBusy,
          },
        }
      : {}),
    unbound: target.kind === 'task',
  });
}

function subscribeHomeThreadStateInputs(onChange: () => void): () => void {
  const unsubscribe = [
    useHomeThreadLive.subscribe(onChange),
    useServerTasksStore.subscribe(onChange),
    useServerAgents.subscribe(onChange),
  ];
  return () => {
    for (const stop of unsubscribe) stop();
  };
}

/** A send whose delivery could not be confirmed: never resent without the reader. */
export type HomeThreadUnsure = { key: string; text: string; attachments: string[] };
