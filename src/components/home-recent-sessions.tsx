import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { ChevronRight, Trash2, X } from 'lucide-react-native';
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AppState,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import { AgentMark } from '@/components/agent-mark';
import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { FontedTextInput } from '@/components/fonted-text-input';
import { HomeFoldLink } from '@/components/home-fold-link';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { useMinuteNow } from '@/hooks/use-minute-now';
import {
  HOME_CONTINUE_REFRESH_MS,
  refreshHomeContinue,
  refreshHomeGateways,
  homeAgentSessionsListPath,
} from '@/lib/home-continue-refresh';
import {
  endHomeRefresh,
  homeRefreshAttempt,
  homeRefreshDue,
  onHomeRefreshRetry,
  retryHomeRefresh,
  startHomeRefresh,
  forgetHomeRefresh,
} from '@/lib/home-refresh-schedule';
import { onNetworkChange } from '@/lib/network-events';
import { snapshotServesAgents } from '@/lib/session-snapshot';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerChannels } from '@/stores/server-channels';
import { useAppActive } from '@/hooks/use-app-active';
import {
  deleteGatewayRecordJson,
  loadRecordSessions,
  readGatewayRecordJson,
} from '@/lib/gateway-client';
import { resolveSessionId, sessionChoices, type SessionChoice } from '@/lib/session-switcher';
import { useServerSession } from '@/stores/server-session';
import { isDemoRecord } from '@/lib/demo-gateway';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { HomeCommand } from '@/lib/home-commands';
import { findAgent } from '@/lib/agent-discovery';
import { agentDisplayName } from '@/lib/home-launch-model';
import { useAgents } from '@/stores/agents';
import { useHomeAgentSessions } from '@/stores/home-agent-sessions';
import { useHomeAttention } from '@/stores/home-attention';
import { taskAttentionView } from '@/lib/task-attention';
import {
  agentSessionStatusPresentation,
  homeContinueCommand,
  homeContinueEntries,
  homeContinueKind,
  homeContinueObservationNow,
  type HomeContinueObservation,
  type HomeContinueObservationView,
  homeContinueTarget,
  shouldShowHomeContinueOverflow,
  HOME_CONTINUE_INITIAL_LIMIT,
  type HomeContinueEntry,
} from '@/lib/home-continue';
import { agentSessionStatusWord, agentStatusWord, taskStateWord } from '@/i18n/labels';
import { boundTask } from '@/lib/home-in-progress';
import { useServerTasksStore } from '@/stores/server-tasks';
import { agentBrandName, agentStatusTone, isLaunchCommandTitle } from '@/lib/herdr-entity';
import {
  paneLedgerTask,
  sessionLedgerTask,
  taskRowTitle,
  taskRowVisual,
} from '@/lib/home-computer-cards';
import type { ActiveServerConnection, ServerReachability } from '@/lib/server-reachability';
import { selectServerAgentsContent, useServerAgents } from '@/stores/server-agents';
import { useAppSettings } from '@/stores/app-settings';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useGoneAgentSessions } from '@/stores/gone-agent-sessions';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { describeGatewayFailure } from '@/lib/network-error';
import { agentRequestErrorDetail, classifyAgentRequestError } from '@/lib/agent-request-error';
import { homeTargetAgentId } from '@/lib/home-recents';
import {
  deleteHomeSession,
  homeSessionDeleteTarget,
  HomeSessionDeleteUnavailableError,
  AGENT_SESSION_DELETE_SCOPED_CAPABILITY,
  type HomeDeletableTarget,
} from '@/lib/home-session-delete';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { homeProviderTextColor, searchedHomeContinueEntries } from '@/lib/home-continue-search';
import {
  homeContinueComputerLabel,
  homeContinueMetaChars,
  homeContinueMetaParts,
  homePathLabel,
  META_SEPARATOR,
  terminalRowPath,
  terminalRowTitle,
} from '@/lib/home-continue-row';

