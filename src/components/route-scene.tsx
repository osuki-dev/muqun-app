import { type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { FullscreenRouteSafeArea } from '@/components/sheet-route-frame';

/** A stable surface shared by root pages. Native navigation owns reveal, back and
 * cancellation; this layer never snapshots a terminal or mounts a second one.
 * Form sheets bypass this wrapper to retain their native measurement contract.
 */
export function RouteScene({ children, modal = false }: { children: ReactNode; modal?: boolean }) {
  const { colors } = useThemeTokens();
  // The native stack owns the transition. Transforming the entire subtree
  // also rescales live glass, wallpaper and terminal canvases on every frame.
  return (
    <View style={[styles.viewport, { backgroundColor: colors.background }]}>
      {modal ? <FullscreenRouteSafeArea>{children}</FullscreenRouteSafeArea> : children}
    </View>
  );
}
const styles = StyleSheet.create({
  viewport: { flex: 1, overflow: 'hidden' },
});
