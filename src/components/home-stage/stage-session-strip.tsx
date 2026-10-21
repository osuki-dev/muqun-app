import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type ScrollViewInstance,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ThemeIcon } from '@/components/theme-icon';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { NextIcon } from '@/icons';
import { withAlpha } from '@/lib/color';
import type { HomeContinueEntry } from '@/lib/home-continue';
import { HOME_DOCK_OUTER_INSET } from '@/lib/home-pad-geometry';
import {
  stageFlipDelay,
  stageFlipDirection,
  stageFlipVisibleSlots,
  type StageFlipDirection,
} from '@/lib/home-stage-flip';
import { cardIn, cardOut, listLayout, STAGE_FLIP_MOTION, STAGGER, timing } from '@/lib/motion';

/** A typical card, for counting how many are on screen; cards size to their titles. */
const CARD_ESTIMATE = 150;
/** The narrowest card: a two-character title is still a comfortable target. */
const CARD_MIN_WIDTH = 72;
/** The widest card, as a share of the row; a longer title truncates. */
const CARD_MAX_SHARE = 0.7;
const STRIP_GAP = 8;
/** The composer's own gutter, so the first card lines up with the composer below it. */
const STRIP_PADDING = HOME_DOCK_OUTER_INSET;
const HALF_TURN = Math.PI / 2;

type Flip = {
  /** Bumped each time the chosen computer changes; 0 until the first change. */
  generation: number;
  direction: StageFlipDirection;
  /** What the strip showed before the change: the faces turning away. */
  from: readonly HomeContinueEntry[];
};

type Shown = {
  serverId: string | undefined;
  index: number;
  sessions: readonly HomeContinueEntry[];
  flip: Flip;
};

export type StageSessionStripProps = {
  serverId: string | undefined;
  selectedIndex: number;
  panelCount: number;
  sessions: readonly HomeContinueEntry[];
  /** The session the dock is talking to: its card is outlined. */
  threadKey?: string;
  onOpenSession: (entry: HomeContinueEntry) => void;
  /** The card whose long-press menu is open: it shows as pressed. */
  menuKey?: string;
  /** A long press: the card's actions, with where the card is on screen. */
  onSessionActions?: (
    entry: HomeContinueEntry,
    card: { x: number; y: number; width: number; height: number }
  ) => void;
  onOpenAll: () => void;
};

/**
 * The chosen computer's sessions above the composer. When the computer changes
 * the cards turn like a rotating billboard: each slat flips about its
 * horizontal axis, left to right, the way the cover-flow travelled. The turn is
 * transforms and opacity on the UI thread; React renders once per change.
 */
