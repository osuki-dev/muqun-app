import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LegendListRef } from '@legendapp/list/react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  Extrapolation,
  interpolate,
  makeMutable,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { AgentFormCard } from '@/components/agent-form-card';
import { AgentPermissionCard } from '@/components/agent-permission-card';
import { AgentTranscriptList } from '@/components/agent-transcript-list';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { HomeSheetGrabber, HomeSheetHeader } from '@/components/home-sheet';
import {
  followHomeSession,
  HOME_THREAD_PANE_POLL_MS,
  useHomeThreadState,
} from '@/components/home-thread';
import { JumpToLatestPill } from '@/components/jump-to-latest-pill';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { TerminalTranscript } from '@/components/terminal-transcript';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { removeTimelineItems } from '@/lib/agent-revert';
import { canReplyAgentForm } from '@/lib/agent-runtime-controls';
import { replyAgentForm, replyAgentPermission, type PermissionDecision } from '@/lib/agent-session';
import { replaceAgentTranscript, type AgentSessionRuntime } from '@/lib/agent-session-runtime';
import { upsertTimelineItems } from '@/lib/agent-timeline-upsert';
import { withAlpha } from '@/lib/color';
import { readPaneOutput } from '@/lib/gateway-client';
import { sameComputer } from '@/lib/home-composer';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  REPLY_DRAWER_MIN_HEIGHT,
  replyDrawerHeights,
  replyDrawerRubberBand,
  replyDrawerSettle,
  replyDrawerSnapHeight,
  type ReplyDrawerSnap,
} from '@/lib/home-reply-drawer';
import {
  homeThreadKey,
  homeThreadPanePolls,
  type HomeThreadState,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import { calmFadeIn, fadeIn, fadeOut, SETTLE, timing } from '@/lib/motion';
import { createTranscriptFollow } from '@/lib/transcript-follow';
import { TRANSCRIPT_ESTIMATED_ITEM_SIZE } from '@/lib/transcript-sizing';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeAttention } from '@/stores/home-attention';
import { useHomeThreadLive } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';

/**
 * Home's reply drawer: the dock's conversation, its real content, in a sheet
 * that rises from behind the composer while the composer stays where it is
 * and keeps sending to it.
 *
 * Three pieces, all drawn by the dock: the grabber on top of the field
 * (`HomeReplyGrabber`), the drawer under the dock (`HomeReplyDrawer`, the
 * dock's underlay, so it rides the keyboard with the field) and, from Home,
 * the page receding behind it (`HomeReplyRecede`). One controller
 * (`useHomeReplyDrawer`) owns where it rests and the height the finger drags.
 *
 * The drawer draws -- and reads, streams or polls -- only while it is open or
 * being dragged: closed, Home costs what it did without it.
 */

/** How far the drawer's foot tucks under the field, past the grabber row. */
const FIELD_OVERLAP = 22;
/** The grabber row on top of the field: its height is part of the overlap. */
const GRABBER_ROW_HEIGHT = 14;
/** How far Home recedes behind an open drawer, and how much it dims. */
const RECEDE_SCALE = 0.03;
const SCRIM_OPACITY = 0.28;
/** Rows of a pane's recent output the drawer shows: the screen and a little before it. */
const PANE_ROWS = 200;
/** After a send, the first read of the pane: time for the agent to take the message. */
const PANE_FIRST_READ_MS = 1_500;
/** History rows the transcript opens with, as the session screen's first page. */
const HISTORY_PAGE_SIZE = 40;
/** A Pad's drawer is a card, never wider than a comfortable transcript. */
const PAD_MAX_WIDTH = 760;

/**
 * How open the drawer is, 0 to 1, for Home to recede by. One drawer, Home's
 * dock's; written on the UI thread from the drag and the settle.
 */
export const homeReplyDrawerProgress = makeMutable(0);

export type HomeReplyDrawerController = ReturnType<typeof useHomeReplyDrawer>;

