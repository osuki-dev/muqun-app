import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Text } from '@/components/text';
import { useHomeScenePlate } from '@/hooks/use-home-scene-plate';

/**
 * "Show more" / "Show less" under a Home list, outside its surface.
 *
 * The link stands on the page, not in the card, so on a pack's scene it takes
 * the same plate as Home's section headings: the plate is the text's own, the
 * 44pt press target around it stays clear.
 */
export function HomeFoldLink({
  expanded,
  onPress,
  testID,
  style,
}: {
  expanded: boolean;
  onPress: () => void;
  testID: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useHomeScenePlate();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={[styles.more, style]}>
      <View style={plate}>
        <Text variant="bodySmall" color={theme.colors.primary}>
          {expanded ? t`Show less` : t`Show more`}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  more: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
});
