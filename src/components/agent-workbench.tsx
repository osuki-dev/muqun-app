import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  RefreshControl,
  Share,
} from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Bot,
  ChevronDown,
  FolderGit2,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react-native';
import {
  LegendList,
  type LegendListRenderItemProps,
  type LegendListRef,
} from '@legendapp/list/react-native';
import { PressableScale } from '@/components/pressable-scale';
import { GlassChrome } from '@/components/glass-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import Animated from 'react-native-reanimated';
import { withAlpha } from '@/lib/color';
import { DURATION, fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { TerminalNotice, terminalNoticeStyles } from '@/components/terminal-notice';
import { StatusDot } from '@/components/status-dot';
import {
  getAgentSessionSnapshot,
  listAgentSessions,
  createAgentSession,
  sendAgentPrompt,
  abortAgentSession,
  switchAgentModel,
  switchAgentMode,
  replyAgentPermission,
  replyAgentForm,
  getAgentVcsDiff,
  getAgentCatalog,
  getAgentProjects,
  openAgentSessionStream,
  getAgentTimelineDelta,
  backgroundAgentSession,
  compactAgentSession,
  getAgentContext,
  listAgentSessionChildren,
  listAgentShells,
  listAgentInbox,
  cancelAgentInboxItem,
  clearAgentRevert,
  exportAgentSession,
  revertAgentSession,
  sendAgentCommand,
  sortTimeline,
  isBusyStatus,
  inboxItemText,
  type AgentContextUsage,
  type AgentDomainEvent,
  type AgentRunStatus,
  type AgentSessionInfo,
  type CommandInfo,
  type ShellInfo,
  type CompactionReason,
  type InboxItem,
  type TimelineItem,
  type PermissionRequest,
  type FormRequest,
  type ModelRef,
  type PermissionDecision,
  type AgentInfo,
  type SkillInfo,
  type AgentProject,
} from '@/lib/agent-session';
import { dangerousPermissionReason, yoloDecision } from '@/lib/agent-permission-safety';
import { classifyTool, capText } from '@/lib/agent-tool-output';
import type { AgentClientCommandId } from '@/lib/agent-commands';
import {
  buildSessionStrip,
  indexSessions,
  parentOf,
  rootOf,
  sessionsInWorkspace,
  type ChildrenByParent,
} from '@/lib/agent-session-tree';
import { workspaceDisplayName } from '@/lib/agent-protocol';
import { useAgentSessionState } from '@/stores/agent-session-state';
import { useAgentPermissionStore } from '@/stores/agent-permissions';
import { useAppActive } from '@/hooks/use-app-active';
import type { SessionAsset } from '@/lib/session-assets';
import {
  EMPTY_TODOS,
  useAgentSheetBridge,
  type AgentSheetActions,
  type AgentSheetSnapshot,
} from '@/stores/agent-sheet-bridge';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { AssetViewer } from '@/components/asset-viewer';
import { assetFromToolFile } from '@/lib/session-assets';
import {
  AgentAssistantMessage,
  AgentUserMessage,
  type AgentToolActions,
} from './agent-message-block';
import {
  buildTimelineGroupsCached,
  createTimelineGroupCache,
  type TimelineRenderGroup,
} from '@/lib/agent-timeline-groups';
import { AgentPermissionCard } from './agent-permission-card';
import { AgentFormCard } from './agent-form-card';
import { AgentComposer } from './agent-composer';
import { runningShellCount } from '@/components/agent-background-tray';
import { ThinkingIndicator } from './agent-thinking-indicator';
import { AGENT_TYPE } from '@/constants/agent-type';
import { KeyboardInset } from '@/components/keyboard-inset';
import { gatewayAuthHeaders, gatewayUrl } from '@/lib/gateway-client';

/**
 * How many history timeline items the workbench reveals per page. The gateway
 * timeline only supports forward deltas, so history is paged on the client by
 * growing the rendered window downwards from the latest page.
 */
const HISTORY_PAGE_SIZE = 40;

/**
 * Distance from the bottom, in pixels, within which streaming output may keep
 * the list pinned to the latest message. Beyond it, the reader is browsing
 * history and new output must not move their viewport.
 */
const NEAR_BOTTOM_PX = 120;

function formatAgentErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const str = err instanceof Error ? err.message : String(err);
  if (
    str.includes('agent_engine_error') ||
    str.includes('agent_unavailable') ||
    str.includes('502') ||
    str.includes('503') ||
    str.includes('Connection refused') ||
    str.includes('Network error communicating with agent engine') ||
    str.includes('error sending request')
  ) {
    return 'OpenCode service is offline on the host. Please run "opencode serve --service" to start it.';
  }
  return str;
}

export interface AgentWorkbenchProps {
  sessionId: string;
  initialAsid?: string;
  topInset?: number;
  bottomInset?: number;
  createNewSessionRef?: React.MutableRefObject<(() => void) | null>;
  /** Wired to the workbench's abort call so a header can expose a Stop control. */
  abortSessionRef?: React.MutableRefObject<(() => void) | null>;
}

