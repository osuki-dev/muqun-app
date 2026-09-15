import { Text, useThemeTokens } from '@osuki-dev/ui';
import { StyleSheet, View } from 'react-native';
import { useSheetGroundPlate } from '@/components/sheet-ground';

/** Shared title and supporting copy, protected from custom wallpaper. */
export function SheetHeading({ title, caption }: { title: string; caption?: string }) {
  const { colors } = useThemeTokens();
  const plate = useSheetGroundPlate();
  return (
    <View style={styles.container}>
      <View style={[styles.copy, plate]}>
        <Text variant="bodySmall" style={styles.title}>
          {title}
        </Text>
        {caption ? (
          <Text variant="caption" color={colors.textMuted}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, minWidth: 0 },
  copy: { gap: 2, maxWidth: '100%' },
  title: { fontSize: 20, lineHeight: 25, includeFontPadding: false },
});
