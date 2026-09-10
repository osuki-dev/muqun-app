import { Text, useThemeTokens } from '@osuki-dev/ui';
import { View } from 'react-native';

/** Bundled instructions travel with the task, not in the text field or route. */
export function AgentCommandSummary({ name, description }: { name: string; description?: string }) {
  const { colors } = useThemeTokens();
  return (
    <View
      testID="agent-command-summary"
      style={{ padding: 16, gap: 8, borderRadius: 16, backgroundColor: colors.surfaceRaised }}>
      <Text variant="bodySmall">{name}</Text>
      {description ? (
        <Text selectable variant="caption" color={colors.textMuted}>
          {description}
        </Text>
      ) : null}
    </View>
  );
}
