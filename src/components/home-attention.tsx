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
import {
  homeContinueComputerLabel,
  homeContinueMetaParts,
  homePathLabel,
  META_SEPARATOR,
} from '@/lib/home-continue-row';
import { agentDisplayName } from '@/lib/home-launch-model';
import { homeTargetAgentId, type HomeTarget } from '@/lib/home-recents';
import type { HomeAttentionSnapshot } from '@/lib/home-attention';
import { useAgents } from '@/stores/agents';
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
      {pending.map(([key, snapshot]) => (
        <AttentionRow key={key} snapshot={snapshot} servers={servers} onOpen={onOpen} />
      ))}
    </View>
  );
}

function AttentionRow({
  snapshot,
  servers,
  onOpen,
}: {
  snapshot: HomeAttentionSnapshot;
  servers: readonly GatewayRecord[];
  onOpen: (target: HomeTarget) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const { i18n } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { target } = snapshot;
  const agents = useAgents((state) => state.index.servers[target.serverId]?.agents?.agents);
  const count = snapshot.requestIds.length;
  const when = new Date(snapshot.observedAt).toLocaleString(i18n.locale, OBSERVATION_DATE_FORMAT);
  // The same meta line as a Continue row: agent · computer · path.
  const meta = homeContinueMetaParts({
    kind: agentDisplayName(agents, homeTargetAgentId(target)),
    computer: homeContinueComputerLabel(servers, target.serverId),
    path: target.directory ? homePathLabel(target.directory) : undefined,
  })
    .map((part) => part.text)
    .join(META_SEPARATOR);
  return (
    <PressableScale
      testID="home-attention-open"
      accessibilityRole="button"
      onPress={() => onOpen(target)}
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
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {meta}
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