/**
 * Where the drawer rests and the height the finger moves. `clipHeight` is the
 * dock's measured field edge above its foot (`onDockHeight`'s second value).
 */
export function useHomeReplyDrawer({
  clipHeight,
  topInset,
}: {
  clipHeight: number;
  topInset: number;
}) {
  const reduced = useReducedMotion();
  const { height: windowHeight } = useWindowDimensions();
  /** The drawer's foot inside the dock: tucked under the field's top edge. */
  const clipBottom = Math.max(0, clipHeight - FIELD_OVERLAP);
  const heights = replyDrawerHeights({ windowHeight, topInset, foot: clipBottom });
  const [snap, setSnap] = useState<ReplyDrawerSnap>('closed');
  /** Where it last rested open: its body keeps that height while it closes. */
  const [resting, setResting] = useState<Exclude<ReplyDrawerSnap, 'closed'>>('peek');
  /** The body is drawn: open, being dragged, or still settling shut. */
  const [mounted, setMounted] = useState(false);
  /** Visible height above the drawer's foot, keyboard aside. */
  const height = useSharedValue(0);
  /** Reduce Motion: the drawer fades where it rests instead of travelling. */
  const fade = useSharedValue(0);
  const peek = useSharedValue(heights.peek);
  const full = useSharedValue(heights.full);
  const dragFrom = useSharedValue(0);
  const dragging = useSharedValue(false);
  useEffect(() => {
    peek.set(heights.peek);
    full.set(heights.full);
  }, [heights.peek, heights.full, peek, full]);

  /** Run once the drawer has gone: what closing it was for (the conversation let go). */
  const afterClose = useRef<(() => void) | null>(null);
  const unmount = useStableHandler(() => {
    setMounted(false);
    const after = afterClose.current;
    afterClose.current = null;
    after?.();
  });
  const settle = useStableHandler((next: ReplyDrawerSnap, velocityY?: number) => {
    const to = replyDrawerSnapHeight(next, { peek: peek.get(), full: full.get() });
    setSnap(next);
    if (next !== 'closed') {
      setMounted(true);
      setResting(next);
    }
    if (reduced) {
      if (next === 'closed') {
        fade.set(
          withTiming(0, timing('short'), (finished) => {
            'worklet';
            if (finished) {
              height.set(0);
              scheduleOnRN(unmount);
            }
          })
        );
      } else {
        height.set(to);
        fade.set(withTiming(1, timing('short')));
      }
      return;
    }
    fade.set(1);
    height.set(
      withSpring(to, { ...SETTLE, velocity: -(velocityY ?? 0) }, (finished) => {
        'worklet';
        if (finished && to === 0) scheduleOnRN(unmount);
      })
    );
  });
  // A window or dock change while open keeps it at its snap. Only a change
  // of size: a change of snap is `settle`'s, with the throw's speed.
  const keepAtSnap = useEffectEvent(() => {
    if (snap === 'closed' || dragging.get()) return;
    const to = replyDrawerSnapHeight(snap, heights);
    height.set(reduced ? to : withTiming(to, timing('short')));
  });
  useEffect(() => {
    keepAtSnap();
  }, [heights.peek, heights.full]);
  useAnimatedReaction(
    () =>
      reduced
        ? 0
        : Math.min(1, Math.max(0, height.get() / Math.max(1, peek.get()))) *
          (fade.get() > 0 ? 1 : 0),
    (progress) => homeReplyDrawerProgress.set(progress)
  );
  useEffect(() => () => homeReplyDrawerProgress.set(0), []);

  const begin = useStableHandler(() => {
    setMounted(true);
    if (snap === 'closed') setSnap('peek');
  });
  // One pan per handle (a gesture is attached to one detector): the grabber
  // on the field and the drawer's own header drag the same height.
  const grabberPan = useMemo(
    () => createDrawerPan({ begin, settle, dragFrom, dragging, fade, full, height, peek }),
    [begin, settle, dragFrom, dragging, fade, full, height, peek]
  );
  const headerPan = useMemo(
    () => createDrawerPan({ begin, settle, dragFrom, dragging, fade, full, height, peek }),
    [begin, settle, dragFrom, dragging, fade, full, height, peek]
  );

  return {
    snap,
    resting,
    open: snap !== 'closed',
    mounted,
    reduced,
    heights,
    clipBottom,
    height,
    fade,
    grabberPan,
    headerPan,
    show: () => settle('peek'),
    close: (after?: () => void) => {
      if (after) afterClose.current = after;
      settle('closed');
    },
  };
}

