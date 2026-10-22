import { useEffect, useMemo, useRef, useState } from 'react';

import { followHomeSession } from '@/components/home-thread';
import {
  isBusyStatus,
  type AgentRunStatus,
  type FormRequest,
  type PermissionRequest,
} from '@/lib/agent-protocol';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useStableHandler } from '@/hooks/use-render-refs';
import { readPaneOutput } from '@/lib/gateway-client';
import { sameComputer } from '@/lib/home-composer';
import { homeWaitingTasks } from '@/lib/home-in-progress';
import { homeThreadKey } from '@/lib/home-thread';
import { paneAgentActivity } from '@/lib/pane-agent-line';
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

/** How often the followed pane agent's screen is read while it works. */
const PANE_ACTIVITY_READ_MS = 4_500;
/** Rows of the pane's visible screen read for its activity. */
const PANE_ACTIVITY_ROWS = 80;

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

/** At most five active speakers, followed only while the Stage is visible. */
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
  const paneSubscriptions = useMemo(
    () => JSON.stringify(sources.filter(({ subject }) => subject.kind === 'pane')),
    [sources]
  );
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

  useEffect(() => {
    const owns = ownsComputer(serverId);
    if (!owns) return;
    let active = true;
    const paneSources = JSON.parse(paneSubscriptions) as {
      subject: Extract<StageActivitySubject, { kind: 'pane' }>;
      source: string;
    }[];
    // One bounded visible-screen read across all terminals, never five parallel histories.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let nextPane = 0;
    const readPane = () => {
      timer = null;
      const entry = paneSources[nextPane % paneSources.length];
      if (!active || !owns() || !paneSessionId || entry?.subject.kind !== 'pane') return;
      nextPane += 1;
      const { subject, source } = entry;
      void readPaneOutput(paneSessionId, subject.paneId, 'text', PANE_ACTIVITY_ROWS, 'visible')
        .then(
          (output) => {
            if (active && owns()) note(subject.key, source, paneAgentActivity(output), Date.now());
          },
          () => {}
        )
        .finally(() => {
          if (active && owns()) timer = setTimeout(readPane, PANE_ACTIVITY_READ_MS);
        });
    };
    if (paneSources.length > 0) readPane();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [serverId, connectionRecord, paneSessionId, paneSubscriptions, note]);

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
