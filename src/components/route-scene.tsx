import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import Animated from 'react-native-reanimated';
import { FullscreenRouteSafeArea } from '@/components/sheet-route-frame';
import { routeSceneEnter, type RouteSceneType } from '@/lib/motion';

/** A fluid, elevated surface shared by root pages and custom routes.
 * Native navigation owns swipe back and cancellation; this layer provides
 * a cyber-tactile depth reveal on route entry. Form sheets bypass this
 * wrapper to retain their native measurement contract.
 */
export function RouteScene({
  children,
  modal = false,
  sceneType,
  animated = true,
}: {
  children: ReactNode;
  modal?: boolean;
  sceneType?: RouteSceneType;
  animated?: boolean;
}) {
  const { colors } = useThemeTokens();
  const content = modal ? <FullscreenRouteSafeArea>{children}</FullscreenRouteSafeArea> : children;
  const effectiveSceneType: RouteSceneType = modal ? 'modal' : (sceneType ?? 'plain');

  return (
    <View style={[styles.viewport, { backgroundColor: colors.background }]}>
      {animated ? (
        <Animated.View style={styles.scene} entering={routeSceneEnter(effectiveSceneType)}>
          {content}
        </Animated.View>
      ) : (
        <View style={styles.scene}>{content}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  scene: { flex: 1 },
});
