import { useHomeThreadTitle } from '@/hooks/use-home-thread-title';
import type { SideInsets } from '@/hooks/use-side-insets';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast, PressableScale, Text } from '@osuki-dev/ui';
import { useIsFocused, useRouter } from 'expo-router';
import { ControlsIcon } from '@/icons';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import {
  AgentComposer,
  type ComposerDraftMemory,
  type DraftInjector,
} from '@/components/agent-composer';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { HomeLaunchController } from '@/components/home-launch-actions';
import type { DockAutoHide } from '@/hooks/use-dock-auto-hide';
import { HomeComposerOptions } from '@/components/home-composer-options';
import { ComposerMenuButton } from '@/components/composer-attachment-button';
import {
  HomeComposerTransition,
  type HomeComposerPulse,
  type HomeComposerTransitionKind,
} from '@/components/home-composer-transition';
import {
  HomeComposerBackground,
  useHomeComposerBackgroundOutset,
  HomeComposerDecoration,
  useHomeComposerDecorationOverhang,
} from '@/components/home-composer-background';
import { ThemeIcon } from '@/components/theme-icon';
import { useAgentFeatures, useAgentsDiscoveryRefresh } from '@/hooks/use-agent-features';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { META_SEPARATOR } from '@/lib/home-continue-row';
import { boundSessionState, goalTitle, type PendingDispatch } from '@/lib/home-computer-cards';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentClientCommandId } from '@/lib/agent-commands';
import { agentRequestErrorDetail, classifyAgentRequestError } from '@/lib/agent-request-error';
import { unsupportedModelRefs } from '@/lib/agent-session-defaults';
import {
  createAgentSession,
  formatModelName,
  getAgentCatalog,
  peekAgentCatalog,
  listAgentSessions,
  invokeAgentSkill,
  invokePaneSkill,
  normalizeAgentId,
  readAgentSessionAt,
  sendAgentCommand,
  sendAgentPrompt,
  switchAgentMode,
  switchAgentModel,
  type AgentCatalog,
  type ModelRef,
  selectableModes,
} from '@/lib/agent-session';
import {
  recoverWith,
  recoverWithSync,
  settleAfter,
  settleAfterAsync,
} from '@/lib/compiler-safe-control-flow';
import { checkAgentServer } from '@/lib/home-agent-readiness';
import { refreshHomeNow } from '@/lib/home-refresh-schedule';
import {
  HOME_AGENT_SESSION_ID,
  homeFolderName,
  homeGuideParams,
  ledgerModelId,
  sameComputer,
  homeHiddenClientCommands,
  homeModelChoiceKey,
  homeSendModelGate,
  homeSessionParams,
  homeSessionReuse,
  resolveHomeComposerTarget,
  type HomeSessionParams,
  type HomeStartedSession,
} from '@/lib/home-composer';
import type { HomeCommandResult } from '@/lib/home-commands';
import { markPromptedSession } from '@/lib/prompted-agent-sessions';
import { loadTerminalCatalog, useTerminalAgentCatalog } from '@/hooks/use-terminal-agent-catalog';
import { agentSpawnRequest, terminalPromptWithAttachments } from '@/lib/agent-spawn';
import { listPaneFiles, loadSessions, sendAgentText, spawnAgent } from '@/lib/gateway-client';
import {
  homeAgentNeedsTerminalLabel,
  homeAgentOptions,
  resolveHomeAgent,
} from '@/lib/home-agent-choice';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  TASK_DEFAULTS_CAPABILITY,
  TASK_LEDGER_PANE_CAPABILITY,
  type LedgerTaskRequest,
  hasTaskLedgerDelivery,
  type LedgerDelivery,
} from '@/lib/task-ledger';
import {
  createHomeLedgerTask,
  forgetHomeLedgerTask,
  loadUnconfirmedHomeTasks,
  reconcileHomeLedgerTask,
  taskForHomeDelivery,
} from '@/lib/home-ledger-delivery';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { gatewaySocketFor } from '@/lib/gateway-socket-runtime';
import { WS_EVENTS_CAPABILITY } from '@/lib/gateway-socket';
import { useFleetPeers } from '@/stores/fleet-peers';
import { fetchFleetPeers, hasFleetPeers } from '@/lib/fleet-peers';
import { recordEndpoint } from '@/hooks/use-server-tasks';
import { mentionedComputers, taskMentions, type MentionComputer } from '@/lib/composer-mentions';
import { useHomeTasksStore as useServerTasksStore } from '@/stores/home-tasks';
import type { ServerReachability } from '@/lib/server-reachability';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeComposerSheet } from '@/stores/home-composer-sheet';
import { markHomeComposerRevealed } from '@/lib/home-first-entry';
import { appChrome } from '@/constants/appearance';
import { HomeThreadFeed, type HomeThreadUnsure } from '@/components/home-thread';
import {
  HomeReplyButton,
  HomeReplyDrawer,
  useHomeReplyDrawer,
} from '@/components/home-reply-drawer';
import { useAppActive } from '@/hooks/use-app-active';
import { agentDisplayName } from '@/lib/home-launch-model';
import {
  homeThreadKey,
  homeThreadSendPlan,
  homeThreadTargetFromTask,
  homeThreadTask,
  type HomeThreadSendPlan,
  type HomeThreadTarget,
} from '@/lib/home-thread';
import { useHomeThreadLive, useHomeThreads } from '@/stores/home-thread';
import { useServerAgents } from '@/stores/server-agents';
import { usePaneShortcuts } from '@/hooks/use-pane-shortcuts';
import { HomeReplyKeyRow } from '@/components/home-reply-key-row';

const NO_COMMANDS: AgentCatalog['commands'] = [];
const NO_SKILLS: AgentCatalog['skills'] = [];

/**
 * Home's dock: the session screen's own composer, before there is a session.
 *
 * `AgentComposer` is hosted whole -- text, attachments, voice, `@` files, `/`
 * commands, the mode and model pills -- in the pre-session state the agent
 * screen shows for a new session: no `activeAsid`, the target computer's
 * catalog behind its choices. A single toolbar icon reveals the computer,
 * agent, workspace, mode and model without shortening the draft field.
 *
 * The target computer is the selected gateway record (one connection at a
 * time), so the catalog, the attachment uploads and the file mentions all go
 * to the computer the bar names. Send does what the workbench does for a new
 * session -- `createAgentSession`, then the prompt -- and binds Home's status
 * row to the returned session. A failure keeps the draft and the staged files
 * in the dock and says why under the bar; nothing is retried by itself.
 */
/** How many of the target's recent sessions are read for models it refused. */
const REFUSAL_SESSIONS_READ = 30;
/** How long Send waits on the target's links before sending without mentions. */
const MENTIONS_READ_TIMEOUT_MS = 2_000;

/**
 * Home's unsent text, outside the dock. The phone page and the Pad page each
 * mount their own dock, and unfolding iPhone Duo (or resizing a window across
 * the Pad width) swaps one for the other mid-sentence.
 */
let homeDockDraft = '';
const HOME_DOCK_DRAFT: ComposerDraftMemory = {
  read: () => homeDockDraft,
  write: (text) => {
    homeDockDraft = text;
  },
};

