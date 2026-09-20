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
import { useHasThemeArtwork } from '@/components/theme-artwork';

import { getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
export {
  EDITORIAL_MASTHEAD_MIN_WIDTH,
  EDITORIAL_TWO_COLUMN_MIN_WIDTH,
  getEditorialLayoutGeometry,
  type EditorialLayoutGeometry,
  type EditorialLayoutMode,
  type EditorialMastheadMode,
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
  /** Native actions kept in the compact masthead utility row. */
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
  const theme = useThemeTokens();
  const hasScene = useHasThemeArtwork('home.background', 'shell.background');
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
                  borderRadius: 4,
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
  const { fontScale: windowFontScale } = useWindowDimensions();
  const fontScale = fontScaleProp ?? windowFontScale;
  const hasAside = hasSlot(attention) || hasSlot(connections);
  const geometry = getEditorialLayoutGeometry(contentWidth, fontScale, hasAside);
  const hasArtwork = artworkAvailable && hasSlot(artwork);
  const mastheadWide = geometry.mastheadMode === 'side-by-side' && hasArtwork;
  const hasHeaderAction = hasSlot(headerAction);
  const mastheadText = (
    <View style={styles.mastheadText}>
      {hasSlot(identity) ? <View style={styles.identity}>{identity}</View> : null}
      <View style={styles.kicker}>
        <View style={[styles.kickerRule, { backgroundColor: theme.colors.primary }]} />
        <Text variant="label" color={theme.colors.textMuted}>
          {t`Home / Editorial`}
        </Text>
      </View>
      {!hasSlot(identity) ? (
        <Text
          variant="heading"
          color={theme.colors.text}
          style={styles.title}
          accessibilityRole="header">
          {t`Workbench`}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View
      testID="home-editorial-layout"
      style={[styles.root, { paddingHorizontal: geometry.gutter }, style]}>
      <View style={styles.masthead}>
        {hasArtwork ? (
          <>
            {hasHeaderAction ? (
              <View style={styles.mastheadActionRow}>
                <View style={styles.headerAction}>{headerAction}</View>
              </View>
            ) : null}
            <View style={[styles.mastheadBody, mastheadWide && styles.mastheadWide]}>
              <View style={[styles.mastheadCopy, mastheadWide && styles.mastheadCopyWide]}>
                {mastheadText}
              </View>
              <View
                style={[styles.artwork, mastheadWide ? styles.artworkWide : styles.artworkStacked]}>
                {artwork}
              </View>
            </View>
          </>
        ) : (
          <View style={[styles.mastheadBody, hasHeaderAction && styles.mastheadNoArtRow]}>
            <View style={styles.mastheadCopy}>{mastheadText}</View>
            {hasHeaderAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
        )}
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
          {hasSlot(launches) ? <View style={styles.launches}>{launches}</View> : null}
          {geometry.mode === 'one-column' && hasSlot(attention) ? attention : null}
          {hasSlot(recent) ? (
            <EditorialSection
              borderColor={theme.colors.border}
              textColor={theme.colors.text}
              spacing={theme.spacing}
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
  root: {
    alignSelf: 'stretch',
    minWidth: 0,
    paddingTop: 12,
    paddingBottom: 32,
  },
  masthead: {
    minWidth: 0,
    marginBottom: 16,
  },
  mastheadActionRow: {
    minWidth: 0,
    minHeight: 0,
    alignItems: 'flex-end',
    marginBottom: 12,
  },
  mastheadBody: {
    minWidth: 0,
  },
  mastheadNoArtRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 12,
  },
  mastheadWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: 20,
  },
  mastheadCopy: {
    minWidth: 0,
    flex: 1,
  },
  mastheadCopyWide: {
    flex: 1,
  },
  mastheadText: {
    flex: 1,
    minWidth: 0,
  },
  headerAction: {
    flexShrink: 0,
    maxWidth: '100%',
  },
  identity: {
    minWidth: 0,
    marginBottom: 12,
  },
  kicker: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    marginBottom: 8,
  },
  kickerRule: {
    width: 24,
    height: 2,
  },
  title: {
    flexShrink: 1,
    letterSpacing: -0.2,
  },
  artwork: {
    minWidth: 0,
    overflow: 'hidden',
  },
  artworkWide: {
    flex: 1,
  },
  artworkStacked: {
    width: '100%',
    marginTop: 16,
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
