import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  ScrollView,
  StyleSheet,
  Platform,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  withTiming,
  Extrapolation,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/text';
import { homeScrollFadeOpacity } from '@/lib/home-scroll-fade';
import { useLaunchHandoff } from '@/stores/launch-handoff';
import { useHomeScenePlate } from '@/hooks/use-home-scene-plate';
import { useInterfaceFontFamily } from '@/hooks/use-user-fonts';
import { USER_FONT_MAX_NATIVE_WEIGHT } from '@/theme/interface-font-registry';

import {
  EDITORIAL_MAX_WIDTH,
  EDITORIAL_PAD_MAX_WIDTH,
  getEditorialLayoutGeometry,
} from '@/lib/home-editorial-layout';
import { entryRise } from '@/lib/motion';
import {
  PAD_COLUMN_GAP,
  padCoverKind,
  padHomeColumns,
  padLaunchLayoutEnabled,
} from '@/lib/home-pad-geometry';
export {
  EDITORIAL_MAX_WIDTH,
  EDITORIAL_PAD_MAX_WIDTH,
  EDITORIAL_TWO_COLUMN_MIN_WIDTH,
  getEditorialLayoutGeometry,
  type EditorialLayoutGeometry,
  type EditorialLayoutMode,
} from '@/lib/home-editorial-layout';

