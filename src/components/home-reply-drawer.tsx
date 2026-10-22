import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import * as Haptics from 'expo-haptics';
import { type ReactNode, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated as NativeAnimated,
  AppState,
  BackHandler,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  type ScrollViewProps,
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
import { create } from 'zustand';

import { AgentFormCard } from '@/components/agent-form-card';
import { ComposerMenuButton } from '@/components/composer-attachment-button';
import { OpenExternalIcon, SessionIcon } from '@/icons';
import { AgentPermissionCard } from '@/components/agent-permission-card';
import { AgentTranscriptList } from '@/components/agent-transcript-list';
import { useHomeSessionReplies } from '@/components/home-session-replies';
import { useAppSettings } from '@/stores/app-settings';
import { noteGatewayGeneration } from '@/stores/gateway-connection-generation';
import {
  foldPaneWindow,
  terminalOwnsScreen,
  terminalViewportRows,
  type PaneReadOrigin,
  type PaneReadWindow,
} from '@/terminal/history';
import { createStreamReadFence } from '@/terminal/stream-read-fence';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { resolveThemeIcon } from '@/theme/icon-direction';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { HomeSheetGrabber, HomeSheetHeader } from '@/components/home-sheet';
import { SheetGround } from '@/components/sheet-ground';
import { ThemeArtwork, SHELL_WALLPAPER_FALLBACK } from '@/components/theme-artwork';
import { ThemeIcon } from '@/components/theme-icon';
import {
  followHomeSession,
  HOME_THREAD_PANE_POLL_MS,
  useHomeThreadState,
} from '@/components/home-thread';
import { JumpToLatestPill } from '@/components/jump-to-latest-pill';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { SkiaTerminal } from '@/components/skia-terminal';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { useAppActive } from '@/hooks/use-app-active';
import { useGatewayTunnel } from '@/hooks/use-gateway-tunnel';
import { usePaneEvents } from '@/hooks/use-pane-events';
import { removeTimelineItems } from '@/lib/agent-revert';
import { canReplyAgentForm } from '@/lib/agent-runtime-controls';
import { replaceAgentTranscript, type AgentSessionRuntime } from '@/lib/agent-session-runtime';
import { upsertTimelineItems } from '@/lib/agent-timeline-upsert';
import {
  INITIAL_PANE_OUTPUT_LINES,
  loadPanes,
  readPaneOutput,
  type HerdrEntity,
  type PaneOutputSource,
} from '@/lib/gateway-client';
import { field, numberField, optionalNumberField } from '@/lib/herdr-entity';
import { isFullScreenTuiPane } from '@/lib/terminal-keys';
import { sameComputer } from '@/lib/home-composer';
import {
  REPLY_DRAWER_MIN_HEIGHT,
  replyDrawerHeights,
  replyDrawerRubberBand,
  replyDrawerSettle,
  REPLY_DRAWER_OPEN_SNAP,
  replyDrawerSnapHeight,
  type ReplyDrawerSnap,
} from '@/lib/home-reply-drawer';
import { homeThreadKey, type HomeThreadTarget } from '@/lib/home-thread';
import { calmFadeIn, fadeIn, SETTLE, timing } from '@/lib/motion';
import { createTranscriptFollow } from '@/lib/transcript-follow';
import { TRANSCRIPT_ESTIMATED_ITEM_SIZE } from '@/lib/transcript-sizing';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeThreadLive } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';

/**
 * Home's reply drawer: the dock's conversation, its real content, in a sheet
 * that rises from behind the composer while the composer stays where it is
 * and keeps sending to it.
 *
 * Three pieces, all drawn by the dock: a toolbar button that shows it
 * (`HomeReplyButton`), the drawer under the dock (`HomeReplyDrawer`, the
 * dock's underlay, so it rides the keyboard with the field) and, from Home,
 * the page receding behind it (`HomeReplyRecede`). One controller
 * (`useHomeReplyDrawer`) owns where it rests and the height the finger drags.
 *
 * The drawer draws -- and reads, streams or polls -- only while it is open or
 * being dragged: closed, Home costs what it did without it.
 */