type DrawerPanInput = {
  begin: () => void;
  settle: (next: ReplyDrawerSnap, velocityY?: number) => void;
  dragFrom: SharedValue<number>;
  dragging: SharedValue<boolean>;
  fade: SharedValue<number>;
  full: SharedValue<number>;
  height: SharedValue<number>;
  peek: SharedValue<number>;
};

/** A pan that drags the drawer's height, and lets it go to the snap the throw reaches. */
function createDrawerPan(input: DrawerPanInput) {
  const { begin, settle, dragFrom, dragging, fade, full, height, peek } = input;
  return Gesture.Pan()
    .activeOffsetY([-8, 8])
    .failOffsetX([-16, 16])
    .onStart(() => {
      dragging.set(true);
      dragFrom.set(height.get());
      fade.set(1);
      scheduleOnRN(begin);
    })
    .onUpdate((event) => {
      height.set(replyDrawerRubberBand(dragFrom.get() - event.translationY, full.get()));
    })
    .onEnd((event) => {
      dragging.set(false);
      const next = replyDrawerSettle({
        height: height.get(),
        velocityY: event.velocityY,
        heights: { peek: peek.get(), full: full.get() },
      });
      scheduleOnRN(settle, next, event.velocityY);
    });
}

/** Home behind the drawer: it recedes a little and dims as the drawer rises. */
export function HomeReplyRecede({
  children,
  enabled = true,
}: {
  children: ReactNode;
  /** The Pad keeps its page still: the drawer is a card over it, and the dock can live in it. */
  enabled?: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const progress = enabled ? homeReplyDrawerProgress.get() : 0;
    return { transform: [{ scale: 1 - RECEDE_SCALE * progress }] };
  });
  return <Animated.View style={[styles.recede, style]}>{children}</Animated.View>;
}

/** The target's state as one word and its tone, as the drawer's chip says it. */
function useStateWord(state: HomeThreadState, offline: boolean) {
  const { t } = useLingui();
  const theme = useThemeTokens();
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
    !offline && (state === 'needs-you' || state === 'failed')
      ? theme.colors.warning
      : state === 'working' && !offline
        ? theme.colors.primary
        : theme.colors.textMuted;
  return { word, tone };
}

/**
 * The slim handle on top of the field while the dock has a conversation: a
 * tap or a swipe up shows it, a long press opens it in full. Warm while it
 * needs the reader; gone while the drawer is up (the drawer has its own).
 */
export function HomeReplyGrabber({
  target,
  controller,
  onOpenFull,
}: {
  target: HomeThreadTarget;
  controller: HomeReplyDrawerController;
  onOpenFull?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const needsYou = useHomeThreadState(target) === 'needs-you';
  const style = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, controller.height.get() / 80),
  }));
  return (
    <GestureDetector gesture={controller.grabberPan}>
      <Animated.View style={style}>
        <PressableScale
          testID="home-reply-grabber"
          accessibilityRole="button"
          accessibilityLabel={needsYou ? t`Show conversation, needs you` : t`Show conversation`}
          accessibilityHint={onOpenFull ? t`Long press to open it in full` : undefined}
          accessibilityState={{ expanded: controller.open }}
          onPress={() => {
            void Haptics.selectionAsync();
            controller.show();
          }}
          onLongPress={
            onOpenFull
              ? () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onOpenFull();
                }
              : undefined
          }
          hitSlop={{ top: 10, bottom: 4, left: 24, right: 24 }}
          style={styles.grabberRow}>
          <HomeSheetGrabber
            tint={needsYou ? theme.colors.warning : undefined}
            style={needsYou ? styles.grabberWarm : undefined}
          />
        </PressableScale>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The drawer itself, under everything the dock draws: a scrim over Home and
 * the sheet, clipped at the field so it seems to come out from behind it.
 * Rendered only while `controller.mounted`.
 */
