import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { formatAssetSize } from '@/lib/asset-display';
import { measuredUpdateProgress } from '@/lib/update-progress-shader';
import { deferAppUpdate, updateAppNow, useAppUpdateStore } from '@/lib/app-updates';
import { Download, RotateCw } from 'lucide-react-native';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated from 'react-native-reanimated';
import { UpdateDownloadProgress } from '@/components/update-download-progress';
import { UpdateReleaseNotes } from '@/components/update-release-notes';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { PressableScale } from '@/components/pressable-scale';
import { fadeIn } from '@/lib/motion';

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
  const downloadSize = useAppUpdateStore((state) => state.downloadSize);
  const downloadSizeStatus = useAppUpdateStore((state) => state.downloadSizeStatus);
  const transitionKind = useAppUpdateStore((state) => state.transitionKind);
  const required = useAppUpdateStore((state) => state.required);
  const releaseId = useAppUpdateStore((state) => state.releaseId);
  const downloading = phase === 'downloading';
  const restarting = phase === 'restarting';
  const restartFailed = phase === 'restart-failed';
  const applying = phase === 'applying';
  const downloadFailed = phase === 'download-failed';
  const actionable = phase === 'available' || downloadFailed || restartFailed;
  const visible = actionable || downloading || applying || restarting;

  if (!visible) return null;

  const label = restarting
    ? t`Restarting Muqun…`
    : restartFailed
      ? t`Restart Muqun to finish updating`
      : downloadFailed
        ? t`Update download failed. Try again.`
        : applying
          ? t`Applying…`
          : downloading
            ? t`Updating Muqun…`
            : t`Update available`;
  const transferred =
    downloadedBytes === undefined ? undefined : formatAssetSize(downloadedBytes) || '0 B';
  const total = totalBytes === undefined ? undefined : formatAssetSize(totalBytes) || '0 B';
  const fullPackage = downloadSize?.fullBytes ? formatAssetSize(downloadSize.fullBytes) : undefined;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={deferAppUpdate}>
      <View
        style={[
          styles.overlay,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
        ]}>
        <View
          testID="update-consent-prompt"
          accessibilityViewIsModal
          style={[
            styles.banner,
            notificationSurfaceStyle,
            {
              backgroundColor: theme.colors.surface,
              maxHeight: Math.max(0, height - insets.top - insets.bottom - 32),
            },
          ]}>
          <ScrollView
            testID="update-prompt-scroll"
            accessibilityLabel={t`What's new`}
            style={styles.body}
            contentContainerStyle={styles.bodyContent}>
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
                <Text variant="body" weight="medium" accessibilityLiveRegion="polite">
                  {label}
                </Text>
                {downloading || restarting || restartFailed ? (
                  <UpdateDownloadProgress value={downloadedProgress} downloading={downloading} />
                ) : null}
                {transferred || downloading || restarting ? (
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
                    {downloading || restarting ? (
                      <Text variant="caption" weight="regular" color={theme.colors.textMuted}>
                        {Math.floor(measuredUpdateProgress(downloadedProgress) * 100)}%
                      </Text>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
            {releaseId ? (
              <Text variant="caption" color={theme.colors.textMuted} style={styles.identifier}>
                {t`Update`} · {releaseId.slice(0, 8)}
              </Text>
            ) : null}
            {actionable &&
            !restartFailed &&
            transitionKind !== 'ADOPT_RELEASE' &&
            transitionKind !== 'USE_BUILTIN' ? (
              <View testID="update-download-size" style={styles.identifier}>
                <Text variant="bodySmall" color={theme.colors.textMuted}>
                  {downloadSizeStatus === 'checking'
                    ? t`Checking download size…`
                    : downloadSizeStatus === 'failed'
                      ? t`Could not check download size. Try again.`
                      : t`Download size: ${fullPackage}`}
                </Text>
                {fullPackage ? (
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {t`Full package size. File reuse may reduce the download.`}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {required ? (
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.identifier}>
                {t`This update is required to continue using Muqun. Read what's new, then update when you're ready.`}
              </Text>
            ) : null}
            {releaseNotes ? (
              <View testID="update-release-notes" style={styles.notes}>
                <UpdateReleaseNotes notes={releaseNotes} bundled={false} />
              </View>
            ) : (
              <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.identifier}>
                {t`No changelog was provided for this update.`}
              </Text>
            )}
          </ScrollView>
          {actionable ? (
            <View testID="update-prompt-actions" style={styles.actions}>
              {!required ? (
                <PressableScale
                  testID="update-later"
                  accessibilityRole="button"
                  accessibilityLabel={t`Later`}
                  onPress={deferAppUpdate}
                  style={styles.action}>
                  <Text variant="bodySmall" color={theme.colors.textMuted}>{t`Later`}</Text>
                </PressableScale>
              ) : null}
              <PressableScale
                testID="update-now"
                accessibilityRole="button"
                accessibilityLabel={
                  downloadSizeStatus
                    ? t`Retry size check`
                    : downloadFailed || restartFailed
                      ? t`Retry`
                      : t`Update now`
                }
                onPress={() => {
                  void updateAppNow();
                }}
                style={[styles.action, { backgroundColor: theme.colors.primarySubtle }]}>
                <Text variant="bodySmall" color={theme.colors.primary}>
                  {downloadSizeStatus
                    ? t`Retry size check`
                    : downloadFailed || restartFailed
                      ? t`Retry`
                      : t`Update now`}
                </Text>
              </PressableScale>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  banner: {
    width: '100%',
    maxWidth: 420,
    padding: 16,
    gap: 12,
  },
  // Header, explanation and notes share one shrinkable scroller. The action
  // footer never competes with their intrinsic height, even with large text.
  body: { flexShrink: 1, minHeight: 0 },
  bodyContent: { gap: 12 },
  identifier: { paddingHorizontal: 4 },
  actions: { flexShrink: 0, flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  action: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
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
  notes: { paddingHorizontal: 10, paddingBottom: 8 },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  transfer: { flex: 1 },
});
