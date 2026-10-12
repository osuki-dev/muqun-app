import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useIsFocused, useRouter } from 'expo-router';
import { SlidersHorizontal } from 'lucide-react-native';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AgentComposer, type DraftInjector } from '@/components/agent-composer';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { HomeLaunchController } from '@/components/home-launch-actions';
import type { DockAutoHide } from '@/hooks/use-dock-auto-hide';
import { HomeComposerOptions } from '@/components/home-composer-options';
import {
  HomeComposerBackground,
  useHomeComposerBackgroundOutset,
  HomeComposerDecoration,
  useHomeComposerDecorationOverhang,
} from '@/components/home-composer-background';
import { PressableScale } from '@/components/pressable-scale';
import { composerStyles } from '@/components/terminal-composer';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useAgentFeatures, useAgentsDiscoveryRefresh } from '@/hooks/use-agent-features';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';
import { META_SEPARATOR } from '@/lib/home-continue-row';
import { boundSessionState, goalTitle, type PendingDispatch } from '@/lib/home-computer-cards';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentClientCommandId } from '@/lib/agent-commands';
import { classifyAgentRequestError } from '@/lib/agent-request-error';
import { unsupportedModelRefs } from '@/lib/agent-session-defaults';
import {
  createAgentSession,
  formatModelName,
  getAgentCatalog,
  listAgentSessions,
  invokeAgentSkill,
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
import { loadSessions, spawnAgent } from '@/lib/gateway-client';
import { homeAgentOptions, resolveHomeAgent } from '@/lib/home-agent-choice';
import { describeGatewayFailure } from '@/lib/network-error';
import {
  hasTaskLedgerCreate,
  TASK_DEFAULTS_CAPABILITY,
  TASK_LEDGER_PANE_CAPABILITY,
  type LedgerTaskRequest,
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
import { useFleetPeers } from '@/stores/fleet-peers';
import { fetchFleetPeers, hasFleetPeers } from '@/lib/fleet-peers';
import { recordEndpoint } from '@/hooks/use-server-tasks';
import { mentionedComputers, taskMentions, type MentionComputer } from '@/lib/composer-mentions';
import { useServerTasksStore } from '@/stores/server-tasks';
import type { ServerReachability } from '@/lib/server-reachability';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeComposerSheet } from '@/stores/home-composer-sheet';

const FLASH_IN_MS = 120;
const FLASH_OUT_MS = 600;

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
 * session -- `createAgentSession`, then the prompt -- and only then opens that
 * session as an existing one. A failure keeps the draft and the staged files
 * in the dock and says why under the bar; nothing is retried by itself.
 */
/** How many of the target's recent sessions are read for models it refused. */
const REFUSAL_SESSIONS_READ = 30;
/** How long Send waits on the target's links before sending without mentions. */
const MENTIONS_READ_TIMEOUT_MS = 2_000;

export function HomeComposerDock({
  controller,
  reachabilityByServer,
  targetPulse = 0,
  bottomInset = 0,
  topInset = 0,
  outerInsets,
  edgeBar,
  fieldLines,
  autoHide,
  onFieldFocus,
  onDockHeight,
  onOpenAgent,
}: {
  controller: HomeLaunchController;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  /**
   * Bumped when Home sets the target from outside the dock (a tap on a
   * computer row); each bump flashes the assignment bar.
   */
  targetPulse?: number;
  bottomInset?: number;
  topInset?: number;
  /** Phone-only space outside the field; Pad keeps its column geometry. */
  outerInsets?: { horizontal: number; bottom: number };
  /** See `AgentComposer`'s `bar`. */
  edgeBar?: { inset: number };
  /** See `AgentComposer`'s `fieldLines`. */
  fieldLines?: number;
  /** See `AgentComposer`'s `autoHide`. */
  autoHide?: DockAutoHide;
  /** See `AgentComposer`'s `onFieldFocus`. */
  onFieldFocus?: (focused: boolean) => void;
  onDockHeight?: (height: number) => void;
  onOpenAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => Promise<HomeCommandResult>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const decorationOverhang = useHomeComposerDecorationOverhang();
  const backgroundOutset = useHomeComposerBackgroundOutset();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [optionsHeightAnimating, setOptionsHeightAnimating] = useState(false);
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

  // The assignment bar lights up for a moment whenever the target is set by
  // hand, so the change is seen, not inferred.
  const flash = useSharedValue(0);
  useEffect(() => {
    if (targetPulse === 0) return;
    flash.set(
      withSequence(
        withTiming(1, { duration: FLASH_IN_MS }),
        withTiming(0, { duration: FLASH_OUT_MS })
      )
    );
  }, [targetPulse, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.get() }));

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
   * draft names none, the target cannot link, or it did not answer.
   */
  const mentionsIn = async (goal: string, serverId: string): Promise<string[]> => {
    // Only a draft that names a computer (`@src/…` is a file) asks, and
    // briefly: Send does not wait long on a slow computer for this.
    const named = mentionedComputers(
      goal,
      mentionComputers.map((computer) => computer.name)
    );
    if (!fleetCapable || named.length === 0) return [];
    const target = servers.find((server) => server.serverId === serverId);
    if (!target || target.sshTunnel) return [];
    const answer = await fetchFleetPeers(recordEndpoint(target), MENTIONS_READ_TIMEOUT_MS);
    // What the target said about its links is news for the fleet store too.
    useFleetPeers.getState().record(serverId, answer);
    return answer.ok ? taskMentions(goal, mentionComputers, answer.peers.peers) : [];
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
  const agent = resolveHomeAgent(
    homeAgentOptions(discovery, terminalCatalog),
    chosenAgentKey,
    terminalCatalog !== undefined
  );
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
  const agentName = agent?.name ?? '';
  const agentLabel = agentName || computerLabel;
  // A gateway that opens ledger tasks gets the goal as one: Home's cards then
  // see the work, and the work it delegates, live.
  const ledgerCreate = useServerCapabilities((state) =>
    targetId ? hasTaskLedgerCreate(state.byServer[targetId]) : false
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

  const selectModel = useStableHandler((model: ModelRef) => {
    if (targetId) chooseModel(targetId, agentId, model);
  });
  useEffect(() => () => useHomeComposerSheet.getState().release(selectModel), [selectModel]);
  function openModelSheet() {
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
    if (targetId) chooseMode(targetId, agentId, mode, bringsModel);
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
    if (target.kind === 'offline') {
      openTargetPicker();
      return null;
    }
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
        const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
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

  async function openLedgerTask(text: string): Promise<boolean> {
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
        const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
        return recoverWith(
          async () => {
            if (!owns()) {
              setError(t`Computer unavailable.`);
              return false;
            }
            pendingId = useHomeTaskCards.getState().dispatched(serverId, text);
            const mentions = await mentionsIn(text, serverId);
            const created = await sendHomeLedger(
              serverId,
              {
                goal: text,
                ...(mentions.length ? { mentions } : {}),
                ...(params.agentId ? { agentId: params.agentId } : {}),
                ...(folder ? { cwd: folder } : {}),
                ...(params.mode ? { mode: params.mode } : {}),
                ...(params.model ? { model: ledgerModelId(params.model) } : {}),
                // Applied at session creation by a gateway that takes it (Gateway
                // Task 15); an older one ignores it, and the switch below sets it.
                ...(params.model?.variant ? { variant: params.model.variant } : {}),
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
            if (pickedModel?.variant) {
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
              const mentions = await mentionsIn(text, serverId);
              if (!owns()) {
                setError(t`Computer unavailable.`);
                return false;
              }
              const created = await sendHomeLedger(
                serverId,
                {
                  goal: text,
                  ...(mentions.length ? { mentions } : {}),
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
              const { task, paneId } = created;
              // The accepted task owns its failure or a still-pending binding.
              if (task.state === 'failed' || !paneId) {
                if (task.state === 'failed') setError(task.summary ?? t`Could not start the task.`);
                return true;
              }
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

  /** A goal with files, to a session; `again` sends a failed row's payload as it was. */
  function sendWithFiles(
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
    if (terminalAgent) {
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
    // Attachments ride on a prompt to a session; the ledger route takes text
    // only, so a send with files keeps the session path. So does a retry onto
    // the session a failed send left. Either way Home stays put.
    if (ledgerCreate && !attachments?.length && !startedRef.current) {
      return dispatchTask(text, () => openLedgerTask(text));
    }
    // Attachments cannot be put back once the field lets them go, so a send
    // with files is answered for real: a failure leaves text and files where
    // they are, and the row keeps them to send again.
    if (attachments?.length) return sendWithFiles(text, attachments);
    return dispatchTask(text, () =>
      startSession((asid) => sendAgentPrompt(HOME_AGENT_SESSION_ID, asid, { text }))
    );
  }
  // The composer empties the field as it hands a command over, so a command
  // that did not run puts its line back.
  function runCommand(name: string, args: string) {
    void startSession((asid) =>
      sendAgentCommand(asid, { name, ...(args ? { arguments: args } : {}) })
    ).then((accepted) => {
      if (!accepted)
        injectDraftRef.current?.(`/${name.replace(/^\//, '')}${args ? ` ${args}` : ''}`);
    });
  }
  async function invokeSkill(skill: string, args: string) {
    const accepted = await startSession((asid) =>
      invokeAgentSkill(HOME_AGENT_SESSION_ID, asid, { skill })
    );
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
  /** Empties the field if it still holds what a failed row just sent. */
  const clearDraftRef = useRef<((text: string) => void) | null>(null);
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
        const sent = await sendWithFiles(resend.text, resend.attachments, {
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
  useEffect(() => {
    if (!followedBound) return;
    const read = () => {
      if (AppState.currentState !== 'active') return;
      for (const item of useHomeTaskCards.getState().pending) {
        if (!item.asid || item.failed || item.reply?.state === 'done') continue;
        if (item.reply?.state === 'failed') continue;
        const record = useGatewayConnectionStore
          .getState()
          .records.find((entry) => entry.serverId === item.serverId);
        if (!record) continue;
        const asid = item.asid;
        void readAgentSessionAt(recordEndpoint(record), HOME_AGENT_SESSION_ID, asid).then(
          (snapshot) => {
            if (!snapshot) return;
            const state = boundSessionState(snapshot);
            if (state !== 'waiting')
              useHomeTaskCards.getState().replied(item.id, state, Date.now());
          }
        );
      }
    };
    read();
    const timer = setInterval(read, BOUND_SESSION_READ_MS);
    return () => clearInterval(timer);
  }, [followedBound]);
  const openRow = useStableHandler((item: PendingDispatch) => {
    if (item.asid) void onOpenAgent(item.serverId, item.asid, undefined, HOME_AGENT_SESSION_ID);
  });
  useEffect(() => {
    const { setRowActions } = useHomeTaskCards.getState();
    setRowActions({ retry: retryRow, open: openRow });
    return () => setRowActions(null);
  }, [retryRow, openRow]);
  function clientCommand(name: AgentClientCommandId) {
    if (name === 'models') openModelSheet();
  }

  if (servers.length === 0) return null;

  const bar = (
    <View>
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
      <HomeComposerOptions
        open={optionsOpen}
        onVisibilityChange={setOptionsVisible}
        onHeightAnimationChange={setOptionsHeightAnimating}
        computer={targetServer ? computerLabel : t`No computer online`}
        agent={agentName}
        folder={folderLabel}
        model={modelName}
        mode={shown.mode ?? 'build'}
        modes={modes}
        offline={!ready}
        onComputer={openTargetPicker}
        onAgent={
          targetServer
            ? () =>
                router.push({
                  pathname: '/home-agent',
                  params: { serverId: targetServer.serverId },
                })
            : undefined
        }
        onFolder={
          targetServer && ready && selected
            ? () =>
                router.push({
                  pathname: '/agent-workspace',
                  params: {
                    owner: 'home',
                    serverId: targetServer.serverId,
                    sessionId: HOME_AGENT_SESSION_ID,
                    ...(agentId ? { agentId } : {}),
                  },
                })
            : undefined
        }
        onModel={features.modelSelection && !terminalAgent ? openModelSheet : undefined}
        onMode={canPickMode && !terminalAgent ? selectMode : undefined}
      />
    </View>
  );
  const parameterButton = (
    <PressableScale
      testID="home-composer-parameters"
      accessibilityRole="button"
      accessibilityLabel={t`Task options`}
      accessibilityHint={t`Choose computer, agent, folder, mode and model`}
      accessibilityState={{ expanded: optionsOpen }}
      onPress={() => setOptionsOpen((open) => !open)}
      style={[
        composerStyles.button,
        { borderRadius: profile.chrome.roundControl },
        optionsOpen && { backgroundColor: background(theme.colors.primarySubtle) },
      ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: profile.chrome.roundControl,
            backgroundColor: background(theme.colors.primarySubtle),
          },
          flashStyle,
        ]}
      />
      <ThemeIcon
        name="chrome.parameters"
        fallback={SlidersHorizontal}
        size={18}
        color={optionsOpen ? theme.colors.primary : theme.colors.textMuted}
      />
    </PressableScale>
  );

  return (
    <AgentComposer
      accessory={bar}
      accessoryHeightAnimating={optionsHeightAnimating || optionsOpen !== optionsVisible}
      fieldBackground={<HomeComposerBackground />}
      fieldBackgroundOutset={backgroundOutset ?? undefined}
      fieldBackgroundColor={background(theme.colors.surface)}
      fieldDecoration={decorationOverhang > 0 ? <HomeComposerDecoration /> : undefined}
      fieldDecorationOverhang={decorationOverhang}
      hideFieldDecoration={
        optionsOpen || optionsVisible || Boolean(error) || Boolean(visibleUnknownDelivery)
      }
      fieldTextTopInset={6}
      toolbarLeading={parameterButton}
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
      mentionComputers={mentionComputers}
      inputTestID="home-composer-input"
      sendTestID="home-composer-send"
      running={false}
      disabled={target.kind === 'none'}
      agentName={agentLabel}
      sessionId={HOME_AGENT_SESSION_ID}
      availableAgents={modes}
      skills={features.skills && !terminalAgent ? (catalog?.skills ?? NO_SKILLS) : NO_SKILLS}
      commands={
        features.slashCommands && !terminalAgent ? (catalog?.commands ?? NO_COMMANDS) : NO_COMMANDS
      }
      hiddenClientCommands={homeHiddenClientCommands(features)}
      selectedAgent={shown.mode}
      selectedModel={selectedModel}
      modelName={modelName}
      canPickMode={canPickMode && !terminalAgent}
      canAttach={Boolean(terminalAgent) || features.attachments}
      attachmentTargetId={targetId}
      bottomInset={bottomInset}
      topInset={topInset}
      outerInsets={outerInsets}
      bar={edgeBar}
      fieldLines={Math.max(3, fieldLines ?? 3) + 1}
      compact
      autoHide={autoHide}
      onFieldFocus={(focused) => {
        if (focused) setOptionsOpen(false);
        onFieldFocus?.(focused);
      }}
      onDockHeight={onDockHeight}
      onSend={sendPrompt}
      onAbort={async () => {}}
      onSelectAgentMode={selectMode}
      onOpenModelSheet={features.modelSelection && !terminalAgent ? openModelSheet : undefined}
      onOpenDiffSheet={() => {}}
      onRunCommand={runCommand}
      onInvokeSkill={invokeSkill}
      onClientCommand={clientCommand}
      injectDraftRef={injectDraftRef}
      clearDraftRef={clearDraftRef}
      holdStagedAttachments={holdStagedFiles}
    />
  );
}

/** How often a row bound to its session reads that session, while it waits or works. */
const BOUND_SESSION_READ_MS = 5_000;

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
  error: { padding: 8, marginBottom: 4, width: '100%' },
});
