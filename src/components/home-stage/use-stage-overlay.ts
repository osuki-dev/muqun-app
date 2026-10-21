import { useEffect, useState } from 'react';

import { followHomeSession } from '@/components/home-thread';
import type { FormRequest, PermissionRequest } from '@/lib/agent-protocol';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useStableHandler } from '@/hooks/use-render-refs';
import { readPaneOutput } from '@/lib/gateway-client';
import { sameComputer } from '@/lib/home-composer';
import { homeWaitingTasks } from '@/lib/home-in-progress';
import { homeThreadKey } from '@/lib/home-thread';
import { paneAgentActivity } from '@/lib/pane-agent-line';
import {
  sessionActivity,
  stageActivitySubject,
  stageNeeds,
  stageProgress,
  type StageActivityInput,
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
  /** The agent whose activity last changed: the one the subtitle holds on to. */
  current?: string;
  /** When each followed agent's activity last changed, on this device's clock. */
  activeAtMs: Readonly<Record<string, number>>;
  line?: { key: string; text: string; atMs: number };
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

/**
 * The newest progress an agent working on `serverId` reported: its ledger
 * task's progress line, or what the most recently active working agent
 * (`stageActivitySubject`) is doing now. A pane agent's visible screen is read
 * every few seconds while it works (`paneAgentActivity`); a session agent's
 * activity comes from its session stream -- the dock's own, already open, or
 * the agent's while it is followed. Mounted only while Home is in front, the
 * app is active and the Stage shows, so nothing is read otherwise, and the
 * reads stop the moment the agent stops working.
 */
export function useStageProgress(serverId: string): StageProgress | null {
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
  const [seen, setSeen] = useState<SeenActivity>({ activeAtMs: {} });
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
  const dockKey = thread?.kind === 'session' ? `session:${thread.asid}` : undefined;
  const subject = stageActivitySubject({
    serverId,
    ...(panes ? { panes } : {}),
    ...(sessions ? { sessions } : {}),
    ...(dock ? { dock } : {}),
    ...(seen.current ? { current: seen.current } : {}),
    activeAtMs:
      dockKey && dockActivity
        ? { ...seen.activeAtMs, [dockKey]: dockActivity.atMs }
        : seen.activeAtMs,
    nowMs,
  });

  const note = useStableHandler((key: string, text: string | undefined, atMs: number) => {
    if (!text) return;
    setSeen((previous) =>
      previous.line?.key === key && previous.line.text === text
        ? previous
        : {
            current: key,
            activeAtMs: { ...previous.activeAtMs, [key]: Date.now() },
            line: { key, text, atMs },
          }
    );
  });

  // A pane agent at work: its visible screen, read every few seconds.
  const paneId = subject?.kind === 'pane' ? subject.paneId : undefined;
  const paneSessionId = panes?.sessionId;
  useEffect(() => {
    if (!paneId || !paneSessionId) return;
    const owns = ownsComputer(serverId);
    if (!owns) return;
    const key = `pane:${paneId}`;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      void readPaneOutput(paneSessionId, paneId, 'text', PANE_ACTIVITY_ROWS, 'visible')
        .then(
          (output) => {
            if (active && owns()) note(key, paneAgentActivity(output), Date.now());
          },
          // A pane that cannot be read says nothing; the next read may.
          () => {}
        )
        .finally(() => {
          if (active) timer = setTimeout(read, PANE_ACTIVITY_READ_MS);
        });
    };
    read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [serverId, paneId, paneSessionId, note]);

  // A session agent other than the dock's: its stream, while it is followed.
  const follow = subject?.kind === 'session' && !subject.dock ? subject : undefined;
  const followSessionId = follow?.sessionId;
  const followAsid = follow?.asid;
  useEffect(() => {
    if (!followSessionId || !followAsid) return;
    const key = `session:${followAsid}`;
    const heard = (activity: ReturnType<typeof sessionActivity>) => {
      if (activity) note(key, activity.text, activity.atMs);
    };
    return followHomeSession({
      serverId,
      sessionId: followSessionId,
      asid: followAsid,
      onSnapshot: (snapshot) => heard(sessionActivity(snapshot.timeline)),
      onEvent: (event) => {
        if (event.type === 'agent.timeline.upsert') heard(sessionActivity(event.items));
      },
    });
  }, [serverId, followSessionId, followAsid, note]);

  let activity: StageActivityInput | undefined;
  if (subject?.kind === 'session' && subject.dock) {
    if (dockActivity)
      activity = {
        key: subject.key,
        ...(subject.agentId ? { agentId: subject.agentId } : {}),
        text: dockActivity.text,
        atMs: dockActivity.atMs,
      };
  } else if (subject && seen.line?.key === subject.key) {
    activity = {
      key: subject.key,
      ...(subject.kind === 'pane'
        ? {
            paneId: subject.paneId,
            ...(subject.agentLabel ? { agentLabel: subject.agentLabel } : {}),
          }
        : subject.agentId
          ? { agentId: subject.agentId }
          : {}),
      text: seen.line.text,
      // When this device saw it change: what the agent is doing now.
      atMs: Math.max(seen.line.atMs, seen.activeAtMs[subject.key] ?? 0),
    };
  }
  return stageProgress({
    tasks,
    ...(panes ? { panes } : {}),
    ...(activity ? { activity } : {}),
    nowMs,
  });
}
