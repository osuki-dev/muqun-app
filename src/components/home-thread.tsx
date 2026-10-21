import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState } from 'react';
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
import { WS_EVENTS_CAPABILITY } from '@/lib/gateway-socket';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import { goneSessionKey } from '@/lib/home-continue';
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
  type HomeThreadLive,
  type HomeThreadState,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import { plainFromMarkdown } from '@/lib/markdown-text';
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
    const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
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
  const resolved = homeThreadResolved(target, task);
  useEffect(() => {
    if (ended) useHomeThreads.getState().clear(target.serverId, target);
    else if (resolved !== target) useHomeThreads.getState().update(target, resolved);
  }, [ended, resolved, target]);
  return null;
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

/**
 * Where the next message goes, above the field: `→ title ×` and "New
 * conversation" with a target, else a quiet line naming the agent a new
 * conversation starts with. Always one row, so the field never moves when the
 * target changes; the two faces cross-fade in place.
 */
export function HomeThreadChip({
  target,
  agentName,
  offline,
  quiet = false,
  onClear,
}: {
  target: HomeThreadTarget | undefined;
  /** The agent a new conversation starts with. */
  agentName: string;
  offline: boolean;
  /** No target: say nothing (the field's decoration has that space). */
  quiet?: boolean;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const reduced = useReducedMotion();
  const enter = reduced ? calmFadeIn() : fadeIn('short');
  const exit = reduced ? calmFadeOut('micro') : fadeOut('micro');
  if (!target && quiet) return null;
  return (
    <Animated.View
      layout={listLayout()}
      // The composer's own ground, so the row reads over any page or wallpaper.
      style={[
        styles.chipRow,
        {
          backgroundColor: background(theme.colors.surface),
          borderRadius: profile.chrome.composerField,
          paddingHorizontal: theme.spacing.md,
          marginBottom: theme.spacing.xs,
        },
      ]}>
      {target ? (
        <Animated.View
          key={`thread:${homeThreadKey(target)}`}
          entering={enter}
          exiting={exit}
          style={styles.chipFaces}>
          <ThreadChip target={target} offline={offline} onClear={onClear} />
          <PressableScale
            testID="home-thread-new"
            accessibilityRole="button"
            accessibilityLabel={t`New conversation`}
            hitSlop={8}
            onPress={onClear}
            style={styles.newButton}>
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {t`+ New conversation`}
            </Text>
          </PressableScale>
        </Animated.View>
      ) : (
        <Animated.View key="new" entering={enter} exiting={exit} style={styles.chipFaces}>
          <Text
            testID="home-thread-new-line"
            variant="caption"
            color={theme.colors.textMuted}
            numberOfLines={1}
            style={styles.newLine}>
            {agentName ? t`New conversation · ${agentName}` : t`New conversation`}
          </Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function ThreadChip({
  target,
  offline,
  onClear,
}: {
  target: HomeThreadTarget;
  offline: boolean;
  onClear: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const state = useHomeThreadState(target);
  const tone = offline
    ? theme.colors.textMuted
    : state === 'needs-you'
      ? theme.colors.warning
      : theme.colors.primary;
  const title = target.title || t`Conversation`;
  return (
    <View
      testID="home-thread-chip"
      accessible
      accessibilityLabel={t`Replying to ${title}`}
      style={styles.chip}>
      <Text
        variant="caption"
        weight="semibold"
        color={tone}
        numberOfLines={1}
        style={styles.chipTitle}>
        {`→ ${title}`}
      </Text>
      <PressableScale
        testID="home-thread-clear"
        accessibilityRole="button"
        accessibilityLabel={t`Stop following this conversation`}
        hitSlop={10}
        onPress={onClear}
        style={styles.chipClose}>
        <CloseIcon size={14} color={tone} />
      </PressableScale>
    </View>
  );
}

/** A send whose delivery could not be confirmed: never resent without the reader. */
export type HomeThreadUnsure = { key: string; text: string; attachments: string[] };

/**
 * The target's last turns above the composer: the reader's message, the
 * agent's reply as it streams (two lines), and the progress line it reports
 * while working; a request waiting on the reader with its actions.
 */
export function HomeThreadStrip({
  target,
  offline,
  unsure,
  onOpen,
  onRetry,
}: {
  target: HomeThreadTarget;
  offline: boolean;
  unsure: HomeThreadUnsure | null;
  onOpen?: () => void;
  onRetry: () => void;
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

  const turns = target.kind === 'session' ? homeThreadTurns(live) : {};
  const mine = turns.mine?.text ?? target.lastSent;
  const replyText =
    turns.reply?.text ?? (target.kind !== 'session' && task?.summary ? task.summary : undefined);
  const reply = replyText ? plainFromMarkdown(replyText).trim() : undefined;
  // Only what the gateway reports; the header's word is the session's own status.
  const progress = state === 'working' ? task?.progress : undefined;
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
  const tone =
    state === 'needs-you' || state === 'failed'
      ? theme.colors.warning
      : state === 'working'
        ? theme.colors.primary
        : theme.colors.textMuted;
  const permission = target.kind === 'session' ? live.permissions[0] : undefined;
  const form =
    target.kind === 'session' && !permission
      ? live.forms.find((entry) => entry.nonblocking !== true)
      : undefined;
  const unsureHere = unsure?.key === key ? unsure : null;
  const enter = reduced ? calmFadeIn() : fadeIn('short');
  const exit = reduced ? calmFadeOut('micro') : fadeOut('micro');

  return (
    <Animated.View
      testID="home-thread-strip"
      entering={reduced ? calmFadeIn() : riseIn()}
      exiting={reduced ? calmFadeOut() : fadeOut('short')}
      layout={listLayout()}
      style={[
        {
          backgroundColor: background(theme.colors.surface),
          borderRadius: profile.chrome.composerField,
          paddingHorizontal: theme.spacing.md,
          paddingVertical: theme.spacing.sm,
          marginBottom: theme.spacing.xs,
          gap: theme.spacing.xs,
        },
      ]}>
      <View style={styles.stripHeader}>
        <Text variant="caption" weight="semibold" numberOfLines={1} style={styles.stripTitle}>
          {live.title || target.title || t`Conversation`}
        </Text>
        <Text
          testID="home-thread-state"
          variant="caption"
          color={tone}
          numberOfLines={1}
          accessibilityLiveRegion="polite">
          {word}
        </Text>
        {onOpen ? (
          <PressableScale
            testID="home-thread-open"
            accessibilityRole="button"
            accessibilityLabel={t`Open conversation`}
            hitSlop={8}
            onPress={onOpen}
            style={styles.open}>
            <Text variant="caption" weight="semibold" color={theme.colors.primary}>
              {`${t`Open`} ↗`}
            </Text>
          </PressableScale>
        ) : null}
      </View>
      {mine ? (
        <Animated.View key={`mine:${turns.mine?.id ?? mine}`} entering={enter} exiting={exit}>
          <Text variant="bodySmall" color={theme.colors.textMuted} numberOfLines={1}>
            {`› ${mine}`}
          </Text>
        </Animated.View>
      ) : null}
      {reply ? (
        <Animated.View
          key={`reply:${turns.reply?.id ?? task?.taskId ?? ''}`}
          entering={enter}
          exiting={exit}>
          <Text testID="home-thread-reply" variant="bodySmall" numberOfLines={2}>
            {reply}
          </Text>
        </Animated.View>
      ) : null}
      {progress ? (
        <Animated.View key={`progress:${progress}`} entering={enter} exiting={exit}>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {progress}
          </Text>
        </Animated.View>
      ) : null}
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
      <Text variant="bodySmall" weight="semibold" color={theme.colors.warning} numberOfLines={2}>
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
      <Text variant="bodySmall" weight="semibold" color={theme.colors.warning} numberOfLines={3}>
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
  chipRow: { flexDirection: 'row', minHeight: 32, alignItems: 'center' },
  chipFaces: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 2 },
  chipTitle: { flexShrink: 1 },
  chipClose: { paddingHorizontal: 4, paddingVertical: 2 },
  newButton: { flexShrink: 0, marginLeft: 'auto', paddingVertical: 4 },
  newLine: { flexShrink: 1 },
  stripHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stripTitle: { flexShrink: 1 },
  open: { marginLeft: 'auto', paddingHorizontal: 4, paddingVertical: 2 },
  request: { gap: 6, paddingTop: 2 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  compactButton: { paddingHorizontal: 12, paddingVertical: 5 },
  unsure: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  unsureText: { flexShrink: 1 },
});
