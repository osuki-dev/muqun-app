import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { OpenCodeIcon } from '@/components/opencode-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';

export function NewTaskAction({ label }: { serverId: string; label: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const router = useRouter();

  return (
    <PressableScale
      testID="server-opencode-action"
      accessibilityRole="button"
      accessibilityLabel={t`Open OpenCode Agent on ${label}`}
      onPress={() => router.push('/agent')}
      style={[styles.button, { backgroundColor: surfaceBackground(theme.colors.primarySubtle) }]}>
      <OpenCodeIcon size={18} color={theme.colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
