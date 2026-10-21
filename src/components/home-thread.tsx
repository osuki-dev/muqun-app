import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { CloseIcon } from '@/icons';
import { permissionDecisionLabel } from '@/i18n/labels';
import { permissionSubject } from '@/lib/agent-engine-text';
import { permissionOptionLabel } from '@/lib/agent-permission-presentation';
import { agentRequestErrorDetail } from '@/lib/agent-request-error';
import {
  DEFAULT_PERMISSION_DECISIONS,
  getAgentSessionSnapshot,
  openAgentSessionStream,
  replyAgentForm,
  replyAgentPermission,
  type AgentDomainEvent,
  type FormRequest,
  type PermissionDecision,
  type PermissionRequest,
} from '@/lib/agent-session';
import { withAlpha } from '@/lib/color';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
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
  homeThreadResolved,
  homeThreadState,
  homeThreadTask,
  homeThreadTurns,
  type HomeThreadFacts,
  type HomeThreadLive,
  type HomeThreadState,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import { plainFromMarkdown } from '@/lib/markdown-text';
import { paneAgentLine } from '@/lib/pane-agent-line';
import { calmFadeIn, calmFadeOut, fadeIn, fadeOut, listLayout, riseIn } from '@/lib/motion';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useGoneAgentSessions } from '@/stores/gone-agent-sessions';
import { useHomeAttention } from '@/stores/home-attention';
import { useHomeThreadLive, useHomeThreads } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * At most four strip updates a second while a reply streams: the strip is
 * read at a glance, and every token re-rendering it is wasted work.
 */
const HOME_THREAD_PUBLISH_MS = 250;
/** How long a dropped event stream waits before it is opened again. */
const HOME_THREAD_STREAM_RETRY_MS = 5_000;
/**
 * At most one read of a pane's screen per two seconds: it is read on events
 * (targeted, status changed, Home back in front), never on a timer, and a
 * burst of them is one read.
 */
const HOME_THREAD_PANE_READ_MS = 2_000;
/** Rows of the pane's visible screen read: the agent's last message is near the bottom. */
const HOME_THREAD_PANE_ROWS = 80;
/** A pill's ends are fully round at any height. */
const PILL_RADIUS = 999;

/**
 * Keeps the strip's store fed for the target, and lets the target go when its
 * conversation ends. Renders nothing, so what it hears re-renders the strip
 * alone. A session is followed over the stream its own screen uses -- the
 * computer's socket where it has `ws_events`, else the session's event stream
 * -- with a snapshot read on subscribe, resync and reconnect; no polling. Only
 * while `enabled`: Home in front, its computer selected.
 */
