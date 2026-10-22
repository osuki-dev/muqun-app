import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { followHomeSession } from '@/components/home-thread';
import {
  isBusyStatus,
  type AgentRunStatus,
  type FormRequest,
  type PermissionRequest,
} from '@/lib/agent-protocol';
import { useGatewayTunnel } from '@/hooks/use-gateway-tunnel';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { usePaneEvents } from '@/hooks/use-pane-events';
import { useStableHandler } from '@/hooks/use-render-refs';
import { readPaneOutput } from '@/lib/gateway-client';
import { sameComputer } from '@/lib/home-composer';
import { homeWaitingTasks } from '@/lib/home-in-progress';
import { homeThreadKey } from '@/lib/home-thread';
import { paneAgentActivity } from '@/lib/pane-agent-line';
import {
  hasSharedPaneFeed,
  paneFeedKey,
  subscribeSharedPaneFeeds,
  watchPaneFeed,
} from '@/lib/pane-event-feeds';
import { OUTPUT_EVENTS } from '@/lib/pane-event-names';
import { initialPaneReadState, paneReadStep, type PaneReadEvent } from '@/lib/pane-read-scheduler';
import {
  keepStageLines,
  sessionActivity,
  stageActivityRecency,
  stageActivitySubjects,
  stageNeeds,
  stageProgressLines,
  type StageActivityInput,
  type StageActivitySubject,
  type StageDockInput,
  type StageNeeds,
  type StageProgress,
} from '@/lib/stage-overlay';
import type { TaskView } from '@/lib/task-ledger';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useHomeAttention } from '@/stores/home-attention';
import { useHomeThreadLive, useHomeThreads } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';
import { useServerTasksStore } from '@/stores/server-tasks';

const NO_PERMISSIONS: readonly PermissionRequest[] = [];
const NO_FORMS: readonly FormRequest[] = [];
const NO_TASKS: readonly TaskView[] = [];

/**
 * What waits on the reader on `serverId`, from the sources Needs you reads
 * (the attention observations, the ledger's waiting tasks, the pane mirror)
 * plus the dock's live conversation, whose requests it carries in full.
 * Subscribes to this computer's slices only.
 */
export function useStageNeeds(serverId: string): StageNeeds & {
  /** The dock's conversation answers questions in the terminal: none from the card. */
  terminal: boolean;
} {
  const thread = useHomeThreads((state) => state.byServer[serverId]);
  const session = thread?.kind === 'session' ? thread : undefined;
  const key = session ? homeThreadKey(session) : null;
  const permissions = useHomeThreadLive((state) =>
    key !== null && state.key === key ? state.live.permissions : NO_PERMISSIONS
  );
  const forms = useHomeThreadLive((state) =>
    key !== null && state.key === key ? state.live.forms : NO_FORMS
  );
  const terminal = useHomeThreadLive(
    (state) => key !== null && state.key === key && state.live.interaction === 'terminal'
  );
  const observations = useHomeAttention((state) => state.byTarget);
  const tasks = useServerTasksStore((state) => state.index[serverId]);
  const panes = useServerAgents((state) => state.byServer[serverId]);
  const nowMs = useMinuteNow();
  const pending = useMemo(
    () =>
      Object.values(observations)
        .filter((snapshot) => snapshot.requestIds.length > 0)
        .map((snapshot) => snapshot.target),
    [observations]
  );
  const waitingTasks = useMemo(
    () =>
      tasks
        ? homeWaitingTasks({ [serverId]: tasks }, [serverId], pending, {
            ...(panes ? { panesByServer: { [serverId]: panes } } : {}),
            requests: observations,
            nowMs,
          }).map((row) => row.task)
        : NO_TASKS,
    [serverId, tasks, pending, panes, observations, nowMs]
  );
  const needs = useMemo(
    () =>
      stageNeeds({
        serverId,
        ...(session
          ? {
              thread: {
                target: {
                  kind: 'agent-session',
                  serverId,
                  sessionId: session.sessionId,
                  directory: session.directory ?? '',
                  asid: session.asid,
                  ...(session.agentId ? { agentId: session.agentId } : {}),
                },
                permissions,
                forms,
              },
            }
          : {}),
        observations,
        waitingTasks,
        ...(panes ? { panes } : {}),
        nowMs,
      }),
    [serverId, session, permissions, forms, observations, waitingTasks, panes, nowMs]
  );
  return { ...needs, terminal };
}