export const AgentWorkbench = memo(function AgentWorkbench({
  sessionId,
  initialAsid,
  topInset = 0,
  bottomInset = 0,
  createNewSessionRef,
  abortSessionRef,
}: AgentWorkbenchProps) {
  const { t } = useLingui();
  const router = useRouter();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = usePaneChatMarkdownStyle();
  const listRef = useRef<LegendListRef>(null);
  const injectDraftRef = useRef<((text: string) => void) | null>(null);

  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  const [activeAsid, setActiveAsid] = useState<string | undefined>(initialAsid);
  const [sessionInfo, setSessionInfo] = useState<AgentSessionInfo | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  // Index into `timeline` where the rendered window starts; history above it is
  // paged in on demand so entering a session lands on the latest messages.
  const [windowStart, setWindowStart] = useState(0);
  // Whether a pull for earlier history is still being answered.
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  /**
   * Where the rendered window starts, mirrored for the resync path.
   *
   * A ref rather than a dependency: `loadSnapshot` is what the snapshot effect
   * runs, and taking `windowStart` as a dependency would refetch the whole
   * session every time the reader pulled in a page of history.
   */
  const windowStartRef = useRef(0);
  useEffect(() => {
    windowStartRef.current = windowStart;
  }, [windowStart]);
  /**
   * The session on screen, for the answers that arrive later.
   *
   * A catch-up request started for one session can land after the reader has
   * switched to another; the answer is then about a transcript that is no
   * longer on screen, and applying it would splice one session's rows into
   * another's.
   */
  const activeAsidRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    activeAsidRef.current = activeAsid;
  }, [activeAsid]);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  const [forms, setForms] = useState<FormRequest[]>([]);
  // What is waiting behind the current turn, as the gateway last stated it.
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  // A compaction in flight, which is a pill above the composer rather than a
  // row: the row lands in the timeline when the boundary is reached.
  const [compaction, setCompaction] = useState<{
    status: 'running' | 'failed';
    reason: CompactionReason;
  } | null>(null);
  // Highest timeline sequence seen; `after=`-style bookkeeping. A ref, never
  // state: bumping it must not re-run the stream effect or re-render anything.
  const lastSeqRef = useRef<number>(0);
  const [loading, setLoading] = useState(true);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  // Whether the reader is browsing history, which is what shows the
  // jump-to-latest button.
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Attachment image preview. The shared lightbox, not a second copy of it:
  // `ImagePreviewModal` already owns pinch, drag-to-dismiss and the paging.
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);
  // A file a tool returned -- a PDF from `read`, say -- opened in the same
  // viewer the artifacts list uses rather than in a second one.
  const [openToolAsset, setOpenToolAsset] = useState<SessionAsset | null>(null);

  const [selectedModel, setSelectedModel] = useState<ModelRef | undefined>(undefined);
  /**
   * The agent the session runs, and whether the *reader* chose it.
   *
   * It used to start as `'build'` and be sent on every session create, which
   * overrode whatever the host had configured. The contract is explicit about
   * this: omitting `model` and `agent` is how a new session gets the user's own
   * defaults, and the gateway no longer substitutes one. So what is sent on a
   * create is what the reader picked, and nothing when they have picked
   * nothing -- while the chips still show the catalog's `defaults`, so the
   * screen is not blank about which model is about to run.
   */
  const [selectedAgent, setSelectedAgent] = useState<string | undefined>(undefined);
  const pickedAgentRef = useRef(false);
  const pickedModelRef = useRef(false);
  // YOLO mode: every permission request is answered automatically, `allow`
  // except for the irreversibly dangerous commands the safety list denies.
  // Mirrored in a ref so the stream handler sees the current value without
  // re-subscribing the SSE connection on every toggle.
  const yoloModeRef = useRef(false);
  const [yoloMode, setYoloModeState] = useState(false);
  const setYoloMode = useCallback((next: boolean) => {
    yoloModeRef.current = next;
    setYoloModeState(next);
  }, []);
  // The model the workbench has actually settled on, tracked in a ref so the
  // catalog's async default cannot clobber the session model the server
  // restored: whichever source writes first wins, but a session's own model
  // must never be overwritten by the catalog catch-all afterwards.
  const appliedModelRef = useRef<ModelRef | undefined>(undefined);

  const applySelectedModel = useCallback((model: ModelRef | undefined) => {
    appliedModelRef.current = model;
    setSelectedModel(model);
  }, []);

  /**
   * What a `POST /api/agent-sessions` carries.
   *
   * Only the parts the reader actually chose. Omitting `model` is the
   * documented way to get the user's configured default, and a display
   * fallback sent as a real field is not a default -- it is this app
   * overriding the host.
   */
  const newSessionParams = useCallback(
    (directory?: string) => ({
      ...(pickedAgentRef.current && selectedAgent ? { agent: selectedAgent } : {}),
      ...(pickedModelRef.current && selectedModel ? { model: selectedModel } : {}),
      ...(directory ? { directory } : {}),
    }),
    [selectedAgent, selectedModel]
  );
  const [showReasoning, setShowReasoning] = useState<boolean>(true);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  // The catalog's own slash commands, which go to `POST …/command` rather than
  // into the prompt as text.
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  /**
   * Everything still in the model's context, i.e. after the last compaction.
   *
   * Not the same number as `info.tokens`, which is what the session has spent
   * in total: a compaction drops the first and leaves the second alone, and a
   * gauge drawn from the spend would never come down.
   */
  const [contextUsage, setContextUsage] = useState<AgentContextUsage | null>(null);
  /**
   * The subagent sessions under whichever root is open, keyed by parent.
   *
   * The list route answers with `roots=true`, so a subagent never arrives in
   * it; `GET …/children` is the only way to see one, and it is asked for per
   * parent rather than for the whole workspace -- a session the reader is not
   * looking at has no tree worth fetching.
   */
  const [childrenByParent, setChildrenByParent] = useState<ChildrenByParent>({});
  /**
   * What is still running after the agent moved on.
   *
   * Detached tools keep running and are readable through `/api/agent-shells`;
   * there is no event for them, so the list is asked for at the moments it can
   * have changed -- entering a session, a turn ending, and right after
   * something was detached.
   */
  const [shells, setShells] = useState<readonly ShellInfo[]>([]);
  const [knownProjects, setKnownProjects] = useState<AgentProject[]>([]);
  const [activeDirectory, setActiveDirectory] = useState<string | undefined>(undefined);

  // Load workspace catalog (available agents, skills & models)
  useEffect(() => {
    let mounted = true;
    getAgentCatalog(sessionId)
      .then((catalog) => {
        if (!mounted) return;
        if (catalog?.agents && catalog.agents.length > 0) {
          setAvailableAgents(catalog.agents);
        }
        if (catalog?.skills && catalog.skills.length > 0) {
          setSkills(catalog.skills);
        }
        setCommands(catalog?.commands ?? []);
        // The host's own defaults, shown as the current selection. What was
        // here before was a guess -- the first model whose id contained "free"
        // or "spark" -- and it was then *sent* on every session create, so a
        // host configured for something else got this app's guess instead.
        if (catalog?.defaults.model && !appliedModelRef.current) {
          applySelectedModel(catalog.defaults.model);
        }
        if (catalog?.defaults.agent && !pickedAgentRef.current) {
          setSelectedAgent(catalog.defaults.agent);
        }
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
      });
    return () => {
      mounted = false;
    };
  }, [sessionId, applySelectedModel]);

  const initialCheckDoneRef = useRef(Boolean(initialAsid));

  // Load available sessions if no activeAsid
  const refreshSessions = useCallback(async () => {
    try {
      // Roots only, and scoped to the workspace on screen: a subagent session
      // is a row in its parent's tree, never a sibling of it in the strip.
      const list = await listAgentSessions(sessionId, {
        roots: true,
        ...(activeDirectory ? { directory: activeDirectory } : {}),
      });
      setIsOffline(false);
      if (list) {
        setSessions(list);
        if (list.length > 0 && !activeAsid) {
          setActiveAsid(list[0].asid);
          setSessionInfo(list[0]);
          if (list[0].model) {
            applySelectedModel(list[0].model);
          }
          if (list[0].agent) setSelectedAgent(list[0].agent);
        } else if (list.length === 0) {
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    } catch (err) {
      console.warn('Failed to list agent sessions:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes('502') ||
        errMsg.includes('503') ||
        errMsg.includes('agent_engine_error') ||
        errMsg.includes('agent_unavailable') ||
        errMsg.includes('Network error')
      ) {
        setIsOffline(true);
      }
      setLoading(false);
    } finally {
      initialCheckDoneRef.current = true;
    }
  }, [sessionId, activeAsid, activeDirectory, applySelectedModel]);

  const handleTimelineScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentSize.height <= 0) return;
    const distanceFromBottom = contentOffset.y + layoutMeasurement.height - contentSize.height;
    // For the jump-to-latest affordance; React bails out when the value is
    // unchanged, so streaming near the bottom costs nothing.
    setIsNearBottom(distanceFromBottom < NEAR_BOTTOM_PX);
  }, []);

  const handleJumpToLatest = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Initial load
  useEffect(() => {
    void refreshSessions().catch(() => {});
  }, [refreshSessions]);

  // YOLO answers every permission request itself: `allow` for anything the
  // safety list lets through, `deny` (with a report) for irreversibly
  // destructive commands — this is the only honesty YOLO mode has.
  const handleAutoPermission = useCallback(
    (req: PermissionRequest) => {
      if (!activeAsid) return;
      const decision = yoloDecision(req);
      void replyAgentPermission(sessionId, activeAsid, req.id, decision).catch((err) => {
        console.warn('YOLO permission reply failed:', err);
      });
      const danger = dangerousPermissionReason(req);
      if (danger) {
        showToast({
          variant: 'danger',
          title: t`Blocked by agent safety`,
          message: req.resources[0] ?? t`Unknown command`,
        });
      }
    },
    [activeAsid, sessionId, showToast, t]
  );

  const refreshShells = useCallback(async () => {
    setShells(await listAgentShells(activeDirectory));
  }, [activeDirectory]);

  const refreshInbox = useCallback(async () => {
    if (!activeAsid) {
      setInbox([]);
      return;
    }
    setInbox(await listAgentInbox(activeAsid));
  }, [activeAsid]);

  /**
   * What the model can still see, read from the engine rather than guessed.
   *
   * Asked for on entering a session, when a turn ends, and when a compaction
   * finishes -- the three moments the answer can have changed. Never on a
   * stream tick: it is a request, and the gauge does not need to be live to
   * the token.
   */
  const refreshContext = useCallback(async () => {
    if (!activeAsid) return;
    const usage = await getAgentContext(activeAsid);
    setContextUsage(usage);
  }, [activeAsid]);

  // Load full snapshot when activeAsid changes
  /**
   * Refetch the session, either as an arrival or as a correction.
   *
   * `mode: 'enter'` is the reader opening a session: the spinner is honest,
   * the window lands on the newest page and the list pins to the end, because
   * that is where they asked to be.
   *
   * `mode: 'silent'` is `agent.resync` -- the gateway saying its event log
   * overflowed and what the app holds may have gaps. That is not the reader
   * doing anything. It used to run the same path: the transcript was swapped
   * for a full-screen spinner, `windowStart` reset to the newest page, and the
   * viewport re-pinned to the bottom -- so a reader three screens up reading a
   * diff was thrown to the end of the conversation by a housekeeping event
   * they had no part in. Nothing moves now: the window is re-anchored on the
   * row that was at its top, and the list re-pins only for a reader who was
   * already at the bottom.
   */
  const loadSnapshot = useCallback(
    async (mode: 'enter' | 'silent' = 'enter') => {
      if (!activeAsid) {
        if (initialCheckDoneRef.current) {
          setLoading(false);
        }
        return;
      }
      if (mode === 'enter') setLoading(true);
      try {
        const snap = await getAgentSessionSnapshot(sessionId, activeAsid);
        const info = snap.info;
        if (info) {
          setSessionInfo(info);
          if (info.directory) setActiveDirectory(info.directory);
        }
        setInbox(snap.inbox);

        if (mode === 'enter') {
          setTimeline(snap.timeline);
          // Enter every session on its latest page: only the newest slice is
          // rendered at first and older history loads on demand from the top.
          setWindowStart(Math.max(0, snap.timeline.length - HISTORY_PAGE_SIZE));
          setIsNearBottom(true);
        } else {
          // Hold the reader's place across the correction. The row that was at
          // the top of the window is the anchor: its index has moved, because
          // that is what a resync means, so the window start moves with it.
          setTimeline((previous) => {
            const anchorId = previous[windowStartRef.current]?.id;
            const anchorIndex = anchorId
              ? snap.timeline.findIndex((item) => item.id === anchorId)
              : -1;
            setWindowStart(
              anchorIndex >= 0 ? anchorIndex : Math.max(0, snap.timeline.length - HISTORY_PAGE_SIZE)
            );
            return snap.timeline;
          });
        }

        if (yoloModeRef.current) {
          // Auto-answer everything the engine raised while we were away — the
          // safety list still denies its share.
          for (const perm of snap.permissions) void handleAutoPermission(perm);
          for (const item of snap.timeline) {
            if (item.part.type === 'approval') void handleAutoPermission(item.part.request);
          }
          setPermissions([]);
        } else {
          setPermissions(snap.permissions);
        }
        setForms(snap.forms);
        lastSeqRef.current = snap.seq;
        if (info?.model) {
          applySelectedModel(info.model);
        }
        if (info?.agent) setSelectedAgent(info.agent);

        // What the model can still see, which the snapshot does not carry.
        void refreshContext();
        void refreshShells();
        void refreshInbox();

        // Check diffs
        try {
          const diffs = await getAgentVcsDiff(sessionId, activeAsid);
          setHasDiffs(diffs.length > 0);
        } catch {
          setHasDiffs(false);
        }
      } catch (err) {
        console.warn('Failed to load snapshot:', err);
        if (
          err instanceof Error &&
          (err.message.includes('404') || err.message.includes('session_not_found'))
        ) {
          setActiveAsid(undefined);
          setSessionInfo(null);
          setTimeline([]);
          setWindowStart(0);
          setPermissions([]);
          setForms([]);
          return;
        }
        // Anything else is a session that exists and could not be read. This
        // is also what pull-to-refresh lands on, and a pull that answers with
        // nothing at all is a pull the reader will make again.
        showToast({
          variant: 'danger',
          title: t`Could not load the session`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
      } finally {
        if (mode === 'enter') setLoading(false);
      }
    },
    [
      sessionId,
      activeAsid,
      applySelectedModel,
      handleAutoPermission,
      refreshContext,
      refreshShells,
      refreshInbox,
      showToast,
      t,
    ]
  );

  useEffect(() => {
    void loadSnapshot().catch(() => {});
  }, [loadSnapshot]);

  // Load known projects for workspace switcher
  useEffect(() => {
    let mounted = true;
    getAgentProjects(sessionId)
      .then((projs) => {
        if (mounted && projs) setKnownProjects(projs);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  /**
   * The tree under the open root: its children, and theirs one level deeper.
   *
   * Two levels is what the strip draws and therefore all that is fetched. The
   * answers replace what was there rather than merging, so a subagent that has
   * been deleted leaves the strip rather than lingering in it.
   */
  const refreshChildren = useCallback(async (rootAsid: string | undefined) => {
    if (!rootAsid) {
      setChildrenByParent({});
      return;
    }
    const first = await listAgentSessionChildren(rootAsid);
    const next: Record<string, AgentSessionInfo[]> = { [rootAsid]: first };
    for (const child of first) {
      const grandchildren = await listAgentSessionChildren(child.asid);
      if (grandchildren.length > 0) next[child.asid] = grandchildren;
    }
    setChildrenByParent(next);
  }, []);

  const handleStreamEvent = useCallback(
    (event: AgentDomainEvent) => {
      // Every frame carries the sequence the gateway is at; a reconnect asks
      // for whatever landed after it rather than refetching the world.
      if (event.seq > lastSeqRef.current) lastSeqRef.current = event.seq;

      /**
       * Whether this event is about the session on screen.
       *
       * The per-session stream is filtered, but a subagent's session events
       * reach it too -- a subagent *is* a session, and its status, its inbox
       * and its compaction all announce themselves by their own `asid`. Applied
       * blindly, a subagent finishing flipped the parent to idle, cleared the
       * parent's queued rows and fired three refreshes, in the middle of a turn
       * the parent was still running.
       *
       * An event that names nobody is about the stream's own session, which is
       * the only one it carries.
       */
      const forActiveSession = !event.asid || event.asid === activeAsid;

      switch (event.type) {
        case 'agent.timeline.upsert':
          setTimeline((prev) => upsertTimelineItems(prev, event.items));
          // Pinning to the latest message while the reader is at the bottom is
          // LegendList's `maintainScrollAtEnd` job (threshold-guarded); a
          // manual scrollToEnd here would start a new animation on every
          // stream tick and fight the reader's own gesture.
          break;

        case 'agent.timeline.removed': {
          const removedIds = new Set(event.ids);
          setTimeline((prev) => prev.filter((it) => !removedIds.has(it.id)));
          break;
        }

        case 'agent.status.changed': {
          // The roots list and the subagent tree take every status, whoever it
          // is about: that is what a chip's own dot is drawn from.
          setSessions((prev) =>
            prev.map((s) => (s.asid === event.asid ? { ...s, status: event.status } : s))
          );
          setChildrenByParent((prev) => applyChildStatus(prev, event.asid, event.status));

          // The transcript takes it only when it is the transcript's own.
          if (!forActiveSession) break;
          // The status the engine reports is the status shown -- `failed`
          // keeps its error, `interrupted` says so, and nothing here forces
          // idle on the way past.
          setSessionInfo((prev) =>
            prev
              ? { ...prev, status: event.status, ...(event.error ? { error: event.error } : {}) }
              : prev
          );
          if (event.status === 'idle') {
            // Delivered: a queued row is now ordinary history.
            setTimeline((prev) => prev.map((it) => (it.queued ? { ...it, queued: false } : it)));
            void refreshSessions();
            void refreshContext();
            void refreshShells();
          }
          break;
        }

        case 'agent.session.updated': {
          const info = event.info;

          /**
           * A session that has been deleted leaves.
           *
           * `deleted` was parsed off the wire and read nowhere, so a session
           * removed on the host -- or a whole subtree, which is what deleting
           * a parent does -- stayed in the strip as a chip that opened an
           * empty transcript. OpenCode announces each one.
           */
          if (info.deleted) {
            setSessions((prev) => prev.filter((session) => session.asid !== info.asid));
            setChildrenByParent((prev) => dropSession(prev, info.asid));
            if (info.asid === activeAsid) {
              setActiveAsid(undefined);
              setSessionInfo(null);
              setTimeline([]);
              setWindowStart(0);
              setPermissions([]);
              setForms([]);
              setInbox([]);
            }
            break;
          }

          if (forActiveSession) {
            setSessionInfo((prev) =>
              prev && prev.asid !== info.asid ? prev : prev ? { ...prev, ...info } : info
            );
          }
          setSessions((prev) =>
            prev.some((s) => s.asid === info.asid)
              ? prev.map((s) => (s.asid === info.asid ? { ...s, ...info } : s))
              : info.parent_id
                ? prev
                : [...prev, info]
          );
          // An auto-title lands here, and the chip it belongs to may be a
          // subagent rather than a root.
          setChildrenByParent((prev) => applyChildInfo(prev, info));
          break;
        }

        case 'agent.permission.pending':
          if (yoloModeRef.current) {
            handleAutoPermission(event.request);
          } else {
            setPermissions((prev) =>
              prev.some((p) => p.id === event.request.id) ? prev : [...prev, event.request]
            );
          }
          break;

        case 'agent.permission.resolved':
          setPermissions((prev) => prev.filter((p) => p.id !== event.request_id));
          break;

        case 'agent.form.pending':
          setForms((prev) =>
            prev.some((f) => f.id === event.request.id) ? prev : [...prev, event.request]
          );
          break;

        case 'agent.form.resolved':
          setForms((prev) => prev.filter((f) => f.id !== event.form_id));
          break;

        case 'agent.inbox.changed':
          // A subagent has its own queue, and it is not the one drawn above
          // this composer.
          if (!forActiveSession) break;
          // The whole queue every time, so there is no diff to reconcile.
          setInbox(event.items);
          break;

        case 'agent.compaction.changed':
          // Likewise: a subagent compacting its own context is not this
          // session's pill.
          if (!forActiveSession) break;
          setCompaction(
            event.status === 'completed'
              ? null
              : event.status === 'failed'
                ? { status: 'failed', reason: event.reason }
                : { status: 'running', reason: event.reason }
          );
          // The boundary itself arrives in the timeline; what changed here is
          // how much of the window is left.
          if (event.status === 'completed') void refreshContext();
          break;

        case 'agent.resync':
          // Housekeeping, not navigation: the reader's place is kept.
          void loadSnapshot('silent');
          break;
      }
    },
    [activeAsid, loadSnapshot, refreshSessions, refreshContext, refreshShells, handleAutoPermission]
  );

  /**
   * Whatever the stream missed.
   *
   * The sequence number was bookkept and never used: `lastSeqRef` was written
   * on every frame and read by nothing, and the route that exists to fill a gap
   * had no caller at all. So every event that landed during a reconnect -- the
   * 400ms-to-5s window after a drop, or the whole time the app was in the
   * background -- was lost for good, and the transcript silently disagreed with
   * the engine until the reader left the screen and came back.
   *
   * Asked for on every (re)connect and on every return to the foreground. A
   * `410` means the point asked for has fallen out of the gateway's ring
   * buffer, and then the snapshot is the only honest answer -- taken silently,
   * so a reader reading history is not thrown to the bottom by it.
   */
  const catchUpRef = useRef<() => void>(() => {});
  const catchUp = useCallback(() => {
    const asid = activeAsid;
    // Nothing to catch up to: a session that has never synced is told to
    // resync by the gateway anyway, and it has just been snapshotted.
    if (!asid || lastSeqRef.current <= 0) return;
    void getAgentTimelineDelta(sessionId, asid, lastSeqRef.current)
      .then((delta) => {
        if (asid !== activeAsidRef.current) return;
        if (delta.resync) {
          void loadSnapshot('silent');
          return;
        }
        if (delta.items.length > 0) {
          setTimeline((prev) => upsertTimelineItems(prev, delta.items));
        }
        // Bound out of the union rather than asserted: there is no `!` on
        // anything that came off the wire anywhere in this surface.
        const nextStatus = delta.status;
        if (nextStatus) {
          setSessionInfo((prev) => (prev ? { ...prev, status: nextStatus } : prev));
        }
        if (delta.latest_seq > lastSeqRef.current) lastSeqRef.current = delta.latest_seq;
      })
      .catch(() => {});
  }, [sessionId, activeAsid, loadSnapshot]);

  useEffect(() => {
    catchUpRef.current = catchUp;
  }, [catchUp]);

  // Returning to the foreground is a reconnect the stream cannot see: the
  // socket may have been held open by the OS and delivered nothing.
  const appActive = useAppActive();
  useEffect(() => {
    if (appActive) catchUpRef.current();
  }, [appActive]);

  // Real-time SSE stream — the only sync channel. Engine output arrives over
  // it; a dropped connection reconnects with a short backoff instead of being
  // papered over by polling. `lastSeq` intentionally lives in a ref so events
  // never re-declare this effect and tear the connection down mid-run.
  useEffect(() => {
    if (!activeAsid) return;
    let mounted = true;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const connect = () => {
      /**
       * Try again, soon.
       *
       * Both ways a stream can end come here. A *failure* is the obvious one.
       * An orderly close is the one that was missing: a gateway restart, a
       * proxy's idle timeout or OpenCode being restarted underneath the
       * connection all end the body with no error at all, and the app used to
       * treat that as nothing happening -- the backoff never armed and the
       * session sat there looking current while the engine moved on.
       */
      const scheduleReconnect = () => {
        if (!mounted) return;
        // Quiet reconnect. Mobile streams drop often; keep the gap short so
        // a dropped connection costs at most a couple of seconds, not a poll.
        const delay = Math.min(400 * 2 ** attempts, 5000);
        attempts += 1;
        reconnectTimer = setTimeout(connect, delay);
      };

      const closeStream = openAgentSessionStream({
        asid: activeAsid,
        sessionId,
        onConnected: () => {
          if (!mounted) return;
          // The gap between the last frame of the old connection and the first
          // of this one.
          catchUpRef.current();
        },
        onEvent: (event) => {
          if (!mounted) return;
          attempts = 0;
          handleStreamEvent(event);
        },
        onError: scheduleReconnect,
        onClose: scheduleReconnect,
      });
      return closeStream;
    };

    const closeCurrent = connect();

    return () => {
      mounted = false;
      closeCurrent();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [sessionId, activeAsid, handleStreamEvent]);

  const handleSelectModel = useCallback(
    (model: ModelRef) => {
      pickedModelRef.current = true;
      applySelectedModel(model);
      // The server owns the per-session model via this call; on next entry the
      // session's own model is restored from it (see loadSnapshot).
      if (activeAsid) {
        void switchAgentModel(sessionId, activeAsid, model).catch((err) => {
          console.warn('Failed to switch agent model:', err);
        });
      }
    },
    [applySelectedModel, sessionId, activeAsid]
  );

  /**
   * Compaction, through the route that exists for it.
   *
   * `/compact` used to be sent as an ordinary prompt and hope OpenCode read it
   * as a command. It is a real endpoint: the request is admitted to the inbox,
   * runs at the next step boundary, and reports itself on
   * `agent.compaction.changed` -- none of which a text prompt could do.
   */
  const handleCompactContext = useCallback(() => {
    if (!activeAsid) return;
    setCompaction({ status: 'running', reason: 'manual' });
    compactAgentSession(activeAsid).catch((err) => {
      console.warn('Failed to compact session:', err);
      setCompaction(null);
      showToast({
        variant: 'danger',
        title: t`Could not compact`,
        message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
      });
    });
  }, [activeAsid, showToast, t]);

  /**
   * Clearing the context is starting a session, not typing `/clear`.
   *
   * v2 has no route that empties a session's history, and a prompt saying
   * "/clear" is a prompt: the model reads it, answers it, and the context is
   * one turn longer than it was. A session with a clean context is a new
   * session -- unless the host's own command catalog carries a `clear`, in
   * which case that is what the reader asked for and it goes to the engine.
   */
  /**
   * A command from the host's own catalog.
   *
   * `POST …/command {name, arguments}` -- not the literal text typed into the
   * prompt, which is what this used to be and what the model then answered as
   * prose.
   */
  const handleRunCommand = useCallback(
    (name: string, args: string) => {
      if (!activeAsid) return;
      sendAgentCommand(activeAsid, {
        name,
        ...(args ? { arguments: args } : {}),
        ...(isBusyStatus(sessionInfo?.status) ? { delivery: 'steer' as const } : {}),
      }).catch((err) => {
        console.warn('Failed to run command:', err);
        showToast({
          variant: 'danger',
          title: t`Could not run that`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
      });
    },
    [activeAsid, sessionInfo?.status, showToast, t]
  );

  /** A failed compaction stays until the reader has seen it. */
  const dismissCompaction = useCallback(() => {
    setCompaction((current) => (current?.status === 'failed' ? null : current));
  }, []);

  const handleCancelInboxItem = useCallback(
    (inboxId: string) => {
      if (!activeAsid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Optimistic, then confirmed: `agent.inbox.changed` carries the whole
      // queue and will correct this if the engine had already delivered it.
      setInbox((prev) => prev.filter((item) => item.id !== inboxId));
      cancelAgentInboxItem(activeAsid, inboxId).catch((err) => {
        console.warn('Failed to cancel queued item:', err);
        void refreshInbox();
      });
    },
    [activeAsid, refreshInbox]
  );

  const handleClearContext = useCallback(() => {
    const serverCommand = commands.find((command) => command.name.replace(/^\//, '') === 'clear');
    if (activeAsid && serverCommand) {
      sendAgentCommand(activeAsid, { name: serverCommand.name }).catch((err) => {
        console.warn('Failed to run /clear:', err);
      });
      return;
    }
    void handleCreateNewSessionRef.current?.();
  }, [activeAsid, commands]);

  /**
   * The session creator, reachable from a handler declared above it.
   *
   * Assigned in an effect rather than during render: a ref written while
   * rendering is a ref React may throw away under Strict Mode.
   */
  const handleCreateNewSessionRef = useRef<(() => Promise<void>) | null>(null);
  /**
   * The three sheet openers, reachable from the command dispatcher above them.
   *
   * Assigned in an effect rather than during render, for the reason
   * `react/refs` gives everywhere else in this file.
   */
  const openSessionsSheetRef = useRef<(() => void) | null>(null);
  const openModelSheetRef = useRef<(() => void) | null>(null);
  const openModeSheetRef = useRef<(() => void) | null>(null);

  // Held in a ref so the sheet actions that use it stay stable and do not
  // re-publish the action object on every render.
  const handleSendPromptRef = useRef<
    | ((text: string, attachments?: string[], delivery?: 'steer' | 'queue') => Promise<boolean>)
    | null
  >(null);

  /**
   * Send, and say so when it did not.
   *
   * Answers whether the prompt was accepted, because the composer clears the
   * draft and the staged attachments on the strength of it. All three failure
   * paths here used to be a `console.warn`: the draft was cleared, the
   * attachments were dropped, and the optimistic row sat in the transcript
   * looking exactly like a message that had been delivered. The reader waited
   * for a reply to something the engine had never been told about.
   */
  const handleSendPrompt = async (
    text: string,
    attachments?: string[],
    delivery?: 'steer' | 'queue'
  ): Promise<boolean> => {
    let currentAsid = activeAsid;
    if (!currentAsid) {
      try {
        const created = await createAgentSession(
          sessionId,
          newSessionParams(activeDirectory ?? sessionInfo?.directory)
        );
        currentAsid = created.asid;
        setActiveAsid(created.asid);
        setSessionInfo(created);
      } catch (err) {
        console.warn('Failed to create session on prompt send:', err);
        showToast({
          variant: 'danger',
          title: t`Could not start a session`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
        return false;
      }
    }

    const isQueued = isBusyStatus(sessionInfo?.status) && delivery === 'queue';

    // Optimistically add user text item
    const tempUserItem: TimelineItem = {
      id: `temp_usr_${Date.now()}`,
      message_id: `msg_${Date.now()}`,
      ordinal: 0,
      seq: lastSeqRef.current + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
      attachments,
      queued: isQueued,
    };
    setTimeline((prev) => [...prev, tempUserItem]);
    // No manual scroll. Following the newest message is the list's
    // `maintainScrollAtEnd`, threshold-guarded -- and a reader who had
    // deliberately scrolled up to read something while typing has the
    // jump-to-latest button, which appears in exactly that case. A timer that
    // yanked them to the bottom was the viewport-moving behaviour the rest of
    // this screen is built to avoid.

    // No optimistic title. Auto-titling happens on the engine's first turn and
    // arrives as `agent.session.updated`; a client-side guess made from the
    // first thirty characters was only ever replaced a few seconds later, and
    // it is what put a truncated prompt in the strip instead of a real title.
    if (sessionInfo) {
      setSessionInfo({ ...sessionInfo, status: 'busy' });
    }

    try {
      await sendAgentPrompt(sessionId, currentAsid, {
        text,
        attachments,
        delivery,
      });
      return true;
    } catch (err) {
      console.warn('Failed to send prompt:', err);
      // The row goes with the failure. A message that was never delivered has
      // no business sitting in the transcript, and the draft comes back so the
      // reader can try again rather than retype it.
      setTimeline((prev) => prev.filter((item) => item.id !== tempUserItem.id));
      setSessionInfo((prev) => (prev ? { ...prev, status: 'idle' } : prev));
      showToast({
        variant: 'danger',
        title: t`Message not sent`,
        message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
      });
      return false;
    }
  };

  // Assigned in an effect rather than during render: a ref written while
  // rendering is a ref React may throw away under Strict Mode, and the rule
  // that forbids it is the same one `react/refs` enforces everywhere else.
  useEffect(() => {
    handleSendPromptRef.current = handleSendPrompt;
  });

  /**
   * Stop, and then wait to be told what happened.
   *
   * This used to force `status: 'idle'` in a `finally`, including when the
   * abort threw -- so a failed abort showed a stopped agent that was still
   * running, and the reader's next prompt landed in the middle of a turn they
   * believed was over. The engine answers an interrupt with
   * `agent.status.changed: interrupted`; that is the status, and a refusal is
   * said out loud rather than papered over.
   */
  const handleAbort = useCallback(async () => {
    if (!activeAsid) return;
    try {
      await abortAgentSession(sessionId, activeAsid);
    } catch (err) {
      console.warn('Failed to abort session:', err);
      showToast({
        variant: 'danger',
        title: t`Could not stop it`,
        message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
      });
    }
  }, [activeAsid, sessionId, showToast, t]);

  /**
   * The agent mode, switched on the session rather than in a local variable.
   *
   * `switchAgentMode` existed in the client with no caller: picking Plan set a
   * string in this component, drew a different word on the chip, and the
   * session went on running Build. Model and agent are both session state in
   * v2 -- switch first, then prompt -- so this is the same shape as the model
   * picker, including the toast when the engine refuses (it does refuse: agent
   * ids are lowercase, and a display name is rejected).
   */
  const handleSelectAgentMode = useCallback(
    (agent: string) => {
      pickedAgentRef.current = true;
      setSelectedAgent(agent);
      if (!activeAsid) return;
      switchAgentMode(activeAsid, agent).catch((err) => {
        console.warn('Failed to switch agent:', err);
        showToast({
          variant: 'danger',
          title: t`Could not switch agent`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
      });
    },
    [activeAsid, showToast, t]
  );

  const handlePermissionDecision = useCallback(
    async (permId: string, decision: PermissionDecision) => {
      if (!activeAsid) return;
      try {
        await replyAgentPermission(sessionId, activeAsid, permId, decision);
      } catch (err) {
        console.warn('Failed to reply permission:', err);
        showToast({
          variant: 'danger',
          title: t`Could not reply`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
        return;
      }
      setPermissions((prev) => prev.filter((p) => p.id !== permId));
    },
    [activeAsid, sessionId, showToast, t]
  );

  const handleToggleYoloMode = useCallback(() => {
    const next = !yoloModeRef.current;
    setYoloMode(next);
    if (next) {
      showToast({
        variant: 'info',
        title: t`YOLO mode on`,
        message: t`Agent actions are auto-approved; dangerous commands stay blocked.`,
      });
    }
  }, [setYoloMode, showToast, t]);

  const handleFormSubmit = useCallback(
    async (formId: string, answers: Record<string, unknown>) => {
      if (!activeAsid) return;
      try {
        await replyAgentForm(sessionId, activeAsid, formId, answers);
      } catch (err) {
        console.warn('Failed to reply form:', err);
        showToast({
          variant: 'danger',
          title: t`Could not reply`,
          message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
        });
        return;
      }
      setForms((prev) => prev.filter((f) => f.id !== formId));
    },
    [activeAsid, sessionId, showToast, t]
  );

  const handleCreateNewSession = useCallback(async () => {
    if (isOffline) {
      showToast({
        variant: 'danger',
        title: t`OpenCode Service Offline`,
        message: t`Please start OpenCode on the server: opencode serve --service`,
      });
      return;
    }
    try {
      const created = await createAgentSession(
        sessionId,
        newSessionParams(activeDirectory ?? sessionInfo?.directory)
      );
      setActiveAsid(created.asid);
      setSessionInfo(created);
      setTimeline([]);
      setWindowStart(0);
      setPermissions([]);
      setForms([]);
      lastSeqRef.current = 0;
      refreshSessions();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        variant: 'info',
        title: t`New Session`,
        message: t`Started a new session with clean context.`,
      });
    } catch (err) {
      console.warn('Failed to create session:', err);
      setIsOffline(true);
      showToast({
        variant: 'danger',
        title: t`Could not create session`,
        message: formatAgentErrorMessage(err, t`Failed to create agent session`),
      });
    }
  }, [
    isOffline,
    sessionId,
    newSessionParams,
    activeDirectory,
    sessionInfo,
    t,
    refreshSessions,
    showToast,
  ]);

  useEffect(() => {
    handleCreateNewSessionRef.current = handleCreateNewSession;
    if (createNewSessionRef) {
      createNewSessionRef.current = handleCreateNewSession;
    }
  }, [createNewSessionRef, handleCreateNewSession]);

  useEffect(() => {
    if (abortSessionRef) {
      abortSessionRef.current = () => {
        void handleAbort();
      };
    }
  }, [abortSessionRef, handleAbort]);

  const handleSelectWorkspace = useCallback(
    async (directory: string, project?: AgentProject) => {
      setActiveDirectory(directory);
      try {
        const created = await createAgentSession(sessionId, newSessionParams(directory));
        setActiveAsid(created.asid);
        setSessionInfo(created);
        setTimeline([]);
        setWindowStart(0);
        setPermissions([]);
        setForms([]);
        lastSeqRef.current = 0;
        refreshSessions();
      } catch (err) {
        console.warn('Failed to switch workspace session:', err);
        setIsOffline(true);
        showToast({
          variant: 'danger',
          title: t`Could not create session`,
          message: formatAgentErrorMessage(err, t`Failed to switch workspace session`),
        });
      }
    },
    [sessionId, newSessionParams, t, refreshSessions, showToast]
  );

  /**
   * Opening a picker is a navigation, not a boolean.
   *
   * Each of these used to flip a `visible` flag on a `<Modal>` that was in the
   * tree either way -- six components, six `useSafeAreaInsets` subscriptions
   * and, for the model and mode sheets, an effect watching that flag so it
   * could fetch the catalog. As routes they are mounted by the navigator when
   * the reader arrives and unmounted when they leave, so none of that work
   * exists until it is asked for. Identity travels as a param; what the sheet
   * reads while it is open comes from `stores/agent-sheet-bridge.ts`.
   */
  const openSessionsSheet = useCallback(() => {
    router.push('/agent-sessions');
  }, [router]);

  const openModelSheet = useCallback(() => {
    router.push({ pathname: '/agent-model', params: { sessionId } });
  }, [router, sessionId]);

  const openModeSheet = useCallback(() => {
    router.push({ pathname: '/agent-mode', params: { sessionId } });
  }, [router, sessionId]);

  const openWorkspaceSheet = useCallback(() => {
    router.push({ pathname: '/agent-workspace', params: { sessionId } });
  }, [router, sessionId]);

  useEffect(() => {
    openSessionsSheetRef.current = openSessionsSheet;
    openModelSheetRef.current = openModelSheet;
    openModeSheetRef.current = openModeSheet;
  }, [openSessionsSheet, openModelSheet, openModeSheet]);

  const openContextSheet = useCallback(() => {
    router.push('/agent-context');
  }, [router]);

  const openTasksSheet = useCallback(() => {
    router.push('/agent-tasks');
  }, [router]);

  const openBackgroundTray = useCallback(() => {
    router.push({
      pathname: '/agent-shells',
      ...(activeDirectory ? { params: { directory: activeDirectory } } : {}),
    });
  }, [router, activeDirectory]);

  const openDiffSheet = useCallback(() => {
    if (!activeAsid) return;
    router.push({ pathname: '/agent-vcs-diff', params: { sessionId, asid: activeAsid } });
  }, [router, sessionId, activeAsid]);

  const handleToggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  /**
   * The app's own commands, dispatched where the routes and the session live.
   *
   * `/undo` is `POST …/revert` to the last thing the reader said, and `/redo`
   * clears the staged rollback -- which is what redo *is* in v2. Neither was
   * reachable before: the client functions existed with no caller.
   */
  const handleClientCommand = useCallback(
    (name: AgentClientCommandId) => {
      switch (name) {
        case 'new':
          void handleCreateNewSessionRef.current?.();
          return;
        case 'sessions':
          openSessionsSheetRef.current?.();
          return;
        case 'models':
          openModelSheetRef.current?.();
          return;
        case 'agents':
          openModeSheetRef.current?.();
          return;
        case 'compact':
          handleCompactContext();
          return;
        case 'clear':
          handleClearContext();
          return;
        case 'undo': {
          if (!activeAsid) return;
          const lastUser = [...timeline].reverse().find((item) => item.role === 'user');
          if (!lastUser) {
            showToast({
              variant: 'info',
              title: t`Nothing to undo`,
              message: t`This session has no message to roll back to.`,
            });
            return;
          }
          revertAgentSession(sessionId, activeAsid, lastUser.message_id).catch((err) => {
            console.warn('Failed to revert:', err);
            showToast({
              variant: 'danger',
              title: t`Could not undo`,
              message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
            });
          });
          return;
        }
        case 'redo': {
          if (!activeAsid) return;
          clearAgentRevert(activeAsid).catch((err) => {
            console.warn('Failed to clear revert:', err);
            showToast({
              variant: 'danger',
              title: t`Could not redo`,
              message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
            });
          });
          return;
        }
        case 'export': {
          if (!activeAsid) return;
          void exportAgentSession(activeAsid)
            .then((transcript) => {
              if (!transcript) return;
              // Capped: a long session's transcript is megabytes, and a share
              // sheet is not a file transfer.
              const text = capText(JSON.stringify(transcript, null, 2)).text;
              return Share.share({ message: text });
            })
            .catch((err) => {
              console.warn('Failed to export session:', err);
            });
          return;
        }
      }
    },
    [activeAsid, sessionId, timeline, handleCompactContext, handleClearContext, showToast, t]
  );

  const handleEditQueuedItem = useCallback((itemId: string, text: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    injectDraftRef.current?.(text);
    setTimeline((prev) => prev.filter((it) => it.id !== itemId));
  }, []);

  /**
   * Cancelling a queued message cancels it on the engine too.
   *
   * It used to drop the local row and nothing else: the prompt stayed in the
   * engine's inbox and ran a minute later, having been told it was cancelled.
   * The optimistic row carries no inbox id, so the item is matched on the text
   * it is carrying -- and the row goes either way, because a cancel that
   * leaves the message on screen has not cancelled anything the reader can see.
   */
  const handleCancelQueuedItem = useCallback(
    (itemId: string) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const row = timeline.find((it) => it.id === itemId);
      const text = row?.part.type === 'text' ? row.part.text.trim() : '';
      const queued = text ? inbox.find((item) => inboxItemText(item).trim() === text) : undefined;
      if (queued) handleCancelInboxItem(queued.id);
      setTimeline((prev) => prev.filter((it) => it.id !== itemId));
    },
    [timeline, inbox, handleCancelInboxItem]
  );

  /**
   * Detach the foreground tools blocking the loop -- the TUI's `ctrl+b`.
   *
   * There is no per-call route: `POST …/background` detaches whatever is
   * blocking the session, which for a card offering the button is the shell it
   * is drawing. The card's own id is passed so a later engine that grows a
   * per-call route needs no change here.
   */
  const handleRunInBackground = useCallback(
    (_toolCallId: string) => {
      if (!activeAsid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      backgroundAgentSession(activeAsid)
        .then(() => refreshShells())
        .catch((err) => {
          console.warn('Failed to background tools:', err);
          showToast({
            variant: 'danger',
            title: t`Could not detach`,
            message: formatAgentErrorMessage(err, t`OpenCode service is offline`),
          });
        });
    },
    [activeAsid, refreshShells, showToast, t]
  );

  const handleOpenToolFile = useCallback(
    (file: { uri: string; mime?: string; name?: string }) => {
      const asset = assetFromToolFile(file, sessionId);
      if (asset) setOpenToolAsset(asset);
    },
    [sessionId]
  );

  /**
   * The live status of every child session, keyed by its id.
   *
   * A subagent's card shows the child's own dot, not the tool's: the call that
   * started it returns long before the child is finished, and `agent.status.changed`
   * for the child arrives on the same list this is read from.
   */
  const childStatuses = useMemo(() => {
    const statuses: Record<string, AgentRunStatus> = {};
    // Out of the fetched tree, not out of the session list: the list is roots
    // only, so a subagent is never in it and this map would always be empty.
    for (const children of Object.values(childrenByParent)) {
      for (const child of children) statuses[child.asid] = child.status;
    }
    return statuses;
  }, [childrenByParent]);

  /**
   * What the tool cards read, published rather than passed.
   *
   * A permission that names a call is drawn under that call's card; handing
   * every card the pending list meant one arriving re-rendered all of them.
   */
  useEffect(() => {
    useAgentPermissionStore.getState().publish(permissions);
  }, [permissions]);

  useEffect(() => {
    useAgentPermissionStore.getState().setDecider(handlePermissionDecision);
  }, [handlePermissionDecision]);

  // A card outliving the workbench would be holding a decider for a session
  // that is gone.
  useEffect(() => {
    return () => {
      useAgentPermissionStore.getState().reset();
    };
  }, []);

  const toolActions = useMemo<AgentToolActions>(
    () => ({
      onOpenChildSession: setActiveAsid,
      onRunInBackground: handleRunInBackground,
      onPreviewImage: setPreviewImageUri,
      onOpenFile: handleOpenToolFile,
      onOpenBackgroundTray: openBackgroundTray,
      onOpenFullDiff: openDiffSheet,
      childStatuses,
    }),
    [handleRunInBackground, handleOpenToolFile, openBackgroundTray, openDiffSheet, childStatuses]
  );

  /**
   * The requests no tool row on screen can carry.
   *
   * A permission names the call it came from, so it is drawn under that card.
   * One that names nothing -- or names a call that has fallen out of the
   * rendered window -- still has to be answerable, and the footer is where it
   * lands.
   */
  const footerPermissions = useMemo(() => {
    const toolIds = new Set<string>();
    for (const item of timeline) {
      if (item.part.type === 'tool') toolIds.add(item.part.id);
    }
    return permissions.filter(
      (request) => !request.source_tool_call_id || !toolIds.has(request.source_tool_call_id)
    );
  }, [permissions, timeline]);

  const renderTimelineItem = useCallback(
    ({ item: group }: LegendListRenderItemProps<TimelineRenderGroup>) => {
      if (group.role === 'user') {
        return (
          <AgentUserMessage
            key={group.key}
            group={group}
            showReasoning={showReasoning}
            markdownStyle={markdownStyle}
            onPreviewImage={setPreviewImageUri}
            onEditQueued={handleEditQueuedItem}
            onCancelQueued={handleCancelQueuedItem}
            actions={toolActions}
          />
        );
      }
      return (
        <AgentAssistantMessage
          key={group.key}
          group={group}
          showReasoning={showReasoning}
          markdownStyle={markdownStyle}
          actions={toolActions}
        />
      );
    },
    [showReasoning, markdownStyle, handleEditQueuedItem, handleCancelQueuedItem, toolActions]
  );

  const isRunning = isBusyStatus(sessionInfo?.status);

  // Surface the active session's run state and title where the header can read
  // it without the workbench owning the header's render. A store write, not a
  // prop callback: both sides read the same value.
  useEffect(() => {
    useAgentSessionState.getState().setSessionStatus({
      running: isRunning,
      title: sessionInfo?.title,
    });
  }, [isRunning, sessionInfo?.title]);

  const activeProject = useMemo(() => {
    if (!activeDirectory) return undefined;
    return knownProjects.find(
      (p) => p.canonical === activeDirectory || activeDirectory.startsWith(p.canonical)
    );
  }, [activeDirectory, knownProjects]);

  useEffect(() => {
    useAgentSessionState.getState().setWorkspace(activeDirectory, activeProject);
  }, [activeDirectory, activeProject]);

  const displayWorkspaceName = workspaceDisplayName(activeProject, activeDirectory, t`Workspace`);
  const displayWorkspacePath = activeDirectory || activeProject?.canonical || '~/';

  // Rendered window over the full timeline: entering a session shows the
  // latest page; earlier pages are prepended on demand.
  const visibleTimeline = useMemo(
    () => (windowStart > 0 ? timeline.slice(windowStart) : timeline),
    [timeline, windowStart]
  );

  // Group the window back into whole messages, the shape OpenCode's own UI
  // renders: reasoning and tool calls fold into the message they belong to.
  //
  // Through the cache, so a group whose items have not changed comes back as
  // the *same object*. That is what `itemsAreEqual` below is asserting, and
  // it is why one message streaming costs one cell re-render rather than the
  // whole visible list. The builder was already written to do this; nothing
  // was passing it the previous render's groups.
  const groupCache = useMemo(() => createTimelineGroupCache(), []);
  const renderGroups = useMemo(
    () => buildTimelineGroupsCached(groupCache, visibleTimeline),
    [groupCache, visibleTimeline]
  );

  /**
   * Earlier history is pulled for, not asked for with a button.
   *
   * The button said how many messages were above it, which is a number nobody
   * acts on, and it took a row of the transcript to say it. The gesture is the
   * one every other list in this app uses, and the viewport is held by the
   * list's own `maintainVisibleContentPosition` -- which is what the
   * `scrollToIndex` on a 60ms timer was approximating, one frame late and with
   * a guess at how long the prepend would take.
   */
  const handleLoadEarlier = useCallback(() => {
    if (windowStart <= 0) return;
    setLoadingEarlier(true);
    setWindowStart((prev) => Math.max(0, prev - HISTORY_PAGE_SIZE));
  }, [windowStart]);

  // The window grew (or there was nothing left to grow into), so the pull is
  // answered and the indicator can retract.
  useEffect(() => {
    setLoadingEarlier(false);
  }, [windowStart]);

  /**
   * What the engine last said about itself, when that is worth a row.
   *
   * `failed`, `interrupted` and `retry` are three of the six statuses the
   * contract defines, and none of them had anywhere to appear: a turn that
   * ended in an error simply stopped, and the only clue was the composer's
   * Stop button going away. The sniffer this replaces read the *model's own
   * prose* for the words "overload", "rate limit" and two Chinese phrases, and
   * offered a switch to a model id (`opencode/union-alpha`) that appears
   * nowhere else in this app or in any catalog it fetches.
   */
  const statusNotice = useMemo(() => {
    const status = sessionInfo?.status;
    if (status === 'failed') {
      return {
        tone: theme.colors.danger,
        label: t`The turn failed`,
        detail: sessionInfo?.error?.message ?? '',
      };
    }
    if (status === 'interrupted') {
      return { tone: theme.colors.warning, label: t`Stopped`, detail: '' };
    }
    if (status === 'retry') {
      return {
        tone: theme.colors.warning,
        label: t`Retrying…`,
        detail: sessionInfo?.error?.message ?? '',
      };
    }
    if (status === 'unknown') {
      /**
       * The engine has not said what this session is doing.
       *
       * `unknown` is one of the six statuses and it is not idle: an idle
       * session is one the engine has told us is idle. Rendering it as idle
       * meant the composer looked ready over a session that might have been
       * mid-turn. Nothing is disabled -- the reader may well want to send --
       * but the screen says it does not know, and offers the one thing that
       * would settle it.
       */
      return {
        tone: theme.colors.textMuted,
        label: t`Status unknown`,
        detail: t`Tap to refresh this session.`,
        refresh: true,
      };
    }
    return null;
  }, [sessionInfo?.status, sessionInfo?.error?.message, theme.colors, t]);

  // A form field in the footer took focus: once the keyboard has risen, bring
  // the card up above the composer. The inset at the end of the list is what
  // makes that scroll possible.
  const scrollFooterAboveKeyboard = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), DURATION.medium);
  }, []);

  const listFooter = useMemo(() => {
    const hasFormsOrPerms = footerPermissions.length > 0 || forms.length > 0;
    if (!hasFormsOrPerms && !isRunning && !statusNotice) return <KeyboardInset />;
    return (
      <View style={styles.footerContainer}>
        {isRunning ? (
          <View style={styles.thinkingRow}>
            <View
              style={[
                styles.thinkingPill,
                {
                  backgroundColor: surfaceBackground(theme.colors.surface),
                  borderColor: theme.colors.border,
                },
              ]}>
              <ThinkingIndicator size={13} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.primary} weight="semibold">
                <Trans>Thinking…</Trans>
              </Text>
            </View>
          </View>
        ) : null}
        {statusNotice ? (
          <PressableScale
            testID="agent-status-notice"
            accessibilityRole={statusNotice.refresh ? 'button' : 'text'}
            accessibilityLabel={statusNotice.label}
            disabled={!statusNotice.refresh}
            onPress={() => {
              void loadSnapshot('silent');
            }}
            style={[
              styles.statusNotice,
              {
                backgroundColor: surfaceBackground(withAlpha(statusNotice.tone, 0.1)),
                borderColor: withAlpha(statusNotice.tone, 0.35),
              },
            ]}>
            <StatusDot color={statusNotice.tone} filled size={7} />
            <View style={styles.statusNoticeText}>
              <Text variant="caption" weight="semibold" color={theme.colors.text}>
                {statusNotice.label}
              </Text>
              {/* OpenCode's own message, said as it was said. */}
              {statusNotice.detail ? (
                <Text variant="caption" selectable color={theme.colors.textMuted}>
                  {statusNotice.detail}
                </Text>
              ) : null}
            </View>
          </PressableScale>
        ) : null}
        {footerPermissions.map((p) => (
          <AgentPermissionCard
            key={p.id}
            request={p}
            onDecision={(dec) => handlePermissionDecision(p.id, dec)}
          />
        ))}
        {forms.map((f) => (
          <AgentFormCard
            key={f.id}
            request={f}
            onSubmit={(answers) => handleFormSubmit(f.id, answers)}
            onFieldFocus={scrollFooterAboveKeyboard}
          />
        ))}
        <KeyboardInset />
      </View>
    );
  }, [
    footerPermissions,
    forms,
    isRunning,
    statusNotice,
    loadSnapshot,
    handlePermissionDecision,
    handleFormSubmit,
    scrollFooterAboveKeyboard,
    surfaceBackground,
    theme.colors,
  ]);

  /**
   * Everything the strip knows about, and the chips it draws.
   *
   * `sessions` is roots; `childrenByParent` is the open root's tree. Both are
   * indexed together so "which root is this child under" and "what is above
   * the session I am reading" are one lookup rather than two lists to search.
   */
  /**
   * The roots this workspace owns.
   *
   * The listing is already scoped by `directory` on the way out; this is the
   * second filter, for a gateway that ignored the parameter. With no workspace
   * chosen yet there is nothing to filter against, so the list stands as it is
   * rather than coming back empty.
   */
  const workspaceRoots = useMemo(() => {
    if (!activeDirectory && !activeProject) return sessions;
    return sessionsInWorkspace(sessions, {
      ...(activeDirectory ? { directory: activeDirectory } : {}),
      ...(activeProject?.id ? { projectId: activeProject.id } : {}),
      ...(activeProject?.canonical ? { canonical: activeProject.canonical } : {}),
    });
  }, [sessions, activeDirectory, activeProject]);

  const sessionIndex = useMemo(
    () => indexSessions(workspaceRoots, childrenByParent),
    [workspaceRoots, childrenByParent]
  );
  const activeRootAsid = useMemo(
    () => rootOf(activeAsid, sessionIndex)?.asid,
    [activeAsid, sessionIndex]
  );
  const sessionStrip = useMemo(
    () => buildSessionStrip(workspaceRoots, childrenByParent, activeAsid),
    [workspaceRoots, childrenByParent, activeAsid]
  );
  const activeParent = useMemo(
    () => parentOf(activeAsid, sessionIndex),
    [activeAsid, sessionIndex]
  );

  /**
   * Every session in hand, for the surfaces that want one list.
   *
   * The list route is asked for roots only now, so the sessions sheet -- which
   * groups by `parent_id` itself -- would otherwise never see a subagent
   * again. Memoised because the bridge commits on reference change.
   */
  const allSessions = useMemo(() => [...sessionIndex.values()], [sessionIndex]);

  // The open root's tree, refetched when the root changes and whenever a turn
  // ends -- which is when a subagent has finished and a new one may exist.
  useEffect(() => {
    void refreshChildren(activeRootAsid).catch(() => {});
  }, [refreshChildren, activeRootAsid]);

  useEffect(() => {
    if (isRunning) return;
    void refreshChildren(activeRootAsid).catch(() => {});
  }, [refreshChildren, activeRootAsid, isRunning]);

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.asid === activeAsid) ?? sessionInfo;
  }, [sessions, activeAsid, sessionInfo]);

  const activeTokens = currentSession?.tokens ?? sessionInfo?.tokens;

  /**
   * How many things are still running out of sight.
   *
   * Running shells, plus any *other* tool the gateway marked `background` that
   * has not finished -- a detached shell is both a shell and a tool row, and
   * counting it twice would make the pill say two for one command.
   */
  const backgroundCount = useMemo(() => {
    let detachedTools = 0;
    for (const item of timeline) {
      const part = item.part;
      if (part.type !== 'tool' || !part.background) continue;
      if (part.state === 'completed' || part.state === 'failed') continue;
      if (classifyTool(part.name) === 'shell') continue;
      detachedTools += 1;
    }
    return runningShellCount(shells) + detachedTools;
  }, [shells, timeline]);

  const activeTodos = useMemo(() => {
    for (let i = timeline.length - 1; i >= 0; i--) {
      const it = timeline[i];
      if (it.part.type === 'todo' && it.part.items.length > 0) {
        return it.part.items;
      }
    }
    return undefined;
  }, [timeline]);

  /**
   * What the sheet routes read, published rather than passed.
   *
   * A store write, not a prop: the sheets are mounted by the navigator above
   * this screen, so there is nowhere to pass a prop to. `publish` commits
   * nothing when every field is unchanged, so a stream tick that only grows
   * the timeline never re-renders an open sheet -- and the workbench does not
   * subscribe to the bridge at all, so nothing a sheet writes back re-renders
   * the workbench either. Each sheet route selects only the fields it reads.
   */
  useEffect(() => {
    const snapshot: Partial<AgentSheetSnapshot> = {
      sessionId,
      activeAsid,
      sessions: allSessions,
      knownProjects,
      activeDirectory,
      sessionInfo: sessionInfo ?? undefined,
      tokens: activeTokens,
      cost: sessionInfo?.cost,
      selectedModel,
      selectedAgent,
      showReasoning,
      yoloMode,
      todos: activeTodos ?? EMPTY_TODOS,
      inbox,
      compaction,
      contextUsage,
      commands,
    };
    useAgentSheetBridge.getState().publish(snapshot);
  }, [
    sessionId,
    activeAsid,
    allSessions,
    knownProjects,
    activeDirectory,
    sessionInfo,
    activeTokens,
    selectedModel,
    selectedAgent,
    showReasoning,
    yoloMode,
    activeTodos,
    inbox,
    compaction,
    contextUsage,
    commands,
  ]);

  const sheetActions = useMemo<AgentSheetActions>(
    () => ({
      selectSession: setActiveAsid,
      createSession: () => {
        void handleCreateNewSession();
      },
      selectModel: handleSelectModel,
      selectAgentMode: handleSelectAgentMode,
      selectWorkspace: (directory, project) => {
        void handleSelectWorkspace(directory, project);
      },
      toggleReasoning: handleToggleReasoning,
      toggleYolo: handleToggleYoloMode,
      compactContext: handleCompactContext,
      clearContext: handleClearContext,
    }),
    [
      handleCreateNewSession,
      handleSelectModel,
      handleSelectAgentMode,
      handleSelectWorkspace,
      handleToggleReasoning,
      handleToggleYoloMode,
      handleCompactContext,
      handleClearContext,
    ]
  );

  useEffect(() => {
    useAgentSheetBridge.getState().setActions(sheetActions);
  }, [sheetActions]);

  // A sheet outliving the workbench would be holding a closure over a session
  // that is gone. Emptying the bridge on unmount makes every handler a no-op
  // again rather than a stale one.
  useEffect(() => {
    return () => {
      useAgentSheetBridge.getState().reset();
    };
  }, []);

  /**
   * The one image the reader tapped, in the shape the shared lightbox takes.
   * Memoised so opening the viewer does not hand it a new array on every
   * stream tick, which would reset its pager.
   */
  const previewImages = useMemo<PreviewImage[] | null>(() => {
    if (!previewImageUri) return null;
    // A thumbnail served by the gateway was loaded with the device's token;
    // the lightbox fetches the same URL itself and needs the same headers.
    const fromGateway = previewImageUri.startsWith(gatewayUrl('/'));
    return [
      {
        id: previewImageUri,
        uri: previewImageUri,
        ...(fromGateway ? { headers: gatewayAuthHeaders() } : {}),
      },
    ];
  }, [previewImageUri]);

  return (
    <View style={styles.root}>
      {/* Main Content Stream */}
      {loading ? (
        <View style={[styles.centerContainer, { paddingTop: topInset + 20 }]}>
          <TerminalNotice>
            <StatusDot color={theme.colors.primary} filled pulse size={7} />
            <Text variant="caption" numberOfLines={1} style={terminalNoticeStyles.label}>
              <Trans>Connecting to agent engine…</Trans>
            </Text>
          </TerminalNotice>
        </View>
      ) : timeline.length === 0 && permissions.length === 0 && forms.length === 0 ? (
        <View
          style={[
            styles.emptyScrollWrapper,
            { paddingTop: topInset + 20, paddingBottom: bottomInset + 185 },
          ]}>
          <Animated.View
            entering={fadeIn()}
            layout={listLayout()}
            style={[
              styles.emptyContainer,
              {
                backgroundColor: surfaceBackground(theme.colors.surface),
                borderColor: theme.colors.border,
              },
            ]}>
            <PressableScale
              testID="agent-empty-workspace-pill"
              onPress={openWorkspaceSheet}
              accessibilityLabel={t`Switch workspace: ${displayWorkspaceName}`}
              style={[
                styles.workspacePill,
                {
                  backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.08)),
                  borderColor: withAlpha(theme.colors.primary, 0.25),
                  marginBottom: 6,
                },
              ]}>
              <FolderGit2 size={13} color={theme.colors.primary} />
              <Text variant="caption" weight="bold" color={theme.colors.primary} numberOfLines={1}>
                {displayWorkspaceName}
              </Text>
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                numberOfLines={1}
                style={styles.workspacePillPath}>
                {displayWorkspacePath}
              </Text>
              <ChevronDown size={12} color={theme.colors.primary} />
            </PressableScale>
            {isOffline ? (
              <>
                <Bot size={44} color={theme.colors.textMuted} />
                <Text variant="subheading" color={theme.colors.text} style={styles.emptyTitle}>
                  <Trans>OpenCode Service Offline</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptySubtitle}>
                  <Trans>
                    OpenCode agent daemon is not running on this host. Run `opencode serve
                    --service` to start it.
                  </Trans>
                </Text>
                <PressableScale
                  testID="agent-offline-retry-btn"
                  onPress={async () => {
                    setCheckingHealth(true);
                    await refreshSessions();
                    setCheckingHealth(false);
                  }}
                  style={[
                    styles.emptyNewBtn,
                    { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)) },
                  ]}>
                  {checkingHealth ? (
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                  ) : (
                    <RefreshCw size={14} color={theme.colors.primary} />
                  )}
                  <Text variant="label" color={theme.colors.primary} style={styles.emptyNewBtnText}>
                    <Trans>Check Again</Trans>
                  </Text>
                </PressableScale>
              </>
            ) : (
              <>
                <Bot size={44} color={theme.colors.primary} />
                <Text variant="subheading" color={theme.colors.text} style={styles.emptyTitle}>
                  <Trans>Welcome to OpenCode Agent</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted} style={styles.emptySubtitle}>
                  <Trans>Ask questions, inspect files, or run commands in your workspace.</Trans>
                </Text>
                <View style={styles.emptyActionsRow}>
                  <PressableScale
                    testID="agent-empty-new-session-btn"
                    onPress={handleCreateNewSession}
                    style={[
                      styles.emptyNewBtn,
                      { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)) },
                    ]}>
                    <PlusCircle size={14} color={theme.colors.primary} />
                    <Text
                      variant="label"
                      color={theme.colors.primary}
                      style={styles.emptyNewBtnText}>
                      <Trans>New Session</Trans>
                    </Text>
                  </PressableScale>
                  <PressableScale
                    testID="agent-empty-choose-project-btn"
                    onPress={openWorkspaceSheet}
                    style={[
                      styles.emptySecondaryBtn,
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                        borderColor: theme.colors.border,
                      },
                    ]}>
                    <FolderGit2 size={14} color={theme.colors.text} />
                    <Text variant="label" color={theme.colors.text} style={styles.emptyNewBtnText}>
                      <Trans>Choose Project</Trans>
                    </Text>
                  </PressableScale>
                </View>
              </>
            )}
          </Animated.View>
        </View>
      ) : (
        <LegendList<TimelineRenderGroup>
          ref={listRef}
          data={renderGroups}
          keyExtractor={keyOfGroup}
          renderItem={renderTimelineItem}
          /*
            Never, and this one is load-bearing rather than a preference. An
            assistant cell renders `EnrichedMarkdownText`, whose native view
            compares the incoming markdown against the last string it drew and
            re-parses when they differ -- which a recycle always makes them.
            Turning this on for "performance" would silently put a native
            markdown parse on every cell of every scroll.
            See docs/git-diff-viewer.md:362-380.
          */
          recycleItems={false}
          /*
            The other half of the identity deal, stated to the list itself: a
            group whose object has not changed has not changed.
            `buildTimelineGroupsCached` guarantees exactly that, so the
            strictest comparison is also the correct one, and the cheapest.
          */
          itemsAreEqual={groupsAreEqual}
          /*
            A user bubble, an assistant card carrying six tool shells and a diff
            block are wildly different heights, and one flat average across all
            of them is what makes a virtualised list jump when content lands
            above the viewport. The role is already the right bucket, so the
            list learns a size per kind instead.
          */
          getItemType={groupTypeOf}
          estimatedItemSize={70}
          initialScrollAtEnd={true}
          /*
            The reader's place across a change of *data* -- which is what
            "Load earlier messages" is here: the window comes back longer at the
            top, and the message they were reading has to stay under their eyes.
            The default covers rows changing size and skips that case.
          */
          maintainVisibleContentPosition={MAINTAIN_TIMELINE_POSITION}
          /*
            Follow the newest message, but only for a reader already at it --
            that is the threshold's job. New output must never move the viewport
            of someone who has scrolled up, which is also why there is no manual
            `scrollToEnd` on a stream tick.
          */
          maintainScrollAtEnd={true}
          maintainScrollAtEndThreshold={0.1}
          onScroll={handleTimelineScroll}
          refreshControl={
            <RefreshControl
              refreshing={loadingEarlier}
              enabled={windowStart > 0}
              onRefresh={handleLoadEarlier}
              progressViewOffset={topInset}
              // The same three colours the terminal transcript's own pull uses,
              // so the two surfaces answer a pull the same way.
              colors={[theme.colors.primary]}
              tintColor={theme.colors.textMuted}
              progressBackgroundColor={theme.colors.surfaceRaised}
            />
          }
          ListFooterComponent={listFooter}
          style={styles.timelineScroll}
          contentContainerStyle={[
            styles.timelineContent,
            { paddingTop: topInset + 10, paddingBottom: bottomInset + 185 },
          ]}
        />
      )}

      {/* Jump back to the latest message while browsing history */}
      {!loading && timeline.length > 0 && !isNearBottom ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.jumpToLatestWrap, { bottom: bottomInset + 196 }]}>
          <GlassChrome surface="navigation" style={styles.jumpToLatestCircle}>
            <PressableScale
              testID="agent-jump-to-latest-btn"
              accessibilityRole="button"
              accessibilityLabel={t`Scroll to latest message`}
              onPress={handleJumpToLatest}
              style={styles.jumpToLatestInner}>
              <ChevronDown size={18} color={theme.colors.text} strokeWidth={2.2} />
            </PressableScale>
          </GlassChrome>
        </Animated.View>
      ) : null}

      {/* YOLO mode indicator — tap to switch auto-approval off again */}
      {!loading && yoloMode ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.yoloBannerWrap, { bottom: bottomInset + 196 }]}>
          <PressableScale
            testID="agent-yolo-indicator"
            accessibilityRole="button"
            accessibilityLabel={t`YOLO mode on — tap to turn off`}
            onPress={() => setYoloMode(false)}
            style={[
              styles.yoloBanner,
              {
                backgroundColor: surfaceBackground(withAlpha(theme.colors.danger, 0.16)),
                borderColor: withAlpha(theme.colors.danger, 0.45),
              },
            ]}>
            <ShieldAlert size={13} color={theme.colors.danger} />
            <Text variant="caption" weight="bold" color={theme.colors.danger}>
              YOLO
            </Text>
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              style={styles.yoloBannerHint}>
              <Trans>auto-approving actions</Trans>
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}

      {/* Floating Glass Composer at Bottom */}
      <AgentComposer
        disabled={isOffline}
        running={isRunning}
        sessionStrip={sessionStrip}
        parentSession={activeParent}
        availableAgents={availableAgents}
        skills={skills}
        sessionId={sessionId}
        activeAsid={activeAsid}
        activeDirectory={activeDirectory}
        activeProject={activeProject}
        selectedAgent={selectedAgent}
        selectedModel={selectedModel}
        hasDiffs={hasDiffs}
        bottomInset={bottomInset}
        tasks={activeTodos}
        tokens={activeTokens}
        contextUsage={contextUsage}
        contextLimit={sessionInfo?.limit?.context}
        compaction={compaction}
        onDismissCompaction={dismissCompaction}
        cost={sessionInfo?.cost}
        sessionTitle={sessionInfo?.title}
        onSend={handleSendPrompt}
        onAbort={handleAbort}
        onSelectSession={setActiveAsid}
        onSelectAgentMode={handleSelectAgentMode}
        onCreateNewSession={handleCreateNewSession}
        onOpenModeSheet={openModeSheet}
        onOpenModelSheet={openModelSheet}
        onOpenDiffSheet={openDiffSheet}
        onOpenSessionsSheet={openSessionsSheet}
        onOpenTasksSheet={activeTodos && activeTodos.length > 0 ? openTasksSheet : undefined}
        backgroundCount={backgroundCount}
        onOpenBackgroundTray={openBackgroundTray}
        commands={commands}
        onRunCommand={handleRunCommand}
        onClientCommand={handleClientCommand}
        inbox={inbox}
        onCancelInboxItem={handleCancelInboxItem}
        onPressTokens={openContextSheet}
        injectDraftRef={injectDraftRef}
      />

      {/*
        The only overlay the workbench still mounts, and only while an image is
        open. Every picker is a route under `src/app/agent-*.tsx` now, so none
        of them is in this tree -- or fetching a catalog, or parsing a diff --
        unless the reader has actually navigated to it.
      */}
      {previewImages ? (
        <ImagePreviewModal
          images={previewImages}
          initialIndex={0}
          onClose={() => setPreviewImageUri(null)}
        />
      ) : null}

      {/* A file a tool returned, in the artifacts viewer rather than a second
          copy of it. */}
      {openToolAsset ? (
        <AssetViewer asset={openToolAsset} onClose={() => setOpenToolAsset(null)} />
      ) : null}
    </View>
  );
});

