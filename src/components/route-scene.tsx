import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import Animated from 'react-native-reanimated';
import { FullscreenRouteSafeArea } from '@/components/sheet-route-frame';
import { routeSceneEnter, type RouteSceneType } from '@/lib/motion';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

/** The stable surface shared by root pages and custom routes.
 * Native navigation owns swipe back and cancellation. Classic keeps its legacy
 * entry reveal; the new profiles use only the native route transition. Never
 * swap the wrapper type when the profile changes: it owns live workspaces.
 * Form sheets bypass this wrapper to retain their native measurement contract.
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
  const profile = useAppearanceProfile();
  const content = modal ? <FullscreenRouteSafeArea>{children}</FullscreenRouteSafeArea> : children;
  const effectiveSceneType: RouteSceneType = modal ? 'modal' : (sceneType ?? 'plain');

  return (
    <View style={[styles.viewport, { backgroundColor: colors.background }]}>
      <Animated.View
        style={styles.scene}
        entering={
          animated && profile.id === 'classic' ? routeSceneEnter(effectiveSceneType) : undefined
        }>
        {content}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
  scene: { flex: 1 },
});
