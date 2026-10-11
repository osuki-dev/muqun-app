import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useAppUpdateStore } from '@/lib/app-updates';
import { Check, Download, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useNotificationSurfaceStyle } from '@/components/notification-surface';
import { PressableScale } from '@/components/pressable-scale';
import { fadeInDown, fadeOutUp, timing } from '@/lib/motion';

export function UpdateStatusBanner() {
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
  const progress = useSharedValue(0);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const visible = phase === 'downloading' || (phase === 'ready' && !noticeDismissed);

  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setTimeout(() => setNoticeDismissed(true), 6000);
    return () => clearTimeout(timer);
  }, [phase]);

  // Interpolate measured progress only; timing() respects reduced motion.
  useEffect(() => {
    progress.set(withTiming(downloadedProgress, timing('short')));
  }, [downloadedProgress, progress]);

  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.get() }],
  }));

  if (!visible) return null;

  const ready = phase === 'ready';
  const label = ready ? t`Update ready · applies on next launch` : t`Updating Muqun…`;

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
        <View
          style={[styles.icon, { backgroundColor: surfaceBackground(theme.colors.primarySubtle) }]}>
          {ready ? (
            <Check size={15} color={theme.colors.primary} strokeWidth={2.4} />
          ) : (
            <Download size={15} color={theme.colors.primary} strokeWidth={2.2} />
          )}
        </View>
        <View style={styles.content}>
          <Text variant="caption" numberOfLines={2}>
            {label}
          </Text>
          <View
            style={[
              styles.track,
              { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
            ]}>
            <Animated.View
              style={[styles.progress, { backgroundColor: theme.colors.primary }, progressStyle]}
            />
          </View>
        </View>
        {ready ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Dismiss`}
            hitSlop={10}
            pressedScale={0.9}
            onPress={() => setNoticeDismissed(true)}
            style={styles.dismiss}>
            <X size={16} color={theme.colors.textMuted} />
          </PressableScale>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
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
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progress: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    transformOrigin: 'left center',
  },
});