/**
 * The Herdr sessions each computer offered, so a Continue pass does not read
 * `/api/sessions` again every time. Refreshed every few minutes, and dropped
 * when a pass against that computer fails.
 */
const SESSION_CHOICES_TTL_MS = 5 * 60_000;
const sessionChoicesByServer = new Map<string, { choices: SessionChoice[]; atMs: number }>();

async function homeSessionChoices(record: GatewayRecord): Promise<SessionChoice[]> {
  const nowMs = Date.now();
  const cached = sessionChoicesByServer.get(record.serverId);
  if (cached && nowMs - cached.atMs < SESSION_CHOICES_TTL_MS) return cached.choices;
  const inventory = await loadRecordSessions(record);
  const connected = sessionChoices(inventory.sessions);
  const choices = connected.length ? connected : sessionChoices(inventory.sessions, true);
  sessionChoicesByServer.set(record.serverId, { choices, atMs: nowMs });
  return choices;
}

function forgetHomeSessionChoices(serverId: string): void {
  sessionChoicesByServer.delete(serverId);
}

export function HomeContinueSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  return (
    <View
      style={[
        styles.search,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: profile.chrome.surface,
        },
      ]}>
      <FontedTextInput
        testID="home-continue-search"
        accessibilityLabel={t`Search sessions`}
        placeholder={t`Search sessions`}
        placeholderTextColor={theme.colors.textMuted}
        value={query}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        underlineColorAndroid="transparent"
        style={[styles.searchInput, { color: theme.colors.text }]}
      />
      {query.length ? (
        <PressableScale
          testID="home-continue-search-clear"
          accessibilityRole="button"
          accessibilityLabel={t`Clear session search`}
          onPress={() => onChange('')}
          style={styles.searchClear}>
          <X size={16} color={theme.colors.textMuted} />
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Keep discovery active even when the empty section is omitted from the layout. */
export function useHomeRecentEntries({
  servers,
  hosts,
  reachabilityByServer,
  activeConnection,
  selectedServerId,
  connectionShortcutsElsewhere = false,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  activeConnection?: ActiveServerConnection;
  selectedServerId?: string;
  connectionShortcutsElsewhere?: boolean;
}) {
  const entries = useHomeRecentsStore((state) => state.entries);
  const hydrated = useHomeRecentsStore((state) => state.hydrated);
  const goneSessions = useGoneAgentSessions((state) => state.keys);
  // Rows, not ages: a pass that only re-confirms the panes leaves this alone.
  const snapshots = useServerAgents(selectServerAgentsContent);
  const paneMode = useAppSettings((state) => state.serverCardPanes);
  const targetId = selectedServerId ?? activeConnection?.serverId;
  const agentSessions = useHomeAgentSessions((state) =>
    targetId ? state.byServer[targetId] : undefined
  );
  const appActive = useAppActive();
  const refreshFlight = useRef<Promise<void>>(Promise.resolve());
  // Coming back to the foreground asks the computers that were not answering.
  useEffect(() => {
    if (appActive) retryHomeRefresh();
  }, [appActive]);
  // Read at each tick, not reacted to: a probe landing must not restart the loop.
  const readReachability = useLatestReader(reachabilityByServer);
  // The computer the dock points at, as of the last run: a newly chosen one
  // is read now rather than when its last cadence comes round.
  const refreshTargetRef = useRef<string | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      if (!appActive || !hydrated) return;
      if (refreshTargetRef.current !== targetId) {
        refreshTargetRef.current = targetId;
        if (targetId) forgetHomeRefresh(targetId);
      }
      let current = true;
      let pending = false;
      let again = false;
      const isCurrent = () => current && AppState.currentState === 'active';
      const refreshOne = async (record: GatewayRecord): Promise<boolean | undefined> => {
        // The selected computer's listing does not need the Herdr session,
        // so it goes out beside that lookup rather than after it.
        const agentSessionsList =
          record.serverId === targetId
            ? readGatewayRecordJson(record, homeAgentSessionsListPath())
            : undefined;
        agentSessionsList?.catch(() => undefined);
        const choices = await homeSessionChoices(record);
        if (!isCurrent()) return undefined;
        const sessionId = resolveSessionId(
          choices,
          useServerSession.getState().byServer[record.serverId]
        );
        const recent = useHomeRecentsStore.getState();
        const results = await refreshHomeContinue({
          serverId: record.serverId,
          sessionId,
          entries: recent.entries,
          read: (path) => readGatewayRecordJson(record, path),
          isCurrent,
          recordPanes: useServerAgents.getState().record,
          observe: recent.observeSession,
          updateTitle: recent.updateTitle,
          repairAgent: recent.repairAgent,
          // The chosen gateway's own sessions, including ones this
          // device never opened; every other gateway keeps its recents.
          recordAgentSessions:
            record.serverId === targetId ? useHomeAgentSessions.getState().record : undefined,
          servesSnapshot: snapshotServesAgents({
            capabilities: useServerCapabilities.getState().byServer[record.serverId],
          }),
          capabilities: useServerCapabilities.getState().byServer[record.serverId],
          agentSessionsList,
        });
        // The panes read failing while the list answered is the session the
        // cached choice names having gone: ask `/api/sessions` again next pass.
        if (results[0]?.status === 'rejected') forgetHomeSessionChoices(record.serverId);
        return results.some((result) => result.status === 'fulfilled');
      };
      const refresh = async (): Promise<void> => {
        if (!isCurrent()) return;
        if (pending) {
          again = true;
          return;
        }
        pending = true;
        // Drain older reads before starting another batch after a focus/target change.
        const flight = refreshFlight.current.then(async () => {
          if (!isCurrent()) return;
          const nowMs = Date.now();
          const sockets = useServerChannels.getState().sockets;
          // Only the computers that are due: an answering one on its cadence,
          // a failing one on its backoff -- unless it was down when it failed
          // and is answering again -- and one known to be down not at all.
          const reachability = readReachability();
          const due = servers.filter((server) => {
            if (isDemoRecord(server) || reachability[server.serverId] === 'offline') return false;
            return homeRefreshDue(
              homeRefreshAttempt(server.serverId),
              nowMs,
              sockets[server.serverId] === 'open',
              reachability[server.serverId] === 'live'
            );
          });
          await refreshHomeGateways({
            records: due,
            selectedServerId: targetId,
            isCurrent,
            refresh: async (record) => {
              startHomeRefresh(record.serverId, nowMs);
              const ok = await refreshOne(record).then(
                (answered) => answered,
                () => false
              );
              if (ok === undefined) return;
              if (!ok) forgetHomeSessionChoices(record.serverId);
              endHomeRefresh(record.serverId, ok, readReachability()[record.serverId] === 'live');
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
            if (again) {
              again = false;
              void refresh();
            }
          }
        );
      };
      void refresh();
      const timer = setInterval(() => {
        void refresh();
      }, HOME_CONTINUE_REFRESH_MS);
      const stopRetry = onHomeRefreshRetry(() => {
        void refresh();
      });
      const stopNetwork = onNetworkChange(() => retryHomeRefresh());
      return () => {
        current = false;
        clearInterval(timer);
        stopRetry();
        stopNetwork();
      };
    }, [servers, targetId, hydrated, appActive, readReachability])
  );
  const available = homeContinueEntries({
    serverIds: servers.map((server) => server.serverId),
    hostIds: hosts.map((host) => host.id),
    snapshots,
    recents: entries,
    reachabilityByServer,
    paneMode,
    gatewaySessions: agentSessions,
    goneSessions,
    connectionShortcutsElsewhere,
  });
  return available;
}

/** Shared Classic pane inventory, ranked by explicit visits without recording synthetic visits. */
export function HomeRecentSessions({
  servers,
  hosts,
  available,
  selectedServerId,
  compact = false,
  limit,
  linkStyle,
  selectedPaneId,
  selectedAsid,
  onOpen,
  query = '',
  pad = false,
  header,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  available: readonly HomeContinueEntry[];
  selectedServerId?: string;
  compact?: boolean;
  /** Rows shown before the inline expansion toggle; defaults to five. */
  limit?: number;
  /** Overrides the `Sessions (N)` link's box, e.g. to inset it like the rows. */
  linkStyle?: StyleProp<ViewStyle>;
  selectedPaneId?: string;
  selectedAsid?: string;
  /** Runs the row's Home command; see `homeContinueCommand`. */
  onOpen: (command: HomeCommand) => void;
  query?: string;
  /** Pad keeps the large ordinal; a phone shrinks it so the title has the row. */
  pad?: boolean;
  /** Drawn above the rows, e.g. Home's per-computer filter chips. */
  header?: ReactNode;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { fontScale } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  // What the meta line has across: the row less its padding, ordinal, gaps and arrow.
  const ordinalWidth = compact ? 0 : (pad ? 48 : 30) + 12;
  const metaChars = homeContinueMetaChars(
    listWidth - 24 - ordinalWidth - 12 - 16,
    theme.typography.caption.fontSize * fontScale
  );
  const discovery = useAgents((state) => state.index.servers);
  const collapsedLimit = limit ?? HOME_CONTINUE_INITIAL_LIMIT;
  const searching = query.trim().length > 0;
  const displayed = searchedHomeContinueEntries(
    available,
    query,
    expanded,
    collapsedLimit,
    discovery,
    Object.fromEntries(servers.map((server) => [server.serverId, server.label]))
  );
  return (
    <View testID="home-recent-sessions" style={styles.root}>
      {header}
      <View
        onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}
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
            servers={servers}
            pad={pad}
            metaChars={metaChars}
            onOpen={() => onOpen(homeContinueCommand(entry.destination))}
          />
        ))}
      </View>
      {searching && !displayed.length ? (
        <Text
          testID="home-continue-no-matches"
          variant="bodySmall"
          color={theme.colors.textMuted}
          style={{ padding: 12 }}>
          {t`No matching sessions`}
        </Text>
      ) : null}
      {!searching && shouldShowHomeContinueOverflow(available, collapsedLimit) ? (
        <HomeFoldLink
          testID="home-recent-sessions-more"
          expanded={expanded}
          onPress={() => setExpanded(!expanded)}
          style={linkStyle}
        />
      ) : null}
    </View>
  );
}

