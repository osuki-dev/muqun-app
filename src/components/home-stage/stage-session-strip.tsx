import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type ScrollViewInstance,
  type StyleProp,
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
  type SharedValue,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ThemeIcon } from '@/components/theme-icon';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { NextIcon } from '@/icons';
import { withAlpha } from '@/lib/color';
import type { HomeContinueEntry } from '@/lib/home-continue';
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
const STRIP_PADDING = 14;
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
  onOpenSession: (entry: HomeContinueEntry) => void;
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
  onOpenSession,
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
  // Each session's card width as last laid out, by session: a face turning
  // away keeps its own width rather than taking the new card's.
  const widths = useSharedValue<Record<string, number>>({});
  const measured = useStableHandler((key: string, faceWidth: number) =>
    widths.modify((all) => {
      'worklet';
      all[key] = faceWidth;
      return all;
    })
  );
  const surface = background(theme.colors.surface);
  const idleBorder = withAlpha(theme.colors.text, 0.1);
  const liveBorder = withAlpha(theme.colors.primary, 0.6);
  const face = (entry: HomeContinueEntry) => ({
    backgroundColor: surface,
    borderColor: entry.observation?.status === 'working' ? liveBorder : idleBorder,
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
                widths={widths}
                onMeasured={measured}
                onPress={() => onOpenSession(entry)}
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
  widths,
  onMeasured,
  onPress,
}: {
  entry: HomeContinueEntry;
  from: HomeContinueEntry | undefined;
  flip: Flip;
  delay: number;
  reduced: boolean;
  faceStyle: FaceStyle;
  fromStyle: FaceStyle | undefined;
  widths: SharedValue<Record<string, number>>;
  onMeasured: (key: string, width: number) => void;
  onPress: () => void;
}) {
  const entryKey = entry.key;
  const fromKey = from?.key;
  const progress = useSharedValue(1);
  // The generation the running turn belongs to. Until the effect starts the
  // turn for a new generation, the styles hold the old face (progress 0), so
  // the new session is never painted ahead of its turn.
  const started = useSharedValue(flip.generation);
  const generation = flip.generation;
  const direction = flip.direction;
  const turns = from !== undefined;

  const start = useEffectEvent(() => {
    started.set(generation);
    if (!turns) return;
    progress.set(0);
    progress.set(
      reduced
        ? withTiming(1, timing(STAGE_FLIP_MOTION.fadeMs, { reduceMotion: ReduceMotion.Never }))
        : withDelay(
            delay,
            withTiming(1, timing(STAGE_FLIP_MOTION.cardMs, { reduceMotion: ReduceMotion.Never }))
          )
    );
  });
  useEffect(() => {
    if (generation > 0) start();
  }, [generation]);

  const newStyle = useAnimatedStyle(() => {
    const p = turns && started.get() !== generation ? 0 : progress.get();
    if (reduced) return { opacity: p, transform: [{ rotateX: '0deg' }] };
    // Second half of the turn: from edge-on (90 degrees) back to flat.
    const angle = (p - 1) * Math.PI * direction;
    const shown = p >= 0.5;
    return {
      opacity: shown ? 1 - 0.35 * Math.sin(Math.abs(angle)) : 0,
      transform: [
        { perspective: STAGE_FLIP_MOTION.perspective },
        { rotateX: `${shown ? angle : HALF_TURN * direction}rad` },
      ],
    };
  });
  const oldStyle = useAnimatedStyle(() => {
    const p = turns && started.get() !== generation ? 0 : progress.get();
    if (reduced) return { opacity: 1 - p, transform: [{ rotateX: '0deg' }] };
    // First half: flat to edge-on, away from the reader.
    const angle = p * Math.PI * direction;
    const shown = p < 0.5;
    const fromWidth = fromKey === undefined ? undefined : widths.get()[fromKey];
    return {
      ...(fromWidth === undefined ? null : { width: fromWidth }),
      opacity: shown ? 1 - 0.35 * Math.sin(Math.abs(angle)) : 0,
      transform: [
        { perspective: STAGE_FLIP_MOTION.perspective },
        { rotateX: `${shown ? angle : HALF_TURN * direction}rad` },
      ],
    };
  });

  return (
    <PressableScale
      testID="home-stage-session"
      accessibilityRole="button"
      accessibilityLabel={entry.title}
      onPress={onPress}
      style={styles.slot}>
      <Animated.View
        onLayout={(event) => onMeasured(entryKey, event.nativeEvent.layout.width)}
        style={[styles.card, styles.face, faceStyle, newStyle]}>
        <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
          {entry.title}
        </Text>
      </Animated.View>
      {from && fromStyle ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.card, styles.face, styles.back, fromStyle, oldStyle]}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
            {from.title}
          </Text>
        </Animated.View>
      ) : null}
    </PressableScale>
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
