import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import * as Updates from 'expo-updates';
import { Check, Download } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { appChrome } from '@/constants/appearance';
import { fadeInDown, fadeOutUp, timing } from '@/lib/motion';

/** How long the indeterminate download bar takes to crawl to 92%. */
const DOWNLOAD_RAMP_MS = 2400;

export function UpdateStatusBanner() {
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
  const { isDownloading, isUpdatePending } = Updates.useUpdates();
  const [reloadFailed, setReloadFailed] = useState(false);
  const progress = useSharedValue(0);
  const visible = Updates.isEnabled && (isDownloading || isUpdatePending || reloadFailed);

  // `downloadProgress` from expo-updates counts assets, not bytes -- and on an
  // over-the-air update almost every asset (fonts, images) is already cached, so
  // it jumps straight to ~0.97 and sits there while the one new thing, the JS
  // bundle, downloads as a single unit with no sub-progress. Showing that number
  // reads as "stuck at 97%". Ramp the bar smoothly instead: from zero while the
  // download runs, snap to full once the update is staged.
  useEffect(() => {
    if (isUpdatePending) {
      progress.value = withTiming(1, timing('short'));
    } else if (isDownloading) {
      progress.value = 0;
      // Not a transition but a stand-in for a download whose real length is
      // unknown, so it is deliberately far outside the token scale: the bar
      // has to still be crawling when a slow bundle finally lands.
      progress.value = withTiming(0.92, timing(DOWNLOAD_RAMP_MS));
    }
  }, [isDownloading, isUpdatePending, progress]);

  useEffect(() => {
    if (!isUpdatePending) return;
    const timer = setTimeout(() => {
      void Updates.reloadAsync({
        reloadScreenOptions: {
          backgroundColor: '#08111B',
          spinner: { color: '#58AFFF' },
        },
      }).catch(() => setReloadFailed(true));
    }, 1100);
    return () => clearTimeout(timer);
  }, [isUpdatePending]);

  const progressStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  if (!visible) return null;

  const ready = isUpdatePending && !reloadFailed;
  const label = reloadFailed
    ? t`Restart Muqun to finish updating`
    : ready
      ? t`Update ready · restarting…`
      : t`Updating Muqun…`;

  return (
    <SafeAreaView edges={['top']} pointerEvents="none" style={styles.overlay}>
      <Animated.View
        // Timed rather than sprung: the design system is explicitly "no spring,
        // no bounce", and this banner sits under the status bar where an
        // overshoot reads as a glitch.
        entering={fadeInDown('medium')}
        exiting={fadeOutUp('short')}
        style={[
          styles.banner,
          {
            backgroundColor: theme.colors.surface,
          },
        ]}>
        <View style={[styles.icon, { backgroundColor: theme.colors.primarySubtle }]}>
          {ready ? (
            <Check size={15} color={theme.colors.primary} strokeWidth={2.4} />
          ) : (
            <Download size={15} color={theme.colors.primary} strokeWidth={2.2} />
          )}
        </View>
        <View style={styles.content}>
          <Text variant="caption" numberOfLines={1} style={styles.label}>
            {label}
          </Text>
          <View style={[styles.track, { backgroundColor: theme.colors.primarySubtle }]}>
            <Animated.View
              style={[styles.progress, { backgroundColor: theme.colors.primary }, progressStyle]}
            />
          </View>
        </View>
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
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
    paddingHorizontal: 6,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    boxShadow: appChrome.shadow.notice,
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
  label: {
    fontWeight: '600',
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