export function HomeThreadFeed({
  target,
  enabled,
}: {
  target: HomeThreadTarget;
  enabled: boolean;
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
    // Reads and streams go through the selected computer: everything heard is
    // dropped unless that is still the very connection this started on.
    const owner = useGatewayConnectionStore.getState().record;
    if (owner?.serverId !== serverId) return;
    const owns = () => {
      const now = useGatewayConnectionStore.getState().record;
      return sameComputer(now, owner) && now?.deviceId === owner.deviceId;
    };
    const current = useHomeThreadLive.getState();
    let live: HomeThreadLive = current.key === key ? current.live : EMPTY_HOME_THREAD_LIVE;
    let active = true;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let reading = false;
    let readAgain = false;
    let closeStream: (() => void) | null = null;
    let releaseSocket: (() => void) | null = null;

    const publish = () => {
      publishTimer = null;
      if (active) useHomeThreadLive.getState().publish(key, live);
    };
    const schedule = () => {
      if (!publishTimer) publishTimer = setTimeout(publish, HOME_THREAD_PUBLISH_MS);
    };
    const read = () => {
      if (reading) {
        readAgain = true;
        return;
      }
      reading = true;
      void getAgentSessionSnapshot(sessionId, asid)
        .then(
          (snapshot) => {
            if (!active || !owns()) return;
            live = homeThreadLiveFromSnapshot(snapshot);
            if (publishTimer) clearTimeout(publishTimer);
            publish();
          },
          (failure: unknown) => {
            if (active && owns() && agentRequestErrorDetail(failure).status === 404)
              useHomeThreadLive.getState().markNotFound(key);
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
    const onEvent = (event: AgentDomainEvent) => {
      if (!active || (event.asid && event.asid !== asid)) return;
      if (event.type === 'agent.resync') {
        read();
        return;
      }
      live = applyHomeThreadEvent(live, event);
      schedule();
    };
    const connectStream = () => {
      closeStream = openAgentSessionStream({
        asid,
        sessionId,
        onEvent,
        onConnected: read,
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
        onSubscribed: read,
        onEvent,
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
      if (publishTimer) clearTimeout(publishTimer);
      if (retryTimer) clearTimeout(retryTimer);
      releaseSocket?.();
      closeStream?.();
    };
  }, [enabled, key, serverId, sessionId, asid]);

  // A pane has no transcript: its agent's last prose is read off its screen
  // (the terminal screen's own read) when it becomes the target, when its
  // status changes and when Home is back in front. No polling.
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
  useEffect(() => {
    if (!enabled || !paneId || !paneSessionId) return;
    const owner = useGatewayConnectionStore.getState().record;
    if (owner?.serverId !== serverId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      paneReadAtMs.current = Date.now();
      void readPaneOutput(paneSessionId, paneId, 'text', HOME_THREAD_PANE_ROWS, 'visible').then(
        (output) => {
          const now = useGatewayConnectionStore.getState().record;
          if (!active || !sameComputer(now, owner) || now?.deviceId !== owner.deviceId) return;
          const store = useHomeThreadLive.getState();
          const paneLine = paneAgentLine(output);
          if (store.key !== key || store.live.paneLine === paneLine) return;
          const { paneLine: _previous, ...live } = store.live;
          store.publish(key, paneLine ? { ...live, paneLine } : live);
        },
        // A pane that cannot be read says nothing; its mirror says whether it is gone.
        () => undefined
      );
    };
    const waitMs = paneReadAtMs.current + HOME_THREAD_PANE_READ_MS - Date.now();
    if (waitMs > 0) timer = setTimeout(read, waitMs);
    else read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, key, serverId, paneId, paneSessionId, paneStatus]);

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

/** What the strip's state word and the chip's tone read: the target's live state. */
function useHomeThreadState(target: HomeThreadTarget): HomeThreadState {
  const key = homeThreadKey(target);
  const live = useHomeThreadLive((state) => (state.key === key ? state.live : undefined));
  const task = useServerTasksStore((state) =>
    homeThreadTask(target, state.index[target.serverId]?.tasks)
  );
  const pane = useServerAgents((state) =>
    target.kind === 'pane'
      ? state.byServer[target.serverId]?.agents.find((agent) => agent.paneId === target.paneId)
      : undefined
  );
  return homeThreadState({
    ...(target.kind === 'session' && live ? { live } : {}),
    ...(task ? { task } : {}),
    ...(pane ? { pane } : {}),
    unbound: target.kind === 'task',
  });
}

/** A send whose delivery could not be confirmed: never resent without the reader. */
export type HomeThreadUnsure = { key: string; text: string; attachments: string[] };

/**
 * Home's reply bar, joined to the top of the composer on its ground: where the
 * next message goes and how it is doing, read at a glance.
 *
 * Row 1 is `↳ title · state` with × on the right, which lets the target go;
 * the next message then starts a new conversation. Row 2, at most two lines,
 * is the agent's latest reply, or while it works and has not replied the
 * progress line it reports, or for a pane the agent's last prose as its
 * screen shows it, or nothing. The reader's own message is never
 * repeated. A request waiting on the reader tints the bar and puts its
 * actions in row 2. The bar is one button that opens the conversation.
 */
export function HomeThreadBar({
  target,
  offline,
  unsure,
  onOpen,
  onClear,
  onRetry,
  named = false,
  onShown,
}: {
  target: HomeThreadTarget;
  offline: boolean;
  unsure: HomeThreadUnsure | null;
  onOpen?: () => void;
  onClear: () => void;
  onRetry: () => void;
  /**
   * The conversation is named, and cleared, on its own outlined card right
   * above (Stage): the bar drops the title and ×, says only how it is doing
   * and what it last said, and is not drawn when it has nothing to say.
   */
  named?: boolean;
  /** Told whether the bar is drawn, so the field joins it only then. */
  onShown?: (shown: boolean) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const reduced = useReducedMotion();
  const key = homeThreadKey(target);
  const live = useHomeThreadLive((state) =>
    state.key === key ? state.live : EMPTY_HOME_THREAD_LIVE
  );
  const task = useServerTasksStore((state) =>
    homeThreadTask(target, state.index[target.serverId]?.tasks)
  );
  const state = useHomeThreadState(target);

  const replyText =
    target.kind === 'session'
      ? homeThreadTurns(live).reply?.text
      : task?.summary && state !== 'working'
        ? task.summary
        : undefined;
  const progress = state === 'working' ? task?.progress : undefined;
  // Only what was reported: the reply, else the task's progress while it
  // works, else for a pane its agent's last prose as its screen shows it.
  const paneLine = target.kind === 'pane' && !replyText && !progress ? live.paneLine : undefined;
  const line = replyText ? plainFromMarkdown(replyText).trim() : (progress ?? paneLine);
  const lineSource = replyText ? 'reply' : paneLine ? 'pane' : 'progress';
  const word = offline
    ? t`Offline`
    : state === 'needs-you'
      ? t`Needs you`
      : state === 'working'
        ? t`Working`
        : state === 'failed'
          ? t`Failed`
          : state === 'starting'
            ? t`Starting…`
            : t`Idle`;
  const needsYou = state === 'needs-you' && !offline;
  const tone =
    needsYou || state === 'failed'
      ? theme.colors.warning
      : state === 'working' && !offline
        ? theme.colors.primary
        : theme.colors.textMuted;
  const permission = target.kind === 'session' ? live.permissions[0] : undefined;
  const form =
    target.kind === 'session' && !permission
      ? live.forms.find((entry) => entry.nonblocking !== true)
      : undefined;
  const title = live.title || target.title || t`Conversation`;
  const unsureHere = unsure?.key === key ? unsure : null;
  const enter = reduced ? calmFadeIn() : fadeIn('short');
  const exit = reduced ? calmFadeOut('micro') : fadeOut('micro');
  const shown =
    !named || Boolean(line) || needsYou || Boolean(permission || form) || Boolean(unsureHere);
  const reportShown = useEffectEvent((next: boolean) => onShown?.(next));
  useEffect(() => {
    reportShown(shown);
  }, [shown]);
  useEffect(() => () => reportShown(false), []);
  if (!shown) return null;

  return (
    <Animated.View
      testID="home-thread-bar-row"
      entering={reduced ? calmFadeIn() : riseIn()}
      exiting={reduced ? calmFadeOut() : fadeOut('short')}
      layout={listLayout()}
      style={[
        styles.bar,
        {
          backgroundColor: background(theme.colors.surface),
          borderTopLeftRadius: profile.chrome.composerField,
          borderTopRightRadius: profile.chrome.composerField,
          paddingHorizontal: theme.spacing.md,
          paddingTop: theme.spacing.sm,
          paddingBottom: theme.spacing.xs,
          gap: theme.spacing.xs,
        },
      ]}>
      {needsYou ? (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: withAlpha(theme.colors.warning, 0.1) },
          ]}
        />
      ) : null}
      <View style={styles.barRow}>
        <PressableScale
          testID="home-thread-bar"
          accessibilityRole="button"
          accessibilityLabel={t`Open conversation ${title}, ${word}`}
          accessibilityState={{ disabled: !onOpen }}
          disabled={!onOpen}
          onPress={onOpen}
          style={styles.barOpen}>
          {named ? (
            // The card above names it: the state leads, and the line follows on it.
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
              <Text testID="home-thread-state" variant="caption" weight="semibold" color={tone}>
                {`↳ ${word}`}
              </Text>
              {line && !permission && !form ? `  ${line}` : null}
            </Text>
          ) : (
            <View style={styles.barHead}>
              <Text
                variant="caption"
                weight="semibold"
                color={needsYou ? theme.colors.warning : theme.colors.text}
                numberOfLines={1}
                style={styles.barTitle}>
                {`↳ ${title}`}
              </Text>
              <Text
                testID="home-thread-state"
                variant="caption"
                color={tone}
                numberOfLines={1}
                style={styles.barState}>
                {`· ${word}`}
              </Text>
            </View>
          )}
          {!named && line && !permission && !form ? (
            <Animated.View
              key={`line:${task?.taskId ?? ''}:${lineSource}`}
              entering={enter}
              exiting={exit}>
              <Text
                testID="home-thread-reply"
                variant="caption"
                color={theme.colors.textMuted}
                numberOfLines={2}>
                {line}
              </Text>
            </Animated.View>
          ) : null}
        </PressableScale>
        {named ? null : (
          <PressableScale
            testID="home-thread-clear"
            accessibilityRole="button"
            accessibilityLabel={t`Stop following this conversation`}
            hitSlop={10}
            onPress={onClear}
            style={styles.barClose}>
            <CloseIcon size={14} color={theme.colors.textMuted} />
          </PressableScale>
        )}
      </View>
      {permission ? (
        <ThreadPermission target={target} request={permission} />
      ) : form ? (
        <ThreadQuestion target={target} form={form} onOpen={onOpen} />
      ) : null}
      {unsureHere ? (
        <Animated.View entering={enter} exiting={exit} style={styles.unsure}>
          <Text
            testID="home-thread-unsure"
            variant="caption"
            color={theme.colors.warning}
            style={styles.unsureText}>
            {t`Not sure it was delivered`}
          </Text>
          <CompactButton testID="home-thread-retry" label={t`Retry`} onPress={onRetry} />
          {onOpen ? (
            <CompactButton testID="home-thread-unsure-open" label={t`Open`} onPress={onOpen} />
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function CompactButton({
  label,
  onPress,
  tone,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone?: string;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useThemeTokens();
  const color = tone ?? theme.colors.primary;
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={[
        styles.compactButton,
        { backgroundColor: withAlpha(color, 0.14), borderRadius: PILL_RADIUS },
      ]}>
      <Text variant="caption" weight="semibold" color={color} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** Whether the selected computer is still the target's: replies use the shared client. */
function ownsTarget(target: HomeThreadTarget): boolean {
  return useGatewayConnectionStore.getState().record?.serverId === target.serverId;
}

/**
 * A permission, answered here: the session screen's own request
 * (`replyAgentPermission`) with its options as compact buttons. A failure is
 * said in place; nothing is retried.
 */
function ThreadPermission({
  target,
  request,
}: {
  target: HomeThreadTarget;
  request: PermissionRequest;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const options = (
    request.options.length > 0
      ? request.options
      : DEFAULT_PERMISSION_DECISIONS.map((decision, index) => ({
          index,
          label: decision,
          decision,
        }))
  ).map((option) => ({
    ...option,
    label: permissionOptionLabel(option, {
      allow: _(permissionDecisionLabel.allow),
      allow_always: _(permissionDecisionLabel.allow_always),
      deny: _(permissionDecisionLabel.deny),
      once: t`Allow once`,
      turn: t`Allow for this turn`,
    }),
  }));
  const decide = (decision: PermissionDecision) => {
    if (busy || target.kind !== 'session' || !ownsTarget(target)) return;
    setBusy(true);
    setFailed(null);
    const { serverId, sessionId, asid } = target;
    void settleAfter(
      () =>
        recoverWith(
          async () => {
            await replyAgentPermission(sessionId, asid, request.id, decision);
            useHomeAttention
              .getState()
              .resolve(
                { kind: 'agent-session', serverId, sessionId, directory: '', asid },
                request.id
              );
          },
          (failure: unknown) => {
            console.warn('Home could not reply to a permission:', failure);
            setFailed(t`Could not reply`);
          }
        ),
      () => setBusy(false)
    );
  };
  return (
    <View style={styles.request} testID="home-thread-permission">
      <Text variant="caption" color={theme.colors.text} numberOfLines={1}>
        {permissionSubject(request) || t`Permission required`}
      </Text>
      <View style={styles.actions}>
        {options.map((option) => (
          <CompactButton
            key={`${option.index}:${option.decision}`}
            label={option.label}
            tone={option.decision === 'deny' ? theme.colors.danger : theme.colors.warning}
            disabled={busy}
            onPress={() => decide(option.decision)}
          />
        ))}
      </View>
      {failed ? (
        <Text variant="caption" color={theme.colors.danger}>
          {failed}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A question: one with a single list of answers is answered here with them
 * (`replyAgentForm`, as its card does); anything richer opens the session,
 * where its full card is.
 */
function ThreadQuestion({
  target,
  form,
  onOpen,
}: {
  target: HomeThreadTarget;
  form: FormRequest;
  onOpen?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const field = form.fields.length === 1 ? form.fields[0] : undefined;
  const choices = field?.type === 'string' && field.options?.length ? field.options : undefined;
  const answer = (value: string) => {
    if (busy || !field || target.kind !== 'session' || !ownsTarget(target)) return;
    setBusy(true);
    setFailed(null);
    const { sessionId, asid } = target;
    void settleAfter(
      () =>
        recoverWith(
          async () => {
            await replyAgentForm(sessionId, asid, form.id, { [field.key]: value });
          },
          (failure: unknown) => {
            console.warn('Home could not answer a question:', failure);
            setFailed(t`Could not reply`);
          }
        ),
      () => setBusy(false)
    );
  };
  return (
    <View style={styles.request} testID="home-thread-question">
      <Text variant="caption" color={theme.colors.text} numberOfLines={2}>
        {field?.title || form.title}
      </Text>
      <View style={styles.actions}>
        {choices ? (
          choices.map((choice) => (
            <CompactButton
              key={choice.value}
              label={choice.label}
              tone={theme.colors.warning}
              disabled={busy}
              onPress={() => answer(choice.value)}
            />
          ))
        ) : onOpen ? (
          <CompactButton label={t`Answer`} tone={theme.colors.warning} onPress={onOpen} />
        ) : null}
      </View>
      {failed ? (
        <Text variant="caption" color={theme.colors.danger}>
          {failed}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { overflow: 'hidden' },
  barRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  barOpen: { flex: 1, gap: 2 },
  barHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  barTitle: { flexShrink: 1 },
  barState: { flexShrink: 0 },
  barClose: { paddingHorizontal: 4, paddingVertical: 2 },
  request: { gap: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  compactButton: { paddingHorizontal: 12, paddingVertical: 5 },
  unsure: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  unsureText: { flexShrink: 1 },
});
