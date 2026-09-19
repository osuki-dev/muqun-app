import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, CircleAlert } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
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
  const { i18n } = useLinguiRuntime();
  const theme = useThemeTokens();
  const observations = useHomeAttention((state) => state.byTarget);
  const pending = Object.entries(observations).filter(
    ([, snapshot]) =>
      snapshot.requestIds.length > 0 &&
      servers.some((server) => server.serverId === snapshot.target.serverId)
  );
  if (pending.length === 0) {
    return (
      <Text variant="caption" color={theme.colors.textMuted}>
        {t`Open a session to check its requests.`}
      </Text>
    );
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
            style={[styles.row, { borderColor: theme.colors.borderStrong }]}>
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
            <ChevronRight size={16} color={theme.colors.primary} />
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, minWidth: 0 },
  row: {
    minHeight: 64,
    padding: 14,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
});
