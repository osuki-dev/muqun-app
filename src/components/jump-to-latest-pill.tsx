import { Trans, useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { memo, useSyncExternalStore, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { DisclosureDownIcon } from '@/icons';
import { fadeIn } from '@/lib/motion';
import type { TranscriptFollow } from '@/lib/transcript-follow';

/**
 * One tappable pill floating over the transcript, in the navigation material.
 *
 * The Latest action and the YOLO indicator stack at the same edge, so they
 * share one shell: the same chrome, height, radius and padding, drawn from the
 * active pack rather than restated by each caller.
 */
export function FloatingPill({
  testID,
  accessibilityLabel,
  onPress,
  children,
}: {
  testID: string;
  accessibilityLabel: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <GlassChrome surface="navigation" shape="navigationPill" style={styles.pill}>
      <PressableScale
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={styles.inner}>
        {children}
      </PressableScale>
    </GlassChrome>
  );
}

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
  // No exit: scrolling at the threshold and every snapshot read (`enabled`)
  // hide and show this within a second.
  return (
    <Animated.View entering={fadeIn('micro')} style={[styles.wrap, { bottom }]}>
      <FloatingPill
        testID={testID}
        accessibilityLabel={t`Scroll to latest message`}
        onPress={onPress}>
        <DisclosureDownIcon size={15} color={theme.colors.text} />
        <Text variant="caption" weight="semibold" color={theme.colors.text}>
          <Trans>Latest</Trans>
        </Text>
      </FloatingPill>
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
