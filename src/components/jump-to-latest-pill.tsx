import { Trans, useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { memo, useSyncExternalStore } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { DisclosureDownIcon } from '@/icons';
import { fadeIn, fadeOut } from '@/lib/motion';
import type { TranscriptFollow } from '@/lib/transcript-follow';

/**
 * The way back to the newest row, and the only view that reads the scroll.
 *
 * Its own component so that a drag costs one render of a pill rather than one
 * render of the workbench. `useSyncExternalStore` is the right shape here
 * precisely because the store is written from an `onScroll` callback that is
 * not React's to schedule -- it subscribes, it does not poll, and it tears
 * nothing when the value changes mid-render.
 */
export const JumpToLatestPill = memo(function JumpToLatestPill({
  follow,
  enabled,
  bottom,
  onPress,
  testID = 'agent-jump-to-latest-btn',
}: {
  testID?: string;
  follow: TranscriptFollow;
  enabled: boolean;
  bottom: number;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const { visible } = useSyncExternalStore(follow.subscribe, follow.getSnapshot);
  if (!enabled || !visible) return null;
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      style={[styles.wrap, { bottom }]}>
      <GlassChrome surface="navigation" shape="navigationPill" style={styles.pill}>
        <PressableScale
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={t`Scroll to latest message`}
          onPress={onPress}
          style={styles.inner}>
          <DisclosureDownIcon size={15} color={theme.colors.text} />
          <Text variant="caption" weight="semibold" color={theme.colors.text}>
            <Trans>Latest</Trans>
          </Text>
        </PressableScale>
      </GlassChrome>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
  },
  pill: {
    height: 34,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    paddingHorizontal: 12,
  },
});