export function HomeComposerDock({
  revealed,
  controller,
  reachabilityByServer,
  bottomInset = 0,
  topInset = 0,
  outerInsets,
  sideInsets,
  edgeBar,
  fieldLines,
  autoHide,
  onFieldFocus,
  onDockHeight,
  onOpenAgent,
  onOpenThread,
  drawerMaxWidth,
}: {
  revealed: boolean;
  controller: HomeLaunchController;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  bottomInset?: number;
  topInset?: number;
  /** Phone-only space outside the field; Pad keeps its column geometry. */
  outerInsets?: { horizontal: number; bottom: number };
  /** See `AgentComposer`'s `sideInsets`: for a dock that spans the window. */
  sideInsets?: SideInsets;
  /** See `AgentComposer`'s `bar`. */
  edgeBar?: { inset: number };
  /** See `AgentComposer`'s `fieldLines`. */
  fieldLines?: number;
  /** See `AgentComposer`'s `autoHide`. */
  autoHide?: DockAutoHide;
  /** See `AgentComposer`'s `onFieldFocus`. */
  onFieldFocus?: (focused: boolean) => void;
  onDockHeight?: (height: number, clipHeight: number) => void;
  onOpenAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => Promise<HomeCommandResult>;
  /** Opens the dock's conversation in full: its session or its pane. */
  onOpenThread?: (target: HomeThreadTarget) => void;
  /** A Pad's reply drawer is a card no wider than this, centred on the dock. */
  drawerMaxWidth?: number;
}) {
  const { t } = useLingui();
  useEffect(() => {
    if (revealed) markHomeComposerRevealed();
  }, [revealed]);
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const decorationOverhang = useHomeComposerDecorationOverhang();
  const backgroundOutset = useHomeComposerBackgroundOutset();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [transitionPulse, setTransitionPulse] = useState<HomeComposerPulse | null>(null);
  const playTransition = useStableHandler((kind: HomeComposerTransitionKind) => {
    setTransitionPulse((previous) => ({ id: (previous?.id ?? 0) + 1, kind }));
  });
  const background = useSurfaceBackground();
  const router = useRouter();
  const { showToast } = useToast();
  const { servers, chosen, openTargetPicker } = controller;
  const { record, selectRecord, selectRecordNow } = useGatewayRecord();
  const [error, setError] = useState<string | null>(null);
  const [unknownDelivery, setUnknownDelivery] = useState<{
    serverId: string;
    deviceId?: string;
    clientRef: string;
    goal: string;
    pendingId?: string;
  } | null>(null);
  const [checkingDelivery, setCheckingDelivery] = useState(false);

  const target = resolveHomeComposerTarget({ servers, chosen, reachabilityByServer });
  const targetServer = target.kind === 'none' ? undefined : target.server;
  const targetId = targetServer?.serverId;
  const ready = target.kind === 'ready';
  const selected = Boolean(targetId) && record?.serverId === targetId;
  const readDeliveryScope = useLatestReader({ serverId: targetId, deviceId: record?.deviceId });
  const isCurrentDeliveryScope = useCallback(
    (scope: { serverId: string; deviceId?: string }): boolean => {
      const shown = readDeliveryScope();
      const current = useGatewayConnectionStore.getState().record;
      return (
        shown.serverId === scope.serverId &&
        shown.deviceId === scope.deviceId &&
        current?.serverId === scope.serverId &&
        current.deviceId === scope.deviceId
      );
    },
    [readDeliveryScope]
  );

  useEffect(() => {
    if (!unknownDelivery) return;
    const reconcile = () => {
      if (!isCurrentDeliveryScope(unknownDelivery)) return;
      const tasks = useServerTasksStore.getState().index[unknownDelivery.serverId]?.tasks ?? [];
      if (!taskForHomeDelivery(tasks, unknownDelivery.clientRef, unknownDelivery.deviceId)) return;
      if (unknownDelivery.pendingId) useHomeTaskCards.getState().settle(unknownDelivery.pendingId);
      void recoverWith(
        async () => {
          forgetHomeLedgerTask(unknownDelivery, unknownDelivery.clientRef);
          const next = loadUnconfirmedHomeTasks(unknownDelivery)[0];
          setUnknownDelivery(next ? { ...unknownDelivery, ...next, pendingId: undefined } : null);
        },
        () => setError(t`The previous send could not be checked.`)
      );
    };
    reconcile();
    return useServerTasksStore.subscribe(reconcile);
  }, [unknownDelivery, t, isCurrentDeliveryScope]);
  const visibleUnknownDelivery =
    unknownDelivery?.serverId === targetId && unknownDelivery?.deviceId === record?.deviceId
      ? unknownDelivery
      : null;
  useEffect(() => {
    if (!record || record.serverId !== targetId) {
      setUnknownDelivery(null);
      return;
    }
    void recoverWith(
      async () => {
        const first = loadUnconfirmedHomeTasks(record)[0];
        setUnknownDelivery((previous) =>
          first
            ? previous?.clientRef === first.clientRef
              ? previous
              : { serverId: record.serverId, deviceId: record.deviceId, ...first }
            : null
        );
      },
      () => setError(t`The previous send could not be checked.`)
    );
  }, [record, targetId, t]);

  // `@` offers the target and the computers it has linked -- the ones it can
  // hand work to -- each by the name the target knows it by, when it can
  // link at all (`fleet_peers`). A paired computer it has not linked is not
  // offered: naming it would tell the agent nothing.
  const fleetCapable = useServerCapabilities((state) =>
    targetId ? hasFleetPeers(state.byServer[targetId]) : false
  );
  const linkedPeers = useFleetPeers((state) =>
    targetId ? state.byServer[targetId]?.peers : undefined
  );
  const mentionComputers: MentionComputer[] =
    fleetCapable && targetServer
      ? [
          {
            serverId: targetServer.serverId,
            name: targetServer.label,
            current: true,
            reachable: true,
          },
          ...(linkedPeers ?? []).map((peer) => ({
            serverId: peer.serverId,
            name: peer.name,
            current: false,
            reachable: peer.reachable && !peer.unauthorized,
            ...(peer.unauthorized ? { revoked: true } : {}),
          })),
        ]
      : [];
  /**
   * The task's `mentions`: the computers the draft names, checked against the
   * target's own linked peers read just now (`taskMentions`). Nothing when the
   * draft names none. A failed resolution preserves the draft.
   */
  const mentionsIn = async (
    goal: string,
    serverId: string
  ): Promise<{ mentions: string[]; computerIds: string[] }> => {
    // Only a draft that names a computer (`@src/…` is a file) asks, and
    // briefly: Send does not wait long on a slow computer for this.
    const named = mentionedComputers(
      goal,
      mentionComputers.map((computer) => computer.name)
    );
    if (named.length === 0) return { mentions: [], computerIds: [] };
    const target = servers.find((server) => server.serverId === serverId);
    if (!fleetCapable || !target || target.sshTunnel) throw new Error(t`Computer unavailable.`);
    const answer = await fetchFleetPeers(recordEndpoint(target), MENTIONS_READ_TIMEOUT_MS);
    // What the target said about its links is news for the fleet store too.
    useFleetPeers.getState().record(serverId, answer);
    const mentions = answer.ok ? taskMentions(goal, mentionComputers, answer.peers.peers) : null;
    if (!mentions) throw new Error(t`Computer unavailable.`);
    if (
      !useServerCapabilities.getState().byServer[serverId]?.includes('agent_computer_context_v1')
    ) {
      throw new Error(t`Update Gateway to use computer references in this conversation.`);
    }
    const computerIds = named.map(
      (name) => mentionComputers.find((computer) => computer.name === name)!.serverId
    );
    return { mentions, computerIds };
  };

  // One connection at a time: the computer Send goes to is the one selected,
  // so its catalog, uploads and file list are what the dock shows. Selected
  // when the target changes or Home comes back into focus -- not whenever
  // the selection moves: opening a task on another computer selects that one
  // for its screen, and the dock must not pull it back mid-open (A5 D3).
  const focused = useIsFocused();
  const selectTarget = useEffectEvent(() => {
    if (!ready || !targetId || record?.serverId === targetId) return;
    if (!selectRecordNow(targetId)) void selectRecord(targetId);
  });
  useEffect(() => {
    if (focused) selectTarget();
  }, [ready, targetId, focused]);
  useAgentsDiscoveryRefresh(targetId, ready && selected);

  const discovery = useAgents((state) => (targetId ? state.index.servers[targetId] : undefined));
  const markAgentUsed = useAgents((state) => state.markUsed);
  // The reader's Home agent for this computer, or its first ready agent.
  // Read for whichever computer the bar names, selected or not.
  const terminalCatalog = useTerminalAgentCatalog(targetId, ready);
  const chosenAgentKey = useHomeAgentChoice((state) =>
    targetId ? state.byServer[targetId] : undefined
  );
  const agentOptions = homeAgentOptions(discovery, terminalCatalog);
  const agent = resolveHomeAgent(agentOptions, chosenAgentKey, terminalCatalog !== undefined);
  const terminalAgent = agent?.kind === 'terminal' ? agent : null;
  // Where the goal runs on this computer: the folder last picked here, if
  // any. Sent as `cwd` (ledger, spawn) or `directory` (session).
  const folder = useHomeAgentChoice((state) =>
    targetId ? state.folderByServer[targetId] : undefined
  );
  const agentsDiscovered = Boolean(discovery?.agents);
  const agentId =
    agentsDiscovered && agent?.kind === 'session' ? normalizeAgentId(agent.agentId) : undefined;
  const features = useAgentFeatures(targetId, agentId);
  const computerLabel = targetServer?.label ?? '';
  // Nothing picked sends no folder and the gateway uses its default, which it
  // reports (`defaults`); only a gateway that cannot say leaves "Last folder".
  const reportsDefaults = useServerCapabilities((state) =>
    targetId ? state.byServer[targetId]?.includes(TASK_DEFAULTS_CAPABILITY) === true : false
  );
  const reportedCwd = useServerTasksStore((state) =>
    targetId ? state.defaultCwd[targetId] : undefined
  );
  const defaultCwd = reportsDefaults ? reportedCwd : undefined;
  const folderLabel = homeFolderName(folder ?? defaultCwd, {
    last: t`Last folder`,
    home: t`Home folder`,
  });
  const providerName = agent?.name ?? '';
  const agentName = homeAgentNeedsTerminalLabel(agent, agentOptions)
    ? t`${providerName} (terminal)`
    : providerName;
  const agentLabel = agentName || computerLabel;

  // The conversation the next message goes to on this computer, if any
  // (`lib/home-thread`): set by the first goal sent from here or by tapping a
  // session card, cleared by the reader or when it ends.
  const thread = useHomeThreads((state) => (targetId ? state.byServer[targetId] : undefined));
  const threadKey = thread ? homeThreadKey(thread) : undefined;
  const threadAgentId = thread?.kind === 'session' ? thread.agentId : undefined;
  const threadFeatures = useAgentFeatures(targetId, threadAgentId ?? null);
  // What the field offers on `/`, `$` and `@` follows the conversation the
  // next message goes to. A session offers its own agent's commands, skills
  // and files, read for that session; a pane or a task that has not said
  // where it runs offers none of an agent's catalog, since its agent reads
  // the line itself. The dock's own agent is asked only when nothing is
  // targeted.
  const threadSession = thread?.kind === 'session' ? thread : undefined;
  const threadSessionId = threadSession?.sessionId;
  const threadAsid = threadSession?.asid;
  const threadDirectory = threadSession?.directory;
  const threadCatalogAgentId = threadAgentId ? normalizeAgentId(threadAgentId) : undefined;
  const threadCatalogKey = threadSession
    ? [
        targetId ?? '',
        threadSessionId,
        threadAsid,
        threadDirectory ?? '',
        threadCatalogAgentId ?? '',
      ].join('\u0000')
    : null;
  const [threadCatalogRead, setThreadCatalogRead] = useState<{
    key: string;
    catalog: AgentCatalog;
  } | null>(null);
  const discoveredAgents = discovery?.agents?.agents;
  const threadAgentName = !thread
    ? agentLabel
    : thread.kind === 'session'
      ? agentDisplayName(discoveredAgents, thread.agentId)
      : thread.kind === 'pane' && thread.agentLabel
        ? agentDisplayName(discoveredAgents, thread.agentLabel)
        : agentLabel;
  const appActive = useAppActive();
  /** A follow-up whose delivery could not be confirmed: kept, never resent by itself. */
  const [unsure, setUnsure] = useState<HomeThreadUnsure | null>(null);
  const visibleUnsure = unsure && unsure.key === threadKey ? unsure : null;
  // The conversation's drawer, rising from behind the field: only for a
  // session or a pane (a task that has not said where it runs has nothing to
  // show yet), and only while Home is the focused screen with the computer it
  // is on. The app leaving the
  // foreground does not close it: Android reports a system dialog over the
  // app, such as the microphone permission prompt voice input raises, as the
  // app going to the background, and the drawer's own streams already pause
  // there by themselves.
  const [dockClip, setDockClip] = useState(0);
  const drawer = useHomeReplyDrawer({ clipHeight: dockClip, topInset });
  const replyTitle = useHomeThreadTitle(thread);
  const conversation =
    thread && thread.kind !== 'task'
      ? replyTitle && replyTitle !== thread.title
        ? { ...thread, title: replyTitle }
        : thread
      : undefined;
  const drawerAllowed = Boolean(conversation) && focused;
  const closeDrawer = drawer.close;
  const drawerOpen = drawer.open;
  const drawerKey = useRef(threadKey);
  useEffect(() => {
    const changed = drawerKey.current !== threadKey;
    drawerKey.current = threadKey;
    if (drawerOpen && (changed || !drawerAllowed)) closeDrawer();
  }, [threadKey, drawerAllowed, drawerOpen, closeDrawer]);
  // A gateway that takes the delivery by name lets the reader's pick decide
  // how a goal is carried: the provider's session entry sends a session
  // task, its terminal entry a pane task, each only where that provider
  // lists the delivery. No agent is named here; the data is.
  const ledgerDelivery = useServerCapabilities((state) =>
    targetId ? hasTaskLedgerDelivery(state.byServer[targetId]) : false
  );
  /** The discovery entry a picked option stands for, if the computer listed one. */
  const discoveredAgent = (option: {
    kind: 'session' | 'terminal';
    agentId?: string;
    agentKind: string;
  }) =>
    discovery?.agents?.agents.find((entry) =>
      option.kind === 'session' ? entry.id === option.agentId : entry.kind === option.agentKind
    );
  // ... and a terminal agent's goal as one too: the gateway opens the pane,
  // types the goal and follows the agent as the task's state.
  const ledgerPane = useServerCapabilities((state) =>
    targetId ? state.byServer[targetId]?.includes(TASK_LEDGER_PANE_CAPABILITY) === true : false
  );

  // The catalog behind the pills, read for the computer and agent on the bar.
  // Kept with the key it was read for, so another target never shows it.
  const catalogKey = `${targetId ?? ''}\u0000${agentId ?? ''}`;
  const [catalogRead, setCatalogRead] = useState<{ key: string; catalog: AgentCatalog } | null>(
    null
  );
  // A failed read, by the key it was for: the pill stops saying it is loading.
  const [catalogFailedKey, setCatalogFailedKey] = useState<string | null>(null);
  // Bumped by a Send held on a failed read, so pressing it again reads again.
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  // The models this computer already refused (a session whose turn failed
  // as "not supported"), read from its recent sessions alongside the catalog:
  // the model the pill names and Send sends is never one of them.
  const [refusedRead, setRefusedRead] = useState<{ key: string; refused: Set<string> } | null>(
    null
  );
  useEffect(() => {
    if (!ready || !selected || terminalAgent) return;
    let current = true;
    const peeked = peekAgentCatalog(HOME_AGENT_SESSION_ID, agentId ? { agentId } : undefined);
    if (peeked) setCatalogRead({ key: catalogKey, catalog: peeked });
    getAgentCatalog(HOME_AGENT_SESSION_ID, undefined, agentId ? { agentId } : undefined)
      .then((catalog) => {
        if (current) setCatalogRead({ key: catalogKey, catalog });
      })
      .catch((failure: unknown) => {
        console.warn('Failed to load the agent catalog for Home:', failure);
        if (current) setCatalogFailedKey(catalogKey);
      });
    listAgentSessions(HOME_AGENT_SESSION_ID, {
      roots: true,
      limit: REFUSAL_SESSIONS_READ,
      ...(agentId ? { agentId } : {}),
    })
      .then((sessions) => {
        if (current) setRefusedRead({ key: catalogKey, refused: unsupportedModelRefs(sessions) });
      })
      .catch((failure: unknown) => {
        console.warn('Failed to read recent sessions for Home:', failure);
      });
    return () => {
      current = false;
    };
  }, [ready, selected, agentId, catalogKey, terminalAgent, catalogAttempt]);
  useEffect(() => {
    if (!ready || !selected || threadCatalogKey === null || !threadSessionId) return;
    let current = true;
    const scope = {
      ...(threadDirectory ? { directory: threadDirectory } : {}),
      ...(threadCatalogAgentId ? { agentId: threadCatalogAgentId } : {}),
    };
    const peeked = peekAgentCatalog(threadSessionId, scope);
    if (peeked) setThreadCatalogRead({ key: threadCatalogKey, catalog: peeked });
    getAgentCatalog(threadSessionId, undefined, scope)
      .then((read) => {
        if (current) setThreadCatalogRead({ key: threadCatalogKey, catalog: read });
      })
      .catch((failure: unknown) => {
        console.warn('Failed to load the targeted conversation catalog for Home:', failure);
      });
    return () => {
      current = false;
    };
  }, [ready, selected, threadCatalogKey, threadSessionId, threadDirectory, threadCatalogAgentId]);
  const threadCatalog =
    threadCatalogRead && threadCatalogRead.key === threadCatalogKey
      ? threadCatalogRead.catalog
      : undefined;
  // A targeted pane offers the commands its agent accepts: the gateway's
  // table for that pane, the same list the terminal screen's `/` shows. They
  // go to the pane as the typed line.
  const threadPane = thread?.kind === 'pane' ? thread : undefined;
  const paneSessionId =
    useServerAgents((state) =>
      threadPane
        ? (threadPane.sessionId ?? state.byServer[threadPane.serverId]?.sessionId)
        : undefined
    ) ?? '';
  const paneShortcuts = usePaneShortcuts({
    sessionId: paneSessionId,
    paneId: threadPane?.paneId ?? '',
    enabled: Boolean(threadPane) && ready && selected,
  });
  const paneCommands = useMemo<AgentCatalog['commands']>(
    () =>
      (paneShortcuts?.commands ?? [])
        .filter((entry) => entry.command.startsWith('/'))
        .map((entry) => ({
          name: entry.command.slice(1),
          ...(entry.description ? { description: entry.description } : {}),
        })),
    [paneShortcuts]
  );
  // `$` is the app's skills entry here as everywhere: the pane's skills, run by
  // name through the Gateway, which decides how that pane's agent runs one.
  const paneSkills = useMemo<AgentCatalog['skills']>(
    () =>
      (paneShortcuts?.skills ?? []).map((skill) => ({
        id: skill.name,
        name: skill.name,
        description: skill.description,
      })),
    [paneShortcuts]
  );
  // `@` files for a pane are the pane's own folder, the search the terminal
  // screen uses, when its agent takes file mentions.
  const panePaneId = threadPane?.paneId;
  const searchPaneFiles = useCallback(
    (query: string) =>
      paneSessionId && panePaneId
        ? listPaneFiles(paneSessionId, panePaneId, query)
        : Promise.resolve([]),
    [paneSessionId, panePaneId]
  );
  const catalog = catalogRead?.key === catalogKey ? catalogRead.catalog : undefined;
  const refused = refusedRead?.key === catalogKey ? refusedRead.refused : undefined;
  const models = catalog?.models ?? [];
  // The same list the session's picker offers: hidden routines (title,
  // summary, compaction) and subagents are not modes a reader sends a goal to.
  const modes = selectableModes(catalog?.modes ?? []);

  // What the reader last picked in the dock for this computer and agent,
  // kept across launches; nothing picked runs the agent's own default.
  const picked = useHomeAgentChoice((state) =>
    targetId ? state.modelChoice[homeModelChoiceKey(targetId, agentId)] : undefined
  );
  const chooseModel = useHomeAgentChoice((state) => state.chooseModel);
  const chooseMode = useHomeAgentChoice((state) => state.chooseMode);
  const { params: sessionParams, shown } = homeSessionParams({
    picked: picked ?? {},
    ...(refused ? { refused } : {}),
    catalogDefaults: catalog?.defaults ?? {},
    models,
    modes,
    ...(agentId ? { agentId } : {}),
    agentsDiscovered,
    catalogRead: catalog !== undefined,
  });
  const selectedModel = shown.model;
  // Only a picker opened here can animate its changed choice on returning.
  // Catalog refreshes and initial preference hydration are not user steps.
  const pendingChoiceRef = useRef<string | null>(null);
  const choiceSignature = JSON.stringify([targetId, chosenAgentKey, folder, picked]);
  useEffect(() => {
    if (!focused || pendingChoiceRef.current === null) return;
    const previous = pendingChoiceRef.current;
    pendingChoiceRef.current = null;
    if (previous !== choiceSignature) playTransition('choice');
  }, [focused, choiceSignature, playTransition]);
  function beginChoice() {
    pendingChoiceRef.current = choiceSignature;
  }
  const modelInfo = selectedModel
    ? models.find(
        (model) =>
          model.id === selectedModel.model_id &&
          (!selectedModel.provider_id || model.provider_id === selectedModel.provider_id)
      )
    : undefined;
  // Nothing to name yet: "Loading…" only while a read is actually under way
  // (the target answering and selected), else the plain word, translated --
  // never the formatter's English fallback.
  const catalogFailed = catalogFailedKey === catalogKey;
  const catalogLoading = ready && selected && !terminalAgent && !catalog && !catalogFailed;
  const modelName = selectedModel
    ? formatModelName(selectedModel, '', modelInfo?.name)
    : catalogLoading
      ? t`Loading…`
      : t`Model`;
  const canPickMode = features.modes && modes.length > 0;

  /**
   * The pills a follow-up compares against: what they said when the session
   * became the target. Only for the dock's own agent, whose catalog they
   * name, and once that catalog has been read.
   */
  const threadPills = (current: HomeThreadTarget): HomeSessionParams | undefined => {
    if (terminalAgent || catalog === undefined || current.kind !== 'session') return undefined;
    if (current.agentId && agentId && normalizeAgentId(current.agentId) !== agentId)
      return undefined;
    return sessionParams;
  };
  const threadPillsMissing = thread?.kind === 'session' && !thread.pills;
  const recordThreadPills = useEffectEvent(() => {
    const current = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    if (!current || current.pills) return;
    const pills = threadPills(current);
    if (pills) useHomeThreads.getState().update(current, { ...current, pills });
  });
  const catalogReady = catalog !== undefined;
  useEffect(() => {
    if (threadPillsMissing && catalogReady) recordThreadPills();
  }, [threadPillsMissing, catalogReady, threadKey]);

  const selectModel = useStableHandler((model: ModelRef) => {
    if (targetId) chooseModel(targetId, agentId, model);
  });
  useEffect(() => () => useHomeComposerSheet.getState().release(selectModel), [selectModel]);
  function openModelSheet() {
    beginChoice();
    useHomeComposerSheet.getState().open(selectedModel, selectModel);
    router.push({
      pathname: '/agent-model',
      params: {
        sessionId: HOME_AGENT_SESSION_ID,
        ...(agentId ? { agentId } : {}),
        owner: 'home',
      },
    });
  }
  // A mode that names its own model brings it, as it does on a session: the
  // model pick is dropped and the ladder starts from the mode again. A mode
  // that names none keeps the model the reader picked.
  function selectMode(mode: string) {
    const bringsModel = modes.find((entry) => entry.id === mode)?.model !== undefined;
    if (targetId) {
      chooseMode(targetId, agentId, mode, bringsModel);
      if (mode !== shown.mode) playTransition('choice');
    }
  }

  /** The workbench's own sentences for a failed request, in this agent's name. */
  function describeFailure(failure: unknown): string {
    // No agent tile to name: the computer stands in, never an empty name.
    const agentName = agentLabel;
    const reading = classifyAgentRequestError(failure);
    switch (reading.kind) {
      case 'offline':
        return t`${agentName} is offline`;
      case 'refused': {
        const message = reading.message;
        return t`${agentName} refused the request: ${message}`;
      }
      case 'unsupported':
        return t`${agentName} does not support that action.`;
      case 'unknown-agent':
        return t`This computer does not know ${agentName}. Refresh the agent list and try again.`;
      case 'other':
        return reading.message;
    }
  }

  /**
   * A session made for a send whose act did not land. The next Send on the
   * same computer and agent goes to it (see `homeSessionReuse`) rather than
   * leaving an empty session behind each attempt.
   */
  const startedRef = useRef<HomeStartedSession | null>(null);
  /** Two taps in one frame are one send: React state cannot lock that. */
  const inFlightRef = useRef(false);
  /** The composer's own draft, for a command that failed after it was cleared. */
  const injectDraftRef = useRef<DraftInjector | null>(null);
  /** Empties the field if it still holds what a failed row just sent. */
  const clearDraftRef = useRef<((text: string) => void) | null>(null);
  // "Reply from Home" on a card: the field takes focus to write the reply.
  const focusRequest = useHomeThreads((state) => state.focusRequest);
  const seenFocusRequest = useRef(focusRequest);
  useEffect(() => {
    if (focusRequest === seenFocusRequest.current) return;
    seenFocusRequest.current = focusRequest;
    injectDraftRef.current?.('', { focusOnly: true });
  }, [focusRequest]);

  /**
   * Never a session without a model on an agent that takes one, whatever
   * creates it -- a goal, a command or a skill: it waits for the catalog, and
   * says why under the bar when the catalog could not be read. `true`: held.
   */
  function heldByModelGate(): boolean {
    const gate = homeSendModelGate({
      choosesModel: features.modelSelection,
      model: sessionParams.model,
      catalogRead: catalog !== undefined,
      catalogFailed,
    });
    if (gate === 'send') return false;
    if (gate === 'failed') {
      // Read the catalog again now, so the next press can send.
      setCatalogFailedKey(null);
      setCatalogAttempt((attempt) => attempt + 1);
    }
    setError(
      gate === 'wait'
        ? t`Waiting for this computer's model list. Send again in a moment.`
        : t`Could not read this computer's model list, so nothing was sent. Pick a model or try again.`
    );
    return true;
  }

  /** The computer Send goes to, selected; or `null` with the reason shown. */
  async function sendTarget(fixed?: string): Promise<string | null> {
    if (fixed) {
      // A retry goes where the failed send was going, whatever the bar names now.
      if (useGatewayConnectionStore.getState().record?.serverId === fixed) return fixed;
      if (selectRecordNow(fixed) || (await selectRecord(fixed))) return fixed;
      setError(t`Computer unavailable.`);
      return null;
    }
    // An offline computer keeps the draft and says so (`offlineReason`); it
    // is never swapped for another one behind the reader's back.
    if (target.kind !== 'ready') return null;
    const serverId = target.server.serverId;
    if (useGatewayConnectionStore.getState().record?.serverId === serverId) return serverId;
    const reached = selectRecordNow(serverId) || (await selectRecord(serverId));
    if (!reached) {
      setError(t`Computer unavailable.`);
      return null;
    }
    return serverId;
  }

  /**
   * A conversation a send just started becomes the target -- unless the
   * reader picked another one on this computer while it went out.
   */
  function startedThread(target: HomeThreadTarget) {
    if (useHomeThreads.getState().byServer[target.serverId]) return;
    useHomeThreads.getState().target(target);
  }

  /** What Send does with the dock's conversation now (`homeThreadSendPlan`). */
  function threadPlan(current: HomeThreadTarget): HomeThreadSendPlan {
    const key = homeThreadKey(current);
    const liveState = useHomeThreadLive.getState();
    const live = liveState.key === key ? liveState.live : undefined;
    const pills = threadPills(current);
    return homeThreadSendPlan({
      target: current,
      task: homeThreadTask(current, useServerTasksStore.getState().index[current.serverId]?.tasks),
      ...(live
        ? {
            live: {
              ...(live.status ? { status: live.status } : {}),
              ...(live.interaction ? { interaction: live.interaction } : {}),
            },
          }
        : {}),
      features: {
        inbox: threadFeatures.inbox,
        steering: threadFeatures.extra.promptSteering === true,
      },
      ...(pills ? { pills } : {}),
    });
  }

  /** Why a follow-up cannot go now; the draft stays. `null` when it can. */
  function threadRefusal(plan: HomeThreadSendPlan): string | null {
    const name = threadAgentName;
    switch (plan.kind) {
      case 'starting':
        return t`The task is still starting. Send again in a moment.`;
      case 'busy':
        return t`${name} is still working and cannot take a message now. Your draft stays here.`;
      case 'terminal':
        return t`Continue in the linked terminal. Your draft stays here.`;
      case 'elsewhere':
        return t`This task runs on another computer. Open it to reply.`;
      default:
        return null;
    }
  }

  /**
   * A follow-up into the dock's conversation, over the path its own screen
   * uses: `POST …/prompt` for an agent session (steered while it runs, after
   * any pill switched on it), the pane's agent send for a terminal agent.
   * Waits for the gateway's answer, so a refusal keeps the draft. A send that
   * timed out may have landed: the draft stays and the strip asks the reader
   * to retry or check, never sending it again by itself.
   */
  function followUp(
    current: HomeThreadTarget,
    text: string,
    attachments: string[]
  ): Promise<boolean> {
    if (inFlightRef.current) return Promise.resolve(false);
    const plan = threadPlan(current);
    const refusal = threadRefusal(plan);
    if (refusal || (plan.kind !== 'session' && plan.kind !== 'pane')) {
      setError(refusal);
      return Promise.resolve(false);
    }
    const key = homeThreadKey(current);
    const pills = threadPills(current);
    inFlightRef.current = true;
    return settleAfter(
      async () => {
        setError(null);
        setUnsure(null);
        const serverId = await sendTarget(current.serverId);
        if (!serverId) return false;
        const owner = useGatewayConnectionStore.getState().record;
        const owns = () => {
          const now = useGatewayConnectionStore.getState().record;
          return (
            owner?.serverId === serverId &&
            sameComputer(now, owner) &&
            now?.deviceId === owner.deviceId
          );
        };
        return recoverWith(
          async () => {
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            if (plan.kind === 'session') {
              const { computerIds } = await mentionsIn(text, serverId);
              if (!owns()) throw new Error(t`Computer unavailable.`);
              if (plan.switchMode) await switchAgentMode(plan.asid, plan.switchMode);
              if (plan.switchModel)
                await switchAgentModel(plan.sessionId, plan.asid, plan.switchModel);
              if (!owns()) throw new Error(t`Computer unavailable.`);
              await sendAgentPrompt(plan.sessionId, plan.asid, {
                text,
                attachments,
                computerIds,
                ...(plan.delivery ? { delivery: plan.delivery } : {}),
              });
            } else {
              const sessionId =
                plan.sessionId ??
                useServerAgents.getState().byServer[serverId]?.sessionId ??
                (await loadSessions()).sessions?.[0]?.id;
              if (!owns()) throw new Error(t`Computer unavailable.`);
              if (!sessionId) {
                setError(t`This computer has no session to start an agent in.`);
                return false;
              }
              await sendAgentText(
                sessionId,
                plan.paneId,
                terminalPromptWithAttachments(text, attachments)
              );
            }
            const latest = useHomeThreads.getState().byServer[serverId];
            if (latest && homeThreadKey(latest) === key)
              useHomeThreads.getState().update(latest, {
                ...latest,
                lastSent: text,
                sentAtMs: Date.now(),
                ...(pills && plan.kind === 'session' ? { pills } : {}),
              });
            // A pane's status comes from the computer's mirror: read it now,
            // so the agent shows as working without waiting for the cadence.
            if (plan.kind === 'pane') refreshHomeNow(serverId);
            return true;
          },
          (failure) => {
            console.warn('Home could not send a follow-up:', failure);
            if (agentRequestErrorDetail(failure).status === 404) {
              // The conversation is gone: the next Send starts a new one.
              const latest = useHomeThreads.getState().byServer[serverId];
              if (latest && homeThreadKey(latest) === key)
                useHomeThreads.getState().clear(serverId, latest);
              setError(t`That conversation has ended. Send again to start a new one.`);
              return false;
            }
            if (describeGatewayFailure(failure).kind === 'timeout') {
              setUnsure({ key, text, attachments });
              return false;
            }
            setError(
              plan.kind === 'session'
                ? describeFailure(failure)
                : describeGatewayFailure(failure, t`Could not send input.`).message
            );
            return false;
          }
        );
      },
      () => {
        inFlightRef.current = false;
      }
    );
  }

  /** The reader's Retry on a send that may not have landed: the same message, once. */
  const retryUnsure = useStableHandler(() => {
    const pending = unsure;
    const current = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    if (!pending || !current || homeThreadKey(current) !== pending.key) return;
    void followUp(current, pending.text, pending.attachments).then((sent) => {
      if (sent) clearDraftRef.current?.(pending.text);
    });
  });

  /**
   * A command or a skill with a session as the target goes to that session,
   * as its own screen would run it; `null` when there is no such target.
   */
  async function threadAct(
    act: (sessionId: string, asid: string) => Promise<void>
  ): Promise<boolean | null> {
    const current = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    const plan = current ? threadPlan(current) : undefined;
    if (!current || plan?.kind !== 'session' || inFlightRef.current) return null;
    inFlightRef.current = true;
    return settleAfter(
      async () => {
        setError(null);
        const serverId = await sendTarget(current.serverId);
        if (!serverId) return false;
        return recoverWith(
          async () => {
            await act(plan.sessionId, plan.asid);
            return true;
          },
          (failure) => {
            console.warn('Home could not act on its conversation:', failure);
            setError(describeFailure(failure));
            return false;
          }
        );
      },
      () => {
        inFlightRef.current = false;
      }
    );
  }

  /**
   * Create the session (or reuse the one a failed send left), act on it, and,
   * for a command or a skill, open it. A goal (`sent`) never navigates: the
   * card holds a Sent row while it goes out, bound to the session once it
   * went, or saying it could not be sent, with what to send again. A create that fails on
   * an agent that is not ready opens its setup guide, as a launch tile does;
   * every other failure is said under the bar.
   */
  async function startSession(
    act: (asid: string) => Promise<void>,
    sent?: { goal: string; attachments: string[] },
    /** A failed row's send again: its computer, agent and folder, gated when it first went. */
    again?: { serverId: string; params: HomeSessionParams; folder?: string }
  ): Promise<boolean> {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    let pendingId: string | null = null;
    let keepRow = false;
    return settleAfter(
      async () => {
        setError(null);
        const serverId = await sendTarget(again?.serverId);
        if (!serverId) return false;
        if (sent) pendingId = useHomeTaskCards.getState().dispatched(serverId, sent.goal);
        const params = again ? again.params : sessionParams;
        const sendFolder = again ? again.folder : folder;
        // A retry reuses the session only where it would have made it.
        const key = `${serverId}\u0000${params.agentId ?? ''}\u0000${sendFolder ?? ''}`;
        // The selection moved while this was in flight: the session and its
        // prompt would go to a computer the bar no longer names.
        const owner = useGatewayConnectionStore.getState().record;
        const owns = () => {
          const current = useGatewayConnectionStore.getState().record;
          return (
            owner?.serverId === serverId &&
            sameComputer(current, owner) &&
            current?.deviceId === owner.deviceId
          );
        };
        let creating = false;
        return recoverWith(
          async () => {
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            const plan = homeSessionReuse(startedRef.current, key, params);
            let started: HomeStartedSession;
            if (plan.kind === 'reuse') {
              const { asid } = plan.started;
              if (plan.switchMode) await switchAgentMode(asid, plan.switchMode);
              if (!owns()) throw new Error(t`Computer unavailable.`);
              if (plan.switchModel)
                await switchAgentModel(HOME_AGENT_SESSION_ID, asid, plan.switchModel);
              started = { ...plan.started, params };
            } else {
              // A command or a skill creates the session too: the same gate as
              // Send. A failed row's send passed it when it first went.
              if (!again && heldByModelGate()) return false;
              creating = true;
              const created = await createAgentSession(HOME_AGENT_SESSION_ID, {
                ...params,
                ...(sendFolder ? { directory: sendFolder } : {}),
              });
              creating = false;
              markAgentUsed(serverId, created.agent_id);
              started = {
                key,
                asid: created.asid,
                ...(created.directory ? { directory: created.directory } : {}),
                sessionAgentId: created.agent_id,
                params,
              };
            }
            startedRef.current = started;
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            await act(started.asid);
            startedRef.current = null;
            // Its first snapshot may predate the prompt: no welcome card for it.
            markPromptedSession(serverId, started.asid);
            // A goal stays on Home. Sent straight to its session, its row stands
            // for that session until the session's task appears on the card.
            if (sent) {
              if (pendingId) {
                useHomeTaskCards.getState().bound(pendingId, started.asid);
                keepRow = true;
              }
              // The conversation it started is where the next message goes.
              startedThread({
                kind: 'session',
                serverId,
                sessionId: HOME_AGENT_SESSION_ID,
                asid: started.asid,
                ...(started.sessionAgentId ? { agentId: started.sessionAgentId } : {}),
                ...(started.directory ? { directory: started.directory } : {}),
                title: goalTitle(sent.goal),
                pills: params,
                lastSent: sent.goal,
                sentAtMs: Date.now(),
                setAtMs: Date.now(),
              });
              return true;
            }
            void onOpenAgent(
              serverId,
              started.asid,
              started.directory,
              HOME_AGENT_SESSION_ID,
              started.sessionAgentId
            );
            return true;
          },
          async (failure) => {
            console.warn('Home could not start a session:', failure);
            // The row stays, says why, and keeps exactly what went, so a tap
            // sends it again; the draft, files included, stays in the field.
            // Marked before any guide opens, so its files are held across that.
            if (sent && pendingId) {
              useHomeTaskCards.getState().failed(pendingId, describeFailure(failure), {
                text: sent.goal,
                attachments: sent.attachments,
                params,
                ...(sendFolder ? { folder: sendFolder } : {}),
              });
              keepRow = true;
            }
            if (creating) {
              const record = useGatewayConnectionStore
                .getState()
                .records.find((item) => item.serverId === serverId);
              const readiness = await checkAgentServer(record, params.agentId);
              const guide = homeGuideParams(readiness, {
                serverId,
                ...(record?.label ? { label: record.label } : {}),
              });
              if (guide) {
                router.push({ pathname: '/agent-guide', params: guide });
                return false;
              }
            }
            setError(describeFailure(failure));
            return false;
          }
        );
      },
      () => {
        if (pendingId && !keepRow) useHomeTaskCards.getState().settle(pendingId);
        inFlightRef.current = false;
      }
    );
  }

  /**
   * `POST /api/tasks`: the gateway creates the session, sends the goal and
   * records the ledger task in one step, so the target's card shows the work
   * from the first frame. The card holds a "Sent" row until the answer lands.
   * Home stays put: the row is the feedback, and tapping it opens the session.
   */

  async function sendHomeLedger(
    serverId: string,
    request: LedgerTaskRequest,
    owns: () => boolean,
    pendingId: string
  ) {
    const owner = useGatewayConnectionStore.getState().record;
    if (!owns() || owner?.serverId !== serverId) throw new Error(t`Computer unavailable.`);
    const deviceId = owner?.deviceId;
    const delivery = await createHomeLedgerTask({
      serverId,
      deviceId,
      ...(owner && !owner.sshTunnel ? { endpoint: recordEndpoint(owner) } : {}),
      request,
      isCurrent: () => owns() && sameComputer(useGatewayConnectionStore.getState().record, owner),
      knownTasks: () => useServerTasksStore.getState().index[serverId]?.tasks ?? [],
    });
    if (delivery.kind === 'rejected') throw delivery.failure;
    if (delivery.kind === 'unknown') {
      if (isCurrentDeliveryScope({ serverId, deviceId })) {
        if (unknownDelivery?.pendingId)
          useHomeTaskCards.getState().settle(unknownDelivery.pendingId);
        setUnknownDelivery({
          serverId,
          deviceId,
          clientRef: delivery.clientRef,
          pendingId,
          goal: request.goal,
        });
      }
      return null;
    }
    if (isCurrentDeliveryScope({ serverId, deviceId })) {
      const next = recoverWithSync(
        () => loadUnconfirmedHomeTasks({ serverId, deviceId })[0],
        () => {
          setError(t`Task accepted. Send status could not be saved.`);
          return undefined;
        }
      );
      setUnknownDelivery(next ? { serverId, deviceId, ...next } : null);
    }
    useServerTasksStore.getState().upsert(serverId, delivery.created.task);
    return delivery.created;
  }

  const checkDelivery = useStableHandler(async () => {
    if (!unknownDelivery || checkingDelivery || !isCurrentDeliveryScope(unknownDelivery)) return;
    setCheckingDelivery(true);
    await settleAfter(
      () =>
        recoverWith(
          async () => {
            const owner = useGatewayConnectionStore.getState().record;
            if (
              owner?.serverId !== unknownDelivery.serverId ||
              owner.deviceId !== unknownDelivery.deviceId
            )
              return;
            const created = await reconcileHomeLedgerTask({
              ...unknownDelivery,
              ...(!owner.sshTunnel ? { endpoint: recordEndpoint(owner) } : {}),
              isCurrent: () => sameComputer(useGatewayConnectionStore.getState().record, owner),
              knownTasks: () =>
                useServerTasksStore.getState().index[unknownDelivery.serverId]?.tasks ?? [],
            });
            if (created)
              useServerTasksStore.getState().upsert(unknownDelivery.serverId, created.task);
            else if (isCurrentDeliveryScope(unknownDelivery))
              showToast({
                variant: 'info',
                title: t`Delivery not confirmed`,
                message: t`Check this computer's tasks. This request has not been sent again.`,
              });
          },
          () => {
            if (isCurrentDeliveryScope(unknownDelivery))
              setError(t`The previous send could not be checked.`);
          }
        ),
      () => setCheckingDelivery(false)
    );
  });

  async function openLedgerTask(
    text: string,
    carried?: { delivery: LedgerDelivery; agentId?: string }
  ): Promise<boolean> {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    let pendingId: string | null = null;
    let keepRow = false;
    return settleAfter(
      async () => {
        setError(null);
        const serverId = await sendTarget();
        if (!serverId) return false;
        const params = sessionParams;
        const owner = useGatewayConnectionStore.getState().record;
        const owns = () => {
          const current = useGatewayConnectionStore.getState().record;
          return (
            owner?.serverId === serverId &&
            sameComputer(current, owner) &&
            current?.deviceId === owner.deviceId
          );
        };
        return recoverWith(
          async () => {
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            pendingId = useHomeTaskCards.getState().dispatched(serverId, text);
            const { mentions, computerIds } = await mentionsIn(text, serverId);
            const created = await sendHomeLedger(
              serverId,
              {
                goal: text,
                ...(mentions.length ? { mentions, computerIds } : {}),
                ...(carried?.agentId
                  ? { agentId: carried.agentId }
                  : params.agentId
                    ? { agentId: params.agentId }
                    : {}),
                ...(folder ? { cwd: folder } : {}),
                ...(params.mode ? { mode: params.mode } : {}),
                ...(params.model ? { model: ledgerModelId(params.model) } : {}),
                // Applied at session creation by a gateway that takes it (Gateway
                // Task 15); an older one ignores it, and the switch below sets it.
                ...(params.model?.variant ? { variant: params.model.variant } : {}),
                ...(carried ? { delivery: carried.delivery } : {}),
              },
              owns,
              pendingId
            );
            if (!created) {
              keepRow = true;
              // Acceptance is unknown: keep its Sent row and never restore a
              // draft labelled "not sent" that invites another creation.
              return true;
            }
            const { task, asid } = created;
            // A failed accepted task stays in the ledger; its failure is not a
            // send rejection and must not invite a second creation.
            if (task.state === 'failed') {
              setError(task.summary ?? t`Could not start the task.`);
              return true;
            }
            // The task's conversation is where the next message goes, once
            // the gateway says where it runs (a queued task says so later).
            startedThread({
              ...homeThreadTargetFromTask(
                serverId,
                task,
                task.title ?? goalTitle(text),
                Date.now(),
                carried?.delivery === 'pane' ? undefined : params
              ),
              lastSent: text,
              sentAtMs: Date.now(),
            });
            if (!asid) {
              // A queued accepted task can report its session in a later frame.
              return true;
            }
            if (task.binding.kind === 'agent_session')
              markAgentUsed(serverId, task.binding.agentId);
            markPromptedSession(serverId, asid);
            // Fallback for a gateway that ignores `variant` in the body: its
            // first turn ran at the agent's default effort, and the session
            // takes the picked variant for every turn after. On one that
            // applied it, this sets what is already set.
            const pickedModel = params.model;
            // Creation may finish after the reader selected another computer.
            // The shared client's fallback write still belongs to this one.
            if (pickedModel?.variant && owns()) {
              void switchAgentModel(HOME_AGENT_SESSION_ID, asid, pickedModel).catch(
                (failure: unknown) => console.warn('Home could not set the model variant:', failure)
              );
            }
            return true;
          },
          async (failure) => {
            console.warn('Home could not open a task:', failure);
            const record = useGatewayConnectionStore
              .getState()
              .records.find((item) => item.serverId === serverId);
            const readiness = await checkAgentServer(record, params.agentId);
            const guide = homeGuideParams(readiness, {
              serverId,
              ...(record?.label ? { label: record.label } : {}),
            });
            if (guide) {
              router.push({ pathname: '/agent-guide', params: guide });
              return false;
            }
            setError(describeFailure(failure));
            return false;
          }
        );
      },
      () => {
        if (pendingId && !keepRow) useHomeTaskCards.getState().settle(pendingId);
        inFlightRef.current = false;
      }
    );
  }

  /**
   * A terminal agent (Codex, Claude Code) chosen as Home agent: started in a
   * pane with the goal as its first prompt, with the gateway's own launch
   * arguments. On a gateway with `task_ledger_pane` through `POST /api/tasks`,
   * so the card follows it as a task; otherwise Quick actions' New task path
   * (spawn), behind a Sent row. Home stays put either way: the pane is in
   * Recent.
   */
  async function startTerminalAgent(
    kind: string,
    name: string,
    confirmed: boolean,
    text: string,
    viaLedger: boolean,
    cwd: string | undefined
  ): Promise<boolean> {
    if (inFlightRef.current) return false;
    inFlightRef.current = true;
    let pendingId: string | null = null;
    let keepRow = false;
    return settleAfter(
      async () => {
        setError(null);
        const serverId = await sendTarget();
        if (!serverId) return false;
        // The New task sheet's guard: every await below talks to the shared
        // client, so a selection that moved meanwhile would start the agent
        // (with its bypass flags) on another computer.
        // By computer, not by object: the store republishes the same record
        // (a status update) during slow awaits, and that is not a move.
        const owner = useGatewayConnectionStore.getState().record;
        const owns = () =>
          owner?.serverId === serverId &&
          sameComputer(useGatewayConnectionStore.getState().record, owner);
        return recoverWith(
          async () => {
            // A stored choice the catalog has not confirmed is checked first:
            // Send never starts an agent other than the one the bar names.
            if (!confirmed) {
              const profiles = await loadTerminalCatalog(serverId);
              if (!owns()) {
                setError(t`Computer unavailable.`);
                return false;
              }
              if (!profiles?.some((profile) => profile.kind === kind && profile.available)) {
                const agentName = name;
                setError(
                  t`This computer does not know ${agentName}. Refresh the agent list and try again.`
                );
                return false;
              }
            }
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            pendingId = useHomeTaskCards.getState().dispatched(serverId, text);
            if (viaLedger) {
              const { mentions, computerIds } = await mentionsIn(text, serverId);
              if (!owns()) {
                setError(t`Computer unavailable.`);
                return false;
              }
              const created = await sendHomeLedger(
                serverId,
                {
                  goal: text,
                  ...(mentions.length ? { mentions, computerIds } : {}),
                  agentId: kind,
                  ...(cwd ? { cwd } : {}),
                },
                owns,
                pendingId
              );
              if (!created) {
                keepRow = true;
                return true;
              }
              const { task } = created;
              // The accepted task owns its failure or a still-pending binding.
              if (task.state === 'failed') {
                setError(task.summary ?? t`Could not start the task.`);
                return true;
              }
              startedThread({
                ...homeThreadTargetFromTask(
                  serverId,
                  task,
                  task.title ?? goalTitle(text),
                  Date.now()
                ),
                lastSent: text,
                sentAtMs: Date.now(),
              });
              return true;
            }
            // One Herdr session per gateway today, and the first is the one
            // every other screen uses -- the same choice `new-task.tsx` makes.
            const sessions = await loadSessions();
            const sessionId = sessions.sessions?.[0]?.id;
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            if (!sessionId) {
              setError(t`This computer has no session to start an agent in.`);
              return false;
            }
            const spawned = await spawnAgent(
              sessionId,
              agentSpawnRequest({ agent: kind, prompt: text, ...(cwd ? { cwd } : {}) })
            );
            if (
              spawned.agentStarted === false ||
              spawned.promptSubmitted === false ||
              spawned.failure
            ) {
              setError(t`Could not start the task.`);
              return false;
            }
            startedThread({
              kind: 'pane',
              serverId,
              sessionId,
              paneId: spawned.paneId,
              agentLabel: kind,
              ...(spawned.agentInstanceId ? { instanceId: spawned.agentInstanceId } : {}),
              title: goalTitle(text),
              lastSent: text,
              sentAtMs: Date.now(),
              setAtMs: Date.now(),
            });
            return true;
          },
          (failure) => {
            setError(describeGatewayFailure(failure, t`Could not start the task.`).message);
            return false;
          }
        );
      },
      () => {
        if (pendingId && !keepRow) useHomeTaskCards.getState().settle(pendingId);
        inFlightRef.current = false;
      }
    );
  }

  /**
   * A goal sent as a ledger task: the composer empties at once and the card's
   * Sent row is the feedback (design §2). A send that fails puts the text
   * back, with the reason under the bar -- unless the reader has started the
   * next goal meanwhile: that stays, and the bar says which goal was not sent.
   */
  function dispatchTask(text: string, open: () => Promise<boolean>): Promise<boolean> {
    if (inFlightRef.current) return Promise.resolve(false);
    void open().then((accepted) => {
      if (accepted || injectDraftRef.current?.(text, { ifEmpty: true })) return;
      const notSent = [t`Could not send`, goalTitle(text)].join(META_SEPARATOR);
      setError((reason) => (reason ? `${notSent}${META_SEPARATOR}${reason}` : notSent));
    });
    return Promise.resolve(true);
  }

  /** A goal, with or without files; `again` preserves the failed row's destination. */
  function sendSessionPrompt(
    text: string,
    attachments: string[],
    again?: { serverId: string; params: HomeSessionParams; folder?: string }
  ): Promise<boolean> {
    return startSession(
      (asid) => sendAgentPrompt(HOME_AGENT_SESSION_ID, asid, { text, attachments }),
      { goal: text, attachments },
      again
    );
  }

  function sendPrompt(text: string, attachments?: string[]): Promise<boolean> {
    // A conversation is targeted: the message is a follow-up there.
    const current = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    if (current && ready) return followUp(current, text, attachments ?? []);
    if (terminalAgent) {
      // The terminal entry of a provider whose ledger carries goals into a
      // pane: the task is the computer's, with the pane as its delivery.
      const paneEntry = ledgerDelivery ? discoveredAgent(terminalAgent) : undefined;
      const paneListed =
        paneEntry?.ledgerDelivery?.includes('pane') ||
        (ledgerDelivery &&
          terminalCatalog
            ?.find((profile) => profile.kind === terminalAgent.agentKind)
            ?.ledgerDelivery?.includes('pane'));
      if (paneListed && !attachments?.length) {
        return dispatchTask(text, () =>
          openLedgerTask(text, {
            delivery: 'pane',
            agentId: paneEntry?.id ?? terminalAgent.agentKind,
          })
        );
      }
      const start = () =>
        startTerminalAgent(
          terminalAgent.agentKind,
          terminalAgent.name,
          terminalAgent.confirmed,
          terminalPromptWithAttachments(text, attachments ?? []),
          ledgerPane,
          folder
        );
      // Optimistic dispatch can restore text only. Keep a file-bearing draft
      // staged until the gateway actually accepts the complete first prompt.
      return attachments?.length ? start() : dispatchTask(text, start);
    }
    if (heldByModelGate()) return Promise.resolve(false);
    // A session entry: a ledger task bound to the provider's native session
    // where the gateway takes the delivery by name and the provider lists it,
    // which is what lets the card follow the work and keep it across this
    // device's restarts. A gateway without that answer, or a provider that
    // does not list it, gets the session opened by Home directly -- the
    // path files and retries take too.
    const sessionEntry = ledgerDelivery && agent ? discoveredAgent(agent) : undefined;
    if (
      sessionEntry?.ledgerDelivery?.includes('session') &&
      !attachments?.length &&
      !startedRef.current
    ) {
      return dispatchTask(text, () => openLedgerTask(text, { delivery: 'session' }));
    }
    // Wait for acceptance so any failure retains the complete draft. Passing
    // the goal also binds Home's status row without opening another screen.
    return sendSessionPrompt(text, attachments ?? []);
  }
  // The composer empties the field as it hands a command over, so a command
  // that did not run puts its line back.
  function runCommand(name: string, args: string) {
    const command = { name, ...(args ? { arguments: args } : {}) };
    // A targeted conversation takes the command or nothing does: a pane's
    // line is put back rather than starting a session on the dock's agent.
    const targeted = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    const line = `/${name.replace(/^\//, '')}${args ? ` ${args}` : ''}`;
    if (targeted?.kind === 'pane') {
      // A pane's agent reads its own commands: the line is typed into it.
      void followUp(targeted, line, []).then((accepted) => {
        if (!accepted) injectDraftRef.current?.(line);
      });
      return;
    }
    void threadAct((_sessionId, asid) => sendAgentCommand(asid, command))
      .then(
        (inThread) =>
          inThread ?? (targeted ? false : startSession((asid) => sendAgentCommand(asid, command)))
      )
      .then((accepted) => {
        if (!accepted) injectDraftRef.current?.(line);
      });
  }
  async function invokeSkill(skill: string, args: string) {
    const targeted = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    if (targeted?.kind === 'pane') {
      // By name, as a session's skill is: the Gateway checks the pane offers it
      // and runs it the way that agent does. The draft stays until it has.
      if (!paneSessionId) return false;
      return recoverWith(
        async () => {
          setError(null);
          await invokePaneSkill(paneSessionId, targeted.paneId, {
            skill,
            ...(args ? { args } : {}),
          });
          return true;
        },
        (failure) => {
          console.warn('Home could not run the skill in its pane:', failure);
          setError(describeFailure(failure));
          return false;
        }
      );
    }
    const accepted =
      (await threadAct((sessionId, asid) => invokeAgentSkill(sessionId, asid, { skill }))) ??
      (targeted
        ? false
        : await startSession((asid) => invokeAgentSkill(HOME_AGENT_SESSION_ID, asid, { skill })));
    // A skill takes no arguments on the wire; what was typed after it is said
    // out loud rather than dropped in silence.
    if (accepted && args)
      showToast({
        variant: 'info',
        title: t`Skill started`,
        message: t`“${args}” was not sent: a skill takes no arguments.`,
      });
    return accepted;
  }
  // What a tap on a Sent row does: a failed send goes again exactly as it was,
  // to the computer it was for; one bound to its session opens it.
  const retryRow = useStableHandler((item: PendingDispatch) => {
    const resend = item.resend;
    if (!resend) return;
    // The retry goes to its own computer and the selection comes back after
    // it; the files staged in the field for the computer the bar names stay.
    const before = useGatewayConnectionStore.getState().record?.serverId;
    retrySwitchBegins();
    void settleAfterAsync(
      async () => {
        const sent = await sendSessionPrompt(resend.text, resend.attachments, {
          serverId: item.serverId,
          params: resend.params,
          ...(resend.folder ? { folder: resend.folder } : {}),
        });
        if (sent) clearDraftRef.current?.(resend.text);
      },
      // Back to where the bar was, however the retry ended -- a throw too.
      async () => {
        if (before && before !== item.serverId && !selectRecordNow(before)) {
          await selectRecord(before).catch(() => false);
        }
        retrySwitchEnds();
      }
    ).catch((failure: unknown) => console.warn('Home could not retry a send:', failure));
  });
  // A row bound to its session reads that session from its own computer until
  // the agent replied and its run ended: then it reads like a task in that
  // state. Only while the app is in front, and only rows still waiting or
  // working.
  const followedBound = useHomeTaskCards((state) =>
    state.pending
      .filter(
        (item) =>
          item.asid !== undefined &&
          !item.failed &&
          item.reply?.state !== 'done' &&
          item.reply?.state !== 'failed'
      )
      .map((item) => item.id)
      .join(',')
  );
  // Kept while Home is merely mounted: tearing this down on blur and back up
  // on focus re-read every followed row's whole transcript on each return
  // from the terminal. The socket watches stay; the poll skips its ticks while
  // Home is not in front (`readInFront`).
  const readInFront = useLatestReader(focused);
  useEffect(() => {
    if (!followedBound || !appActive) return;
    // One read per row at a time: a snapshot takes up to the request budget,
    // which is longer than the poll, and the poll used to stack reads behind
    // a slow one. Where the row's computer has `ws_events`, its session's
    // socket says when something changed and the poll is not run at all.
    const inFlight = new Set<string>();
    const readOne = (item: PendingDispatch) => {
      if (AppState.currentState !== 'active' || inFlight.has(item.id) || !item.asid) return;
      const record = useGatewayConnectionStore
        .getState()
        .records.find((entry) => entry.serverId === item.serverId);
      if (!record) return;
      inFlight.add(item.id);
      void readAgentSessionAt(
        { ...recordEndpoint(record), serverId: record.serverId },
        HOME_AGENT_SESSION_ID,
        item.asid
      )
        .then((snapshot) => {
          if (!snapshot) return;
          const state = boundSessionState(snapshot);
          if (state !== 'waiting') useHomeTaskCards.getState().replied(item.id, state, Date.now());
        })
        .finally(() => inFlight.delete(item.id));
    };
    const rows = useHomeTaskCards
      .getState()
      .pending.filter(
        (item) =>
          item.asid &&
          !item.failed &&
          item.reply?.state !== 'done' &&
          item.reply?.state !== 'failed'
      );
    const capabilities = useServerCapabilities.getState().byServer;
    const watched = rows.filter((item) =>
      capabilities[item.serverId]?.includes(WS_EVENTS_CAPABILITY)
    );
    const polled = rows.filter((item) => !watched.includes(item));
    for (const item of rows) readOne(item);
    // A turn's events arrive in bursts; one read a moment after the last of them.
    const settle = new Map<string, ReturnType<typeof setTimeout>>();
    const releases = watched.map((item) =>
      gatewaySocketFor(item.serverId).watch(item.asid!, {
        onEvent: () => {
          const pending = settle.get(item.id);
          if (pending) clearTimeout(pending);
          settle.set(
            item.id,
            setTimeout(() => {
              settle.delete(item.id);
              readOne(item);
            }, BOUND_SESSION_SETTLE_MS)
          );
        },
        onSubscribed: () => readOne(item),
      })
    );
    const timer =
      polled.length > 0
        ? setInterval(() => {
            if (!readInFront()) return;
            for (const item of polled) readOne(item);
          }, BOUND_SESSION_READ_MS)
        : null;
    return () => {
      if (timer) clearInterval(timer);
      for (const pending of settle.values()) clearTimeout(pending);
      for (const release of releases) release();
    };
  }, [appActive, followedBound, readInFront]);
  const openRow = useStableHandler((item: PendingDispatch) => {
    if (item.asid) void onOpenAgent(item.serverId, item.asid, undefined, HOME_AGENT_SESSION_ID);
  });
  const checkRow = useStableHandler((_item: PendingDispatch) => void checkDelivery());
  useEffect(() => {
    const { setRowActions } = useHomeTaskCards.getState();
    setRowActions({ retry: retryRow, open: openRow, check: checkRow });
    return () => setRowActions(null);
  }, [retryRow, openRow, checkRow]);
  function clientCommand(name: AgentClientCommandId) {
    // A pane's agent has its own `/clear`, `/export` and the rest: the app's
    // client commands are not what it was asked for there.
    const targeted = targetId ? useHomeThreads.getState().byServer[targetId] : undefined;
    if (targeted?.kind === 'pane') {
      const line = `/${name}`;
      void followUp(targeted, line, []).then((accepted) => {
        if (!accepted) injectDraftRef.current?.(line);
      });
      return;
    }
    if (name === 'models') openModelSheet();
  }

  if (servers.length === 0) return null;

  const clearThread = () => {
    if (targetId) useHomeThreads.getState().clear(targetId);
    setUnsure(null);
    setError(null);
  };
  const openThread =
    conversation && onOpenThread
      ? () => {
          closeDrawer();
          onOpenThread(conversation);
        }
      : undefined;
  // This is the same server-scoped thread Send follows, never the agent picker.
  // Live titles already passed the thread-key check above. Keep the recipient
  // visible after typing has replaced the placeholder.
  const replyAgentId =
    thread?.kind === 'session'
      ? thread.agentId
      : thread?.kind === 'pane'
        ? thread.agentLabel
        : undefined;
  const replyAgentName = replyAgentId
    ? agentDisplayName(discoveredAgents, replyAgentId)
    : undefined;
  const replyContext = thread
    ? `${t`Reply to`} ${replyTitle}${replyAgentName ? `${META_SEPARATOR}${replyAgentName}` : ''}`
    : undefined;
  const replyButton = conversation ? (
    <HomeReplyButton target={conversation} controller={drawer} onOpenFull={openThread} />
  ) : null;
  const replyDrawer =
    conversation && drawer.mounted ? (
      <HomeReplyDrawer
        target={conversation}
        controller={drawer}
        agentName={threadAgentName}
        bleed={outerInsets?.horizontal ?? 0}
        maxWidth={drawerMaxWidth}
        onOpenFull={openThread}
      />
    ) : null;
  const bar = (
    <View>
      {thread ? (
        <HomeThreadFeed
          target={thread}
          enabled={appActive && ready && selected}
          inFront={focused}
        />
      ) : null}
      {/* A terminal pane's keys, above the field while its drawer is up. */}
      {conversation?.kind === 'pane' && drawer.mounted ? (
        <HomeReplyKeyRow target={conversation} open={drawer.open} />
      ) : null}
      {visibleUnsure ? (
        <View
          style={[
            styles.error,
            styles.unsure,
            {
              backgroundColor: background(theme.colors.surface),
              borderRadius: profile.chrome.noticeBanner,
            },
          ]}>
          <Text
            testID="home-thread-unsure"
            variant="caption"
            color={theme.colors.warning}
            accessibilityLiveRegion="polite"
            style={styles.unsureText}>
            {t`Not sure it was delivered`}
          </Text>
          <PressableScale
            testID="home-thread-retry"
            accessibilityRole="button"
            accessibilityLabel={t`Retry`}
            hitSlop={6}
            onPress={retryUnsure}>
            <Text variant="caption" weight="semibold" color={theme.colors.primary}>
              {t`Retry`}
            </Text>
          </PressableScale>
          {conversation ? (
            <PressableScale
              testID="home-thread-unsure-show"
              accessibilityRole="button"
              accessibilityLabel={t`Show conversation`}
              hitSlop={6}
              onPress={drawer.show}>
              <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                {t`Show`}
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
      {visibleUnknownDelivery ? (
        <PressableScale
          testID="home-composer-check-delivery"
          accessibilityRole="button"
          accessibilityLabel={t`Check status`}
          disabled={checkingDelivery}
          onPress={() => void checkDelivery()}
          style={styles.error}>
          <Text variant="caption" color={theme.colors.text} accessibilityLiveRegion="polite">
            {[
              t`Delivery not confirmed`,
              goalTitle(visibleUnknownDelivery.goal),
              checkingDelivery ? t`Checking…` : t`Check status`,
            ].join(META_SEPARATOR)}
          </Text>
        </PressableScale>
      ) : null}
      {error ? (
        <Text
          testID="home-composer-error"
          variant="caption"
          color={theme.colors.danger}
          accessibilityLiveRegion="polite"
          style={[
            styles.error,
            {
              backgroundColor: background(theme.colors.surface),
              borderRadius: profile.chrome.noticeBanner,
            },
          ]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
  // The chosen computer is confirmed offline: Send waits, with the reason, as
  // a session observed elsewhere does. A reconnecting one is not offline.
  const offlineComputer = target.kind === 'offline' ? target.server.label : undefined;
  const offlineReason = offlineComputer
    ? (() => {
        const agentName = offlineComputer;
        return t`${agentName} is offline`;
      })()
    : undefined;
  const options = (
    <HomeComposerOptions
      computer={targetServer ? computerLabel : t`No computer online`}
      agent={agentName}
      folder={folderLabel}
      model={modelName}
      mode={shown.mode ?? 'build'}
      modes={modes}
      offline={!ready}
      onComputer={() => {
        beginChoice();
        openTargetPicker();
      }}
      onAgent={
        targetServer
          ? () => {
              beginChoice();
              router.push({
                pathname: '/home-agent',
                params: { serverId: targetServer.serverId },
              });
            }
          : undefined
      }
      onFolder={
        targetServer && ready && selected
          ? () => {
              beginChoice();
              router.push({
                pathname: '/agent-workspace',
                params: {
                  owner: 'home',
                  serverId: targetServer.serverId,
                  sessionId: HOME_AGENT_SESSION_ID,
                  ...(agentId ? { agentId } : {}),
                },
              });
            }
          : undefined
      }
      onModel={features.modelSelection && !terminalAgent ? openModelSheet : undefined}
      onMode={canPickMode && !terminalAgent ? selectMode : undefined}
      replyTitle={replyTitle}
      onNewConversation={() => {
        setOptionsOpen(false);
        // As the drawer's header does: an open drawer settles shut first.
        if (drawer.mounted) closeDrawer(clearThread);
        else clearThread();
      }}
    />
  );
  const parameterButton = (
    <ComposerMenuButton
      testID="home-composer-parameters"
      label={t`Task options`}
      hint={t`Choose computer, agent, folder, mode and model`}
      expanded={optionsOpen}
      onPress={() => setOptionsOpen((open) => !open)}>
      <ThemeIcon
        name="chrome.parameters"
        fallback={ControlsIcon}
        size={18}
        color={optionsOpen ? theme.colors.primary : theme.colors.textMuted}
      />
    </ComposerMenuButton>
  );

  return (
    <AgentComposer
      revealed={revealed}
      accessory={bar}
      dockUnderlay={replyDrawer}
      pinDock={drawer.open}
      fieldBackground={
        <>
          <HomeComposerBackground />
          <View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                left: backgroundOutset?.left ?? 0,
                right: backgroundOutset?.right ?? 0,
                bottom: backgroundOutset?.bottom ?? 0,
              },
            ]}>
            <HomeComposerTransition
              pulse={transitionPulse}
              focused={focused}
              radius={profile.chrome.composerField}
            />
          </View>
        </>
      }
      fieldBackgroundOutset={backgroundOutset ?? undefined}
      fieldBackgroundColor={background(theme.colors.surface)}
      fieldDecoration={decorationOverhang > 0 ? <HomeComposerDecoration /> : undefined}
      fieldDecorationOverhang={decorationOverhang}
      hideFieldDecoration={Boolean(error) || Boolean(visibleUnknownDelivery) || Boolean(thread)}
      fieldTextTopInset={6}
      // Home's field is the dock's only painted surface, on both the phone
      // bar and the Pad cover, so it casts the edge a dock's glass would.
      fieldShadow={appChrome.shadow.homeComposerField}
      toolbarLeading={
        <>
          {parameterButton}
          {replyButton}
        </>
      }
      toolbarMenu={{
        open: optionsOpen,
        onOpenChange: setOptionsOpen,
        content: options,
        testID: 'home-composer-options-menu',
      }}
      hideParameterRow
      flushField
      voiceContext={JSON.stringify([
        HOME_AGENT_SESSION_ID,
        targetId,
        agentId,
        folder ?? defaultCwd,
        shown.mode,
        selectedModel,
      ])}
      mentionComputers={
        thread
          ? thread.kind === 'pane' || threadFeatures.extra.computerTools === true
            ? mentionComputers
            : []
          : agent?.kind === 'terminal' || features.extra.computerTools === true
            ? mentionComputers
            : []
      }
      inputTestID="home-composer-input"
      sendTestID="home-composer-send"
      running={false}
      disabled={target.kind === 'none'}
      interactionBlockedReason={offlineReason}
      blockedReasonInField
      agentName={agentLabel}
      placeholder={replyContext ? '' : t`New conversation with ${agentLabel}`}
      inputAccessibilityLabel={replyContext}
      fieldHeader={
        replyContext ? (
          <View
            testID="home-composer-reply-target"
            accessible
            accessibilityLabel={replyContext}
            accessibilityLiveRegion="polite"
            style={styles.replyContext}>
            <Text variant="caption" color={theme.colors.textMuted}>{t`Reply to`}</Text>
            <View style={styles.replyTarget}>
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
                numberOfLines={1}
                ellipsizeMode="tail">
                {replyTitle}
              </Text>
            </View>
            {replyAgentName ? (
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {replyAgentName}
              </Text>
            ) : null}
          </View>
        ) : undefined
      }
      sessionId={threadSessionId ?? HOME_AGENT_SESSION_ID}
      {...(threadAsid ? { activeAsid: threadAsid } : {})}
      canMentionFiles={
        thread
          ? threadSession
            ? threadFeatures.extra.fileMentions !== false
            : threadPane !== undefined && paneShortcuts?.fileMentions === true
          : !terminalAgent
      }
      {...(threadPane ? { searchFiles: searchPaneFiles } : {})}
      availableAgents={modes}
      skills={
        thread
          ? threadSession && threadFeatures.skills
            ? (threadCatalog?.skills ?? NO_SKILLS)
            : threadPane
              ? paneSkills
              : NO_SKILLS
          : features.skills && !terminalAgent
            ? (catalog?.skills ?? NO_SKILLS)
            : NO_SKILLS
      }
      commands={
        thread
          ? threadSession && threadFeatures.slashCommands
            ? (threadCatalog?.commands ?? NO_COMMANDS)
            : threadPane
              ? paneCommands
              : NO_COMMANDS
          : features.slashCommands && !terminalAgent
            ? (catalog?.commands ?? NO_COMMANDS)
            : NO_COMMANDS
      }
      // `/models` opens the dock's own model sheet, which is the targeted
      // session's only when that session runs the dock's agent.
      hiddenClientCommands={homeHiddenClientCommands(
        thread && !(threadSession && threadCatalogAgentId === agentId)
          ? { modelSelection: false }
          : features
      )}
      selectedAgent={shown.mode}
      selectedModel={selectedModel}
      modelName={modelName}
      canPickMode={canPickMode && !terminalAgent}
      // A follow-up takes files where its own conversation does: a session by
      // its agent's `attachments`, a pane as paths in the line.
      canAttach={
        thread?.kind === 'session'
          ? threadFeatures.attachments
          : thread?.kind === 'pane' || Boolean(terminalAgent) || features.attachments
      }
      attachmentTargetId={targetId}
      bottomInset={bottomInset}
      topInset={topInset}
      outerInsets={outerInsets}
      sideInsets={sideInsets}
      bar={edgeBar}
      fieldLines={Math.max(3, fieldLines ?? 3)}
      compact
      autoHide={autoHide}
      onFieldFocus={(focused) => {
        if (focused) setOptionsOpen(false);
        onFieldFocus?.(focused);
      }}
      onDockHeight={(height, clipHeight) => {
        setDockClip(clipHeight);
        onDockHeight?.(height, clipHeight);
      }}
      onSend={sendPrompt}
      onAbort={async () => {}}
      onSelectAgentMode={selectMode}
      onOpenModelSheet={features.modelSelection && !terminalAgent ? openModelSheet : undefined}
      onOpenDiffSheet={() => {}}
      onRunCommand={runCommand}
      onInvokeSkill={invokeSkill}
      onClientCommand={clientCommand}
      injectDraftRef={injectDraftRef}
      draftMemory={HOME_DOCK_DRAFT}
      clearDraftRef={clearDraftRef}
      holdStagedAttachments={holdStagedFiles}
    />
  );
}

/** How often a row bound to its session reads that session, while it waits or works. */
const BOUND_SESSION_READ_MS = 5_000;
/** How long after a session's last event its snapshot is read, so a burst costs one read. */
const BOUND_SESSION_SETTLE_MS = 1_500;

/** Failed rows' retries under way: their switch of the selection holds the staged files. */
let retrySwitches = 0;
function retrySwitchBegins(): void {
  retrySwitches += 1;
}
function retrySwitchEnds(): void {
  retrySwitches -= 1;
}

/**
 * What the dock's staged files are held across: leaving Home while a failed
 * send still holds files -- to the setup guide the dock opened, or anywhere
 * else -- and the switch a failed row's retry makes to its own computer and
 * back.
 */
function holdStagedFiles(reason: 'blur' | 'switch'): boolean {
  if (reason === 'switch') return retrySwitches > 0;
  return useHomeTaskCards
    .getState()
    .pending.some((item) => item.failed === true && (item.resend?.attachments.length ?? 0) > 0);
}

const styles = StyleSheet.create({
  replyContext: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 2,
  },
  replyTarget: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  error: { padding: 8, marginBottom: 4, width: '100%' },
  unsure: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  unsureText: { flexShrink: 1 },
});
