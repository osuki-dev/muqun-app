import { useLingui } from '@lingui/react/macro';
import { AGENT_ERROR_MESSAGE_LIMIT, agentRequestErrorDetail } from '@/lib/agent-request-error';
import { describeConnectionError } from '@/lib/network-error';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { View } from 'react-native';
import { PressableScale } from './pressable-scale';

/** Activation failures leave the reader's cached conversation in place. */
export function AgentSessionActivationNotice({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (!error) return null;
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message =
    describeConnectionError(error) ??
    agentRequestErrorDetail(error).message ??
    (raw.trim()
      ? raw.trim().split(/\r?\n/, 1)[0]!.slice(0, AGENT_ERROR_MESSAGE_LIMIT)
      : t`Something went wrong`);
  return (
    <View testID="agent-session-activation-error" style={{ gap: 4, padding: 12 }}>
      <Text variant="caption" color={theme.colors.danger}>
        {title ?? t`Could not resume the session`}
      </Text>
      <Text selectable variant="caption" color={theme.colors.textMuted}>
        {message}
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
