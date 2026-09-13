import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { View } from 'react-native';

import { Button } from '@/components/themed-button';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

/** A failed secure read is not an empty list and must not suggest pairing again. */
export function GatewayStorageError({
  busy,
  onRetry,
}: {
  busy: boolean;
  onRetry: () => Promise<void>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  return (
    <View
      testID="gateway-storage-error"
      style={{
        padding: 16,
        gap: 12,
        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
        borderRadius: 12,
      }}>
      <Text variant="bodySmall" selectable accessibilityRole="alert">
        {t`Could not read saved servers. Your saved data has not been changed. Unlock this device and retry.`}
      </Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        {t`If this continues, restart the app or check the app installation`}
      </Text>
      <Button
        testID="gateway-storage-retry"
        variant="secondary"
        disabled={busy}
        onPress={() => void onRetry()}>
        {busy ? t`Loading` : t`Retry`}
      </Button>
    </View>
  );
}
