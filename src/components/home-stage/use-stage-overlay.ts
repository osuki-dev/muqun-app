import { useEffect, useState } from 'react';

import { followHomeSession } from '@/components/home-thread';
import type { AgentRunStatus, FormRequest, PermissionRequest } from '@/lib/agent-protocol';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useStableHandler } from '@/hooks/use-render-refs';
import { readPaneOutput } from '@/lib/gateway-client';
import { sameComputer } from '@/lib/home-composer';
import { homeWaitingTasks } from '@/lib/home-in-progress';
import { homeThreadKey } from '@/lib/home-thread';
import { paneAgentActivity } from '@/lib/pane-agent-line';
import {
  sessionActivity,
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
  const pending = Object.values(observations)
    .filter((snapshot) => snapshot.requestIds.length > 0)
    .map((snapshot) => snapshot.target);
  const waitingTasks = tasks
    ? homeWaitingTasks({ [serverId]: tasks }, [serverId], pending, {
        ...(panes ? { panesByServer: { [serverId]: panes } } : {}),
        requests: observations,
        nowMs,
      }).map((row) => row.task)
    : NO_TASKS;
  const needs = stageNeeds({
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
  });
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
  const liveSessions = sessions
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
          const observed =
            seen.serverId === serverId
              ? seen.statuses[JSON.stringify([session.agentId ?? null, session.asid])]
              : undefined;
          return observed?.sessionId === sessions.sessionId &&
            observed.atMs >= sessions.observedAtMs
            ? { ...session, status: observed.status }
            : session;
        }),
      }
    : undefined;
  const dock: StageDockInput | undefined =
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
        : undefined;
  const subjects = stageActivitySubjects({
    serverId,
    ...(panes ? { panes } : {}),
    ...(liveSessions ? { sessions: liveSessions } : {}),
    ...(dock ? { dock } : {}),
    activeAtMs: {},
    nowMs,
  });
  // Include terminal incarnation in the subscription identity, not its mutable label.
  const sources = subjects.map((subject) => {
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
  });
  const subscriptions = JSON.stringify(sources);
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
    const owns = ownsComputer(serverId);
    if (!owns) return;
    let active = true;
    const cleanups: (() => void)[] = [];
    const followed = JSON.parse(subscriptions) as {
      subject: StageActivitySubject;
      ambiguous: boolean;
      source: string;
    }[];
    for (const { subject, source, ambiguous } of followed) {
      if (subject.kind === 'session') {
        if (subject.dock || ambiguous) continue;
        const statusKey = JSON.stringify([subject.agentId ?? null, subject.asid]);
        let verified = false;
        const heard = (activity: ReturnType<typeof sessionActivity>) => {
          if (active && owns() && verified && activity)
            note(subject.key, source, activity.text, activity.atMs);
        };
        cleanups.push(
          followHomeSession({
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
              if (event.type === 'agent.timeline.upsert') heard(sessionActivity(event.items));
              if (active && owns() && verified && event.type === 'agent.status.changed')
                noteStatus(statusKey, subject.sessionId, event.status);
            },
          })
        );
      }
    }
    // One bounded visible-screen read across all terminals, never five parallel histories.
    const paneSources = followed.filter((row) => row.subject.kind === 'pane');
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
      for (const cleanup of cleanups) cleanup();
    };
  }, [serverId, paneSessionId, subscriptions, note, noteStatus]);

  const activities: StageActivityInput[] = [];
  for (const { subject, source } of sources) {
    const line =
      subject.kind === 'session' && subject.dock
        ? dockActivity
        : seen.serverId === serverId && seen.lines[subject.key]?.source === source
          ? seen.lines[subject.key]
          : undefined;
    if (!line) continue;
    activities.push({
      key: subject.key,
      ...(subject.kind === 'pane'
        ? {
            paneId: subject.paneId,
            ...(subject.agentLabel ? { agentLabel: subject.agentLabel } : {}),
          }
        : { asid: subject.asid, ...(subject.agentId ? { agentId: subject.agentId } : {}) }),
      text: line.text,
      atMs: line.atMs,
    });
  }
  return stageProgressLines({
    serverId,
    tasks,
    panes,
    sessions: liveSessions,
    activities,
    nowMs,
  }).slice(0, 5);
}
