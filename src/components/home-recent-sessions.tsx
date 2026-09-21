import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { hasRealSessionTitle } from '@/lib/agent-protocol';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { listAgentSessionsObserved } from '@/lib/agent-session';
import type { HomeTarget } from '@/lib/home-recents';
import {
  homeContinueEntries,
  shouldShowHomeContinueOverflow,
  visibleHomeContinueEntries,
  type HomeContinueEntry,
} from '@/lib/home-continue';
import { agentStatusWord } from '@/i18n/labels';
import { agentStatusTone } from '@/lib/herdr-entity';
import type { ActiveServerConnection, ServerReachability } from '@/lib/server-reachability';
import { useServerAgents } from '@/stores/server-agents';
import { useAppSettings } from '@/stores/app-settings';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';

const HOME_SESSION_REFRESH_MS = 30_000;

/** Shared Classic pane inventory, ranked by explicit visits without recording synthetic visits. */
export function HomeRecentSessions({
  servers,
  hosts,
  reachabilityByServer,
  activeConnection,
  onOpen,
  onOpenPane,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  activeConnection?: ActiveServerConnection;
  onOpen: (target: HomeTarget) => void;
  onOpenPane: (serverId: string, paneId?: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const entries = useHomeRecentsStore((state) => state.entries);
  const hydrated = useHomeRecentsStore((state) => state.hydrated);
  const [expanded, setExpanded] = useState(false);
  const [observationNowMs, setObservationNowMs] = useState(Date.now);
  const snapshots = useServerAgents((state) => state.byServer);
  const snapshotsHydrated = useServerAgents((state) => state.hydrated);
  const paneMode = useAppSettings((state) => state.serverCardPanes);
  const openCodeScopes = useMemo(() => {
    if (!activeConnection || activeConnection.phase !== 'connected') return [];
    const seen = new Set<string>();
    return entries.flatMap((entry) => {
      const target = entry.target;
      if (target.kind !== 'opencode-session' || target.serverId !== activeConnection.serverId) {
        return [];
      }
      const key = JSON.stringify([target.sessionId, target.directory]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ sessionId: target.sessionId, directory: target.directory }];
    });
  }, [activeConnection, entries]);
  const openCodeScopeKey = JSON.stringify(openCodeScopes);
  const refreshOpenCodeObservations = useCallback(async () => {
    if (!activeConnection || activeConnection.phase !== 'connected') return;
    const serverId = activeConnection.serverId;
    const recentEntries = useHomeRecentsStore.getState().entries;
    const scopes = JSON.parse(openCodeScopeKey) as {
      sessionId: string;
      directory: string;
    }[];
    await Promise.all(
      scopes.map(async ({ sessionId, directory }) => {
        const result = await listAgentSessionsObserved(sessionId, {
          roots: true,
          directory,
          limit: 50,
          order: 'desc',
        });
        if (
          useGatewayConnectionStore.getState().record?.serverId !== serverId ||
          result.observedAtMs === undefined
        ) {
          return;
        }
        const byAsid = new Map(result.sessions.map((info) => [info.asid, info]));
        for (const entry of recentEntries) {
          const target = entry.target;
          if (
            target.kind !== 'opencode-session' ||
            target.serverId !== serverId ||
            target.sessionId !== sessionId ||
            target.directory !== directory
          ) {
            continue;
          }
          const info = byAsid.get(target.asid);
          if (!info || info.parent_id || info.deleted) continue;
          const store = useHomeRecentsStore.getState();
          if (hasRealSessionTitle(info)) void store.updateTitle(target, info.title);
          void store.observeSession(target, {
            status: info.status,
            observedAtMs: result.observedAtMs,
          });
        }
      })
    );
  }, [activeConnection, openCodeScopeKey]);
  useFocusEffect(
    useCallback(() => {
      setObservationNowMs(Date.now());
      void refreshOpenCodeObservations();
      const timer = setInterval(() => {
        setObservationNowMs(Date.now());
        void refreshOpenCodeObservations();
      }, HOME_SESSION_REFRESH_MS);
      return () => clearInterval(timer);
    }, [refreshOpenCodeObservations])
  );
  const available = homeContinueEntries({
    serverIds: servers.map((server) => server.serverId),
    hostIds: hosts.map((host) => host.id),
    snapshots,
    recents: entries,
    reachabilityByServer,
    paneMode,
    nowMs: observationNowMs,
  });
  const displayed = visibleHomeContinueEntries(available, expanded);
  return (
    <View testID="home-recent-sessions" style={styles.root}>
      <View
        style={[
          styles.list,
          {
            backgroundColor: background(theme.colors.surface),
            borderRadius: profile.chrome.surface,
          },
        ]}>
        {displayed.map((entry, index) => (
          <RecentSessionRow
            key={entry.key}
            entry={entry}
            number={index + 1}
            hasSeparator={index < displayed.length - 1}
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
      </View>
      {shouldShowHomeContinueOverflow(available) ? (
        <PressableScale
          testID="home-recent-sessions-more"
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
  hasSeparator,
  serverLabel,
  onOpen,
}: {
  entry: HomeContinueEntry;
  number: number;
  hasSeparator: boolean;
  serverLabel?: string;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
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
  const metadataKind = entry.agentLabel ? `${kind} · ${entry.agentLabel}` : kind;
  const observation = entry.observation;
  const status = observation?.status;
  const statusLabel = status
    ? observation?.kind === 'opencode-session'
      ? status === 'busy'
        ? t`Running`
        : status === 'idle'
          ? t`Idle`
          : status === 'failed'
            ? t`The turn failed`
            : status === 'interrupted'
              ? t`Stopped`
              : status === 'retry'
                ? t`Retrying…`
                : t`Status unknown`
      : _(agentStatusWord[status] ?? agentStatusWord.unknown)
    : undefined;
  const statusTone =
    observation?.kind === 'opencode-session'
      ? status === 'busy' || status === 'retry'
        ? 'info'
        : status === 'failed'
          ? 'danger'
          : status === 'interrupted'
            ? 'warning'
            : 'textSubtle'
      : agentStatusTone(status);
  const age = observation?.age;
  let seenLabel: string | undefined;
  if (age?.unit === 'now') seenLabel = t`Seen just now`;
  else if (age?.unit === 'minute') {
    // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
    seenLabel = t`Seen ${age.value}m ago`;
  } else if (age?.unit === 'hour') {
    // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
    seenLabel = t`Seen ${age.value}h ago`;
  } else if (age?.unit === 'day') {
    // react-doctor-disable-next-line react-hooks-js/todo -- Lingui expands this macro before React Compiler runs.
    seenLabel = t`Seen ${age.value}d ago`;
  }
  const observationLabel = [statusLabel, seenLabel].filter(Boolean).join(' · ');
  return (
    <PressableScale
      testID="home-recent-open"
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${metadataKind}${serverLabel ? `, ${serverLabel}` : ''}${observationLabel ? `, ${observationLabel}` : ''}`}
      onPress={onOpen}
      style={[
        styles.row,
        hasSeparator && {
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        {
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
            {metadataKind}
            {serverLabel ? ` · ${serverLabel}` : ''}
          </Text>
          {cwd ? (
            <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
              {cwd}
            </Text>
          ) : null}
          {observationLabel ? (
            <View style={styles.observation}>
              {status ? <StatusDot color={theme.colors[statusTone]} filled size={6} /> : null}
              <Text
                variant="caption"
                color={status ? theme.colors[statusTone] : theme.colors.textSubtle}
                style={styles.observationText}
                numberOfLines={1}>
                {observationLabel}
              </Text>
            </View>
          ) : null}
        </View>
        <ChevronRight size={16} color={theme.colors.primary} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { minWidth: 0 },
  list: { minWidth: 0, borderRadius: 6, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
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
  observation: { minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  observationText: { minWidth: 0, flex: 1 },
  more: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
});
