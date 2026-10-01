import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AgentMark } from '@/components/agent-mark';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  HOME_CONTINUE_REFRESH_MS,
  refreshHomeContinue,
  refreshHomeGateways,
} from '@/lib/home-continue-refresh';
import { useAppActive } from '@/hooks/use-app-active';
import { loadRecordSessions, readGatewayRecordJson } from '@/lib/gateway-client';
import { resolveSessionId, sessionChoices } from '@/lib/session-switcher';
import { useServerSession } from '@/stores/server-session';
import { isDemoRecord } from '@/lib/demo-gateway';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { HomeCommand } from '@/lib/home-commands';
import { findAgent } from '@/lib/agent-discovery';
import { agentDisplayName } from '@/lib/home-launch-model';
import { useAgents } from '@/stores/agents';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import {
  agentSessionStatusPresentation,
  homeContinueCommand,
  homeContinueEntries,
  homeContinueKind,
  homeContinueTarget,
  shouldShowHomeContinueOverflow,
  visibleHomeContinueEntries,
  type HomeContinueEntry,
} from '@/lib/home-continue';
import { agentSessionStatusWord, agentStatusWord } from '@/i18n/labels';
import { agentStatusTone } from '@/lib/herdr-entity';
import type { ActiveServerConnection, ServerReachability } from '@/lib/server-reachability';
import { useServerAgents } from '@/stores/server-agents';
import { useAppSettings } from '@/stores/app-settings';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/** Shared Classic pane inventory, ranked by explicit visits without recording synthetic visits. */
export function HomeRecentSessions({
  servers,
  hosts,
  reachabilityByServer,
  activeConnection,
  selectedServerId,
  compact = false,
  selectedPaneId,
  selectedAsid,
  onOpen,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  activeConnection?: ActiveServerConnection;
  selectedServerId?: string;
  compact?: boolean;
  selectedPaneId?: string;
  selectedAsid?: string;
  /** Runs the row's Home command; see `homeContinueCommand`. */
  onOpen: (command: HomeCommand) => void;
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
  const targetId = selectedServerId ?? activeConnection?.serverId;
  const agentSessions = useHomeAgentSessions((state) =>
    targetId ? state.byServer[targetId] : undefined
  );
  const appActive = useAppActive();
  const refreshFlight = useRef<Promise<void>>(Promise.resolve());
  useFocusEffect(
    useCallback(() => {
      if (!appActive || !hydrated) return;
      let current = true;
      let pending = false;
      const isCurrent = () => current && AppState.currentState === 'active';
      const refresh = async () => {
        if (!isCurrent() || pending) return;
        pending = true;
        // Drain older reads before starting another batch after a focus/target change.
        const flight = refreshFlight.current.then(async () => {
          if (!isCurrent()) return;
          await refreshHomeGateways({
            records: servers.filter((server) => !isDemoRecord(server)),
            selectedServerId: targetId,
            isCurrent,
            refresh: async (targetRecord) => {
              const inventory = await loadRecordSessions(targetRecord);
              if (!isCurrent()) return;
              const choices = sessionChoices(inventory.sessions);
              const sessionId = resolveSessionId(
                choices.length ? choices : sessionChoices(inventory.sessions, true),
                useServerSession.getState().byServer[targetRecord.serverId]
              );
              const recent = useHomeRecentsStore.getState();
              await refreshHomeContinue({
                serverId: targetRecord.serverId,
                sessionId,
                entries: recent.entries,
                read: (path) => readGatewayRecordJson(targetRecord, path),
                isCurrent,
                recordPanes: useServerAgents.getState().record,
                observe: recent.observeSession,
                updateTitle: recent.updateTitle,
                repairAgent: recent.repairAgent,
                // The chosen gateway's own sessions, including ones this
                // device never opened; every other gateway keeps its recents.
                recordAgentSessions:
                  targetRecord.serverId === targetId
                    ? useHomeAgentSessions.getState().record
                    : undefined,
              });
            },
          });
        });
        refreshFlight.current = flight;
        return settleAfter(
          async () => {
            await flight;
          },
          () => {
            pending = false;
            if (isCurrent()) setObservationNowMs(Date.now());
          }
        );
      };
      setObservationNowMs(Date.now());
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, HOME_CONTINUE_REFRESH_MS);
      return () => {
        current = false;
        clearInterval(timer);
      };
    }, [servers, targetId, hydrated, appActive])
  );
  const available = homeContinueEntries({
    serverIds: servers.map((server) => server.serverId),
    hostIds: hosts.map((host) => host.id),
    snapshots,
    recents: entries,
    reachabilityByServer,
    paneMode,
    nowMs: observationNowMs,
    gatewaySessions: agentSessions,
  });
  const visible = visibleHomeContinueEntries(available, expanded);
  const displayed = compact && !expanded ? visible.slice(0, 4) : visible;
  return (
    <View testID="home-recent-sessions" style={styles.root}>
      <View
        style={[
          styles.list,
          {
            backgroundColor: available.length ? background(theme.colors.surface) : 'transparent',
            borderRadius: profile.chrome.surface,
          },
        ]}>
        {displayed.map((entry, index) => (
          <RecentSessionRow
            key={entry.key}
            entry={entry}
            number={index + 1}
            compact={compact}
            selectedServerId={selectedServerId}
            selectedPaneId={selectedPaneId}
            selectedAsid={selectedAsid}
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
            onOpen={() => onOpen(homeContinueCommand(entry.destination))}
          />
        ))}
        {available.length === 0 ? (
          <Text
            variant="bodySmall"
            color={theme.colors.textMuted}
            style={{ paddingVertical: 16, paddingHorizontal: 0 }}>
            {hydrated && snapshotsHydrated ? t`Nothing to show yet.` : t`Loading recent sessions…`}
          </Text>
        ) : null}
      </View>
      {shouldShowHomeContinueOverflow(available) || (compact && available.length > 4) ? (
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
  compact,
  selectedServerId,
  selectedPaneId,
  selectedAsid,
  onOpen,
}: {
  entry: HomeContinueEntry;
  number: number;
  hasSeparator: boolean;
  serverLabel?: string;
  compact: boolean;
  selectedServerId?: string;
  selectedPaneId?: string;
  selectedAsid?: string;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const target = homeContinueTarget(entry.destination);
  const selected =
    target?.kind === 'agent-session'
      ? target.serverId === selectedServerId && target.asid === selectedAsid
      : target?.kind === 'gateway-terminal'
        ? target.serverId === selectedServerId &&
          Boolean(selectedPaneId) &&
          target.paneId === selectedPaneId
        : entry.destination.type === 'pane' &&
          entry.destination.serverId === selectedServerId &&
          Boolean(selectedPaneId) &&
          entry.destination.paneId === selectedPaneId;
  const rowKind = homeContinueKind(entry.destination);
  const cwd =
    entry.destination.type === 'pane'
      ? entry.destination.cwd
      : target?.kind === 'agent-session'
        ? target.directory
        : undefined;
  // The agent's own name from the last discovery, so a DeepSeek session does
  // not say it is an OpenCode one.
  const mirroredAgents = useAgents((state) =>
    target?.kind === 'agent-session'
      ? state.index.servers[target.serverId]?.agents?.agents
      : undefined
  );
  const agentId = rowKind.kind === 'agent' ? rowKind.agentId : undefined;
  const agentName = agentId ? agentDisplayName(mirroredAgents, agentId) : '';
  const agentKind = agentId ? (findAgent(mirroredAgents, agentId)?.kind ?? agentId) : undefined;
  const kind =
    rowKind.kind === 'agent'
      ? t`${agentName} session`
      : rowKind.kind === 'terminal'
        ? t`Terminal`
        : t`SSH host`;
  const title = entry.title || kind;
  const metadataKind = entry.agentLabel ? `${kind} · ${entry.agentLabel}` : kind;
  const observation = entry.observation;
  const status = observation?.status;
  const sessionStatus =
    observation?.kind === 'agent-session' && observation.status
      ? agentSessionStatusPresentation(observation.status)
      : undefined;
  const statusLabel = status
    ? sessionStatus
      ? _(agentSessionStatusWord[sessionStatus.word])
      : _(agentStatusWord[status] ?? agentStatusWord.unknown)
    : undefined;
  const statusTone = sessionStatus ? sessionStatus.tone : agentStatusTone(status);
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
      accessibilityHint={cwd}
      accessibilityState={{ selected }}
      onPress={onOpen}
      style={[
        styles.row,
        hasSeparator && {
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        {
          backgroundColor: background(selected ? theme.colors.primarySubtle : theme.colors.surface),
        },
      ]}>
      <View style={styles.open}>
        {compact ? null : (
          <Text variant="heading" color={theme.colors.primary} style={styles.number}>
            {String(number).padStart(2, '0')}
          </Text>
        )}
        <View style={styles.copy}>
          {agentKind ? (
            <View style={styles.titleLine}>
              <View style={styles.titleMark}>
                <AgentMark kind={agentKind} size={14} color={theme.colors.primary} />
              </View>
              <Text variant="bodySmall" weight="semibold" numberOfLines={2} style={styles.title}>
                {title}
              </Text>
            </View>
          ) : (
            <Text variant="bodySmall" weight="semibold" numberOfLines={2}>
              {title}
            </Text>
          )}
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
            {metadataKind}
            {serverLabel ? ` · ${serverLabel}` : ''}
          </Text>
          {cwd && !compact ? (
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
        <ThemeIcon
          name="home.arrow"
          fallback={ChevronRight}
          size={16}
          color={theme.colors.primary}
        />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { minWidth: 0 },
  list: { minWidth: 0, overflow: 'hidden' },
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
  titleLine: { minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // Centred on the title's first line (bodySmall's 20pt line box).
  titleMark: { height: 20, justifyContent: 'center' },
  title: { minWidth: 0, flex: 1 },
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
