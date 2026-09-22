import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, CircleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { HomeTarget } from '@/lib/home-recents';
import { useHomeAttention } from '@/stores/home-attention';

const OBSERVATION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** An open-only summary. Permission decisions remain in the source workbench. */
export function HomeAttention({
  servers,
  onOpen,
}: {
  servers: readonly GatewayRecord[];
  onOpen: (target: HomeTarget) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const { i18n } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const observations = useHomeAttention((state) => state.byTarget);
  const pending = Object.entries(observations).filter(
    ([, snapshot]) =>
      snapshot.requestIds.length > 0 &&
      servers.some((server) => server.serverId === snapshot.target.serverId)
  );
  if (pending.length === 0) {
    return null;
  }
  return (
    <View testID="home-attention" style={styles.list}>
      {pending.map(([key, snapshot]) => {
        const count = snapshot.requestIds.length;
        const when = new Date(snapshot.observedAt).toLocaleString(
          i18n.locale,
          OBSERVATION_DATE_FORMAT
        );
        const server = servers.find((entry) => entry.serverId === snapshot.target.serverId);
        return (
          <PressableScale
            key={key}
            testID="home-attention-open"
            accessibilityRole="button"
            onPress={() => onOpen(snapshot.target)}
            style={[
              styles.row,
              {
                backgroundColor: background(theme.colors.surface),
                borderColor: theme.colors.borderStrong,
                borderLeftColor: theme.colors.warning,
                borderRadius: profile.chrome.noticeCard,
              },
            ]}>
            <CircleAlert size={20} color={theme.colors.warning} />
            <View style={styles.copy}>
              <Text weight="semibold" variant="bodySmall">
                {t`${count} requests last observed`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
                {server?.label} · {snapshot.target.directory}
              </Text>
              <Text variant="caption" color={theme.colors.textSubtle}>
                {t`Last checked ${when}`}
              </Text>
              <Text variant="caption" color={theme.colors.textSubtle}>
                {t`Open to check the current state`}
              </Text>
            </View>
            <ThemeIcon name="home.arrow" fallback={ChevronRight} size={16} color={theme.colors.primary} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, minWidth: 0, marginTop: 16, marginBottom: 8 },
  row: {
    minHeight: 64,
    padding: 14,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
});
