import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { ReactNode } from 'react';

import { Text } from '@/components/text';
import type { HomeEditorialLayoutProps } from '@/components/home-editorial-layout';
import { getEditorialLayoutGeometry } from '@/lib/home-editorial-layout';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

/** Instrument-panel composition; data, actions, and scrolling stay with Home.
 * The rail is always horizontal. Plates use opaque theme surfaces so a night
 * shift palette is optional, not imposed, and wallpaper never reduces contrast.
 */
export function HomeMechanicalLayout({
  contentWidth,
  fontScale,
  identity,
  artwork,
  artworkAvailable,
  headerLeading,
  headerAction,
  launches,
  recent,
  attention,
  connections,
  controls,
  style,
}: HomeEditorialLayoutProps) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const window = useWindowDimensions();
  const geometry = getEditorialLayoutGeometry(contentWidth, fontScale ?? window.fontScale, true);
  const wide = geometry.mode === 'two-column';
  return (
    <View
      testID="home-mechanical-layout"
      style={[styles.root, { paddingHorizontal: geometry.gutter }, style]}>
      <View style={[styles.header, { borderColor: colors.borderStrong }]}>
        <View style={styles.utility}>
          {headerLeading}
          {headerAction}
        </View>
        {identity ? (
          <View style={[styles.identity, { backgroundColor: colors.surface }]}>{identity}</View>
        ) : null}
      </View>
      {launches}
      <View style={[styles.body, wide && styles.wide]}>
        <View style={[styles.main, wide && { flex: 1.5 }]}>
          {attention}
          <InstrumentPanel marker="01" title={t`Continue`}>
            {recent}
          </InstrumentPanel>
        </View>
        <View style={[styles.main, wide && { flex: 1 }]}>
          <InstrumentPanel marker="02" title={t`Connections`}>
            {connections}
          </InstrumentPanel>
          {artworkAvailable ? <View style={styles.artwork}>{artwork}</View> : null}
        </View>
      </View>
      {controls}
    </View>
  );
}

function InstrumentPanel({
  marker,
  title,
  children,
}: {
  marker: string;
  title: string;
  children: ReactNode;
}) {
  const { colors } = useThemeTokens();
  const profile = useAppearanceProfile();
  if (!children) return null;
  return (
    <View
      style={[
        styles.panel,
        {
          borderColor: colors.border,
          backgroundColor: colors.surface,
          borderRadius: profile.chrome.surface,
        },
      ]}>
      <View style={[styles.panelHeading, { borderBottomColor: colors.border }]}>
        <Text variant="caption" color={colors.primary} accessible={false}>
          {marker}
        </Text>
        <Text variant="bodySmall" weight="semibold" accessibilityRole="header">
          {title}
        </Text>
        <View accessible={false} style={[styles.rule, { backgroundColor: colors.primary }]} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { minWidth: 0, paddingTop: 12, paddingBottom: 24, gap: 16 },
  header: { borderTopWidth: 3, paddingTop: 10, gap: 12 },
  utility: {
    minHeight: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  identity: { padding: 12 },
  body: { gap: 12 },
  wide: { flexDirection: 'row', alignItems: 'flex-start' },
  main: { minWidth: 0, gap: 12 },
  panel: { borderWidth: 1, padding: 12, gap: 8 },
  panelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  rule: { marginLeft: 'auto', width: 24, height: 3 },
  artwork: { maxHeight: 180, overflow: 'hidden' },
});
