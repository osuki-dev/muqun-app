import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import Animated from 'react-native-reanimated';
import { FullscreenRouteSafeArea } from '@/components/sheet-route-frame';

/** The stable surface shared by root pages and custom routes.
 * Native navigation owns route motion, swipe back and cancellation. Never swap
 * the wrapper type when the profile changes: it owns live workspaces.
 * Form sheets bypass this wrapper to retain their native measurement contract.
 */
export function RouteScene({ children, modal = false }: { children: ReactNode; modal?: boolean }) {
  const { colors } = useThemeTokens();
  const content = modal ? <FullscreenRouteSafeArea>{children}</FullscreenRouteSafeArea> : children;

  // Opacity audit: floor -- the route's opaque base, or the previous route shows through.
  return (
    <View style={[styles.viewport, { backgroundColor: colors.background }]}>
      <Animated.View style={styles.scene}>{content}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  scene: { flex: 1 },
});
