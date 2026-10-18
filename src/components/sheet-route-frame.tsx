import { useThemeTokens } from '@osuki-dev/ui';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { createContext, useContext, type ReactNode } from 'react';
import { useRouter, type NativeStackNavigationOptions } from 'expo-router';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { PAD_SETTINGS_SHEET_WIDTH } from '@/lib/route-presentation';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  useSafeAreaFrame,
} from 'react-native-safe-area-context';

/**
 * Android keeps the native sheet host full width even when its content is a
 * centered card. Put dismiss targets in that host's transparent side gutters.
 * The card stays first for native scroll discovery; the absolute gutters cost
 * no height, so fitToContents still measures only the scene's own column.
 */
export function SheetRouteFrame({
  children,
  detents,
}: {
  children: ReactNode;
  detents: NativeStackNavigationOptions['sheetAllowedDetents'];
}) {
  const router = useRouter();
  const profile = useAppearanceProfile();
  const sizing = detents === 'fitToContents' ? undefined : routeFrameStyles.fill;
  return (
    <View collapsable={false} pointerEvents="box-none" style={sizing}>
      <View
        collapsable={false}
        style={[
          routeFrameStyles.card,
          sizing,
          {
            borderTopLeftRadius: profile.chrome.sheet,
            borderTopRightRadius: profile.chrome.sheet,
          },
        ]}>
        {children}
      </View>
      {/* Invisible hit regions are not extra screen-reader controls. Native
          back/dismiss remains available, without reading two empty buttons. */}
      <Pressable
        testID="sheet-dismiss-left-gutter"
        accessible={false}
        importantForAccessibility="no"
        style={[routeFrameStyles.gutter, routeFrameStyles.leftGutter]}
        onPress={() => router.back()}
      />
      <Pressable
        testID="sheet-dismiss-right-gutter"
        accessible={false}
        importantForAccessibility="no"
        style={[routeFrameStyles.gutter, routeFrameStyles.rightGutter]}
        onPress={() => router.back()}
      />
    </View>
  );
}

const routeFrameStyles = StyleSheet.create({
  fill: { flex: 1 },
  card: {
    width: '100%',
    maxWidth: PAD_SETTINGS_SHEET_WIDTH,
    alignSelf: 'center',
    overflow: 'hidden',
  },
  gutter: { position: 'absolute', top: 0, bottom: 0 },
  leftGutter: { left: 0, right: '50%', marginRight: PAD_SETTINGS_SHEET_WIDTH / 2 },
  rightGutter: { right: 0, left: '50%', marginLeft: PAD_SETTINGS_SHEET_WIDTH / 2 },
});

/** Native full-screen modals own a measured safe-area coordinate space. */
export function FullscreenRouteSafeArea({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  return (
    <SafeAreaProvider initialMetrics={{ insets, frame }} style={{ flex: 1 }}>
      {children}
    </SafeAreaProvider>
  );
}

/**
 * Whether the sheet under this subtree is being shown full-screen.
 *
 * Set by the root stack's `screenLayout` for a sheet route that a Pad presents
 * as a `fullScreenModal` (`isFullscreenSheetRoute`). A full-screen modal has no
 * grabber and no swipe, so the scene draws a close button and status-bar
 * clearance instead, and `SheetHandle` draws nothing.
 */
const SheetFullscreenContext = createContext(false);

export const SheetFullscreenProvider = SheetFullscreenContext.Provider;

export function useSheetIsFullscreen(): boolean {
  return useContext(SheetFullscreenContext);
}

/**
 * The grabber Android's form sheet does not draw for itself.
 *
 * The geometry and the colour are defaults rather than a caller's business:
 * every sheet that spelled them out arrived at the same 38x4 pill, and the
 * colour they all typed was a fixed mid-grey, which is a grey that is wrong in
 * both light and dark. `borderStrong` is the token the switch track and the
 * emphasised rule already use, so the handle moves with the pack. A `style` is
 * still merged last, for the sheets that need a different margin.
 */
export function SheetHandle({ style }: { style?: StyleProp<ViewStyle> }) {
  const profile = useAppearanceProfile();
  const { colors } = useThemeTokens();
  const fullscreen = useSheetIsFullscreen();
  if (process.env.EXPO_OS !== 'android' || fullscreen) return null;
  return (
    <View
      accessible={false}
      style={[
        sheetHandleStyles.handle,
        { backgroundColor: colors.borderStrong, borderRadius: Math.min(2, profile.radius.xs) },
        style,
      ]}
    />
  );
}

const sheetHandleStyles = StyleSheet.create({
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
});
