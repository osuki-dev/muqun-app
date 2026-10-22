/**
 * One theme as a card: the theme's own picture on top, its name and where it
 * came from underneath. Every tab of the themes sheet -- Mine, Built-in and
 * Gallery -- draws this one card, so a theme looks the same whichever list it
 * is found in.
 *
 * The card is a content surface on the sheet's frosted ground, so its fill goes
 * through the reader's interface opacity (`useSurfaceBackground`) and its
 * corner is the profile's `card` radius. The picture is artwork and keeps its
 * own colours. A filled check in the picture's corner marks the current theme
 * without adding an outline around the whole card.
 *
 * Every card in a grid is exactly as tall as `themeGridLayout` says, which is
 * what lets the list place them without measuring (`getFixedItemSize`).
 */
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Skeleton, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { themeSwatch, type ThemeAppearance } from '@/constants/theme-packs';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { AddItemIcon, DoneIcon } from '@/icons';
import { DURATION, fadeIn, fadeOut, riseIn, timing, travelTiming } from '@/lib/motion';
import { withAlpha } from '@/lib/color';
import { sheetFrostAlpha, surfaceBackgroundFill } from '@/theme/surface-background';

/** Between two cards, across and down. */
export const THEME_GRID_GAP = 12;

/** The copy under the picture at a font scale of 1: padding, a name, a caption. */
const CARD_COPY_PADDING = 18;
const CARD_COPY_LINES = 40;

export type ThemeGridLayout = {
  columns: number;
  previewHeight: number;
  cardHeight: number;
  /** What the list reserves per card: the card and the gap under it. */
  itemHeight: number;
};

/**
 * Two across on a phone, three on a small tablet, four on a large one, with a
 * 4:3 picture. The copy grows with the reader's text size rather than being
 * clipped by it.
 */
export function themeGridLayout(width: number, fontScale = 1): ThemeGridLayout {
  const columns = width >= 900 ? 4 : width >= 560 ? 3 : 2;
  const cardWidth = Math.max(0, (width - THEME_GRID_GAP * (columns - 1)) / columns);
  const previewHeight = Math.round((cardWidth * 3) / 4);
  const copy = Math.ceil(CARD_COPY_PADDING + CARD_COPY_LINES * Math.min(Math.max(fontScale, 1), 2));
  const cardHeight = previewHeight + copy;
  return { columns, previewHeight, cardHeight, itemHeight: cardHeight + THEME_GRID_GAP };
}

/** One entry of a card's long-press menu, also offered to assistive technology. */
export type ThemeCardAction = {
  name: string;
  label: string;
  run: () => void;
  Icon?: ComponentType<{ size?: number; color?: string }>;
  tone?: 'default' | 'danger';
  /**
   * Ask twice before `run`. Such an action is never offered as a bare
   * accessibility action -- that would remove a theme in one gesture -- and is
   * reached through the menu, which asks.
   */
  confirm?: { label: string; detail?: string };
};

/**
 * A card's arrival: `riseIn` the first time a key is seen, nothing after.
 *
 * The list mounts and unmounts cells as they cross the viewport, so without
 * the record a scrolled-back grid would rise in again -- the difference
 * between a list that arrives and one that flickers. A `Set` the sheet owns,
 * written from an effect: the render that decides whether to animate only
 * reads it.
 */
export type CardRise = {
  revealed: Set<string>;
  key: string;
  delay: number;
  enabled: boolean;
  /**
   * When the tab last changed. A card mounted just after a switch fades in,
   * which is the tab's cross-fade; one mounted by scrolling later does not.
   */
  switchedAt?: number;
};

/** How long after a tab switch a mounting card still counts as part of it. */
const TAB_FADE_WINDOW_MS = 400;

function useCardRise(rise: CardRise | undefined) {
  const [entering] = useState(() => {
    if (!rise) return undefined;
    if (rise.enabled && !rise.revealed.has(rise.key)) return riseIn(rise.delay);
    return rise.switchedAt !== undefined && Date.now() - rise.switchedAt < TAB_FADE_WINDOW_MS
      ? fadeIn('micro')
      : undefined;
  });
  const revealed = rise?.revealed;
  const key = rise?.key;
  useEffect(() => {
    if (revealed && key) revealed.add(key);
  }, [revealed, key]);
  return entering;
}

