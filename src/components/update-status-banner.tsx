import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Canvas, Fill } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';

import { SNAP_DUST_EFFECT, SnapDust } from '@/components/launch-snap';
import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { useSurfacePhotograph, type SurfacePhotograph } from '@/components/reskin-transition';
import { UpdateReleaseNotes } from '@/components/update-release-notes';
import { UpdateRing, type UpdateRingState } from '@/components/update-ring';
import { formatAssetSize } from '@/lib/asset-display';
import { deferAppUpdate, updateAppNow, useAppUpdateStore } from '@/lib/app-updates';
import { calmFadeIn, calmFadeOut, DURATION, entryRise, SETTLE, timing } from '@/lib/motion';
import { setUpdateCurtain } from '@/lib/update-curtain';
import { updateNoteBullets } from '@/lib/update-note-bullets';
import { disposeViewPhotograph } from '@/lib/view-photograph';

const RISE = 28;
/** The launch snap's own length (`launch-intro-timeline.ts`). */
const DISSOLVE_MS = DURATION.long + DURATION.medium;
/** The ring closing, the check drawing, and a beat to see it. */
const CHECK_SETTLE_MS = DURATION.short + DURATION.medium + 100 + 260;
const calm = (duration: number) => timing(duration, { reduceMotion: ReduceMotion.Never });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function UpdateStatusBanner() {
  const phase = useAppUpdateStore((state) => state.phase);
  const visible = [
    'available',
    'download-failed',
    'restart-failed',
    'downloading',
    'applying',
    'restarting',
  ].includes(phase);
  // The dialog mounts with the prompt and unmounts with it, so its ring and
  // every clock in it stop the moment it is gone.
  return visible ? <UpdateDialog /> : null;
}

