import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, X } from 'lucide-react-native';
import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
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
import { FontedTextInput } from '@/components/fonted-text-input';
import { PressableScale } from '@/components/pressable-scale';
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
import { useServerAgents } from '@/stores/server-agents';
import { useAppSettings } from '@/stores/app-settings';
import type { SshHostRecord } from '@/lib/ssh-hosts';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { useGoneAgentSessions } from '@/stores/gone-agent-sessions';
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

export function HomeContinueSearch({
  query,
  onChange,
}: {
  query: string;
  onChange: (query: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <View style={styles.search}>
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
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  activeConnection?: ActiveServerConnection;
  selectedServerId?: string;
}) {
  const entries = useHomeRecentsStore((state) => state.entries);
  const hydrated = useHomeRecentsStore((state) => state.hydrated);
  const goneSessions = useGoneAgentSessions((state) => state.keys);
  const [observationNowMs, setObservationNowMs] = useState(Date.now);
  const snapshots = useServerAgents((state) => state.byServer);
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
    goneSessions,
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
  moreLabel = 'count',
  header,
}: {
  servers: readonly GatewayRecord[];
  hosts: readonly SshHostRecord[];
  available: readonly HomeContinueEntry[];
  selectedServerId?: string;
  compact?: boolean;
  /** Rows shown before the `Sessions (N)` toggle; compact lists default to four. */
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
  /** What the collapsed list's toggle says: `Sessions (N)` or Home's `Show all`. */
  moreLabel?: 'count' | 'show-all';
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
  const collapsedLimit = limit ?? (compact ? 4 : undefined);
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
      {!searching &&
      (shouldShowHomeContinueOverflow(available) ||
        (collapsedLimit !== undefined && available.length > collapsedLimit)) ? (
        <PressableScale
          testID="home-recent-sessions-more"
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          style={[styles.more, linkStyle]}>
          <Text variant="bodySmall" color={theme.colors.primary}>
            {expanded
              ? t`Show less`
              : moreLabel === 'show-all'
                ? t`Show all`
                : `${t`Sessions`} (${available.length})`}
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
  const observation = entry.observation;
  const taskState = task?.state;
  const status = taskState ?? observation?.status;
  const sessionStatus =
    !taskState && observation?.kind === 'agent-session' && observation.status
      ? agentSessionStatusPresentation(observation.status)
      : undefined;
  const statusLabel = taskState
    ? _(taskStateWord[taskState])
    : status
      ? sessionStatus
        ? _(agentSessionStatusWord[sessionStatus.word])
        : _(agentStatusWord[status] ?? agentStatusWord.unknown)
      : undefined;
  // The task's tone is the one its card and Needs you row wear.
  const statusTone = task
    ? taskRowVisual(task, { canComplete: false, acknowledged: false }).tone
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
  return (
    <PressableScale
      testID="home-recent-open"
      accessibilityRole="button"
      accessibilityLabel={[title, ...meta.map((part) => part.text)].join(', ')}
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
  );
}

const styles = StyleSheet.create({
  search: {
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
  more: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
});
