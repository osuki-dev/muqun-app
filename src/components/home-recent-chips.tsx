import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { ScrollView, StyleSheet } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GatewayRecord } from '@/lib/gateway-storage';

/** Recent's filter: every row, or one computer's. */
export function HomeRecentChips({
  servers,
  serverIds,
  value,
  onChange,
}: {
  servers: readonly GatewayRecord[];
  serverIds: readonly string[];
  value: string | null;
  onChange: (serverId: string | null) => void;
}) {
  const { t } = useLingui();
  const chips: { id: string | null; label: string }[] = [
    { id: null, label: t`All` },
    ...serverIds.map((serverId) => ({
      id: serverId,
      label: servers.find((server) => server.serverId === serverId)?.label ?? serverId,
    })),
  ];
  return (
    <ScrollView
      horizontal
      testID="home-recent-chips"
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.row}>
      {chips.map((chip) => (
        <Chip
          key={chip.id ?? 'all'}
          testID={`home-recent-chip-${chip.id ?? 'all'}`}
          label={chip.label}
          selected={chip.id === value}
          onPress={() => onChange(chip.id)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  testID,
  label,
  selected,
  onPress,
}: {
  testID: string;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  return (
    <PressableScale
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderRadius: profile.chrome.control,
          // The same two fills as the launch tiles above: the chosen chip is
          // solid primary, the rest are surface. A primary tint over the
          // wallpaper read as a hollow outline.
          backgroundColor: background(selected ? theme.colors.primary : theme.colors.surface),
        },
      ]}>
      <Text
        variant="caption"
        weight={selected ? 'semibold' : undefined}
        color={selected ? theme.colors.onPrimary : theme.colors.textMuted}
        numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingBottom: 8 },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    maxWidth: 200,
  },
});