function UpdateDialog() {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const notificationSurfaceStyle = useNotificationSurfaceStyle();
  // The hook's `t`, bound to the Lingui context, so a language switch reaches
  // every string here under the React Compiler.
  const { t } = useLingui();
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const photographSurface = useSurfacePhotograph();

  const phase = useAppUpdateStore((state) => state.phase);
  const progress = useAppUpdateStore((state) => state.progress);
  const releaseNotes = useAppUpdateStore((state) => state.releaseNotes);
  const downloadSize = useAppUpdateStore((state) => state.downloadSize);
  const downloadSizeStatus = useAppUpdateStore((state) => state.downloadSizeStatus);
  const transitionKind = useAppUpdateStore((state) => state.transitionKind);
  const required = useAppUpdateStore((state) => state.required);
  const downloadFailed = phase === 'download-failed';
  const restartFailed = phase === 'restart-failed';
  const restarting = phase === 'restarting';
  const actionable = phase === 'available' || downloadFailed || restartFailed;

  const ringState: UpdateRingState =
    restarting || restartFailed
      ? 'done'
      : phase === 'downloading' || phase === 'applying'
        ? 'progress'
        : 'waiting';
  const measured = phase === 'downloading' && Number.isFinite(progress) ? progress : 0;

  // Entrance: the sheet rises on the settle spring; Reduce Motion fades only.
  const enter = useSharedValue(0);
  const rise = useSharedValue(reduced ? 0 : RISE);
  // The exit into the restart: 0 shown, 1 gone.
  const leave = useSharedValue(0);
  const dust = useSharedValue(0);
  useEffect(() => {
    enter.set(withTiming(1, calm(DURATION.medium)));
    if (!reduced) rise.set(withSpring(0, SETTLE));
  }, [enter, reduced, rise]);
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: enter.get() * (1 - leave.get()),
    transform: [{ translateY: rise.get() + leave.get() * (reduced ? 0 : 12) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: 1 - leave.get() }));

  // The restart's curtain: the screen this update replaces, breaking into the
  // launch scene's ash over the theme's ground, before the reload runs.
  const [shot, setShot] = useState<SurfacePhotograph | null>(null);
  const [drawn, setDrawn] = useState<(() => void) | null>(null);
  useEffect(() => {
    if (!shot) return;
    return () => disposeViewPhotograph(shot.image);
  }, [shot]);
  const playCurtain = useEffectEvent(async () => {
    await wait(CHECK_SETTLE_MS);
    const picture =
      reduced || !SNAP_DUST_EFFECT ? null : await photographSurface('root').catch(() => null);
    if (!picture) {
      // Without a picture, the dialog alone fades away.
      leave.set(withTiming(1, calm(DURATION.medium)));
      await wait(DURATION.medium);
      return;
    }
    await new Promise<void>((resolve) => {
      setDrawn(() => resolve);
      setShot(picture);
    });
  });
  useEffect(() => setUpdateCurtain(() => playCurtain()), []);
  // The dust is in the canvas: one clock from here, linear like the launch's.
  const onDustReady = () => {
    leave.set(withTiming(1, calm(DURATION.medium)));
    dust.set(
      withTiming(
        1,
        { duration: DISSOLVE_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never },
        (finished) => {
          if (finished && drawn) scheduleOnRN(drawn);
        }
      )
    );
  };
  // A restart that failed brings the dialog back, with its Retry.
  useEffect(() => {
    if (restarting) return;
    setShot(null);
    setDrawn(null);
    dust.set(0);
    leave.set(withTiming(0, calm(DURATION.medium)));
  }, [dust, leave, restarting]);

  const bullets = releaseNotes ? updateNoteBullets(releaseNotes) : null;
  const size =
    transitionKind === 'ADOPT_RELEASE' || transitionKind === 'USE_BUILTIN'
      ? null
      : downloadSizeStatus === 'checking'
        ? t`Checking download size…`
        : downloadSizeStatus === 'failed'
          ? t`Could not check download size. Try again.`
          : downloadSize?.fullBytes
            ? formatAssetSize(downloadSize.fullBytes)
            : null;
  const footnote = downloadFailed
    ? t`Update download failed. Try again.`
    : restartFailed
      ? t`Restart Muqun to finish updating`
      : size;
  const status = phase === 'downloading' ? t`Downloading…` : t`Installing…`;
  const primaryLabel = downloadSizeStatus
    ? t`Retry size check`
    : downloadFailed || restartFailed
      ? t`Retry`
      : t`Update now`;

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={deferAppUpdate}>
      <GestureHandlerRootView style={styles.fill}>
        {shot ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Fill color={theme.colors.background} />
            <SnapDust image={shot.image} width={shot.width} progress={dust} onReady={onDustReady} />
          </Canvas>
        ) : null}
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
        <View
          style={[
            styles.overlay,
            { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 },
          ]}>
          <Animated.View
            testID="update-consent-prompt"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              notificationSurfaceStyle,
              {
                // Opacity audit: dialog -- a modal consent prompt over a dim
                // scrim, opaque like the kit's dialogs; its contents sit on it.
                backgroundColor: theme.colors.surface,
                maxHeight: Math.max(0, height - insets.top - insets.bottom - 32),
              },
              sheetStyle,
            ]}>
            <View style={styles.header}>
              <View
                testID="update-download-progress"
                accessibilityRole={ringState === 'progress' ? 'progressbar' : undefined}
                accessibilityValue={
                  ringState === 'progress'
                    ? { min: 0, max: 100, now: Math.floor(Math.min(1, measured) * 100) }
                    : undefined
                }>
                <UpdateRing state={ringState} progress={Math.max(0, Math.min(1, measured))} />
              </View>
              <Text variant="body" weight="medium" style={styles.title}>
                {t`Update ready`}
              </Text>
            </View>
            {required ? (
              <Text variant="bodySmall" color={theme.colors.textMuted}>
                {t`This update is required to continue using Muqun. Read what's new, then update when you're ready.`}
              </Text>
            ) : null}
            <ScrollView
              testID="update-prompt-scroll"
              accessibilityLabel={t`What's new`}
              nestedScrollEnabled
              style={styles.body}
              contentContainerStyle={styles.bodyContent}>
              {bullets ? (
                <View testID="update-release-notes" style={styles.bullets}>
                  {bullets.map((bullet, index) => (
                    <Animated.View
                      key={`${index}:${bullet}`}
                      entering={
                        reduced ? calmFadeIn('short') : entryRise(index, bullets.length, 120)
                      }
                      style={styles.bullet}>
                      <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
                      <Text variant="body" color={theme.colors.text} style={styles.bulletText}>
                        {bullet}
                      </Text>
                    </Animated.View>
                  ))}
                </View>
              ) : releaseNotes ? (
                <View testID="update-release-notes">
                  <UpdateReleaseNotes notes={releaseNotes} bundled={false} />
                </View>
              ) : (
                <Text variant="bodySmall" color={theme.colors.textMuted}>
                  {t`No changelog was provided for this update.`}
                </Text>
              )}
            </ScrollView>
            {footnote ? (
              <Text
                testID="update-download-size"
                variant="caption"
                color={theme.colors.textMuted}
                accessibilityLiveRegion="polite">
                {footnote}
              </Text>
            ) : null}
            {/* One reserved row: the buttons, or the status that replaces them. */}
            <View style={styles.footer}>
              {actionable ? (
                <Animated.View
                  key="actions"
                  testID="update-prompt-actions"
                  entering={calmFadeIn('short')}
                  exiting={calmFadeOut('micro')}
                  style={[StyleSheet.absoluteFill, styles.actions]}>
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
                    accessibilityLabel={primaryLabel}
                    onPress={() => {
                      void updateAppNow();
                    }}
                    style={[styles.action, { backgroundColor: theme.colors.primary }]}>
                    <Text variant="bodySmall" weight="medium" color={theme.colors.onPrimary}>
                      {primaryLabel}
                    </Text>
                  </PressableScale>
                </Animated.View>
              ) : (
                <Animated.View
                  key="status"
                  testID="update-status-line"
                  entering={calmFadeIn('short')}
                  exiting={calmFadeOut('micro')}
                  style={[StyleSheet.absoluteFill, styles.status]}>
                  <Text
                    variant="bodySmall"
                    color={theme.colors.textMuted}
                    accessibilityLiveRegion="polite">
                    {status}
                  </Text>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    padding: 16,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1 },
  // Only the notes scroll; the size line and the action row stay in view.
  body: { flexGrow: 0, flexShrink: 1, minHeight: 0 },
  bodyContent: { paddingHorizontal: 2 },
  bullets: { gap: 10 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9, opacity: 0.8 },
  bulletText: { flex: 1 },
  footer: { height: 44, flexShrink: 0 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  action: {
    flexShrink: 1,
    minWidth: 0,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 12,
  },
  status: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
});
