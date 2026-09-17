import { useThemeTokens } from '@osuki-dev/ui';
import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  useSafeAreaFrame,
} from 'react-native-safe-area-context';
import {
  SheetGround,
  SheetGroundProvidedContext,
  type SheetGroundTint,
} from '@/components/sheet-ground';

const FullscreenSheetContext = createContext(false);

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

/** Fullscreen sheet content gets safe edges and no misleading drag handle. */
export function FullscreenSheetFrame({
  children,
  tint = 'surface',
}: {
  children: ReactNode;
  tint?: SheetGroundTint;
}) {
  return (
    <FullscreenSheetContext.Provider value>
      <View style={{ flex: 1 }}>
        <SheetGround tint={tint} />
        <SheetGroundProvidedContext.Provider value>
          <SafeAreaView style={{ flex: 1 }}>{children}</SafeAreaView>
        </SheetGroundProvidedContext.Provider>
      </View>
    </FullscreenSheetContext.Provider>
  );
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
  const { colors } = useThemeTokens();
  const fullscreen = useContext(FullscreenSheetContext);
  if (fullscreen || process.env.EXPO_OS !== 'android') return null;
  return (
    <View
      accessible={false}
      style={[sheetHandleStyles.handle, { backgroundColor: colors.borderStrong }, style]}
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