export type HomeEditorialLayoutProps = {
  /** Remaining content width after the parent has accounted for its rail. */
  contentWidth: number;
  /** Available height for the Pad theme and launch pane. */
  viewportHeight?: number;
  /** Optional override for deterministic layout previews and tests. */
  fontScale?: number;
  /** A tablet Home with navigation owned by the persistent left rail. */
  pad?: boolean;
  /** The existing identity block supplied by Home data/theme composition. */
  identity?: ReactNode;
  /** Cover artwork follows the utility row and precedes work actions. */
  artwork?: ReactNode;
  /** Rendered offset to visible foreground; preserves transparent source pixels. */
  artworkTopInset?: number;
  /** Scroll position drives reversible cover fades and pull-down stretch. */
  scrollY?: SharedValue<number>;
  cover?: boolean;
  coverTitle?: string;
  /** Native actions kept in the compact masthead utility row. */
  headerAction?: ReactNode;
  /** Current Gateway control aligned opposite the masthead actions. */
  headerLeading?: ReactNode;
  /** Start-new-work actions, already wired by the parent. */
  launches?: ReactNode;
  /**
   * Home's dock on the two-column Pad page, across the foot of both columns:
   * the lists stop `padComposerHeight` above it. Every other layout draws the
   * dock over the page itself.
   */
  padComposer?: ReactNode;
  /** The dock's measured height, which the columns' foot clears. */
  padComposerHeight?: number;
  /** Scroll events of the Pad work column, where the computer cards scroll. */
  workScrollEvents?: {
    onScrollBeginDrag?: () => void;
    onScrollEndDrag?: () => void;
    onMomentumScrollBegin?: () => void;
    onMomentumScrollEnd?: () => void;
  };
  /**
   * Home's first mount: the sections rise in on the entry stagger. False on
   * every later mount, so a return from a sub-screen does not replay it.
   */
  entering?: boolean;
  /** Recent sessions or panes, already wired by the parent. */
  recent?: ReactNode;
  /** Replaces the Continue heading with a search control when inventory is large. */
  recentHeading?: ReactNode;
  /** Genuine pending approvals or requests, already wired by the parent. */
  attention?: ReactNode;
  /**
   * The computer cards, already wired by the parent; the layout gives them
   * their "Computers" heading, between needs-you and Recent.
   */
  progress?: ReactNode;
  /** Reachable gateways and saved SSH hosts, already wired by the parent. */
  connections?: ReactNode;
  /** Secondary scan or pair controls, already wired by the parent. */
  controls?: ReactNode;
  /**
   * No theme pack: the Pad band sets `coverTitle` as the app's wordmark.
   * Ignored wherever a pack's artwork is showing.
   */
  typographicCover?: boolean;
  /** The brand mark, at the Pad band's leading edge before the wordmark. */
  coverMark?: ReactNode;
  /** A quiet texture painted behind the Pad page when it wears the wordmark. */
  coverBackdrop?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * Home's sections in the order they arrive on first mount: launches, needs
 * you, Computers, Recent, Connections. Absent ones keep their beat.
 */
const HOME_SECTION_COUNT = 5;

/** The Pad band's wordmark: the toolbar's height, not the cover's. */
const PAD_BAND_TITLE_SIZE = 40;

type EditorialSectionProps = {
  title: ReactNode;
  entering?: ReturnType<typeof entryRise>;
  heading?: ReactNode;
  children: ReactNode;
  borderColor: string;
  textColor: string;
  spacing: {
    md: number;
    lg: number;
  };
  first?: boolean;
};

function EditorialSection({
  title,
  heading,
  children,
  borderColor,
  textColor,
  spacing,
  first = false,
  entering,
}: EditorialSectionProps) {
  const plate = useHomeScenePlate();
  return (
    <Animated.View
      entering={entering}
      style={[styles.section, { marginTop: first ? 0 : spacing.lg, marginBottom: 0 }]}>
      <View style={[styles.sectionHeader, { borderBottomColor: borderColor }]}>
        {heading ?? (
          <Text variant="heading" color={textColor} accessibilityRole="header" style={plate}>
            {title}
          </Text>
        )}
      </View>
      <View style={[styles.sectionContent, { marginTop: 8 }]}>{children}</View>
    </Animated.View>
  );
}

/**
 * Japanese-editorial Home composition. The parent owns scrolling, refreshing,
 * safe areas, navigation, and every slot's data/action wiring.
 *
 * @example
 * ```tsx
 * <HomeEditorialLayout
 *   contentWidth={measuredRemainingWidth}
 *   identity={<HomeIdentity />}
 *   launches={<HomeLaunches />}
 *   recent={<HomeRecent />}
 *   attention={<HomeAttention />}
 *   progress={<HomeComputerCards />}
 *   connections={<HomeConnections />}
 *   controls={<HomeControls />}
 * />
 * ```
 */
function useScrollStage(
  scrollY: SharedValue<number> | undefined,
  origin: SharedValue<number>,
  entryProgress: SharedValue<number>,
  timelineEnd: SharedValue<number>,
  enabled: boolean,
  fadeDistance: number
) {
  const bounds = useSharedValue({ y: 0, height: 0 });
  const onLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    bounds.set({ y, height });
    timelineEnd.set(Math.max(timelineEnd.get(), origin.get() + y + height));
  };
  const style = useAnimatedStyle(() => {
    if (!enabled || !scrollY || bounds.value.height <= 0) return { opacity: 1 };
    return {
      opacity: homeScrollFadeOpacity(
        Math.max(scrollY.value, (1 - entryProgress.value) * timelineEnd.value),
        origin.value + bounds.value.y + bounds.value.height,
        Math.min(fadeDistance, bounds.value.height)
      ),
    };
  });
  return { onLayout, style };
}

