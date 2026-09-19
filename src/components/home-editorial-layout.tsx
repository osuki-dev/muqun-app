import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

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
  /** Optional bounded artwork. The caller supplies the shared resolver's presence answer. */
  artwork?: ReactNode;
  artworkAvailable: boolean;
  /** A native action kept beside the masthead copy. */
  headerAction?: ReactNode;
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
  number: string;
  title: ReactNode;
  children: ReactNode;
  borderColor: string;
  numberColor: string;
  textColor: string;
  mutedColor: string;
  surfaceColor: string;
  spacing: {
    md: number;
    xl: number;
    '2xl': number;
  };
};

function EditorialSection({
  number,
  title,
  children,
  borderColor,
  numberColor,
  textColor,
  mutedColor,
  surfaceColor,
  spacing,
}: EditorialSectionProps) {
  return (
    <View style={[styles.section, { marginBottom: spacing['2xl'] }]}>
      <View style={[styles.sectionHeader, { borderBottomColor: borderColor }]}>
        <Text variant="label" color={numberColor} hugSlack={false}>
          {number}
        </Text>
        <Text
          variant="heading"
          color={textColor}
          style={styles.sectionTitle}
          accessibilityRole="header">
          {title}
        </Text>
      </View>
      <View
        style={[
          styles.sectionBody,
          {
            backgroundColor: surfaceColor,
            borderBottomColor: borderColor,
            paddingTop: spacing.md,
            paddingBottom: spacing.xl,
          },
        ]}>
        <View style={styles.slotContent}>{children}</View>
        <View style={[styles.sectionAsideRule, { backgroundColor: mutedColor }]} />
      </View>
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
 *   artworkAvailable={heroResolution !== null}
 *   identity={<HomeIdentity />}
 *   artwork={homeArtwork}
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
  artworkAvailable,
  headerAction,
  launches,
  recent,
  attention,
  connections,
  controls,
  style,
}: HomeEditorialLayoutProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { fontScale: windowFontScale } = useWindowDimensions();
  const fontScale = fontScaleProp ?? windowFontScale;
  const hasAside = hasSlot(attention) || hasSlot(connections);
  const geometry = getEditorialLayoutGeometry(contentWidth, fontScale, hasAside);
  const mastheadWide = geometry.mode === 'two-column' && artworkAvailable;
  const backgroundColor = surfaceBackground(theme.colors.background);
  const surfaceColor = surfaceBackground(theme.colors.surface);

  const sectionProps = {
    borderColor: theme.colors.border,
    numberColor: theme.colors.primary,
    textColor: theme.colors.text,
    mutedColor: theme.colors.textSubtle,
    surfaceColor,
    spacing: theme.spacing,
  };

  return (
    <View
      testID="home-editorial-layout"
      style={[styles.root, { backgroundColor, paddingHorizontal: geometry.gutter }, style]}>
      <View style={[styles.masthead, mastheadWide && styles.mastheadWide]}>
        <View style={[styles.mastheadCopy, mastheadWide && styles.mastheadCopyWide]}>
          <View style={styles.mastheadTop}>
            <View style={styles.mastheadText}>
              {hasSlot(identity) ? <View style={styles.identity}>{identity}</View> : null}
              <View style={styles.kicker}>
                <View style={[styles.kickerRule, { backgroundColor: theme.colors.primary }]} />
                <Text variant="label" color={theme.colors.textMuted}>
                  {t`Home / Editorial`}
                </Text>
              </View>
              <Text
                variant="display"
                color={theme.colors.text}
                style={styles.title}
                accessibilityRole="header">
                {t`Workbench`}
              </Text>
            </View>
            {hasSlot(headerAction) ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
        </View>
        {artworkAvailable ? (
          <View
            style={[
              styles.artwork,
              { backgroundColor: surfaceColor, borderColor: theme.colors.border },
              mastheadWide ? styles.artworkWide : styles.artworkStacked,
            ]}>
            {artwork}
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.content,
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
          {hasSlot(launches) ? (
            <EditorialSection {...sectionProps} number="01" title={t`Start`}>
              {launches}
            </EditorialSection>
          ) : null}
          {hasSlot(recent) ? (
            <EditorialSection {...sectionProps} number="02" title={t`Continue`}>
              {recent}
            </EditorialSection>
          ) : null}
          {geometry.mode === 'one-column' && hasSlot(attention) ? (
            <EditorialSection {...sectionProps} number="03" title={t`Attention`}>
              {attention}
            </EditorialSection>
          ) : null}
          {geometry.mode === 'one-column' && hasSlot(connections) ? (
            <EditorialSection {...sectionProps} number="04" title={t`Connections`}>
              {connections}
            </EditorialSection>
          ) : null}
        </View>

        {geometry.mode === 'two-column' ? (
          <View style={[styles.aside, { width: geometry.asideWidth }]}>
            {hasSlot(attention) ? (
              <EditorialSection {...sectionProps} number="03" title={t`Attention`}>
                {attention}
              </EditorialSection>
            ) : null}
            {hasSlot(connections) ? (
              <EditorialSection {...sectionProps} number="04" title={t`Connections`}>
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
  root: {
    alignSelf: 'stretch',
    minWidth: 0,
    paddingTop: 24,
    paddingBottom: 32,
  },
  masthead: {
    minWidth: 0,
    marginBottom: 40,
  },
  mastheadWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 24,
  },
  mastheadCopy: {
    minWidth: 0,
  },
  mastheadCopyWide: {
    flex: 1,
  },
  mastheadTop: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 16,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    flexShrink: 0,
  },
  identity: {
    minWidth: 0,
    marginBottom: 24,
  },
  kicker: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    marginBottom: 12,
  },
  kickerRule: {
    width: 24,
    height: 2,
  },
  title: {
    flexShrink: 1,
    letterSpacing: -0.8,
  },
  artwork: {
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  artworkWide: {
    flex: 1,
  },
  artworkStacked: {
    width: '100%',
    marginTop: 24,
  },
  content: {
    minWidth: 0,
    flexDirection: 'column',
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
    columnGap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingBottom: 8,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  sectionBody: {
    minWidth: 0,
    position: 'relative',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  slotContent: {
    minWidth: 0,
  },
  sectionAsideRule: {
    width: 24,
    height: StyleSheet.hairlineWidth,
    marginTop: 16,
    opacity: 0.5,
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
