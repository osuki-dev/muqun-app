import { createContext, useContext, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
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

export function SheetHandle({ style }: { style?: StyleProp<ViewStyle> }) {
  const fullscreen = useContext(FullscreenSheetContext);
  if (fullscreen || process.env.EXPO_OS !== 'android') return null;
  return <View accessible={false} style={style} />;
}