export function HomeEditorialLayout({
  contentWidth,
  viewportHeight,
  fontScale: fontScaleProp,
  pad = false,
  identity,
  artwork,
  scrollY,
  artworkTopInset = 0,
  cover = false,
  coverTitle,
  headerAction,
  headerLeading,
  launches,
  padComposer,
  padComposerHeight = 0,
  workScrollEvents,
  entering = false,
  recent,
  recentHeading,
  attention,
  progress,
  connections,
  controls,
  typographicCover = false,
  coverMark,
  coverBackdrop,
  style,
}: HomeEditorialLayoutProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const interfaceFontFamily = useInterfaceFontFamily();
  const chromeFontFamily =
    interfaceFontFamily ?? (Platform.OS === 'android' ? 'sans-serif-condensed' : undefined);
  const titleWeight = interfaceFontFamily ? USER_FONT_MAX_NATIVE_WEIGHT : 900;
  const titleKey = `${coverTitle ?? ''}:${chromeFontFamily ?? 'system'}:${titleWeight}`;
  const { fontScale: windowFontScale } = useWindowDimensions();
  const fontScale = fontScaleProp ?? windowFontScale;
  // Needs-you leads the main column on every layout, so only Computers is aside.
  const hasAside = hasSlot(connections);
  const hasProgress = hasSlot(progress);
  // The Pad work column's headings take the same plate as the phone's sections.
  const scenePlate = useHomeScenePlate();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [titleMeasurement, setTitleMeasurement] = useState<{ title: string; width: number } | null>(
    null
  );
  const maxWidth = pad ? EDITORIAL_PAD_MAX_WIDTH : EDITORIAL_MAX_WIDTH;
  const geometry = getEditorialLayoutGeometry(
    measuredWidth || Math.min(contentWidth, maxWidth),
    fontScale,
    hasAside,
    pad
  );
  const padLaunchLayout =
    pad && padLaunchLayoutEnabled(geometry.contentWidth, fontScale, viewportHeight);
  const scrollPosition = scrollY;
  const hasIdentity = hasSlot(identity);
  const hasArtwork = hasSlot(artwork);
  const hasHeaderAction = hasSlot(headerAction);
  const hasHeaderLeading = hasSlot(headerLeading);
  const hasHeaderRow = hasHeaderLeading || hasHeaderAction;
  const reducedMotion = useReducedMotion();
  const sceneOrigin = useSharedValue(0);
  const animateCover = cover && hasArtwork && !reducedMotion;
  // The phone cover's reading column already arrives with the launch reveal;
  // everywhere else the sections rise in on the entry stagger, once.
  const sectionEntering = entering && (padLaunchLayout || !animateCover);
  const rise = (slot: number) =>
    sectionEntering ? entryRise(slot, HOME_SECTION_COUNT) : undefined;
  const revealing = useLaunchHandoff((state) => state.revealing);
  // Under the launch snap, Home's entrance rides the snap's own progress, so
  // it starts on the frame the first tile leaves and is complete with the
  // last; under the cross-fade it keeps its own clock.
  const revealDriver = useLaunchHandoff((state) => state.driver);
  const markRevealReady = useLaunchHandoff((state) => state.markReady);
  const entryProgress = useSharedValue(revealing || reducedMotion ? 1 : 0);
  const timelineEnd = useSharedValue(0);
  useEffect(() => {
    if (revealing && revealDriver) {
      // Laid out and waiting: the snap may start.
      markRevealReady();
      return;
    }
    if (revealing || reducedMotion) {
      entryProgress.set(withTiming(1, { duration: reducedMotion ? 0 : 520 }));
    }
    return () => cancelAnimation(entryProgress);
  }, [revealing, revealDriver, reducedMotion, entryProgress, markRevealReady]);
  useAnimatedReaction(
    () => (revealDriver ? revealDriver.get() : -1),
    (progress) => {
      if (progress < 0) return;
      // Ease-out: three quarters in by the middle of the sweep, so what shows
      // through the gaps is Home arriving rather than a page already there.
      const t = Math.min(1, Math.max(0, progress));
      entryProgress.set(1 - (1 - t) * (1 - t));
    }
  );
  const titleStage = useScrollStage(
    scrollPosition,
    sceneOrigin,
    entryProgress,
    timelineEnd,
    animateCover,
    120
  );
  const artworkStage = useScrollStage(
    scrollPosition,
    sceneOrigin,
    entryProgress,
    timelineEnd,
    animateCover,
    160
  );
  const controlsStage = useScrollStage(
    scrollPosition,
    sceneOrigin,
    entryProgress,
    timelineEnd,
    animateCover,
    96
  );
  const launchesStage = useScrollStage(
    scrollPosition,
    sceneOrigin,
    entryProgress,
    timelineEnd,
    animateCover,
    120
  );
  const readingEntryStyle = useAnimatedStyle(() => {
    if (!animateCover) return { opacity: 1, transform: [{ translateY: 0 }] };
    const opacity = homeScrollFadeOpacity((1 - entryProgress.value) * 120, 120, 120);
    return { opacity, transform: [{ translateY: (1 - opacity) * 8 }] };
  });
  const mastheadText = (
    <View style={styles.mastheadText}>
      {hasIdentity ? <View style={styles.identity}>{identity}</View> : null}
    </View>
  );

  const animatedArtworkStyle = useAnimatedStyle(() => {
    if (!scrollPosition || reducedMotion) return {};
    const y = scrollPosition.value;
    // Pull-down stretch is independent from the measured scroll-fade stages.
    // Keep layout geometry stable while the cover scrolls away.
    const translateY = interpolate(y, [-120, 0], [18, 0], Extrapolation.CLAMP);
    const scale = interpolate(y, [-120, 0], [1.04, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  if (padLaunchLayout) {
    // Two columns under a compact band (design §8 Pad): the work -- tiles,
    // needs-you, Computers -- on the left, Recent on the right, each scrolling
    // on its own, and the dock across the foot. A pack's painting is the
    // page's backdrop behind the band and the work column, at the slot's own
    // opacity; the page itself does not scroll.
    const columns = padHomeColumns(geometry.innerWidth);
    const coverKind = padCoverKind({
      cover,
      hasArtwork,
      typographic: typographicCover,
      hasTitle: Boolean(coverTitle),
    });
    const bandTitle = coverKind === 'identity' ? undefined : coverTitle;
    const hasRecent = hasSlot(recent);
    const hasConnections = hasSlot(connections);
    return (
      <View
        testID="home-editorial-layout"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={[
          styles.root,
          styles.padRoot,
          { maxWidth, height: viewportHeight, paddingHorizontal: geometry.gutter },
          style,
        ]}>
        {coverKind === 'wordmark' && hasSlot(coverBackdrop) ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {coverBackdrop}
          </View>
        ) : null}
        {hasArtwork ? (
          <View
            testID="home-pad-backdrop"
            pointerEvents="none"
            style={[styles.padBackdrop, { width: geometry.gutter + columns.work }]}>
            {artwork}
          </View>
        ) : null}
        <View testID="home-pad-toolbar" style={styles.padToolbar}>
          <View style={styles.mastheadLeadGroup}>
            {coverKind === 'wordmark' && hasSlot(coverMark) ? (
              <View testID="home-pad-cover-mark">{coverMark}</View>
            ) : null}
            {bandTitle ? (
              <Text
                testID="home-pad-wordmark"
                accessibilityRole="header"
                color={theme.colors.text}
                numberOfLines={1}
                allowFontScaling={false}
                style={[
                  styles.padBandTitle,
                  { fontFamily: chromeFontFamily, fontWeight: titleWeight },
                ]}>
                {bandTitle}
              </Text>
            ) : hasIdentity ? (
              <View style={styles.compactIdentity}>{identity}</View>
            ) : null}
            {hasHeaderLeading ? <View style={styles.headerLeading}>{headerLeading}</View> : null}
          </View>
          {hasHeaderAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
        </View>
        <View style={styles.padColumns}>
          <View testID="home-pad-work-column" style={{ width: columns.work }}>
            <ScrollView
              testID="home-pad-launch-pane"
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.padScroll}
              contentContainerStyle={styles.padWorkContent}
              {...workScrollEvents}>
              {hasSlot(launches) ? (
                <Animated.View testID="home-pad-launch-dock" entering={rise(0)}>
                  {launches}
                </Animated.View>
              ) : null}
              {hasSlot(attention) ? (
                <Animated.View entering={rise(1)}>{attention}</Animated.View>
              ) : null}
              {hasProgress || hasConnections ? (
                <View testID="home-pad-lower-band" style={styles.padWorkSections}>
                  {hasProgress ? (
                    <Animated.View testID="home-pad-in-progress" entering={rise(2)}>
                      <Text
                        variant="heading"
                        accessibilityRole="header"
                        color={theme.colors.text}
                        style={[styles.padWorkTitle, scenePlate]}>
                        {t`Computers`}
                      </Text>
                      {progress}
                    </Animated.View>
                  ) : null}
                  {hasConnections ? (
                    <Animated.View testID="home-pad-connections" entering={rise(4)}>
                      <Text
                        variant="heading"
                        accessibilityRole="header"
                        color={theme.colors.text}
                        style={[styles.padWorkTitle, scenePlate]}>
                        {t`Connections`}
                      </Text>
                      {connections}
                    </Animated.View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          </View>
          <View testID="home-pad-recent-column" style={styles.padRecentColumn}>
            {/* Keyboard-aware on its own: the page's view only lifts fields
                whose nearest scroll view it is, and Recent's search is here. */}
            {hasRecent ? (
              <KeyboardAwareScrollView
                testID="home-pad-recent-pane"
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bottomOffset={hasSlot(padComposer) ? padComposerHeight : undefined}
                style={styles.padScroll}
                contentContainerStyle={styles.padWorkContent}>
                <Animated.View testID="home-pad-continue" entering={rise(3)}>
                  {recentHeading ? (
                    <View style={styles.padWorkTitle}>{recentHeading}</View>
                  ) : (
                    <Text
                      variant="heading"
                      accessibilityRole="header"
                      color={theme.colors.text}
                      style={[styles.padWorkTitle, scenePlate]}>
                      {t`Recent`}
                    </Text>
                  )}
                  {recent}
                </Animated.View>
              </KeyboardAwareScrollView>
            ) : null}
          </View>
        </View>
        {/* In flow under both columns, sized to the measured dock: the lists
            end where the dock begins, so no row can sit under it. */}
        {hasSlot(padComposer) ? (
          <View testID="home-pad-composer" style={{ height: padComposerHeight }}>
            {padComposer}
          </View>
        ) : null}
      </View>
    );
  }

  if (cover && hasSlot(artwork)) {
    const split = geometry.contentWidth >= 752 && fontScale < 1.35;
    const coverWidth = split ? (geometry.innerWidth - 24) * 0.45 : geometry.innerWidth;
    const titleFontSize =
      titleMeasurement && titleMeasurement.title === titleKey && titleMeasurement.width > 0
        ? Math.min(coverWidth * 0.48, ((coverWidth - 4) * 100) / titleMeasurement.width)
        : coverWidth * 0.3;
    const titleHeight = titleFontSize * 1.08;
    return (
      <View
        key="cover"
        testID="home-editorial-layout"
        onLayout={(event) => {
          setMeasuredWidth(event.nativeEvent.layout.width);
          sceneOrigin.set(event.nativeEvent.layout.y + 12);
        }}
        style={[styles.root, { maxWidth, paddingHorizontal: geometry.gutter }, style]}>
        <View style={split ? styles.coverColumns : undefined}>
          <View style={split ? { width: coverWidth, minWidth: 0 } : undefined}>
            <View style={styles.coverScene}>
              {coverTitle ? (
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ position: 'absolute', width: 10000, opacity: 0 }}>
                  <Text
                    allowFontScaling={false}
                    onTextLayout={(event) => {
                      const measured = event.nativeEvent.lines[0]?.width ?? 0;
                      if (measured > 0)
                        setTitleMeasurement((current) =>
                          current?.title === titleKey && Math.abs(current.width - measured) < 0.1
                            ? current
                            : { title: titleKey, width: measured }
                        );
                    }}
                    style={{
                      fontSize: 100,
                      fontFamily: chromeFontFamily,
                      fontWeight: titleWeight,
                      letterSpacing: -5,
                    }}>
                    {coverTitle}
                  </Text>
                </View>
              ) : null}
              {coverTitle ? (
                <Animated.View onLayout={titleStage.onLayout} style={titleStage.style}>
                  <Text
                    accessibilityRole="header"
                    color={theme.colors.text}
                    adjustsFontSizeToFit
                    numberOfLines={1}
                    allowFontScaling={false}
                    style={{
                      fontSize: titleFontSize,
                      lineHeight: titleHeight,
                      fontFamily: chromeFontFamily,
                      fontWeight: titleWeight,
                      letterSpacing: -titleFontSize * 0.05,
                    }}>
                    {coverTitle}
                  </Text>
                </Animated.View>
              ) : null}
              <Animated.View
                onLayout={artworkStage.onLayout}
                pointerEvents="none"
                style={[
                  {
                    marginTop: coverTitle ? -titleHeight * 0.35 - artworkTopInset : 0,
                    marginHorizontal: split ? 0 : -geometry.gutter,
                    zIndex: 1,
                  },
                  animatedArtworkStyle,
                  artworkStage.style,
                ]}>
                {artwork}
              </Animated.View>
              <Animated.View
                onLayout={controlsStage.onLayout}
                style={[
                  styles.coverUtilities,
                  { top: coverTitle ? titleHeight + 28 : 16 },
                  controlsStage.style,
                ]}>
                {headerAction ? <View style={styles.coverButtons}>{headerAction}</View> : null}
                {headerLeading ? <View style={styles.coverTarget}>{headerLeading}</View> : null}
              </Animated.View>
            </View>
            {hasSlot(launches) ? (
              <Animated.View
                onLayout={launchesStage.onLayout}
                style={[styles.coverLaunches, launchesStage.style]}>
                {launches}
              </Animated.View>
            ) : null}
          </View>
          <Animated.View style={[split ? styles.coverReadingColumn : undefined, readingEntryStyle]}>
            {hasSlot(attention) ? (
              <Animated.View entering={rise(1)}>{attention}</Animated.View>
            ) : null}
            {hasProgress ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Computers`}
                entering={rise(2)}
                first={split}>
                {progress}
              </EditorialSection>
            ) : null}
            {hasSlot(recent) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Recent`}
                entering={rise(3)}
                heading={recentHeading}
                first={split && !hasProgress}>
                {recent}
              </EditorialSection>
            ) : null}
            {hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Connections`}
                entering={rise(4)}>
                {connections}
              </EditorialSection>
            ) : null}
            {controls}
          </Animated.View>
        </View>
      </View>
    );
  }

  if (!hasArtwork) {
    return (
      <View
        key="without-artwork"
        testID="home-editorial-layout"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={[
          styles.root,
          styles.noArtworkRoot,
          { maxWidth, paddingHorizontal: geometry.gutter },
          style,
        ]}>
        {hasHeaderRow ? (
          <View style={styles.noArtworkToolbar}>
            <View style={[styles.mastheadLeadGroup, styles.noArtworkLeadGroup]}>
              {hasHeaderLeading ? (
                <View
                  style={[
                    styles.headerLeading,
                    styles.noArtworkHeaderLeading,
                    geometry.mode === 'two-column' && {
                      flexShrink: 0,
                      minWidth: Math.min(220, geometry.mainWidth * 0.34),
                      maxWidth: '50%',
                    },
                  ]}>
                  {headerLeading}
                </View>
              ) : null}
            </View>
            {hasHeaderAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
        ) : null}

        {hasIdentity ? <View style={styles.noArtworkIdentity}>{identity}</View> : null}

        {hasSlot(launches) ? (
          <Animated.View entering={rise(0)} style={styles.launches}>
            {launches}
          </Animated.View>
        ) : null}

        <View
          style={[
            styles.content,
            hasSlot(launches) && { marginTop: theme.spacing.lg },
            geometry.mode === 'two-column' && {
              flexDirection: 'row',
              columnGap: geometry.gap,
            },
          ]}>
          <View
            style={[
              styles.main,
              geometry.mode === 'two-column' ? { width: geometry.mainWidth } : styles.fullWidth,
            ]}>
            {hasSlot(attention) ? (
              <Animated.View entering={rise(1)}>{attention}</Animated.View>
            ) : null}
            {hasProgress ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Computers`}
                entering={rise(2)}
                first>
                {progress}
              </EditorialSection>
            ) : null}
            {hasSlot(recent) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Recent`}
                entering={rise(3)}
                heading={recentHeading}
                first={!hasProgress}>
                {recent}
              </EditorialSection>
            ) : null}
            {geometry.mode === 'one-column' && hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Connections`}
                entering={rise(4)}>
                {connections}
              </EditorialSection>
            ) : null}
          </View>

          {geometry.mode === 'two-column' ? (
            <View style={[styles.aside, { width: geometry.asideWidth }]}>
              {hasSlot(connections) ? (
                <EditorialSection
                  borderColor={theme.colors.border}
                  textColor={theme.colors.text}
                  spacing={theme.spacing}
                  title={t`Connections`}
                  entering={rise(4)}
                  first>
                  {connections}
                </EditorialSection>
              ) : null}
            </View>
          ) : null}
        </View>

        {hasSlot(controls) ? (
          <View style={[styles.controls, { borderTopColor: theme.colors.border }]}>
            <Text variant="label" color={theme.colors.textMuted}>
              {t`Controls`}
            </Text>
            <View style={styles.controlsSlot}>{controls}</View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View
      key="with-artwork"
      testID="home-editorial-layout"
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[styles.root, { maxWidth, paddingHorizontal: geometry.gutter }, style]}>
      <View style={styles.masthead}>
        {hasHeaderRow ? (
          <View style={styles.mastheadActionRow}>
            <View style={styles.mastheadLeadGroup}>
              {hasHeaderLeading ? <View style={styles.headerLeading}>{headerLeading}</View> : null}
              {!hasArtwork && hasIdentity ? (
                <View style={styles.compactIdentity}>{identity}</View>
              ) : null}
            </View>
            {hasHeaderAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
        ) : null}
        {hasIdentity && (hasArtwork || !hasHeaderRow) ? (
          <View style={styles.mastheadBody}>
            <View style={styles.mastheadCopy}>{mastheadText}</View>
          </View>
        ) : null}
      </View>

      {hasArtwork ? (
        <Animated.View
          style={[{ marginHorizontal: -geometry.gutter, marginBottom: 12 }, animatedArtworkStyle]}>
          {artwork}
        </Animated.View>
      ) : null}

      {!hasArtwork && hasSlot(launches) ? (
        <Animated.View entering={rise(0)} style={styles.launches}>
          {launches}
        </Animated.View>
      ) : null}

      <View
        style={[
          styles.content,
          !hasArtwork && hasSlot(launches) && { marginTop: theme.spacing.lg },
          geometry.mode === 'two-column' && {
            flexDirection: 'row',
            columnGap: geometry.gap,
          },
        ]}>
        <View
          style={[
            styles.main,
            geometry.mode === 'two-column' ? { width: geometry.mainWidth } : styles.fullWidth,
          ]}>
          {hasArtwork && hasSlot(launches) ? (
            <Animated.View entering={rise(0)} style={styles.launches}>
              {launches}
            </Animated.View>
          ) : null}
          {hasSlot(attention) ? (
            <Animated.View entering={rise(1)}>{attention}</Animated.View>
          ) : null}
          {hasProgress ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
              title={t`Computers`}
              entering={rise(2)}
              first={!hasArtwork}>
              {progress}
            </EditorialSection>
          ) : null}
          {hasSlot(recent) ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
              first={!hasArtwork && !hasProgress}
              title={t`Recent`}
              entering={rise(3)}
              heading={recentHeading}>
              {recent}
            </EditorialSection>
          ) : null}
          {geometry.mode === 'one-column' && hasSlot(connections) ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
              title={t`Connections`}
              entering={rise(4)}>
              {connections}
            </EditorialSection>
          ) : null}
        </View>

        {geometry.mode === 'two-column' ? (
          <View style={[styles.aside, { width: geometry.asideWidth }]}>
            {hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                first
                title={t`Connections`}
                entering={rise(4)}>
                {connections}
              </EditorialSection>
            ) : null}
          </View>
        ) : null}
      </View>

      {hasSlot(controls) ? (
        <View style={[styles.controls, { borderTopColor: theme.colors.border }]}>
          <Text variant="label" color={theme.colors.textMuted}>
            {t`Controls`}
          </Text>
          <View style={styles.controlsSlot}>{controls}</View>
        </View>
      ) : null}
    </View>
  );
}

