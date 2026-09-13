import { Text, useThemeTokens } from '@osuki-dev/ui';
import { View } from 'react-native';

import { formatAssetSize } from '@/lib/asset-display';

/**
 * The named step of a slow import, so waiting never looks like nothing.
 *
 * A step that knows its total draws a bar; one that does not draws its name
 * alone rather than a bar that cannot move. Fetching a manifest and installing
 * images are both single opaque waits, and a bar stuck at zero reads as failure.
 */
export function ThemeImportProgress({
  label,
  completed,
  total,
  receivedBytes,
  testID,
}: {
  label: string;
  completed?: number;
  total?: number;
  receivedBytes?: number;
  testID?: string;
}) {
  const { colors } = useThemeTokens();
  const measured = typeof completed === 'number' && typeof total === 'number' && total > 0;
  const fraction = measured ? Math.min(1, Math.max(0, completed / total)) : 0;
  const transferred = receivedBytes ? formatAssetSize(receivedBytes) : '';
  return (
    <View testID={testID} accessibilityLiveRegion="polite" style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text variant="caption" style={{ flex: 1, minWidth: 0 }}>
          {label}
        </Text>
        {measured ? (
          <Text
            variant="caption"
            color={colors.textMuted}
            style={{ fontVariant: ['tabular-nums'] }}>
            {completed}/{total}
          </Text>
        ) : null}
      </View>
      {measured ? (
        <View
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: total, now: completed }}
          style={{
            height: 4,
            borderRadius: 2,
            overflow: 'hidden',
            backgroundColor: colors.surfaceRaised,
          }}>
          <View
            style={{
              width: `${fraction * 100}%`,
              height: '100%',
              backgroundColor: colors.primary,
            }}
          />
        </View>
      ) : null}
      {transferred ? (
        <Text variant="caption" color={colors.textMuted}>
          {transferred}
        </Text>
      ) : null}
    </View>
  );
}