/**
 * A row's observation against the minute clock, with the newest "still the
 * same" its sources hold. Only this row re-renders when a pass re-confirms it.
 */
function useObservationNow(
  observation: HomeContinueObservation | undefined
): HomeContinueObservationView | undefined {
  const nowMs = useMinuteNow();
  const seen = observation?.seen;
  const panesAtMs = useServerAgents((state) =>
    seen?.panesOf ? state.byServer[seen.panesOf]?.checkedAtMs : undefined
  );
  const recentAtMs = useHomeRecentsStore((state) =>
    seen?.recentKey ? state.seenAtMs[seen.recentKey] : undefined
  );
  const listedAtMs = useHomeAgentSessions((state) =>
    seen?.listedBy ? state.seenAtMs[seen.listedBy] : undefined
  );
  if (!observation) return undefined;
  return homeContinueObservationNow(
    observation,
    Math.max(panesAtMs ?? 0, recentAtMs ?? 0, listedAtMs ?? 0),
    nowMs
  );
}

function RecentSessionRow({
  entry,
  number,
  hasSeparator,
  servers,
  compact,
  pad,
  metaChars,
  selectedServerId,
  selectedPaneId,
  selectedAsid,
  onOpen,
}: {
  entry: HomeContinueEntry;
  number: number;
  hasSeparator: boolean;
  servers: readonly GatewayRecord[];
  compact: boolean;
  pad: boolean;
  metaChars: number;
  selectedServerId?: string;
  selectedPaneId?: string;
  selectedAsid?: string;
  onOpen: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const [menu, setMenu] = useState<{
    record?: GatewayRecord;
    target?: HomeDeletableTarget;
    canDelete: boolean;
    title: string;
    computer: string;
    provider: string;
  } | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
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
  const serverId =
    entry.destination.type === 'pane'
      ? entry.destination.serverId
      : target?.kind === 'ssh-host'
        ? undefined
        : target?.serverId;
  const computer = homeContinueComputerLabel(servers, serverId);
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
  // A terminal an agent runs in is named by that agent.
  const paneAgentName = entry.agentLabel ? agentBrandName(entry.agentLabel) : undefined;
  const kind =
    rowKind.kind === 'agent'
      ? agentName
      : rowKind.kind === 'terminal'
        ? (paneAgentName ?? t`Terminal`)
        : t`SSH host`;
  const providerInk = agentKind ?? entry.agentLabel;
  const terminal = rowKind.kind === 'terminal';
  // A pane the gateway opened for a ledger task, still named after its launch
  // command, says the task's goal instead.
  const paneGoal = useServerTasksStore((state) => {
    if (entry.destination.type !== 'pane' || !isLaunchCommandTitle(entry.title)) return undefined;
    const task = paneLedgerTask(
      state.index[entry.destination.serverId]?.tasks,
      entry.destination.paneId
    );
    return task ? taskRowTitle(task) : undefined;
  });
  // A session a ledger task runs in says what the task says: its one-line
  // title, as on the card (the newest task, finished too), and the open
  // task's state -- the session's own status lags it (it read "Idle" under a
  // working delegation).
  const task = useServerTasksStore((state) =>
    target?.kind === 'agent-session'
      ? boundTask(state.index[target.serverId]?.tasks, target.asid)
      : undefined
  );
  const taskTitle = useServerTasksStore((state) => {
    if (target?.kind !== 'agent-session') return undefined;
    const named = sessionLedgerTask(state.index[target.serverId]?.tasks, target.asid);
    return named ? taskRowTitle(named) : undefined;
  });
  const title = paneGoal
    ? paneGoal
    : taskTitle
      ? taskTitle
      : terminal
        ? terminalRowTitle({
            paneTitle: entry.title,
            cwd,
            hasAgent: Boolean(entry.agentLabel),
            agentName: paneAgentName,
          }) || kind
        : entry.title || kind;
  const path = terminal ? terminalRowPath(title, cwd) : cwd ? homePathLabel(cwd) : undefined;
  const observation = useObservationNow(entry.observation);
  const requests = useHomeAttention((state) => state.byTarget);
  const nowMs = useMinuteNow();
  const displayTask =
    task && target?.kind === 'agent-session'
      ? taskAttentionView({ task, serverId: target.serverId, requests, nowMs })
      : undefined;
  const taskState = displayTask?.state;
  const status = taskState ?? observation?.status;
  const sessionStatus =
    !taskState && observation?.kind === 'agent-session' && observation.status
      ? agentSessionStatusPresentation(observation.status)
      : undefined;
  const stateLabel = taskState
    ? _(taskStateWord[taskState])
    : status
      ? sessionStatus
        ? _(agentSessionStatusWord[sessionStatus.word])
        : _(agentStatusWord[status] ?? agentStatusWord.unknown)
      : undefined;
  const statusLabel =
    observation?.kind === 'gateway-agent' && observation.pendingUserInput
      ? [stateLabel, t`Needs your input`].filter(Boolean).join(META_SEPARATOR)
      : stateLabel;
  // The task's tone is the one its card and Needs you row wear.
  const statusTone = displayTask
    ? taskRowVisual(displayTask, { canComplete: false, acknowledged: false }).tone
    : sessionStatus
      ? sessionStatus.tone
      : agentStatusTone(observation?.status);
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
  const meta = homeContinueMetaParts({
    kind,
    computer,
    path,
    status: statusLabel,
    seen: seenLabel,
    maxChars: metaChars,
  });
  const surface = selected ? theme.colors.primarySubtle : theme.colors.surface;
  const toggleMenu = () => {
    if (deletingRef.current) return;
    setMenuError(null);
    if (menu) {
      setMenu(null);
      return;
    }
    const capturedTarget = homeSessionDeleteTarget(entry);
    const record = servers.find((server) => server.serverId === capturedTarget?.serverId);
    const canDelete = Boolean(
      record &&
      (isDemoRecord(record) ||
        useServerCapabilities
          .getState()
          .byServer[record.serverId]?.includes(AGENT_SESSION_DELETE_SCOPED_CAPABILITY))
    );
    setMenu({
      target: capturedTarget,
      canDelete,
      title,
      computer: computer ?? t`Computer`,
      provider: agentName,
      record: record
        ? { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined }
        : undefined,
    });
    if (!capturedTarget) {
      setMenuError(
        rowKind.kind === 'agent'
          ? t`Refresh Home to identify this session’s provider before deleting it.`
          : t`Close this terminal on its computer. Safe terminal closing from Home is not supported yet.`
      );
    } else if (!canDelete) {
      setMenuError(
        t`Update Gateway on this computer, then reconnect to enable deleting sessions from Home.`
      );
    }
  };
  const deleteSession = useStableHandler(() => {
    if (deletingRef.current) return;
    const captured = menu;
    if (!captured?.target || !captured.record || isDemoRecord(captured.record)) {
      setMenuError(
        t`Demo sessions cannot be deleted. Open a paired computer to manage its sessions.`
      );
      return;
    }
    const record = captured.record;
    if (
      !useGatewayConnectionStore
        .getState()
        .records.some((saved) => saved.serverId === record.serverId)
    ) {
      setMenuError(t`Pair this computer again before deleting its sessions.`);
      return;
    }
    deletingRef.current = true;
    setDeleting(true);
    setMenuError(null);
    void deleteHomeSession({
      target: captured.target,
      capabilities: useServerCapabilities.getState().byServer[record.serverId],
      remove: (path) => deleteGatewayRecordJson(record, path),
      forget: async (deleted) => {
        useGoneAgentSessions
          .getState()
          .markGone(deleted.serverId, deleted.asid, homeTargetAgentId(deleted));
        const snapshot = useHomeAgentSessions.getState().byServer[deleted.serverId];
        if (snapshot) {
          useHomeAgentSessions.getState().record({
            ...snapshot,
            sessions: snapshot.sessions.filter(
              (session) =>
                session.asid !== deleted.asid || session.agentId !== homeTargetAgentId(deleted)
            ),
          });
        }
        const recent = useHomeRecentsStore
          .getState()
          .entries.find(
            (entry) =>
              entry.target.kind === 'agent-session' &&
              entry.target.serverId === deleted.serverId &&
              entry.target.asid === deleted.asid
          );
        if (
          recent &&
          homeTargetAgentId(recent.target.kind === 'agent-session' ? recent.target : undefined) ===
            homeTargetAgentId(deleted)
        ) {
          await useHomeRecentsStore.getState().remove(deleted);
        }
        forgetHomeSessionChoices(deleted.serverId);
        retryHomeRefresh();
      },
    }).then(
      () => {
        deletingRef.current = false;
        setDeleting(false);
        setMenu(null);
      },
      (failure: unknown) => {
        deletingRef.current = false;
        setDeleting(false);
        setMenuError(
          failure instanceof HomeSessionDeleteUnavailableError
            ? failure.reason === 'provider'
              ? t`Refresh Home to identify this session’s provider before deleting it.`
              : t`Update Gateway on this computer, then reconnect to enable deleting sessions from Home.`
            : classifyAgentRequestError(failure).kind === 'unsupported'
              ? t`This provider cannot delete sessions. Open the session to stop a running turn or manage it on its computer.`
              : agentRequestErrorDetail(failure).status === 404
                ? t`This session is no longer available in this service. Refresh Home before trying again.`
                : ['auth', 'network', 'timeout', 'backend'].includes(
                      describeGatewayFailure(failure).kind
                    )
                  ? describeGatewayFailure(failure).message
                  : t`Could not delete this session. Reconnect to its computer and refresh Home before trying again.`
        );
      }
    );
  });
  const menuItems: AgentActionMenuItem[] = [];
  if (menu?.canDelete) {
    const { title, provider, computer } = menu;
    menuItems.push({
      id: 'delete',
      label: deleting ? t`Deleting session…` : t`Delete session`,
      Icon: Trash2,
      tone: 'danger',
      disabled: deleting,
      confirm: {
        label: t`Confirm delete`,
        detail: t`“${title}” and its conversation history will be deleted in ${provider} on ${computer}. The service may also delete its subagent sessions. This cannot be undone.`,
        persist: true,
      },
      onPress: deleteSession,
      testID: 'home-recent-delete',
    });
  }
  menuItems.push({
    id: 'close-menu',
    label: t`Close menu`,
    Icon: X,
    disabled: deleting,
    onPress: () => setMenu(null),
    testID: 'home-recent-close-menu',
  });
  return (
    <View>
      <PressableScale
        testID="home-recent-open"
        accessibilityRole="button"
        accessibilityLabel={[title, ...meta.map((part) => part.text)].join(', ')}
        accessibilityHint={cwd}
        accessibilityState={{ selected }}
        onPress={onOpen}
        onLongPress={toggleMenu}
        accessibilityActions={[{ name: 'longpress', label: t`Actions` }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') toggleMenu();
        }}
        style={[
          styles.row,
          hasSeparator && {
            borderBottomColor: theme.colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
          {
            backgroundColor: background(surface),
          },
        ]}>
        <View style={styles.open}>
          {compact ? null : (
            <Text
              variant="heading"
              color={theme.colors.primary}
              style={pad ? styles.number : styles.phoneNumber}>
              {String(number).padStart(2, '0')}
            </Text>
          )}
          <View style={styles.copy}>
            <View style={styles.titleLine}>
              {agentKind ? (
                <View style={styles.titleMark}>
                  <AgentMark kind={agentKind} size={14} color={theme.colors.primary} />
                </View>
              ) : null}
              <Text
                variant="bodySmall"
                weight="semibold"
                numberOfLines={terminal || taskTitle ? 1 : 2}
                style={styles.title}>
                {title}
              </Text>
            </View>
            <Text
              testID="home-recent-meta"
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}>
              {meta.map((part, index) => (
                <Fragment key={part.role}>
                  {index > 0 ? META_SEPARATOR : null}
                  {part.role === 'status' && status ? (
                    <Text variant="caption" color={theme.colors[statusTone]}>
                      {`\u25CF ${part.text}`}
                    </Text>
                  ) : part.role === 'kind' && providerInk ? (
                    <Text
                      variant="caption"
                      color={homeProviderTextColor(providerInk, theme.colors, surface)}>
                      {part.text}
                    </Text>
                  ) : part.role === 'path' ? (
                    <Text variant="caption" color={theme.colors.textSubtle}>
                      {part.text}
                    </Text>
                  ) : (
                    part.text
                  )}
                </Fragment>
              ))}
            </Text>
          </View>
          <ThemeIcon
            name="home.arrow"
            fallback={ChevronRight}
            size={16}
            color={theme.colors.primary}
          />
        </View>
      </PressableScale>
      {menu ? (
        <AgentActionMenu
          testID="home-recent-actions"
          surface="ground"
          items={menuItems}
          error={menuError}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    paddingHorizontal: 12,
    // borderWidth: StyleSheet.hairlineWidth,
    width: '100%',
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 14, paddingVertical: 10, paddingHorizontal: 0 },
  searchClear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
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
  // The heading token's own size: on a phone the title keeps most of the row.
  phoneNumber: { minWidth: 30, letterSpacing: -0.5 },
  copy: { minWidth: 0, flex: 1, gap: 4 },
  titleLine: { minWidth: 0, flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  // Centred on the title's first line (bodySmall's 20pt line box).
  titleMark: { height: 20, justifyContent: 'center' },
  title: { minWidth: 0, flex: 1 },
});
