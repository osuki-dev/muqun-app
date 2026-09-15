import type { ReactNode } from 'react';
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

/** The enclosing full-screen route owns safe-area padding and artwork. */
export function FullscreenSettingsSheet({
  header,
  contentStyle,
  children,
}: {
  header: ReactNode;
  contentStyle: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={[contentStyle, { paddingBottom: 0 }]}>{header}</View>
      <ScrollView
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ flexGrow: 1, width: '100%' }}>
        <View style={contentStyle}>{children}</View>
      </ScrollView>
    </View>
  );
}