/** Rows of the pane's visible screen read for its activity. */
const PANE_ACTIVITY_ROWS = 80;

/**
 * The Stage's own event feed, when no screen's feed serves the computer:
 * output events only, with one working pane's visible screen inlined as text
 * -- sampled on the computer and sent only when it changes -- and given up
 * the moment the drawer or terminal opens a feed of its own.
 */
const STAGE_FEED = {
  types: OUTPUT_EVENTS,
  borrower: true,
  stream: { source: 'visible', format: 'text', lines: PANE_ACTIVITY_ROWS },
} as const;
/**
 * A streamed screen is parsed at most this often. The gateway samples every
 * 150 ms, so an animating spinner sends a frame nearly every sample; only the
 * newest frame of a burst is parsed.
 */
const STREAM_PARSE_MIN_MS = 250;
const noop = () => {};

type PaneSource = {
  subject: Extract<StageActivitySubject, { kind: 'pane' }>;
  source: string;
};

type SeenActivity = {
  serverId: string;
  lines: Readonly<Record<string, { source: string; text: string; atMs: number }>>;
  statuses: Readonly<Record<string, { sessionId: string; status: AgentRunStatus; atMs: number }>>;
};

const NO_LINES: SeenActivity['lines'] = {};
const NO_STATUSES: SeenActivity['statuses'] = {};

/**
 * Session streams opened besides the dock's own. Each is a gateway stream
 * kept open while the Stage shows; the rest still speak through the ledger
 * and their last heard line.
 */
const STREAMED_SESSIONS_MAX = 2;

function seenStatusKey(agentId: string | undefined, asid: string): string {
  return JSON.stringify([agentId ?? null, asid]);
}

/** Whether the gateway connection is still this computer's, as it was when a read began. */
function ownsComputer(serverId: string): (() => boolean) | null {
  const owner = useGatewayConnectionStore.getState().record;
  if (owner?.serverId !== serverId) return null;
  return () => {
    const now = useGatewayConnectionStore.getState().record;
    return sameComputer(now, owner) && now?.deviceId === owner.deviceId;
  };
}

/**
 * At most five active speakers, followed only while the Stage is visible.
 * Working pane agents are heard through the computer's event feed: one pane's
 * screen streams in it, the rest are read on its hints, and all of them on a
 * 4.5 s poll whenever no feed is up.
 */