/**
 * Rows are addressed by `id` -- upsert, do not append -- and the result is put
 * back in the timeline's own `(message_id, ordinal)` order.
 *
 * The one exception is the optimistic user row: it carries a `temp_` id that
 * the server has never seen, so it is matched on its text and replaced in
 * place. Without that the reader's own message appears twice for a moment.
 */
function upsertTimelineItems(
  previous: readonly TimelineItem[],
  incoming: readonly TimelineItem[]
): TimelineItem[] {
  if (incoming.length === 0) return previous as TimelineItem[];
  const next = [...previous];
  let dirty = false;
  for (const item of incoming) {
    const existing = next.findIndex((it) => it.id === item.id);
    if (existing >= 0) {
      next[existing] = item;
      dirty = true;
      continue;
    }
    if (item.role === 'user' && item.part.type === 'text') {
      const text = item.part.text.trim();
      const optimistic = next.findIndex(
        (it) =>
          it.id.startsWith('temp_') &&
          it.role === 'user' &&
          it.part.type === 'text' &&
          it.part.text.trim() === text
      );
      if (optimistic >= 0) {
        next[optimistic] = item;
        dirty = true;
        continue;
      }
    }
    next.push(item);
    dirty = true;
  }
  return dirty ? sortTimeline(next) : (previous as TimelineItem[]);
}