export function HomeReplyDrawer({
  target,
  controller,
  agentName,
  offline,
  bleed,
  maxWidth,
  onOpenFull,
  onNewConversation,
}: {
  target: HomeThreadTarget;
  controller: HomeReplyDrawerController;
  agentName: string;
  offline: boolean;
  /** How far the drawer reaches past the dock's own sides (the phone's gutter). */
  bleed: number;
  /** A Pad's drawer is a card of at most this width, centred on the dock. */
  maxWidth?: number;
  onOpenFull?: () => void;
  /** Lets the conversation go: the next message starts a new one. */
  onNewConversation: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const { heights, height, fade, reduced, open } = controller;
  const close = useStableHandler(() => controller.close());
  const key = homeThreadKey(target);
  const liveTitle = useHomeThreadLive((state) =>
    state.key === key ? state.live.title : undefined
  );
  const title = liveTitle || target.title || t`Conversation`;
  const state = useHomeThreadState(target);
  const { word, tone } = useStateWord(state, offline);

  // Back closes the drawer before it leaves Home.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => subscription.remove();
  }, [open, close]);

  // The body is laid out once per resting place, never per frame: the sheet
  // travels whole and its body is as tall as where it rests.
  const bodyHeight = visibleOver(
    replyDrawerSnapHeight(controller.resting, heights),
    keyboardHeight
  );

  const scrimStyle = useAnimatedStyle(() => ({
    opacity:
      SCRIM_OPACITY *
      (reduced ? fade.get() : Math.min(1, height.get() / Math.max(1, heights.peek))),
  }));
  // The dock, and the drawer in it, rises with the keyboard: what shows of
  // the drawer above the field shrinks by as much, so its top stays put.
  const sheetStyle = useAnimatedStyle(() => {
    const keyboard = Math.max(0, -keyboardOffset.get());
    return {
      opacity: reduced ? fade.get() : 1,
      transform: [{ translateY: heights.full - visibleOver(height.get(), keyboard) }],
    };
  });
  // The content follows the sheet in, a beat after it starts to move.
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: reduced
      ? 1
      : interpolate(
          height.get(),
          [heights.peek * 0.2, heights.peek * 0.6],
          [0, 1],
          Extrapolation.CLAMP
        ),
  }));
  const radius = profile.chrome.sheet;

  return (
    <>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.scrim,
          {
            top: -windowHeight * 2,
            bottom: -windowHeight,
            left: -windowWidth,
            right: -windowWidth,
          },
          scrimStyle,
        ]}>
        <Pressable
          testID="home-reply-scrim"
          accessibilityRole="button"
          accessibilityLabel={t`Close`}
          style={StyleSheet.absoluteFill}
          onPress={close}
        />
      </Animated.View>
      <View
        pointerEvents="box-none"
        style={[
          styles.clip,
          {
            left: -bleed,
            right: -bleed,
            bottom: controller.clipBottom,
            height: heights.full + 160,
          },
        ]}>
        <Animated.View
          testID="home-reply-drawer"
          role="dialog"
          accessibilityLabel={title}
          style={[
            styles.sheet,
            {
              // Taller than full: a pull past it never lifts the foot off the field.
              height: heights.full + 80,
              ...(maxWidth
                ? { width: Math.min(maxWidth, windowWidth), alignSelf: 'center' }
                : { left: 0, right: 0 }),
              backgroundColor: background(theme.colors.background),
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
            },
            sheetStyle,
          ]}>
          <Animated.View style={[{ height: bodyHeight }, bodyStyle]}>
            <GestureDetector gesture={controller.headerPan}>
              <View collapsable={false}>
                <View style={styles.sheetGrabber}>
                  <HomeSheetGrabber />
                </View>
                <HomeSheetHeader
                  title={title}
                  titleLines={1}
                  closeTestID="home-reply-close"
                  onClose={close}
                  caption={
                    <View style={styles.captionRow}>
                      <Text
                        variant="caption"
                        color={theme.colors.textMuted}
                        numberOfLines={1}
                        style={styles.captionName}>
                        {agentName}
                      </Text>
                      <PressableScale
                        testID="home-reply-new"
                        accessibilityRole="button"
                        accessibilityLabel={t`Stop following this conversation`}
                        hitSlop={8}
                        onPress={() => controller.close(onNewConversation)}>
                        <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                          {t`New conversation`}
                        </Text>
                      </PressableScale>
                    </View>
                  }
                  trailing={
                    <>
                      <View
                        testID="home-reply-state"
                        style={[styles.chip, { backgroundColor: withAlpha(tone, 0.14) }]}>
                        <Text variant="caption" weight="semibold" color={tone} numberOfLines={1}>
                          {word}
                        </Text>
                      </View>
                      {onOpenFull ? (
                        <PressableScale
                          testID="home-reply-open"
                          accessibilityRole="button"
                          accessibilityLabel={t`Open the full conversation`}
                          hitSlop={8}
                          onPress={onOpenFull}
                          style={styles.openButton}>
                          <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                            {`${t`Open`} ↗`}
                          </Text>
                        </PressableScale>
                      ) : null}
                    </>
                  }
                />
              </View>
            </GestureDetector>
            <View style={[styles.body, { paddingBottom: FIELD_OVERLAP }]}>
              {target.kind === 'session' ? (
                <DrawerSession target={target} />
              ) : target.kind === 'pane' ? (
                <DrawerPane target={target} />
              ) : null}
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </>
  );
}