export function ThemeCard({
  testID,
  name,
  caption,
  captionKey,
  preview,
  layout,
  current = false,
  badge,
  progress,
  dimmed = false,
  disabled = false,
  rise,
  accessibilityLabel,
  accessibilityValue,
  actions,
  onPress,
  onLongPress,
}: {
  testID?: string;
  name: string;
  caption: string;
  /** Changes when the caption means something new, so it cross-fades rather than swaps. */
  captionKey?: string;
  preview: ReactNode;
  layout: ThemeGridLayout;
  current?: boolean;
  /** A short word over the picture's corner: "Installed", "Update". */
  badge?: string | null;
  /**
   * The install under way on this card: a fraction for a counted step, `null`
   * for a wait that cannot be counted (the bar travels), `undefined` for none.
   */
  progress?: number | null;
  dimmed?: boolean;
  disabled?: boolean;
  rise?: CardRise;
  accessibilityLabel: string;
  accessibilityValue?: { text: string };
  /** The long-press menu's entries, repeated as accessibility actions. */
  actions?: readonly ThemeCardAction[];
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const radius = profile.chrome.card;
  const entering = useCardRise(rise);

  // The cards that are not being installed settle back rather than flashing.
  const dim = useSharedValue(dimmed ? 0.5 : 1);
  useEffect(() => {
    dim.set(withTiming(dimmed ? 0.5 : 1, timing('short')));
  }, [dim, dimmed]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.get() }));

  const direct = actions?.filter((action) => !action.confirm) ?? [];
  const guarded = Boolean(onLongPress) && direct.length !== (actions?.length ?? 0);
  const accessibilityActions =
    direct.length || guarded
      ? [
          ...direct.map((action) => ({ name: action.name, label: action.label })),
          ...(guarded ? [{ name: 'menu', label: t`More actions` }] : []),
        ]
      : undefined;
  function handleAccessibilityAction(event: AccessibilityActionEvent) {
    const name = event.nativeEvent.actionName;
    if (name === 'menu') onLongPress?.();
    else direct.find((action) => action.name === name)?.run();
  }

  return (
    // Two views, as the rows this replaced had: a layout animation and an
    // animated `opacity` on one view make Reanimated warn that one may
    // overwrite the other. The outer one arrives, the inner one dims.
    <Animated.View entering={entering} style={{ height: layout.cardHeight }}>
      <Animated.View style={[styles.fill, dimStyle]}>
        <PressableScale
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityValue={accessibilityValue}
          accessibilityState={{ selected: current, disabled }}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={accessibilityActions ? handleAccessibilityAction : undefined}
          disabled={disabled}
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={350}
          style={[
            styles.card,
            {
              borderRadius: radius,
              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            },
          ]}>
          <View style={[styles.preview, { height: layout.previewHeight }]}>
            {preview}
            {badge ? <CardBadge label={badge} /> : null}
            {current ? (
              <Animated.View
                entering={fadeIn('short')}
                exiting={fadeOut('micro')}
                style={[styles.check, { backgroundColor: theme.colors.primary }]}>
                <DoneIcon size={13} color={theme.colors.onPrimary} />
              </Animated.View>
            ) : null}
            {progress !== undefined ? <CardProgress fraction={progress} /> : null}
          </View>
          <View style={styles.copy}>
            <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
              {name}
            </Text>
            <Animated.View
              key={captionKey ?? 'caption'}
              entering={captionKey ? fadeIn('short') : undefined}>
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {caption}
              </Text>
            </Animated.View>
          </View>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * The last card in Mine: where a theme the reader already has comes in.
 *
 * Dashed and unfilled -- it is a place for a card rather than a card -- so it
 * never reads as one more theme.
 */
export function ThemeImportCard({
  layout,
  expanded,
  disabled,
  rise,
  onPress,
}: {
  layout: ThemeGridLayout;
  expanded: boolean;
  disabled?: boolean;
  rise?: CardRise;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const entering = useCardRise(rise);
  const surfaceBackground = useSurfaceBackground();
  return (
    <Animated.View entering={entering} style={{ height: layout.cardHeight }}>
      <PressableScale
        testID="theme-import"
        accessibilityRole="button"
        accessibilityLabel={t`Import theme`}
        accessibilityState={{ expanded, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.card,
          styles.importCard,
          {
            borderRadius: profile.chrome.card,
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            borderColor: 'transparent',
          },
        ]}>
        <AddItemIcon size={22} color={theme.colors.textMuted} />
        <Text variant="bodySmall" weight="semibold" color={theme.colors.textMuted}>
          {t`Import theme`}
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

/** A card the catalogue has not filled in yet. */
export function ThemeCardSkeleton({
  layout,
  accessibilityLabel,
}: {
  layout: ThemeGridLayout;
  /** Said by the first placeholder only, so a screen reader hears the wait once. */
  accessibilityLabel?: string;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'progressbar' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.card,
        {
          height: layout.cardHeight,
          borderRadius: profile.chrome.card,
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
        },
      ]}>
      <Skeleton height={layout.previewHeight} style={styles.skeletonPreview} />
      <View style={styles.copy}>
        <Skeleton variant="text" width="70%" height={14} />
        <Skeleton variant="text" width="45%" height={11} />
      </View>
    </View>
  );
}

/**
 * A theme's picture: its published preview when it has one, both halves of its
 * palette when it does not.
 *
 * The palette pair is the light canvas beside the dark one, each with three
 * dots -- accent, link, warning -- which is enough to tell two themes apart at
 * a glance and comes from `themeSwatch`, so it cannot drift from the theme.
 * An image paints over the pair, so its own fade-in is a cross-fade onto the
 * right colours rather than a flash of the sheet. Only sources the app already
 * keeps for thumbnails are passed in; no full artwork is decoded for a card.
 */
export function ThemeCardPreview({
  image,
  pack,
  cachePolicy = 'memory',
  recyclingKey,
  imageTestID,
  onImageError,
}: {
  image?: string | null;
  pack?: Pick<ThemeAppearance, 'light' | 'dark'>;
  cachePolicy?: 'memory' | 'memory-disk';
  recyclingKey?: string;
  imageTestID?: string;
  onImageError?: () => void;
}) {
  const theme = useThemeTokens();
  return (
    <View accessible={false} style={StyleSheet.absoluteFill}>
      {pack ? (
        <View style={styles.halves}>
          <PaletteHalf colors={themeSwatch(pack, 'light')} />
          <PaletteHalf colors={themeSwatch(pack, 'dark')} />
        </View>
      ) : (
        // Opacity audit: decorative -- the placeholder matte under a cover that has not painted.
        <View style={[styles.placeholder, { backgroundColor: theme.colors.surfaceRaised }]}>
          <View style={[styles.placeholderSwatch, { backgroundColor: theme.colors.background }]} />
          <View style={[styles.placeholderSwatch, { backgroundColor: theme.colors.primary }]} />
        </View>
      )}
      {image ? (
        <Image
          accessible={false}
          testID={imageTestID}
          source={{ uri: image }}
          cachePolicy={cachePolicy}
          recyclingKey={recyclingKey}
          contentFit="cover"
          transition={DURATION.medium}
          onError={onImageError}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

/** Half a palette: its canvas and three dots. Artwork, so it keeps its own colours. */
function PaletteHalf({ colors }: { colors: readonly string[] }) {
  const [canvas, ...dots] = colors;
  return (
    // Opacity audit: decorative -- a theme's own canvas drawn as its preview.
    <View style={[styles.half, { backgroundColor: canvas }]}>
      {dots.map((color, index) => (
        <View
          // The three roles are fixed and ordered, so the position is the identity.
          // oxlint-disable-next-line react/no-array-index-key -- fixed, ordered swatch roles
          key={index}
          style={[styles.dot, { backgroundColor: color }]}
        />
      ))}
    </View>
  );
}

/**
 * A word over the picture. It sits on artwork rather than on the sheet, so it
 * keeps the frost's legibility floor under the reader's opacity, the same rule
 * a notice floating over live content follows.
 */
function CardBadge({ label }: { label: string }) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const opacity = useSurfaceBackgroundOpacity();
  return (
    <Animated.View
      entering={fadeIn('medium')}
      exiting={fadeOut('micro')}
      style={[
        styles.badge,
        {
          borderRadius: profile.chrome.segmentedOption,
          backgroundColor: surfaceBackgroundFill(theme.colors.surface, sheetFrostAlpha(opacity)),
        },
      ]}>
      <Text variant="caption" weight="semibold" numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

/**
 * The install's progress along the picture's bottom edge.
 *
 * A counted step fills; a wait that cannot be counted -- the download -- runs a
 * short segment along the edge instead of a bar stuck at zero, and holds still
 * when the reader has asked for less motion.
 */
function CardProgress({ fraction }: { fraction: number | null }) {
  const theme = useThemeTokens();
  const reduceMotion = useReducedMotion();
  const fill = useSharedValue(fraction ?? 0);
  const travel = useSharedValue(0);
  const counted = fraction !== null;

  useEffect(() => {
    if (fraction !== null) fill.set(withTiming(fraction, timing('short')));
  }, [fill, fraction]);

  useEffect(() => {
    if (counted || reduceMotion) {
      cancelAnimation(travel);
      travel.set(0);
      return;
    }
    travel.set(withRepeat(withTiming(1, travelTiming()), -1, false));
    return () => cancelAnimation(travel);
  }, [counted, reduceMotion, travel]);

  const barStyle = useAnimatedStyle(() =>
    counted
      ? { left: 0, width: `${Math.min(Math.max(fill.get(), 0), 1) * 100}%` }
      : { left: `${travel.get() * 70}%`, width: '30%' }
  );

  return (
    <Animated.View
      pointerEvents="none"
      entering={fadeIn('short')}
      exiting={fadeOut('micro')}
      // Opacity audit: decorative -- the track is a tint over artwork, not a surface.
      style={[styles.progressTrack, { backgroundColor: withAlpha(theme.colors.surface, 0.6) }]}>
      <Animated.View
        style={[styles.progressBar, { backgroundColor: theme.colors.primary }, barStyle]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  card: { flex: 1, overflow: 'hidden', borderCurve: 'continuous' },
  preview: { width: '100%', overflow: 'hidden' },
  copy: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10, gap: 2 },
  check: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: '70%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderCurve: 'continuous',
  },
  halves: { flex: 1, flexDirection: 'row' },
  placeholder: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  half: {
    flex: 1,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  placeholderSwatch: { width: 34, height: 22, borderRadius: 6, borderCurve: 'continuous' },
  importCard: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  skeletonPreview: { borderRadius: 0 },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    overflow: 'hidden',
  },
  progressBar: { position: 'absolute', top: 0, bottom: 0 },
});
