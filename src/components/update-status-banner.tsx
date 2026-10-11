import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { formatAssetSize } from '@/lib/asset-display';
import { measuredUpdateProgress } from '@/lib/update-progress-shader';
import { useAppUpdateStore } from '@/lib/app-updates';
import { Download, RotateCw, X } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { UpdateDownloadProgress } from '@/components/update-download-progress';
import { UpdateReleaseNotes } from '@/components/update-release-notes';
import { useUpdateDetails } from '@/stores/update-details';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { PressableScale } from '@/components/pressable-scale';
import { fadeIn, fadeInDown, fadeOutUp } from '@/lib/motion';

export function UpdateStatusBanner() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const notificationSurfaceStyle = useNotificationSurfaceStyle();
  const surfaceBackground = useSurfaceBackground();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();

  const theme = useThemeTokens();
  const phase = useAppUpdateStore((state) => state.phase);
  const downloadedProgress = useAppUpdateStore((state) => state.progress);
  const releaseNotes = useAppUpdateStore((state) => state.releaseNotes);
  const downloadedBytes = useAppUpdateStore((state) => state.downloadedBytes);
  const totalBytes = useAppUpdateStore((state) => state.totalBytes);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const detailsOpen = useUpdateDetails((state) => state.notes !== null || state.bundled);
  const downloading = phase === 'downloading';
  const restarting = phase === 'restarting';
  const restartFailed = phase === 'restart-failed';
  const visible =
    !detailsOpen && (downloading || restarting || (restartFailed && !noticeDismissed));

  if (!visible) return null;

  const label = restarting
    ? t`Restarting Muqun…`
    : restartFailed
      ? t`Restart Muqun to finish updating`
      : t`Updating Muqun…`;
  const transferred =
    downloadedBytes === undefined ? undefined : formatAssetSize(downloadedBytes) || '0 B';
  const total = totalBytes === undefined ? undefined : formatAssetSize(totalBytes) || '0 B';
  const notesHeight = Math.min(240, Math.max(72, (height - insets.top - insets.bottom) * 0.4));

  return (
    <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        // Timed rather than sprung: the design system is explicitly "no spring,
        // no bounce", and this banner sits under the status bar where an
        // overshoot reads as a glitch.
        entering={fadeInDown('medium')}
        exiting={fadeOutUp('short')}
        style={[
          styles.banner,
          notificationSurfaceStyle,
          {
            backgroundColor: surfaceBackground(theme.colors.surface),
          },
        ]}>
        <View style={styles.header}>
          <View
            style={[
              styles.icon,
              { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
            ]}>
            <Animated.View
              key={downloading ? 'downloading' : 'restarting'}
              entering={fadeIn('short')}>
              {downloading ? (
                <Download size={15} color={theme.colors.primary} strokeWidth={2.2} />
              ) : (
                <RotateCw size={15} color={theme.colors.primary} strokeWidth={2.2} />
              )}
            </Animated.View>
          </View>
          <View style={styles.content}>
            <Text variant="caption" weight="regular" accessibilityLiveRegion="polite">
              {label}
            </Text>
            <UpdateDownloadProgress value={downloadedProgress} downloading={downloading} />
            {transferred || downloadedProgress > 0 ? (
              <View style={styles.progressRow}>
                {transferred ? (
                  <Text
                    testID="update-download-bytes"
                    variant="caption"
                    weight="regular"
                    color={theme.colors.textMuted}
                    style={styles.transfer}>
                    {total ? `${transferred} / ${total}` : transferred}
                  </Text>
                ) : null}
                {downloadedProgress > 0 ? (
                  <Text variant="caption" weight="regular" color={theme.colors.textMuted}>
                    {Math.floor(measuredUpdateProgress(downloadedProgress) * 100)}%
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {restartFailed ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Dismiss`}
              pressedScale={0.9}
              onPress={() => setNoticeDismissed(true)}
              style={styles.dismiss}>
              <X size={16} color={theme.colors.textMuted} />
            </PressableScale>
          ) : null}
        </View>
        {releaseNotes ? (
          <ScrollView
            testID="update-release-notes"
            accessibilityLabel={t`What's new`}
            nestedScrollEnabled
            style={{ maxHeight: notesHeight }}
            contentContainerStyle={styles.notes}>
            <UpdateReleaseNotes notes={releaseNotes} bundled={false} />
          </ScrollView>
        ) : null}
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    zIndex: 100,
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  banner: {
    width: '100%',
    maxWidth: 420,
    minHeight: 48,
    paddingHorizontal: 6,
    paddingVertical: 6,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 6,
    paddingRight: 10,
  },
  dismiss: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notes: { paddingHorizontal: 10, paddingBottom: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  transfer: { flex: 1 },
});