/** Of a drawer `height` tall, what shows above a keyboard `keyboard` tall: never less than a sliver. */
function visibleOver(height: number, keyboard: number): number {
  'worklet';
  if (keyboard <= 0) return height;
  return Math.max(height - keyboard, Math.min(height, REPLY_DRAWER_MIN_HEIGHT));
}

/**
 * A session's transcript, with the session screen's own list and rows, read
 * only: the snapshot it opens on, then its stream, live. The reader is kept
 * where they are when output lands under them, with the session screen's
 * "Latest" to come back down; their own send takes them to the end.
 */
function DrawerSession({ target }: { target: Extract<HomeThreadTarget, { kind: 'session' }> }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const reduced = useReducedMotion();
  const markdownStyle = usePaneChatMarkdownStyle();
  const [store] = useState(createAgentTranscriptStore);
  const [follow] = useState(createTranscriptFollow);
  const [runtime, setRuntime] = useState<AgentSessionRuntime | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const listRef = useRef<LegendListRef>(null);
  const { serverId, sessionId, asid } = target;
  const key = homeThreadKey(target);
  const readRuntime = useLatestReader(runtime);

  useEffect(() => {
    let windowStart = 0;
    return followHomeSession({
      serverId,
      sessionId,
      asid,
      onSnapshot: (snapshot) => {
        const transcript = store.getState();
        windowStart = Math.max(0, snapshot.timeline.length - HISTORY_PAGE_SIZE);
        transcript.configure({ windowStart, status: snapshot.info?.status });
        transcript.setTimeline(snapshot.timeline, windowStart);
        transcript.setInbox(snapshot.inbox);
        setRuntime(snapshot.info?.runtime);
        setLoaded(true);
      },
      onEvent: (event) => {
        const transcript = store.getState();
        switch (event.type) {
          case 'agent.timeline.upsert':
            if (replaceAgentTranscript('silent', readRuntime()))
              transcript.setTimeline((previous) => upsertTimelineItems(previous, event.items));
            break;
          case 'agent.timeline.removed':
            if (replaceAgentTranscript('silent', readRuntime()))
              transcript.setTimeline((previous) => removeTimelineItems(previous, event.ids));
            break;
          case 'agent.status.changed':
            transcript.configure({ windowStart, status: event.status });
            if (event.status === 'idle')
              transcript.setTimeline((previous) =>
                previous.some((item) => item.queued)
                  ? previous.map((item) => (item.queued ? { ...item, queued: false } : item))
                  : previous
              );
            break;
          case 'agent.inbox.changed':
            transcript.setInbox(event.items);
            break;
          case 'agent.session.updated':
            if (event.info.asid === asid) {
              transcript.configure({ windowStart, status: event.info.status });
              if (event.info.runtime) setRuntime(event.info.runtime);
            }
            break;
          default:
            break;
        }
      },
      onNotFound: () => {
        setMissing(true);
        setLoaded(true);
      },
    });
  }, [serverId, sessionId, asid, store, readRuntime]);

  useEffect(() => {
    const mark = () => {
      const timeline = store.getState().timeline;
      follow.setMark({ rows: timeline.length, seq: timeline.at(-1)?.seq ?? 0 });
    };
    mark();
    return store.subscribe(mark);
  }, [store, follow]);

  // The reader's own message, sent from the dock under the drawer, is where
  // they want to be: the one time the drawer moves them.
  const sentAtMs = target.sentAtMs;
  const seenSend = useRef(sentAtMs);
  useEffect(() => {
    if (sentAtMs === seenSend.current) return;
    seenSend.current = sentAtMs;
    follow.reset();
    void listRef.current?.scrollToEnd({ animated: !reduced });
  }, [sentAtMs, follow, reduced]);

  const permissions = useHomeThreadLive((state) =>
    state.key === key ? state.live.permissions : undefined
  );
  const forms = useHomeThreadLive((state) => (state.key === key ? state.live.forms : undefined));
  const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
  const decide = async (requestId: string, decision: PermissionDecision) => {
    if (!owns()) return;
    try {
      await replyAgentPermission(sessionId, asid, requestId, decision);
      useHomeAttention
        .getState()
        .resolve({ kind: 'agent-session', serverId, sessionId, directory: '', asid }, requestId);
    } catch (failure) {
      console.warn('Home could not reply to a permission:', failure);
      showToast({
        variant: 'danger',
        title: t`Could not reply`,
        message: describeGatewayFailure(failure, t`Could not reply`).message,
      });
    }
  };
  const answer = async (formId: string, answers: Record<string, unknown>) => {
    if (!owns()) return;
    try {
      await replyAgentForm(sessionId, asid, formId, answers);
    } catch (failure) {
      console.warn('Home could not answer a question:', failure);
      showToast({
        variant: 'danger',
        title: t`Could not reply`,
        message: describeGatewayFailure(failure, t`Could not reply`).message,
      });
    }
  };
  const replyable = (forms ?? []).filter((form) => canReplyAgentForm(form, runtime));
  const requests =
    (permissions?.length ?? 0) > 0 || replyable.length > 0 ? (
      <Animated.View entering={reduced ? calmFadeIn() : fadeIn('short')} style={styles.requests}>
        {permissions?.map((request) => (
          <AgentPermissionCard
            key={request.id}
            request={request}
            onDecision={(decision) => decide(request.id, decision)}
          />
        ))}
        {replyable.map((form) => (
          <AgentFormCard
            key={form.id}
            request={form}
            onSubmit={(answers) => answer(form.id, answers)}
          />
        ))}
      </Animated.View>
    ) : null;

  const rowProps = useMemo(
    () => ({
      showReasoning: true,
      markdownStyle,
      onPreviewImage: doNothing,
      onEditQueued: doNothing,
      onCancelQueued: doNothing,
      actions: { audioSessionId: asid },
      readOnly: true,
    }),
    [markdownStyle, asid]
  );
  const maintainEnd = useMemo(() => ({ animated: !reduced }), [reduced]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentSize.height <= 0) return;
    follow.setGeometry({
      offset: contentOffset.y,
      viewport: layoutMeasurement.height,
      content: contentSize.height,
    });
  };

  if (!loaded)
    return (
      <View testID="home-reply-loading" style={styles.center}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  if (missing)
    return (
      <View style={styles.center}>
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {t`Could not load the session`}
        </Text>
      </View>
    );
  return (
    <Animated.View entering={reduced ? calmFadeIn() : fadeIn('short')} style={styles.fill}>
      <AgentTranscriptList
        ref={listRef}
        keyboardAware={false}
        nestedScrollEnabled
        testID="home-reply-transcript"
        store={store}
        rowProps={rowProps}
        dataKey={asid}
        estimatedItemSize={TRANSCRIPT_ESTIMATED_ITEM_SIZE}
        alignItemsAtEnd
        initialScrollAtEnd
        maintainVisibleContentPosition={MAINTAIN_POSITION}
        maintainScrollAtEnd={maintainEnd}
        maintainScrollAtEndThreshold={0.1}
        onScroll={onScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text variant="bodySmall" color={theme.colors.textMuted}>
              {t`No output yet.`}
            </Text>
          </View>
        }
        ListFooterComponent={requests}
        style={styles.fill}
        contentContainerStyle={styles.transcriptContent}
      />
      <JumpToLatestPill
        testID="home-reply-latest"
        follow={follow}
        enabled
        bottom={12}
        onPress={() => {
          follow.reset();
          void listRef.current?.scrollToEnd({ animated: false });
        }}
      />
    </Animated.View>
  );
}