function hasSlot(value: ReactNode): boolean {
  return value !== null && value !== undefined && value !== false && value !== '';
}

const styles = StyleSheet.create({
  padRoot: { paddingBottom: 0 },
  // The band: wordmark and toolbar over the backdrop's top.
  padToolbar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    marginBottom: 8,
  },
  // The cover title at band size, with the cover's own leading and tracking.
  padBandTitle: {
    fontSize: PAD_BAND_TITLE_SIZE,
    lineHeight: PAD_BAND_TITLE_SIZE * 1.1,
    letterSpacing: -PAD_BAND_TITLE_SIZE * 0.05,
    flexShrink: 1,
  },
  padBackdrop: { position: 'absolute', left: 0, top: 0 },
  padColumns: { flex: 1, minHeight: 0, flexDirection: 'row', gap: PAD_COLUMN_GAP },
  padRecentColumn: { flex: 1, minWidth: 0 },
  padScroll: { flex: 1 },
  padWorkContent: { paddingTop: 16, paddingBottom: 24, gap: 24 },
  padWorkSections: { gap: 32 },
  // The phone editorial section's heading, without its rule: title, 12, card.
  padWorkTitle: { marginBottom: 12 },

  coverColumns: { flexDirection: 'row', alignItems: 'flex-start', gap: 24 },
  coverReadingColumn: { flex: 1, minWidth: 0, paddingTop: 16 },
  coverScene: { position: 'relative', minWidth: 0 },
  coverUtilities: { position: 'absolute', left: 0, maxWidth: '48%', gap: 14, zIndex: 2 },
  coverButtons: { alignSelf: 'flex-start' },
  coverTarget: { alignSelf: 'flex-start', maxWidth: '100%' },
  coverLaunches: { marginTop: -64, zIndex: 1 },
  root: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: EDITORIAL_MAX_WIDTH,
    minWidth: 0,
    paddingTop: 12,
    paddingBottom: 32,
  },
  noArtworkRoot: {
    paddingTop: 0,
  },
  noArtworkToolbar: {
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
    marginBottom: 8,
  },
  noArtworkLeadGroup: {
    flex: 1,
  },
  noArtworkHeaderLeading: {
    maxWidth: '100%',
  },
  noArtworkIdentity: {
    minWidth: 0,
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  masthead: {
    minWidth: 0,
    marginBottom: 16,
  },
  mastheadActionRow: {
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 12,
    marginBottom: 12,
  },
  mastheadLeadGroup: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  compactIdentity: {
    minWidth: 0,
    flexShrink: 1,
  },
  mastheadBody: {
    minWidth: 0,
  },
  mastheadCopy: {
    minWidth: 0,
    flex: 1,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    flexShrink: 0,
    marginLeft: 'auto',
    maxWidth: '100%',
  },
  headerLeading: {
    minWidth: 0,
    flexShrink: 1,
    maxWidth: '100%',
  },
  identity: {
    minWidth: 0,
    marginBottom: 12,
  },
  content: {
    minWidth: 0,
    flexDirection: 'column',
  },
  launches: {
    minWidth: 0,
  },
  main: {
    minWidth: 0,
  },
  fullWidth: {
    width: '100%',
  },
  aside: {
    minWidth: 0,
  },
  section: {
    minWidth: 0,
  },
  sectionHeader: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  sectionContent: {
    minWidth: 0,
  },
  controls: {
    minWidth: 0,
    marginTop: 8,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  controlsSlot: {
    minWidth: 0,
    marginTop: 12,
  },
});