/** A status event, applied to whichever branch of the tree carries that id. */
function applyChildStatus(
  previous: ChildrenByParent,
  asid: string,
  status: AgentRunStatus
): ChildrenByParent {
  let changed = false;
  const next: Record<string, AgentSessionInfo[]> = {};
  for (const [parent, children] of Object.entries(previous)) {
    next[parent] = children.map((child) => {
      if (child.asid !== asid || child.status === status) return child;
      changed = true;
      return { ...child, status };
    });
  }
  return changed ? next : previous;
}

/** A session removed on the host, taken out of the tree wherever it sits. */
function dropSession(previous: ChildrenByParent, asid: string): ChildrenByParent {
  let changed = false;
  const next: Record<string, AgentSessionInfo[]> = {};
  for (const [parent, children] of Object.entries(previous)) {
    // Its own branch goes with it: deleting a session deletes its children,
    // and OpenCode announces each of those too.
    if (parent === asid) {
      changed = true;
      continue;
    }
    const kept = children.filter((child) => child.asid !== asid);
    if (kept.length !== children.length) changed = true;
    next[parent] = kept;
  }
  return changed ? next : previous;
}

/** The same, for the whole info an `agent.session.updated` carries. */
function applyChildInfo(previous: ChildrenByParent, info: AgentSessionInfo): ChildrenByParent {
  let changed = false;
  const next: Record<string, AgentSessionInfo[]> = {};
  for (const [parent, children] of Object.entries(previous)) {
    next[parent] = children.map((child) => {
      if (child.asid !== info.asid) return child;
      changed = true;
      return { ...child, ...info };
    });
  }
  return changed ? next : previous;
}