export function StageSessionStrip({
  serverId,
  selectedIndex,
  panelCount,
  sessions,
  threadKey,
  menuKey,
  onOpenSession,
  onSessionActions,
  onOpenAll,
}: StageSessionStripProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const profile = useAppearanceProfile();
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const scroll = useRef<ScrollViewInstance>(null);

  // What the strip last showed, carried forward so a computer change knows the
  // faces to turn away. Adjusted during render so the first frame of the new
  // computer already has its old faces in place.
  const [shown, setShown] = useState<Shown>(() => ({
    serverId,
    index: selectedIndex,
    sessions,
    flip: { generation: 0, direction: 1, from: [] },
  }));
  if (shown.serverId !== serverId) {
    setShown({
      serverId,
      index: selectedIndex,
      sessions,
      flip: {
        generation: shown.flip.generation + 1,
        direction: stageFlipDirection(shown.index, selectedIndex, panelCount),
        from: shown.sessions,
      },
    });
  } else if (shown.sessions !== sessions || shown.index !== selectedIndex) {
    setShown({ ...shown, index: selectedIndex, sessions });
  }
  const { flip } = shown;

  const resetScroll = useEffectEvent(() => scroll.current?.scrollTo({ x: 0, animated: !reduced }));
  useEffect(() => {
    if (flip.generation > 0) resetScroll();
  }, [flip.generation]);

  const visible = stageFlipVisibleSlots(width, CARD_ESTIMATE, STRIP_GAP, STRIP_PADDING);
  const bounds = { minWidth: CARD_MIN_WIDTH, maxWidth: Math.round(width * CARD_MAX_SHARE) };
  // Each session's card width as last laid out, by session, so the commit
  // that changes computer already gives every face turning away its own old
  // width: never laid out at the new card's width and clipped. Set only when a
  // width actually changes, so a change of computer adds at most one render.
  const [widths, setWidths] = useState<Readonly<Record<string, number>>>({});
  const measured = useStableHandler((key: string, faceWidth: number) =>
    setWidths((all) => (all[key] === faceWidth ? all : { ...all, [key]: faceWidth }))
  );
  const surface = background(theme.colors.surface);
  const idleBorder = withAlpha(theme.colors.text, 0.1);
  const liveBorder = withAlpha(theme.colors.primary, 0.6);
  const raised = background(theme.colors.surfaceRaised);
  const face = (entry: HomeContinueEntry) => ({
    backgroundColor: entry.key === menuKey ? raised : surface,
    borderColor:
      entry.key === threadKey
        ? theme.colors.primary
        : entry.observation?.status === 'working'
          ? liveBorder
          : idleBorder,
    borderWidth: entry.key === threadKey ? 1.5 : StyleSheet.hairlineWidth,
    borderRadius: profile.chrome.card,
  });

  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}>
      <LayoutAnimationConfig skipEntering>
        {sessions.map((entry, index) => {
          const from = flip.from[index];
          const delay = stageFlipDelay(
            index,
            visible,
            STAGE_FLIP_MOTION.stepMs,
            STAGE_FLIP_MOTION.cardMs,
            STAGE_FLIP_MOTION.budgetMs
          );
          return (
            <Animated.View
              // By position: a slot keeps its place and turns to show the new
              // computer's session there; slots the new list lacks fade away.
              // oxlint-disable-next-line react/no-array-index-key -- the slot is the position, not the session.
              key={index}
              entering={cardIn(reduced ? 0 : delay + STAGGER.card)}
              exiting={cardOut()}
              // The row reflows to the new titles' widths under the turn.
              layout={listLayout(reduced ? 'short' : STAGE_FLIP_MOTION.cardMs)}>
              <StageSessionSlot
                entry={entry}
                from={from}
                flip={flip}
                delay={delay}
                reduced={reduced}
                faceStyle={[face(entry), bounds]}
                fromStyle={from ? [face(from), bounds] : undefined}
                fromWidth={from ? widths[from.key] : undefined}
                onMeasured={measured}
                onPress={() => onOpenSession(entry)}
                selected={entry.key === menuKey}
                onLongPress={onSessionActions ? (card) => onSessionActions(entry, card) : undefined}
              />
            </Animated.View>
          );
        })}
        <Animated.View layout={listLayout(reduced ? 'short' : STAGE_FLIP_MOTION.cardMs)}>
          <PressableScale
            testID="home-stage-all-sessions"
            accessibilityRole="button"
            accessibilityLabel={t`All sessions`}
            onPress={onOpenAll}
            style={[
              styles.card,
              styles.moreCard,
              {
                backgroundColor: surface,
                borderColor: idleBorder,
                borderRadius: profile.chrome.card,
              },
            ]}>
            <Text
              variant="bodySmall"
              weight="semibold"
              color={theme.colors.primary}
              style={styles.moreLabel}>
              {t`All sessions`}
            </Text>
            <ThemeIcon
              name="home.arrow"
              fallback={NextIcon}
              size={16}
              color={theme.colors.primary}
            />
          </PressableScale>
        </Animated.View>
      </LayoutAnimationConfig>
    </ScrollView>
  );
}

type FaceStyle = StyleProp<ViewStyle>;

/**
 * One slat. The press target is the unturned slot itself and always opens the
 * new session, so a tap mid-turn never reaches the computer being left.
 */
