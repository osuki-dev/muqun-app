import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { HomeTarget } from '@/lib/home-recents';
import { homeContinueEntries, type HomeContinueEntry } from '@/lib/home-continue';
import { useServerAgents } from '@/stores/server-agents';
import { useAppSettings } from '@/stores/app-settings';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useHomeRecentsStore } from '@/stores/home-recents';

/** Shared Classic pane inventory, ranked by explicit visits without recording synthetic visits. */
export function HomeRecentSessions({
  servers,
  hosts,
  onOpen,
  onOpenPane,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  onOpen: (target: HomeTarget) => void;
  onOpenPane: (serverId: string, paneId?: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const entries = useHomeRecentsStore((state) => state.entries);
  const hydrated = useHomeRecentsStore((state) => state.hydrated);
  const [expanded, setExpanded] = useState(false);
  const snapshots = useServerAgents((state) => state.byServer);
  const snapshotsHydrated = useServerAgents((state) => state.hydrated);
  const paneMode = useAppSettings((state) => state.serverCardPanes);
  // oxlint-disable-next-line react/purity -- same snapshot clock semantics as Classic.
  const nowMs = Date.now();
  const available = homeContinueEntries({
    serverIds: servers.map((server) => server.serverId),
    hostIds: hosts.map((host) => host.id),
    snapshots,
    recents: entries,
    paneMode,
    nowMs,
  });
  return (
    <View testID="home-recent-sessions" style={styles.list}>
      {available.slice(0, expanded ? available.length : 3).map((entry, index) => (
        <RecentSessionRow
          key={entry.key}
          entry={entry}
          number={index + 1}
          serverLabel={
            servers.find(
              (server) =>
                server.serverId ===
                (entry.destination.type === 'pane'
                  ? entry.destination.serverId
                  : entry.destination.target.kind === 'ssh-host'
                    ? undefined
                    : entry.destination.target.serverId)
            )?.label
          }
          onOpen={() => {
            if (entry.destination.type === 'pane')
              onOpenPane(entry.destination.serverId, entry.destination.paneId);
            else onOpen(entry.destination.target);
          }}
        />
      ))}
      {available.length === 0 ? (
        <Text variant="bodySmall" color={theme.colors.textMuted}>
          {hydrated && snapshotsHydrated ? t`Nothing to show yet.` : t`Loading recent sessions…`}
        </Text>
      ) : null}
      {available.length > 3 ? (
        <PressableScale
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          style={styles.more}>
          <Text variant="bodySmall" color={theme.colors.primary}>
            {expanded ? t`Show less` : `${t`Sessions`} (${available.length})`}
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
  entry: HomeContinueEntry;
  number: number;
  serverLabel?: string;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const target = entry.destination.type === 'recent' ? entry.destination.target : undefined;
  const cwd =
    entry.destination.type === 'pane'
      ? entry.destination.cwd
      : target?.kind === 'opencode-session'
        ? target.directory
        : undefined;
  const kind =
    target?.kind === 'opencode-session'
      ? t`OpenCode session`
      : !target || target.kind === 'gateway-terminal'
        ? t`Terminal`
        : t`SSH host`;
  const title = entry.title || kind;
  return (
    <PressableScale
      testID="home-recent-open"
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${kind}${serverLabel ? `, ${serverLabel}` : ''}`}
      onPress={onOpen}
      style={[
        styles.row,
        {
          borderBottomColor: theme.colors.border,
          backgroundColor: background(theme.colors.surface),
        },
      ]}>
      <View style={styles.open}>
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
          {cwd ? (
            <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
              {cwd}
            </Text>
          ) : null}
        </View>
        <ChevronRight size={16} color={theme.colors.primary} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: { minWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  open: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 64,
  },
  number: { minWidth: 48, fontSize: 36, lineHeight: 44, letterSpacing: -1 },
  copy: { minWidth: 0, flex: 1, gap: 4 },
  more: { minHeight: 44, justifyContent: 'center', paddingVertical: 12 },
});