function keyOfGroup(group: TimelineRenderGroup): string {
  return group.key;
}

/** The role is the size bucket: see `getItemType` above. */
function groupTypeOf(group: TimelineRenderGroup): string {
  return group.role;
}

function groupsAreEqual(previous: TimelineRenderGroup, next: TimelineRenderGroup): boolean {
  return previous === next;
}

/** Anchor on a change of data, not only on rows changing size. */
const MAINTAIN_TIMELINE_POSITION = { data: true, size: true } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 30,
    gap: 12,
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingHorizontal: 14,
    gap: 10,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    marginTop: 30,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  emptyTitle: {
    fontWeight: '700',
    fontSize: 16,
  },
  emptySubtitle: {
    fontSize: AGENT_TYPE.meta.size,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: AGENT_TYPE.mono.lineHeight,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  emptyNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  emptySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyNewBtnText: {
    fontWeight: '600',
    fontSize: AGENT_TYPE.meta.size,
  },
  thinkingRow: {
    alignSelf: 'flex-start',
    marginVertical: 4,
  },
  thinkingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyScrollWrapper: {
    flex: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  workspacePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '85%',
  },
  workspacePillPath: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  statusNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  statusNoticeText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  footerContainer: {
    gap: 10,
    marginTop: 4,
  },
  jumpToLatestWrap: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
  },
  jumpToLatestCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpToLatestInner: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  yoloBannerWrap: {
    position: 'absolute',
    left: 14,
    zIndex: 5,
  },
  yoloBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  yoloBannerHint: {
    flexShrink: 1,
    fontSize: AGENT_TYPE.micro.size,
  },
});