/** Room between the drawer's last row and the field's top edge. */
const FIELD_CLEARANCE = 8;
/** How far Home recedes behind an open drawer, and how much it dims. */
const RECEDE_SCALE = 0.03;
const SCRIM_OPACITY = 0.28;
/** History rows the transcript opens with, as the session screen's first page. */
const HISTORY_PAGE_SIZE = 40;
/** A Pad's drawer is a card, never wider than a comfortable transcript. */
const PAD_MAX_WIDTH = 760;

/**
 * How open the drawer is, 0 to 1, for Home to recede by. One drawer, Home's
 * dock's; written on the UI thread from the drag and the settle.
 */
export const homeReplyDrawerProgress = makeMutable(0);

/**
 * The drawer is drawn: open, being dragged, or still settling shut. Home
 * behind it is inert for exactly that long -- no scroll, no touches.
 */
export const useHomeReplyDrawerActive = create<{ active: boolean }>(() => ({ active: false }));
/** How far the finger travels before the content decides between scrolling and dragging. */
const CONTENT_DRAG_SLOP = 8;

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
  /** It stands on the dock's foot, behind the whole field: its rows end above it. */
  const heights = replyDrawerHeights({ windowHeight, topInset, field: clipHeight });
  const [snap, setSnap] = useState<ReplyDrawerSnap>('closed');
  /** Where it last rested open: its body keeps that height while it closes. */
  const [resting, setResting] =
    useState<Exclude<ReplyDrawerSnap, 'closed'>>(REPLY_DRAWER_OPEN_SNAP);
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
  /** The transcript is scrolled to its top: a pull down there drags the drawer. */
  const contentAtTop = useSharedValue(false);
  /** The content is dragging the drawer: the transcript holds still meanwhile. */
  const contentDragging = useSharedValue(false);
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
  useEffect(() => {
    useHomeReplyDrawerActive.setState({ active: mounted });
  }, [mounted]);
  useEffect(() => () => useHomeReplyDrawerActive.setState({ active: false }), []);

  const begin = useStableHandler(() => {
    setMounted(true);
    if (snap === 'closed') setSnap(REPLY_DRAWER_OPEN_SNAP);
  });
  // The drawer's grabber and header always drag it. Its transcript scrolls
  // first (`scroll`, the list's own native scroll); `content` drags the drawer
  // only from a list at its top with the finger moving down, as a bottom sheet
  // does. The two run simultaneously so the scroll never waits on the pull.
  const gestures = useMemo(() => {
    const input = { begin, settle, dragFrom, dragging, fade, full, height, peek };
    const scroll = Gesture.Native();
    const content = createContentPan({
      ...input,
      contentAtTop,
      contentDragging,
    }).simultaneousWithExternalGesture(scroll);
    return { header: createDrawerPan(input), scroll, content };
  }, [begin, settle, dragFrom, dragging, fade, full, height, peek, contentAtTop, contentDragging]);

  return {
    snap,
    resting,
    open: snap !== 'closed',
    mounted,
    reduced,
    heights,
    field: clipHeight,
    height,
    fade,
    gestures,
    contentAtTop,
    contentDragging,
    /** Opens straight to full height; the peek is only a rest on a drag down. */
    show: () => settle(REPLY_DRAWER_OPEN_SNAP),
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

/** A pan on the drawer's content: it activates only on a pull down from the list's top. */
function createContentPan(
  input: DrawerPanInput & {
    contentAtTop: SharedValue<boolean>;
    contentDragging: SharedValue<boolean>;
  }
) {
  const { contentAtTop, contentDragging } = input;
  const startX = makeMutable(0);
  const startY = makeMutable(0);
  return createDrawerPan(input)
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      startX.set(touch.absoluteX);
      startY.set(touch.absoluteY);
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch || event.numberOfTouches > 1) {
        manager.fail();
        return;
      }
      const dx = touch.absoluteX - startX.get();
      const dy = touch.absoluteY - startY.get();
      if (Math.abs(dx) < CONTENT_DRAG_SLOP && Math.abs(dy) < CONTENT_DRAG_SLOP) return;
      // Sideways, upwards, or down a list with rows above: the list's own.
      if (Math.abs(dx) >= Math.abs(dy) || dy < 0 || !contentAtTop.get()) {
        manager.fail();
        return;
      }
      contentDragging.set(true);
      manager.activate();
    })
    .onFinalize(() => {
      contentDragging.set(false);
    });
}