const doNothing = () => {};
const MAINTAIN_POSITION = { data: true, size: true } as const;

/**
 * A terminal agent's pane, as its screen shows it: the recent output in the
 * terminal's face and colours. Read when the drawer opens, when the agent's
 * status changes and after the reader's send; again every few seconds only
 * while the agent works or a reply is awaited. A reader who has scrolled up
 * keeps what they are reading: newer output waits behind "Latest".
 */
function DrawerPane({ target }: { target: Extract<HomeThreadTarget, { kind: 'pane' }> }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const terminal = useTerminalTheme();
  const mono = useMonoFontFamily();
  const profile = useAppearanceProfile();
  const { serverId, paneId } = target;
  const paneSessionId = useServerAgents(
    (state) => target.sessionId ?? state.byServer[serverId]?.sessionId
  );
  const status = useServerAgents((state) => {
    const row = state.byServer[serverId]?.agents.find((agent) => agent.paneId === paneId);
    return row ? `${row.status}:${row.pendingUserInput === true}` : undefined;
  });
  const [shown, setShown] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const atEnd = useRef(true);
  const scroller = useRef<ScrollViewInstance>(null);
  const [follow] = useState(createTranscriptFollow);
  const readTarget = useLatestReader(target);
  const sentAtMs = target.sentAtMs;

  const receive = useStableHandler((output: string) => {
    setFailed(false);
    if (shown === null || atEnd.current) {
      setShown(output);
      setWaiting(null);
    } else if (output !== shown) {
      setWaiting(output);
    }
  });
  useEffect(() => {
    if (!paneSessionId) return;
    const owner = useGatewayConnectionStore.getState().record;
    if (owner?.serverId !== serverId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = () => {
      timer = null;
      void readPaneOutput(paneSessionId, paneId, 'ansi', PANE_ROWS).then(
        (output) => {
          const now = useGatewayConnectionStore.getState().record;
          if (!active || !sameComputer(now, owner) || now?.deviceId !== owner.deviceId) return;
          receive(output);
          again();
        },
        () => {
          if (!active) return;
          setFailed(true);
          again();
        }
      );
    };
    // Read again while the agent works or the reader's message waits for its reply.
    const again = () => {
      if (!active) return;
      const mirror = useServerAgents
        .getState()
        .byServer[serverId]?.agents.find((agent) => agent.paneId === paneId);
      const working = mirror?.status === 'working';
      if (
        working ||
        homeThreadPanePolls({ target: readTarget(), nowMs: Date.now(), answered: false, working })
      )
        timer = setTimeout(read, HOME_THREAD_PANE_POLL_MS);
    };
    const sinceSend = sentAtMs === undefined ? Infinity : Date.now() - sentAtMs;
    if (sinceSend < PANE_FIRST_READ_MS) timer = setTimeout(read, PANE_FIRST_READ_MS - sinceSend);
    else read();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [serverId, paneId, paneSessionId, status, sentAtMs, receive, readTarget]);

  // The reader's own send takes them to the end.
  const seenSend = useRef(sentAtMs);
  useEffect(() => {
    if (sentAtMs === seenSend.current) return;
    seenSend.current = sentAtMs;
    atEnd.current = true;
    follow.reset();
  }, [sentAtMs, follow]);

  const showLatest = () => {
    atEnd.current = true;
    follow.reset();
    if (waiting !== null) {
      setShown(waiting);
      setWaiting(null);
    }
    scroller.current?.scrollToEnd({ animated: false });
  };

  if (shown === null)
    return (
      <View testID="home-reply-loading" style={styles.center}>
        {failed ? (
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            {t`Could not read the terminal.`}
          </Text>
        ) : (
          <ActivityIndicator color={theme.colors.primary} />
        )}
      </View>
    );
  return (
    <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')} style={styles.fill}>
      <View
        style={[
          styles.pane,
          { backgroundColor: terminal.background, borderRadius: profile.chrome.control },
        ]}>
        <ScrollView
          ref={scroller}
          testID="home-reply-pane"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.paneContent}
          onContentSizeChange={() => {
            if (atEnd.current) scroller.current?.scrollToEnd({ animated: false });
          }}
          scrollEventThrottle={32}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            const geometry = {
              offset: contentOffset.y,
              viewport: layoutMeasurement.height,
              content: contentSize.height,
            };
            follow.setGeometry(geometry);
            atEnd.current = follow.getSnapshot().atBottom;
            if (atEnd.current && waiting !== null) {
              setShown(waiting);
              setWaiting(null);
            }
          }}>
          <TerminalTranscript output={shown} maxLines={PANE_ROWS} fontFamily={mono} />
        </ScrollView>
      </View>
      <JumpToLatestPill
        testID="home-reply-latest"
        follow={follow}
        enabled
        bottom={12}
        onPress={showLatest}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  recede: { flex: 1 },
  grabberRow: {
    alignSelf: 'center',
    height: GRABBER_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  grabberWarm: { width: 48 },
  scrim: { position: 'absolute', backgroundColor: '#000' },
  clip: { position: 'absolute', overflow: 'hidden' },
  sheet: { position: 'absolute', bottom: -80, overflow: 'hidden' },
  sheetGrabber: { alignItems: 'center', paddingTop: 8 },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  captionName: { flexShrink: 1 },
  chip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  openButton: { paddingHorizontal: 2, paddingVertical: 4 },
  body: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  empty: { paddingVertical: 24, alignItems: 'center' },
  transcriptContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  requests: { gap: 10, paddingTop: 8 },
  pane: { flex: 1, marginHorizontal: 12, marginBottom: 8, overflow: 'hidden' },
  paneContent: { padding: 12 },
});

export { PAD_MAX_WIDTH as HOME_REPLY_PAD_MAX_WIDTH };
