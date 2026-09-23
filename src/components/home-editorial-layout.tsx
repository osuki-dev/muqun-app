import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useState, type ReactNode } from 'react';
import {
  StyleSheet,
  Platform,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';

import { Text } from '@/components/text';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useInterfaceFontFamily } from '@/hooks/use-user-fonts';
import { USER_FONT_MAX_NATIVE_WEIGHT } from '@/theme/interface-font-registry';
import { useHasThemeArtwork } from '@/components/theme-artwork';

import { getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
export {
  EDITORIAL_TWO_COLUMN_MIN_WIDTH,
  getEditorialLayoutGeometry,
  type EditorialLayoutGeometry,
  type EditorialLayoutMode,
} from '@/lib/home-editorial-layout';

export type HomeEditorialLayoutProps = {
  /** Remaining content width after the parent has accounted for its rail. */
  contentWidth: number;
  /** Optional override for deterministic layout previews and tests. */
  fontScale?: number;
  /** The existing identity block supplied by Home data/theme composition. */
  identity?: ReactNode;
  /** Cover artwork follows the utility row and precedes work actions. */
  artwork?: ReactNode;
  /** Rendered offset to visible foreground; preserves transparent source pixels. */
  artworkTopInset?: number;
  /** Scroll position used only for the artwork's pull-down stretch. */
  scrollY?: SharedValue<number>;
  cover?: boolean;
  coverTitle?: string;
  /** Native actions kept in the compact masthead utility row. */
  headerAction?: ReactNode;
  /** Current Gateway control aligned opposite the masthead actions. */
  headerLeading?: ReactNode;
  /** Start-new-work actions, already wired by the parent. */
  launches?: ReactNode;
  /** Recent sessions or panes, already wired by the parent. */
  recent?: ReactNode;
  /** Genuine pending approvals or requests, already wired by the parent. */
  attention?: ReactNode;
  /** Reachable gateways and saved SSH hosts, already wired by the parent. */
  connections?: ReactNode;
  /** Secondary scan or pair controls, already wired by the parent. */
  controls?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

type EditorialSectionProps = {
  title: ReactNode;
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
  children,
  borderColor,
  textColor,
  spacing,
  first = false,
}: EditorialSectionProps) {
  const background = useSurfaceBackground();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const hasScene = useHasThemeArtwork('home.wallpaper', 'shell.wallpaper');
  return (
    <View style={[styles.section, { marginTop: first ? 0 : spacing.lg, marginBottom: 0 }]}>
      <View style={[styles.sectionHeader, { borderBottomColor: borderColor }]}>
        <Text
          variant="heading"
          color={textColor}
          accessibilityRole="header"
          style={
            hasScene
              ? {
                  alignSelf: 'flex-start',
                  backgroundColor: background(theme.colors.surface),
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: profile.chrome.control,
                }
              : undefined
          }>
          {title}
        </Text>
      </View>
      <View style={[styles.sectionContent, { marginTop: 8 }]}>{children}</View>
    </View>
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
 *   connections={<HomeConnections />}
 *   controls={<HomeControls />}
 * />
 * ```
 */
export function HomeEditorialLayout({
  contentWidth,
  fontScale: fontScaleProp,
  identity,
  artwork,
  scrollY,
  artworkTopInset = 0,
  cover = false,
  coverTitle,
  headerAction,
  headerLeading,
  launches,
  recent,
  attention,
  connections,
  controls,
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
  const hasAside = hasSlot(attention) || hasSlot(connections);
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [titleMeasurement, setTitleMeasurement] = useState<{ title: string; width: number } | null>(
    null
  );
  const geometry = getEditorialLayoutGeometry(
    measuredWidth || Math.min(contentWidth, 1120),
    fontScale,
    hasAside
  );
  const hasIdentity = hasSlot(identity);
  const hasArtwork = hasSlot(artwork);
  const hasHeaderAction = hasSlot(headerAction);
  const hasHeaderLeading = hasSlot(headerLeading);
  const hasHeaderRow = hasHeaderLeading || hasHeaderAction;
  const reducedMotion = useReducedMotion();
  const mastheadText = (
    <View style={styles.mastheadText}>
      {hasIdentity ? <View style={styles.identity}>{identity}</View> : null}
    </View>
  );

  const animatedArtworkStyle = useAnimatedStyle(() => {
    if (!scrollY || reducedMotion) return {};
    const y = scrollY.value;
    // Its layout space remains visible well past 200pt, especially on tablets.
    // Let normal scrolling carry the opaque artwork out with that space instead
    // of fading/shrinking it into a blank hole. Stretch only during pull-down.
    const translateY = interpolate(y, [-120, 0], [18, 0], Extrapolation.CLAMP);
    const scale = interpolate(y, [-120, 0], [1.04, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY }, { scale }],
    };
  });

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
        testID="home-editorial-layout"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={[styles.root, { paddingHorizontal: geometry.gutter }, style]}>
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
              ) : null}
              <Animated.View
                pointerEvents="none"
                style={[
                  {
                    marginTop: coverTitle ? -titleHeight * 0.35 - artworkTopInset : 0,
                    marginHorizontal: split ? 0 : -geometry.gutter,
                    zIndex: 1,
                  },
                  animatedArtworkStyle,
                ]}>
                {artwork}
              </Animated.View>
              <View style={[styles.coverUtilities, { top: coverTitle ? titleHeight + 28 : 16 }]}>
                {headerAction ? <View style={styles.coverButtons}>{headerAction}</View> : null}
                {headerLeading ? <View style={styles.coverTarget}>{headerLeading}</View> : null}
              </View>
            </View>
            {hasSlot(launches) ? <View style={styles.coverLaunches}>{launches}</View> : null}
          </View>
          <View style={split ? styles.coverReadingColumn : undefined}>
            {hasSlot(recent) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Continue`}
                first={split}>
                {recent}
              </EditorialSection>
            ) : null}
            {attention}
            {hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Connections`}>
                {connections}
              </EditorialSection>
            ) : null}
            {controls}
          </View>
        </View>
      </View>
    );
  }

  if (!hasArtwork) {
    return (
      <View
        testID="home-editorial-layout"
        onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
        style={[styles.root, styles.noArtworkRoot, { paddingHorizontal: geometry.gutter }, style]}>
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

        {hasSlot(launches) ? <View style={styles.launches}>{launches}</View> : null}

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
            {geometry.mode === 'one-column' && hasSlot(attention) ? attention : null}
            {hasSlot(recent) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Continue`}
                first>
                {recent}
              </EditorialSection>
            ) : null}
            {geometry.mode === 'one-column' && hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                title={t`Connections`}>
                {connections}
              </EditorialSection>
            ) : null}
          </View>

          {geometry.mode === 'two-column' ? (
            <View style={[styles.aside, { width: geometry.asideWidth }]}>
              {hasSlot(attention) ? attention : null}
              {hasSlot(connections) ? (
                <EditorialSection
                  borderColor={theme.colors.border}
                  textColor={theme.colors.text}
                  spacing={theme.spacing}
                  title={t`Connections`}
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
      testID="home-editorial-layout"
      onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[styles.root, { paddingHorizontal: geometry.gutter }, style]}>
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

      {!hasArtwork && hasSlot(launches) ? <View style={styles.launches}>{launches}</View> : null}

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
          {hasArtwork && hasSlot(launches) ? <View style={styles.launches}>{launches}</View> : null}
          {geometry.mode === 'one-column' && hasSlot(attention) ? attention : null}
          {hasSlot(recent) ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
              first={!hasArtwork}
              title={t`Continue`}>
              {recent}
            </EditorialSection>
          ) : null}
          {geometry.mode === 'one-column' && hasSlot(connections) ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
              title={t`Connections`}>
              {connections}
            </EditorialSection>
          ) : null}
        </View>

        {geometry.mode === 'two-column' ? (
          <View style={[styles.aside, { width: geometry.asideWidth }]}>
            {hasSlot(attention) ? attention : null}
            {hasSlot(connections) ? (
              <EditorialSection
                borderColor={theme.colors.border}
                textColor={theme.colors.text}
                spacing={theme.spacing}
                first
                title={t`Connections`}>
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
    maxWidth: 1120,
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