export function useStageProgress(serverId: string): StageProgress[] {
  const tasks = useServerTasksStore((state) => state.index[serverId]?.tasks ?? NO_TASKS);
  const panes = useServerAgents((state) => state.byServer[serverId]);
  const sessions = useHomeAgentSessions((state) => state.byServer[serverId]);
  const sessionsSeenAtMs = useHomeAgentSessions((state) => state.seenAtMs[serverId]);
  const thread = useHomeThreads((state) => state.byServer[serverId]);
  const threadKey = thread ? homeThreadKey(thread) : null;
  const dockStatus = useHomeThreadLive((state) =>
    threadKey !== null && state.key === threadKey ? state.live.status : undefined
  );
  const dockActivity = useHomeThreadLive((state) =>
    threadKey !== null && state.key === threadKey ? state.live.activity : undefined
  );
  const nowMs = useMinuteNow();
  const [seen, setSeen] = useState<SeenActivity>({ serverId, lines: {}, statuses: {} });
  const seenLines = seen.serverId === serverId ? seen.lines : NO_LINES;
  const seenStatuses = seen.serverId === serverId ? seen.statuses : NO_STATUSES;
  const liveSessions = useMemo(
    () =>
      sessions
        ? {
            ...sessions,
            sessions: sessions.sessions.map((session) => {
              if (
                thread?.kind === 'session' &&
                thread.asid === session.asid &&
                (!thread.agentId || !session.agentId || thread.agentId === session.agentId) &&
                thread.sessionId === sessions.sessionId &&
                dockStatus
              ) {
                return { ...session, status: dockStatus };
              }
              const observed = seenStatuses[seenStatusKey(session.agentId, session.asid)];
              return observed?.sessionId === sessions.sessionId &&
                observed.atMs >= sessions.observedAtMs
                ? { ...session, status: observed.status }
                : session;
            }),
          }
        : undefined,
    [sessions, thread, dockStatus, seenStatuses]
  );
  const dock = useMemo<StageDockInput | undefined>(
    () =>
      thread?.kind === 'session'
        ? {
            kind: 'session',
            sessionId: thread.sessionId,
            asid: thread.asid,
            ...(thread.agentId ? { agentId: thread.agentId } : {}),
            ...(dockStatus ? { status: dockStatus } : {}),
          }
        : thread?.kind === 'pane'
          ? { kind: 'pane', paneId: thread.paneId }
          : undefined,
    [thread, dockStatus]
  );
  const { subjects, recency } = useMemo(() => {
    const input = {
      serverId,
      ...(panes ? { panes } : {}),
      ...(liveSessions ? { sessions: liveSessions } : {}),
      sessionsSeenAtMs,
      ...(dock ? { dock } : {}),
      activeAtMs: {},
      nowMs,
    };
    return { subjects: stageActivitySubjects(input), recency: stageActivityRecency(input) };
  }, [serverId, panes, liveSessions, sessionsSeenAtMs, dock, nowMs]);
  // Include terminal incarnation in the subscription identity, not its mutable label.
  const sources = useMemo(
    () =>
      subjects.map((subject) => {
        const pane =
          subject.kind === 'pane'
            ? panes?.agents.find((agent) => agent.paneId === subject.paneId)
            : undefined;
        return {
          subject,
          ambiguous:
            subject.kind === 'session' &&
            (sessions?.sessions.filter((session) => session.asid === subject.asid).length ?? 0) > 1,
          source:
            subject.kind === 'pane'
              ? JSON.stringify([panes?.sessionId, subject.paneId, pane?.instanceId, pane?.shellPid])
              : JSON.stringify([subject.sessionId, subject.agentId, subject.asid]),
        };
      }),
    [subjects, panes, sessions]
  );
  // The dock's stream is already open; of the rest only the most recently
  // active few get one, in display order so a swap in rank alone changes nothing.
  const sessionSubscriptions = useMemo(() => {
    const followable = sources.filter(
      ({ subject, ambiguous }) => subject.kind === 'session' && !subject.dock && !ambiguous
    );
    const streamed = new Set(
      followable
        .map(({ subject }) => subject.key)
        .sort((a, b) => recency.indexOf(a) - recency.indexOf(b))
        .slice(0, STREAMED_SESSIONS_MAX)
    );
    return JSON.stringify(followable.filter(({ subject }) => streamed.has(subject.key)));
  }, [sources, recency]);
  const paneSources = useMemo(
    () =>
      sources.flatMap(({ subject, source }) =>
        subject.kind === 'pane' ? [{ subject, source } satisfies PaneSource] : []
      ),
    [sources]
  );
  const paneSubscriptions = useMemo(() => JSON.stringify(paneSources), [paneSources]);
  // The feed streams one screen: the most recently active pane's, held while
  // it keeps working so a swap in rank does not reopen the feed.
  const [streamed, setStreamed] = useState<string | null>(null);
  const nextStreamed = useMemo(() => {
    if (paneSources.some(({ source }) => source === streamed)) return streamed;
    let best: PaneSource | undefined;
    let bestRank = Number.POSITIVE_INFINITY;
    for (const entry of paneSources) {
      const rank = recency.indexOf(entry.subject.key);
      const at = rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
      if (at < bestRank) {
        best = entry;
        bestRank = at;
      }
    }
    return best?.source ?? null;
  }, [paneSources, recency, streamed]);
  if (nextStreamed !== streamed) setStreamed(nextStreamed);
  const streamedPaneId =
    paneSources.find(({ source }) => source === nextStreamed)?.subject.paneId ?? null;
  const connectionRecord = useGatewayConnectionStore((state) => state.record);
  const sessionFollowers = useRef(new Map<string, { owns: () => boolean; close: () => void }>());
  const paneSessionId = panes?.sessionId;
  const note = useStableHandler(
    (key: string, source: string, text: string | undefined, atMs: number) => {
      if (!text) return;
      setSeen((previous) => {
        const lines = previous.serverId === serverId ? previous.lines : {};
        if (lines[key]?.source === source && lines[key]?.text === text) return previous;
        return {
          serverId,
          lines: { ...lines, [key]: { source, text, atMs } },
          statuses: previous.serverId === serverId ? previous.statuses : {},
        };
      });
    }
  );
  const noteStatus = useStableHandler((key: string, sessionId: string, status: AgentRunStatus) => {
    setSeen((previous) => ({
      serverId,
      lines: previous.serverId === serverId ? previous.lines : {},
      statuses: {
        ...(previous.serverId === serverId ? previous.statuses : {}),
        [key]: { sessionId, status, atMs: Date.now() },
      },
    }));
  });
  useEffect(() => {
    const followers = sessionFollowers.current;
    const followed = JSON.parse(sessionSubscriptions) as {
      subject: Extract<StageActivitySubject, { kind: 'session' }>;
      source: string;
    }[];
    const identity = (source: string) => JSON.stringify([serverId, source]);
    const wanted = new Set(followed.map(({ source }) => identity(source)));
    for (const [key, follower] of followers) {
      if (wanted.has(key) && follower.owns()) continue;
      follower.close();
      followers.delete(key);
    }
    const owns = ownsComputer(serverId);
    if (!owns) return;
    for (const { subject, source } of followed) {
      const key = identity(source);
      if (followers.has(key)) continue;
      let active = true;
      let verified = false;
      const statusKey = seenStatusKey(subject.agentId, subject.asid);
      const heard = (activity: ReturnType<typeof sessionActivity>) => {
        if (active && owns() && verified && activity)
          note(subject.key, source, activity.text, activity.atMs);
      };
      const stop = followHomeSession({
        serverId,
        sessionId: subject.sessionId,
        asid: subject.asid,
        onSnapshot: (snapshot) => {
          if (!active || !owns()) return;
          verified =
            !!snapshot.info && (!subject.agentId || snapshot.info.agent_id === subject.agentId);
          if (!verified) return;
          if (snapshot.info) noteStatus(statusKey, subject.sessionId, snapshot.info.status);
          heard(sessionActivity(snapshot.timeline));
        },
        onEvent: (event) => {
          if (!active || !owns()) return;
          if (event.type === 'agent.timeline.upsert') heard(sessionActivity(event.items));
          if (verified && event.type === 'agent.status.changed')
            noteStatus(statusKey, subject.sessionId, event.status);
        },
      });
      followers.set(key, {
        owns,
        close: () => {
          active = false;
          stop();
        },
      });
    }
  }, [serverId, connectionRecord, sessionSubscriptions, note, noteStatus]);
  // Changes in one speaker reconcile above; only leaving Stage closes everyone.
  useEffect(() => {
    const followers = sessionFollowers.current;
    return () => {
      for (const follower of followers.values()) follower.close();
      followers.clear();
    };
  }, []);

  // Working pane agents: one event feed for the computer, shared with the
  // reply drawer and the terminal. Never a second: the Stage opens its own only
  // while no screen holds one for this computer, and then streams one pane's
  // screen in it.
  const record = connectionRecord?.serverId === serverId ? connectionRecord : null;
  const working = paneSources.length > 0 && Boolean(paneSessionId && record);
  const tunnel = useGatewayTunnel(record, working);
  const feedKey =
    working && tunnel.baseUrl && paneSessionId ? paneFeedKey(tunnel.baseUrl, paneSessionId) : null;
  const shared = useSyncExternalStore(
    subscribeSharedPaneFeeds,
    () => feedKey !== null && hasSharedPaneFeed(feedKey)
  );
  const ownFeed = feedKey !== null && !shared && streamedPaneId !== null;
  /** Where the own feed's frames go: the pane effect running now. */
  const frames = useRef<((paneId: string, text: string) => void) | null>(null);
  usePaneEvents(
    tunnel.baseUrl,
    record?.token ?? null,
    paneSessionId ?? '',
    ownFeed ? streamedPaneId : null,
    ownFeed,
    0,
    {
      // Changes and the connection arrive through `watchPaneFeed`.
      onPaneRevision: noop,
      onPaneOutput: (revised, _revision, text) => frames.current?.(revised, text),
      onStructureChanged: noop,
      onConnected: noop,
    },
    STAGE_FEED
  );
  useEffect(() => {
    const owns = ownsComputer(serverId);
    if (!owns || !paneSessionId) return;
    const entries = JSON.parse(paneSubscriptions) as PaneSource[];
    if (entries.length === 0) return;
    let active = true;
    // The own feed's pane, while its frames flow, is never read.
    const streamedEntry = ownFeed
      ? entries.find(({ source }) => source === nextStreamed)
      : undefined;
    let streaming = false;
    const pool = () => (streaming ? entries.filter((entry) => entry !== streamedEntry) : entries);
    // Lines already noted: an unchanged line costs no state update at all.
    const noted = new Map<string, string>();
    const heard = ({ subject, source }: PaneSource, text: string | undefined) => {
      if (!text || !active || !owns() || noted.get(subject.key) === `${source}\n${text}`) return;
      noted.set(subject.key, `${source}\n${text}`);
      note(subject.key, source, text, Date.now());
    };

    // The rest are read: one visible-screen read at a time across all of
    // them, hinted panes first, else in turn on the poll (`paneReadStep`).
    const hinted = new Set(entries.map(({ subject }) => subject.paneId));
    let nextPane = 0;
    let state = initialPaneReadState();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timerAtMs: number | undefined;
    const step = (event: PaneReadEvent) => {
      if (!active) return;
      const nowMs = Date.now();
      const plan = paneReadStep(state, event, nowMs);
      state = plan.state;
      // One timer, moved only when the time it is due changes.
      if (plan.wakeAtMs !== timerAtMs) {
        if (timer) clearTimeout(timer);
        timer = null;
        timerAtMs = plan.wakeAtMs;
        if (plan.wakeAtMs !== undefined)
          timer = setTimeout(() => {
            timer = null;
            timerAtMs = undefined;
            step({ type: 'tick' });
          }, plan.wakeAtMs - nowMs);
      }
      const id = plan.read;
      if (id === undefined) return;
      const candidates = pool();
      let entry = candidates.find(({ subject }) => hinted.has(subject.paneId));
      if (!entry) {
        entry = candidates[nextPane % candidates.length];
        nextPane += 1;
      }
      if (!entry) {
        step({ type: 'settled', id });
        return;
      }
      hinted.delete(entry.subject.paneId);
      void readPaneOutput(
        paneSessionId,
        entry.subject.paneId,
        'text',
        PANE_ACTIVITY_ROWS,
        'visible'
      )
        .then(
          // Only the newest read's answer: one given up as stuck may be stale.
          (output) => {
            if (id === state.latest) heard(entry, paneAgentActivity(output));
          },
          // A pane that cannot be read says nothing; the next read may.
          () => {}
        )
        .finally(() => step({ type: 'settled', id }));
      // Other hinted panes are read next, a gap later.
      if (candidates.some(({ subject }) => hinted.has(subject.paneId))) step({ type: 'changed' });
    };
    const streamingChanged = (on: boolean) => {
      streaming = on;
      if (!on && streamedEntry) hinted.add(streamedEntry.subject.paneId);
      // Nothing is read only while the streamed screen is all there is.
      step({ type: 'streaming', on: pool().length === 0 });
      if (!on) step({ type: 'changed' });
    };

    // The streamed screen: the newest frame of a burst, parsed at most
    // `STREAM_PARSE_MIN_MS` apart.
    let frameText: string | null = null;
    let parsedAtMs = Number.NEGATIVE_INFINITY;
    let parseTimer: ReturnType<typeof setTimeout> | null = null;
    const parse = () => {
      parseTimer = null;
      if (!active || !streamedEntry || frameText === null) return;
      const text = frameText;
      frameText = null;
      parsedAtMs = Date.now();
      heard(streamedEntry, paneAgentActivity(text));
    };
    const frame = (revised: string, text: string) => {
      if (!active || revised !== streamedEntry?.subject.paneId) return;
      if (!streaming) streamingChanged(true);
      frameText = text;
      if (parseTimer) return;
      const waitMs = parsedAtMs + STREAM_PARSE_MIN_MS - Date.now();
      if (waitMs <= 0) parse();
      else parseTimer = setTimeout(parse, waitMs);
    };
    if (streamedEntry) frames.current = frame;
    // What printed while the feed was down went unheard: the rest are read
    // once it is back (the own feed's screen follows its connecting at once).
    // Before the first connection, the reads at mount cover it.
    let watching = false;
    let missed = false;
    const unwatch = feedKey
      ? watchPaneFeed(feedKey, {
          onLive: (live) => {
            if (!live) {
              missed = watching;
              if (streaming) streamingChanged(false);
              return;
            }
            if (!missed) return;
            missed = false;
            for (const entry of entries)
              if (entry !== streamedEntry) hinted.add(entry.subject.paneId);
            if (hinted.size > 0) step({ type: 'connected' });
          },
          onChanged: (changed) => {
            if (streaming && changed === streamedEntry?.subject.paneId) return;
            if (!entries.some(({ subject }) => subject.paneId === changed)) return;
            hinted.add(changed);
            step({ type: 'changed' });
          },
        })
      : noop;
    watching = true;
    step({ type: 'tick' });
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      if (parseTimer) clearTimeout(parseTimer);
      if (frames.current === frame) frames.current = null;
      unwatch();
    };
  }, [
    serverId,
    connectionRecord,
    paneSessionId,
    paneSubscriptions,
    nextStreamed,
    feedKey,
    ownFeed,
    note,
  ]);

  // The dock's activity is the one input that moves several times a second:
  // it rebuilds these few rows, and `keepStageLines` keeps every unchanged one.
  const activities = useMemo(() => {
    const rows: StageActivityInput[] = [];
    for (const { subject, source } of sources) {
      const line =
        subject.kind === 'session' && subject.dock
          ? dockActivity
          : seenLines[subject.key]?.source === source
            ? seenLines[subject.key]
            : undefined;
      if (!line) continue;
      rows.push({
        key: subject.key,
        ...(subject.kind === 'pane'
          ? {
              paneId: subject.paneId,
              ...(subject.agentLabel ? { agentLabel: subject.agentLabel } : {}),
            }
          : {
              asid: subject.asid,
              sessionId: subject.sessionId,
              ...(subject.agentId ? { agentId: subject.agentId } : {}),
            }),
        text: line.text,
        atMs: line.atMs,
      });
    }
    return rows;
  }, [sources, dockActivity, seenLines]);
  const lines = useMemo(
    () =>
      stageProgressLines({
        serverId,
        tasks,
        panes,
        sessions: liveSessions,
        sessionsSeenAtMs,
        activities,
        nowMs,
      })
        .filter((line) => {
          // A report with no navigable conversation is not a tappable subtitle.
          if (!line.asid) return line.key.startsWith('pane:');
          // Stream state is newer than the listing timestamp. In particular, an idle
          // event must retire a leftover ledger report even if the list predates it.
          if (
            thread?.kind === 'session' &&
            thread.asid === line.asid &&
            (!thread.agentId || !line.agentId || thread.agentId === line.agentId) &&
            dockStatus
          ) {
            return isBusyStatus(dockStatus);
          }
          const observed = seenStatuses[seenStatusKey(line.agentId, line.asid)];
          if (
            observed &&
            observed.sessionId === sessions?.sessionId &&
            observed.atMs >= Math.max(line.atMs, sessions.observedAtMs)
          ) {
            return isBusyStatus(observed.status);
          }
          return true;
        })
        .slice(0, 5),
    [
      serverId,
      tasks,
      panes,
      liveSessions,
      sessions,
      sessionsSeenAtMs,
      activities,
      nowMs,
      thread,
      dockStatus,
      seenStatuses,
    ]
  );
  // The subtitle re-renders only when a line's words or routing change, not
  // when the same words are read again later.
  const [kept, setKept] = useState(lines);
  const shown = keepStageLines(kept, lines);
  if (shown !== kept) setKept(shown);
  return shown;
}