function StageSessionSlot({
  entry,
  from,
  flip,
  delay,
  reduced,
  faceStyle,
  fromStyle,
  fromWidth,
  onMeasured,
  onPress,
  onLongPress,
  selected,
}: {
  entry: HomeContinueEntry;
  from: HomeContinueEntry | undefined;
  flip: Flip;
  delay: number;
  reduced: boolean;
  faceStyle: FaceStyle;
  fromStyle: FaceStyle | undefined;
  fromWidth: number | undefined;
  onMeasured: (key: string, width: number) => void;
  onPress: () => void;
  onLongPress?: (card: { x: number; y: number; width: number; height: number }) => void;
  selected: boolean;
}) {
  const slot = useRef<ViewInstance>(null);
  return (
    <PressableScale
      ref={slot}
      testID="home-stage-session"
      accessibilityRole="button"
      accessibilityLabel={entry.title}
      accessibilityState={{ selected }}
      onPress={onPress}
      onLongPress={
        onLongPress
          ? () =>
              slot.current?.measureInWindow((x, y, width, height) =>
                onLongPress({ x, y, width, height })
              )
          : undefined
      }
      style={styles.slot}>
      <StageSessionTurn
        // A new turn for every change of computer: its progress is created at
        // the turn's start (0: the old face flat, the new one edge-on and
        // hidden), so the very commit that brings the new session in paints
        // the old face untouched, before any animation has been armed.
        key={flip.generation}
        entry={entry}
        from={from}
        direction={flip.direction}
        animate={flip.generation > 0}
        delay={delay}
        reduced={reduced}
        faceStyle={faceStyle}
        fromStyle={fromStyle}
        fromWidth={fromWidth}
        onMeasured={onMeasured}
      />
    </PressableScale>
  );
}

function StageSessionTurn({
  entry,
  from,
  direction,
  animate,
  delay,
  reduced,
  faceStyle,
  fromStyle,
  fromWidth,
  onMeasured,
}: {
  entry: HomeContinueEntry;
  from: HomeContinueEntry | undefined;
  direction: StageFlipDirection;
  animate: boolean;
  delay: number;
  reduced: boolean;
  faceStyle: FaceStyle;
  fromStyle: FaceStyle | undefined;
  fromWidth: number | undefined;
  onMeasured: (key: string, width: number) => void;
}) {
  const entryKey = entry.key;
  const turns = animate && from !== undefined;
  const progress = useSharedValue(turns ? 0 : 1);

  const start = useEffectEvent(() => {
    if (!turns) return;
    progress.set(
      reduced
        ? withTiming(1, timing(STAGE_FLIP_MOTION.fadeMs, { reduceMotion: ReduceMotion.Never }))
        : withDelay(
            delay,
            withTiming(1, timing(STAGE_FLIP_MOTION.cardMs, { reduceMotion: ReduceMotion.Never }))
          )
    );
  });
  useEffect(() => start(), []);

  const newStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (reduced) return { opacity: p, transform: [{ rotateX: '0deg' }] };
    // Second half of the turn: from edge-on (90 degrees) back to flat.
    const angle = (p - 1) * Math.PI * direction;
    const shown = p >= 0.5;
    return {
      opacity: shown ? 1 - 0.35 * Math.sin(Math.abs(angle)) : 0,
      transform: [
        { perspective: STAGE_FLIP_MOTION.perspective },
        { rotateX: `${shown ? angle : -HALF_TURN * direction}rad` },
      ],
    };
  });
  const oldStyle = useAnimatedStyle(() => {
    const p = progress.get();
    if (reduced) return { opacity: 1 - p, transform: [{ rotateX: '0deg' }] };
    // First half: flat to edge-on, away from the reader.
    const angle = p * Math.PI * direction;
    const shown = p < 0.5;
    return {
      opacity: shown ? 1 - 0.35 * Math.sin(Math.abs(angle)) : 0,
      transform: [
        { perspective: STAGE_FLIP_MOTION.perspective },
        { rotateX: `${shown ? angle : HALF_TURN * direction}rad` },
      ],
    };
  });

  return (
    <>
      <Animated.View
        onLayout={(event) => onMeasured(entryKey, event.nativeEvent.layout.width)}
        style={[styles.card, styles.face, faceStyle, newStyle]}>
        <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
          {entry.title}
        </Text>
      </Animated.View>
      {turns && from && fromStyle ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[
            styles.card,
            styles.face,
            styles.back,
            fromStyle,
            // Its own width from before the change, never the new card's.
            fromWidth === undefined ? null : { width: fromWidth },
            oldStyle,
          ]}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
            {from.title}
          </Text>
        </Animated.View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: STRIP_PADDING, gap: STRIP_GAP },
  slot: { alignSelf: 'flex-start' },
  card: {
    minHeight: 46,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
  },
  face: { backfaceVisibility: 'hidden' },
  // Pinned to the slot's left, top and bottom; its width is the old title's own.
  back: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  moreCard: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  moreLabel: { flexShrink: 0 },
});
