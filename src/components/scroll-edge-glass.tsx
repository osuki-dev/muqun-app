import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { useThemeTokens } from '@osuki-dev/ui';
import type { RefObject } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { withAlpha } from '@/lib/color';

/** Two narrow live-blur edges; scroll progress stays on the UI thread. */
export function ScrollEdgeGlass({
  target,
  offset,
  extent,
  side,
}: {
  target: RefObject<View | null>;
  offset: SharedValue<number>;
  extent: SharedValue<number>;
  side: 'left' | 'right';
}) {
  const theme = useThemeTokens();
  const visibility = useAnimatedStyle(() => ({
    opacity: Math.min(
      1,
      Math.max(0, side === 'left' ? offset.value : extent.value - offset.value) / 20
    ),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.edge, { [side]: 0 }, visibility]}>
      <MaskedView
        style={styles.fill}
        maskElement={
          <View
            style={[
              styles.fill,
              {
                experimental_backgroundImage: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, black, transparent)`,
              },
            ]}
          />
        }>
        <BlurView
          blurTarget={target}
          blurMethod="dimezisBlurViewSdk31Plus"
          intensity={38}
          tint={theme.mode === 'dark' ? 'dark' : 'light'}
          style={styles.fill}
        />
        <View style={[styles.fill, { backgroundColor: withAlpha(theme.colors.surface, 0.12) }]} />
      </MaskedView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, bottom: 0, width: 28, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
});
