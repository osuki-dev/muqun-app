import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, X } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { HomeRecentEntry, HomeTarget } from '@/lib/home-recents';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useHomeRecentsStore } from '@/stores/home-recents';

/** Explicit visits only. Running output never bumps a session to the top. */
export function HomeRecentSessions({
  servers,
  hosts,
  onOpen,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  onOpen: (target: HomeTarget) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const entries = useHomeRecentsStore((state) => state.entries);
  const hydrated = useHomeRecentsStore((state) => state.hydrated);
  const [expanded, setExpanded] = useState(false);
  const available = entries.filter(({ target }) =>
    target.kind === 'ssh-host'
      ? hosts.some((host) => host.id === target.hostId)
      : servers.some((server) => server.serverId === target.serverId)
  );
  return (
    <View testID="home-recent-sessions" style={styles.list}>
      {available.slice(0, expanded ? available.length : 6).map((entry, index) => (
        <RecentSessionRow
          key={entry.key}
          entry={entry}
          number={index + 1}
          serverLabel={
            entry.target.kind === 'ssh-host'
              ? undefined
              : servers.find(
                  (server) =>
                    entry.target.kind !== 'ssh-host' && server.serverId === entry.target.serverId
                )?.label
          }
          onOpen={onOpen}
        />
      ))}
      {available.length === 0 ? (
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {hydrated ? t`Sessions you open will appear here.` : t`Loading recent sessions…`}
        </Text>
      ) : null}
      {available.length > 6 ? (
        <PressableScale
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          style={styles.more}>
          <Text variant="bodySmall" color={theme.colors.primary}>
            {expanded ? t`Show less` : t`Show all recent sessions`}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function RecentSessionRow({
  entry,
  number,
  serverLabel,
  onOpen,
}: {
  entry: HomeRecentEntry;
  number: number;
  serverLabel?: string;
  onOpen: (target: HomeTarget) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const kind =
    entry.target.kind === 'opencode-session'
      ? t`OpenCode session`
      : entry.target.kind === 'gateway-terminal'
        ? t`Terminal`
        : t`SSH host`;
  const title = entry.title || kind;
  return (
    <View style={[styles.row, { borderBottomColor: theme.colors.border }]}>
      <PressableScale
        testID="home-recent-open"
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${kind}${serverLabel ? `, ${serverLabel}` : ''}`}
        onPress={() => onOpen(entry.target)}
        style={styles.open}>
        <Text variant="heading" color={theme.colors.primary} style={styles.number}>
          {String(number).padStart(2, '0')}
        </Text>
        <View style={styles.copy}>
          <Text variant="bodySmall" weight="semibold" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
            {kind}
            {serverLabel ? ` · ${serverLabel}` : ''}
          </Text>
          {entry.target.kind === 'opencode-session' && entry.target.directory ? (
            <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
              {entry.target.directory}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={16} color={theme.colors.primary} />
      </PressableScale>
      <PressableScale
        testID="home-recent-remove"
        accessibilityRole="button"
        accessibilityLabel={t`Remove ${title} from recents`}
        onPress={() => {
          void useHomeRecentsStore.getState().remove(entry.target);
        }}
        style={styles.remove}>
        <X size={15} color={theme.colors.textSubtle} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { minWidth: 0 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  open: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    minHeight: 64,
  },
  number: { minWidth: 32 },
  copy: { minWidth: 0, flex: 1, gap: 4 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  more: { minHeight: 44, justifyContent: 'center', paddingVertical: 12 },
});