/** Home behind the drawer: it recedes a little and dims as the drawer rises. */
export function HomeReplyRecede({
  children,
  enabled = true,
  holdsDock = false,
}: {
  children: ReactNode;
  /** The Pad keeps its page still: the drawer is a card over it, and the dock can live in it. */
  enabled?: boolean;
  /** The dock, and so the drawer, is inside this page (the wide Pad cover): it stays touchable. */
  holdsDock?: boolean;
}) {
  // While the drawer is drawn, Home behind it takes no touch at all; the
  // drawer's scrim closes it on a tap.
  const inert = useHomeReplyDrawerActive((state) => state.active) && !holdsDock;
  const style = useAnimatedStyle(() => {
    const progress = enabled ? homeReplyDrawerProgress.get() : 0;
    return { transform: [{ scale: 1 - RECEDE_SCALE * progress }] };
  });
  return (
    <Animated.View
      pointerEvents={inert ? 'none' : 'auto'}
      importantForAccessibility={inert ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={inert}
      style={[styles.recede, style]}>
      {children}
    </Animated.View>
  );
}

/** A pack without its own Conversation glyph lends its Home arrow, pointing up. */
const CONVERSATION_ICON_ALTERNATE = { name: 'home.arrow', direction: 'up' } as const;

/**
 * The dock's way into the conversation: a toolbar button beside the
 * attachment and options buttons, while there is a session or pane to show.
 * A tap raises the drawer to full height, a long press opens the conversation in
 * full. A small warm dot while it needs the reader.
 */
export function HomeReplyButton({
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
  // The arrow turns to point down while the drawer it opens is up, and back
  // as it closes: a pack's own conversation glyph keeps its orientation.
  const { theme: customTheme, assets } = useEffectiveCustomTheme();
  const ownGlyph =
    resolveThemeIcon(customTheme?.manifest, assets, [{ name: 'chrome.conversation' }], (uri) =>
      isRenderableThemeAsset(uri)
    ) !== null;
  const turn = useSharedValue(controller.open && !ownGlyph ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(controller.open && !ownGlyph ? 1 : 0, timing('short')));
  }, [turn, controller.open, ownGlyph]);
  const turnStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.get() * 180}deg` }],
  }));
  return (
    <ComposerMenuButton
      testID="home-reply-button"
      label={needsYou ? t`Show conversation, needs you` : t`Show conversation`}
      hint={onOpenFull ? t`Long press to open it in full` : undefined}
      expanded={controller.open}
      onPress={() => {
        void Haptics.selectionAsync();
        if (controller.open) controller.close();
        else controller.show();
      }}
      onLongPress={
        onOpenFull
          ? () => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onOpenFull();
            }
          : undefined
      }>
      <Animated.View style={turnStyle}>
        <ThemeIcon
          name="chrome.conversation"
          alternate={CONVERSATION_ICON_ALTERNATE}
          fallback={SessionIcon}
          size={18}
          color={controller.open ? theme.colors.primary : theme.colors.textMuted}
        />
      </Animated.View>
      {needsYou ? (
        <Animated.View
          entering={fadeIn('short')}
          pointerEvents="none"
          style={[styles.dot, { backgroundColor: theme.colors.warning }]}
        />
      ) : null}
    </ComposerMenuButton>
  );
}

/**
 * The drawer itself, under everything the dock draws: a scrim over Home and
 * the sheet, standing on the dock's foot behind the field, so it seems to come out from behind it.
 * Rendered only while `controller.mounted`.
 */
export function HomeReplyDrawer({
  target,
  controller,
  agentName,
  bleed,
  maxWidth,
  onOpenFull,
}: {
  target: HomeThreadTarget;
  controller: HomeReplyDrawerController;
  agentName: string;
  /** How far the drawer reaches past the dock's own sides (the phone's gutter). */
  bleed: number;
  /** A Pad's drawer is a card of at most this width, centred on the dock. */
  maxWidth?: number;
  onOpenFull?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
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
  const floor = controller.field + REPLY_DRAWER_MIN_HEIGHT;
  const bodyHeight = visibleOver(
    replyDrawerSnapHeight(controller.resting, heights),
    keyboardHeight,
    floor
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
      transform: [{ translateY: heights.full - visibleOver(height.get(), keyboard, floor) }],
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
            bottom: 0,
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
              borderTopLeftRadius: radius,
              borderTopRightRadius: radius,
            },
            sheetStyle,
          ]}>
          {/* Conversations and terminal panes share their full page's wallpaper, over an
              opaque floor. Keep it static while Home's Stage is behind it. */}
          {target.kind !== 'task' ? (
            <View
              pointerEvents="none"
              accessible={false}
              importantForAccessibility="no-hide-descendants"
              style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}>
              <ThemeArtwork
                slot="shell.wallpaper"
                fallbackSlot={SHELL_WALLPAPER_FALLBACK}
                effectsEnabled={false}
              />
            </View>
          ) : (
            <SheetGround tint="background" frosted />
          )}
          <Animated.View style={[{ height: bodyHeight }, bodyStyle]}>
            <GestureDetector gesture={controller.gestures.header}>
              <View
                collapsable={false}
                style={
                  target.kind !== 'task' ? { backgroundColor: theme.colors.background } : undefined
                }>
                <View style={styles.sheetGrabber}>
                  <HomeSheetGrabber />
                </View>
                <HomeSheetHeader
                  title={title}
                  titleLines={1}
                  titleVariant="subheading"
                  closeTestID="home-reply-close"
                  onClose={close}
                  caption={
                    <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                      {agentName}
                    </Text>
                  }
                  trailing={
                    onOpenFull ? (
                      <PressableScale
                        testID="home-reply-open"
                        accessibilityRole="button"
                        accessibilityLabel={t`Open the full conversation`}
                        hitSlop={12}
                        onPress={onOpenFull}>
                        <OpenExternalIcon size={18} color={theme.colors.textMuted} />
                      </PressableScale>
                    ) : null
                  }
                />
              </View>
            </GestureDetector>
            <View style={[styles.body, { paddingBottom: controller.field + FIELD_CLEARANCE }]}>
              {target.kind === 'session' ? (
                <GestureDetector gesture={controller.gestures.content}>
                  <View collapsable={false} style={styles.fill}>
                    <DrawerSession
                      target={target}
                      scrollGesture={controller.gestures.scroll}
                      atTop={controller.contentAtTop}
                      dragging={controller.contentDragging}
                    />
                  </View>
                </GestureDetector>
              ) : target.kind === 'pane' ? (
                // The terminal's own gestures own its bounds: no drawer gesture
                // wraps it, so its scrollback pans and pinches win there.
                <DrawerPane target={target} />
              ) : null}
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </>
  );
}

/**
 * Of a drawer `height` tall, what shows above a keyboard `keyboard` tall:
 * never less than `floor` (the field and a few rows over it).
 */
function visibleOver(height: number, keyboard: number, floor: number): number {
  'worklet';
  if (keyboard <= 0) return height;
  return Math.max(height - keyboard, Math.min(height, floor));
}

/**
 * A session's transcript, with the session screen's own list and rows, read
 * only: the snapshot it opens on, then its stream, live. The reader is kept
 * where they are when output lands under them, with the session screen's
 * "Latest" to come back down; their own send takes them to the end.
 */
function DrawerSession({
  target,
  scrollGesture,
  atTop,
  dragging,
}: {
  target: Extract<HomeThreadTarget, { kind: 'session' }>;
  /** The list's native scroll, which the drawer's content pull runs alongside. */
  scrollGesture: ReturnType<typeof Gesture.Native>;
  atTop: SharedValue<boolean>;
  dragging: SharedValue<boolean>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
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
  // The list holds still while the finger drags the drawer from its top.
  const [locked, setLocked] = useState(false);
  useAnimatedReaction(
    () => dragging.get(),
    (next, previous) => {
      if (next !== previous) scheduleOnRN(setLocked, next);
    }
  );
  // It opens at its end, so it is not at its top until it says so.
  useEffect(() => atTop.set(false), [atTop]);
  const renderScroll = useMemo(
    () => (props: ScrollViewProps) => (
      <GestureDetector gesture={scrollGesture}>
        <NativeAnimated.ScrollView {...props} />
      </GestureDetector>
    ),
    [scrollGesture]
  );

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
  const { decide, answer } = useHomeSessionReplies(target);
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
    atTop.set(contentOffset.y <= 1);
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
        renderScrollComponent={renderScroll}
        scrollEnabled={!locked}
        bounces={false}
        overScrollMode="never"
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
/** How often an open drawer re-reads its pane's size while output streams. */
const PANE_GEOMETRY_REFRESH_MS = 2000;

/** The pane fields the drawer draws from (size, cursor, screen ownership). */
const DRAWN_PANE_FIELDS = [
  'width',
  'height',
  'cursor_x',
  'cursor_y',
  'terminal_title_stripped',
  'foreground_command',
] as const;

function sameDrawnPane(a: HerdrEntity | undefined, b: HerdrEntity | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.id !== b.id) return false;
  if (DRAWN_PANE_FIELDS.some((key) => a.raw[key] !== b.raw[key])) return false;
  const scrollA = a.raw.scroll as Record<string, unknown> | undefined;
  const scrollB = b.raw.scroll as Record<string, unknown> | undefined;
  return (
    scrollA?.viewport_rows === scrollB?.viewport_rows &&
    scrollA?.alternate_on === scrollB?.alternate_on
  );
}
const MAINTAIN_POSITION = { data: true, size: true } as const;

/**
 * A terminal agent's pane, drawn by the terminal screen's own renderer
 * (`SkiaTerminal`): the same grid, theme, face, text size and "Latest" as the
 * pane has when opened, read only (no touch input, no pane zoom). It is fed
 * the way the terminal screen feeds it: a full read, then the session's event
 * stream (`usePaneEvents`) with this pane's output inlined, folded into the
 * held window by `foldPaneWindow`; a read again on reconnect and on a
 * revision the stream did not inline, and a slow re-read only while the
 * stream is down. The stream is opened when the drawer mounts and closed
 * when it unmounts or the app goes to the background.
 */
function DrawerPane({ target }: { target: Extract<HomeThreadTarget, { kind: 'pane' }> }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const terminal = useTerminalTheme();
  const textSize = useAppSettings((state) => state.terminalTextSize);
  const appActive = useAppActive();
  const { serverId, paneId } = target;
  const record = useGatewayConnectionStore((state) =>
    state.record?.serverId === serverId ? state.record : null
  );
  const tunnel = useGatewayTunnel(record, Boolean(record));
  const sessionId =
    useServerAgents((state) => target.sessionId ?? state.byServer[serverId]?.sessionId) ?? '';
  const [pane, setPane] = useState<HerdrEntity | undefined>(undefined);
  const [paneRetry, setPaneRetry] = useState(0);
  const [held, setHeld] = useState<PaneReadWindow>({ output: '', capturedRows: 0 });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [streamUp, setStreamUp] = useState(false);

  // How the terminal screen reads this pane (`paneReading` there): an editor
  // from its visible screen, anything else from its recent unwrapped lines.
  const editor = isFullScreenTuiPane(
    undefined,
    field(pane, 'terminal_title_stripped'),
    field(pane, 'foreground_command')
  );
  const ownsScreen = terminalOwnsScreen(pane?.raw.scroll) ?? editor;
  const screenRows = terminalViewportRows(pane?.raw.scroll) ?? 0;
  const source: PaneOutputSource = editor ? 'visible' : 'recent-unwrapped';
  const readShape = useLatestReader({ ownsScreen, screenRows, source });

  const loadPane = useStableHandler(() => {
    if (!sessionId) return;
    void loadPanes(sessionId).then(
      (panes) => {
        const next = panes.find((item) => item.id === paneId);
        // A re-read that changed nothing this pane is drawn from keeps the
        // object it had, so it re-renders nothing.
        setPane((current) => (sameDrawnPane(current, next) ? current : next));
      },
      // A failed read leaves the pane without a size, so the fit cannot apply:
      // try again shortly rather than waiting for the next output.
      () => setPaneRetry((count) => count + 1)
    );
  });
  // herdr sends no event when a pane is resized on the computer, but the
  // program in it redraws for its new width, so output is the cue to look at
  // the pane's size again: at most once per `PANE_GEOMETRY_REFRESH_MS` while
  // output streams, the last call trailing the burst. The canvas eases to the
  // new fit (`SkiaTerminal`'s refit).
  const geometryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshGeometry = useStableHandler(() => {
    if (geometryTimer.current) return;
    geometryTimer.current = setTimeout(() => {
      geometryTimer.current = null;
      if (AppState.currentState === 'active') loadPane();
    }, PANE_GEOMETRY_REFRESH_MS);
  });
  useEffect(
    () => () => {
      if (geometryTimer.current) clearTimeout(geometryTimer.current);
    },
    []
  );
  useEffect(() => {
    if (paneRetry === 0 || !appActive) return;
    const timer = setTimeout(loadPane, PANE_GEOMETRY_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [paneRetry, appActive, loadPane]);
  // A read that lands after a newer streamed frame is not applied: see
  // `createStreamReadFence`.
  const [streamReadFence] = useState(createStreamReadFence);
  const fold = useStableHandler((text: string, origin: PaneReadOrigin) => {
    if (origin === 'frame') streamReadFence.noteFrame();
    const shape = readShape();
    setHeld((current) =>
      foldPaneWindow(
        current,
        text,
        origin,
        INITIAL_PANE_OUTPUT_LINES,
        shape.ownsScreen,
        shape.screenRows
      )
    );
    setLoaded(true);
    setFailed(false);
  });
  const reading = useRef(false);
  const read = useStableHandler(() => {
    if (!sessionId || reading.current) return;
    const owner = useGatewayConnectionStore.getState().record;
    if (owner?.serverId !== serverId) return;
    reading.current = true;
    const notOvertaken = streamReadFence.begin();
    void readPaneOutput(sessionId, paneId, 'ansi', INITIAL_PANE_OUTPUT_LINES, readShape().source)
      .then(
        (output) => {
          const now = useGatewayConnectionStore.getState().record;
          if (sameComputer(now, owner) && now?.deviceId === owner.deviceId && notOvertaken())
            fold(output, 'refresh');
        },
        () => {
          setFailed(true);
          setLoaded(true);
        }
      )
      .finally(() => {
        reading.current = false;
      });
  });
  useEffect(() => {
    loadPane();
    read();
  }, [sessionId, paneId, loadPane, read]);
  // With the stream down, reads are the only way new output arrives.
  useEffect(() => {
    if (streamUp || !appActive) return;
    const timer = setInterval(read, HOME_THREAD_PANE_POLL_MS);
    return () => clearInterval(timer);
  }, [streamUp, appActive, read]);

  usePaneEvents(
    tunnel.baseUrl,
    record?.token ?? null,
    sessionId,
    paneId,
    appActive && Boolean(record),
    0,
    useMemo(
      () => ({
        onPaneRevision: (revised: string) => {
          if (revised !== paneId) return;
          read();
          refreshGeometry();
        },
        onPaneOutput: (revised: string, _revision: number, text: string) => {
          if (revised !== paneId) return;
          fold(text, 'frame');
          refreshGeometry();
        },
        onStructureChanged: loadPane,
        onLayoutChanged: loadPane,
        onConnected: () => {
          setStreamUp(true);
          read();
          loadPane();
        },
        onDisconnected: () => setStreamUp(false),
        onOutputFrame: (payload: unknown) => noteGatewayGeneration(serverId, payload),
      }),
      [paneId, serverId, read, fold, loadPane, refreshGeometry]
    )
  );

  if (!loaded || (failed && !held.output))
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
    <Animated.View testID="home-reply-pane" entering={fadeIn('short')} style={styles.pane}>
      <TerminalBoundary
        resetKey={paneId}
        background={terminal.background}
        textColor={terminal.foreground}>
        <SkiaTerminal
          output={held.output}
          terminalId={paneId}
          textSize={textSize}
          screenRows={screenRows}
          ownsScreen={ownsScreen}
          screenFocused
          paneScale="mirror"
          opaqueCanvas={false}
          paneColumns={pane ? numberField(pane, 'width') || undefined : undefined}
          paneRows={pane ? numberField(pane, 'height') || undefined : undefined}
          paneCursorColumn={optionalNumberField(pane, 'cursor_x')}
          paneCursorRow={optionalNumberField(pane, 'cursor_y')}
        />
      </TerminalBoundary>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  recede: { flex: 1 },
  dot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4 },
  scrim: { position: 'absolute', backgroundColor: '#000' },
  clip: { position: 'absolute', overflow: 'hidden' },
  sheet: { position: 'absolute', bottom: -80, overflow: 'hidden' },
  sheetGrabber: { alignItems: 'center', paddingTop: 8 },
  body: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  empty: { paddingVertical: 24, alignItems: 'center' },
  transcriptContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  requests: { gap: 10, paddingTop: 8 },
  pane: { flex: 1, overflow: 'hidden' },
});

export { PAD_MAX_WIDTH as HOME_REPLY_PAD_MAX_WIDTH };
