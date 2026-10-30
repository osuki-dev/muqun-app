import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { View } from 'react-native';
import { PressableScale } from './pressable-scale';

/** Activation failures leave the reader's cached conversation in place. */
export function AgentSessionActivationNotice({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (!error) return null;
  return (
    <View testID="agent-session-activation-error" style={{ gap: 4, padding: 12 }}>
      <Text variant="caption" color={theme.colors.danger}>{t`Could not resume the session`}</Text>
      <Text selectable variant="caption" color={theme.colors.textMuted}>
        {error instanceof Error ? error.message : t`Something went wrong`}
      </Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Retry`}
        onPress={onRetry}
        style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text variant="caption" color={theme.colors.primary}>{t`Retry`}</Text>
      </PressableScale>
    </View>
  );
}
