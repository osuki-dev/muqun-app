import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  InteractionManager,
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
  X,
} from 'lucide-react-native';
import { type LegendListRenderItemProps, type LegendListRef } from '@legendapp/list/react-native';
import { KeyboardAwareLegendList } from '@legendapp/list/keyboard';
import { PressableScale } from '@/components/pressable-scale';
import { GlassChrome } from '@/components/glass-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { withAlpha } from '@/lib/color';
import { DURATION, fadeIn, fadeInDown, fadeOut, fadeOutUp, riseIn, timing } from '@/lib/motion';
import { emptyCardBottomReserve, emptyCardTopReserve } from '@/lib/agent-empty-layout';
import { StatusDot } from '@/components/status-dot';
import {
  badgeLoadsAllowed,
  workspaceMissingState,
  type WorkspaceMissingState,
} from '@/lib/agent-workspace-missing';
import { AgentTranscriptSkeleton } from '@/components/agent-transcript-skeleton';
import {
  getAgentSessionSnapshot,
  moveAgentSession,
  sessionWorktreeName,
  listAgentWorktrees,
  listAgentSessions,
  sameDirectory,
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
  deleteAgentSession,
  renameAgentSession,
  invokeAgentSkill,
  getAgentContext,
  listAgentSessionChildren,
  listAgentShells,
  listAgentInbox,
  markAgentSessionViewed,
  cancelAgentInboxItem,
  setAgentInboxDelivery,
  clearAgentRevert,
  commitAgentRevert,
  stageAgentRevert,
  exportAgentSession,
  sendAgentCommand,
  orderKeyAfter,
  sortTimeline,
  formatModelName,
  isBusyStatus,
  inboxItemText,
  type WorkspaceMissing,
  type WorktreeDirectory,
  type AgentContextUsage,
  type AgentDomainEvent,
  type AgentRunStatus,
  type AgentSessionInfo,
  type AgentSessionRevert,
  type CommandInfo,
  type FileDiffItem,
  type ShellInfo,
  type CompactionReason,
  type InboxItem,
  type TimelineItem,
  type PermissionRequest,
  type FormRequest,
  type ModelRef,
  type PermissionDecision,
  type AgentInfo,
  type CatalogDefaults,
  type ModelInfo,
  type SkillInfo,
  type AgentProject,
} from '@/lib/agent-session';
import { shouldRefetchAgentCatalog, type AgentCatalogScope } from '@/lib/agent-catalog-scope';
import { loadRememberedAgentDefaults, rememberAgentChoice } from '@/lib/agent-model-memory';
import { loadRememberedAgentSession, rememberOpenedAgentSession } from '@/lib/agent-session-memory';
import { latestSession, pickSessionToOpen } from '@/lib/agent-session-pick';
import { resolveNewSessionDefaults } from '@/lib/agent-session-defaults';
import { engineFailureAction } from '@/lib/agent-engine-text';
import { dangerousPermissionReason, yoloDecision } from '@/lib/agent-permission-safety';
import { removeTimelineItems, revertedMessageCount } from '@/lib/agent-revert';
import { classifyTool, capText } from '@/lib/agent-tool-output';
import type { AgentClientCommandId } from '@/lib/agent-commands';
import {
  advanceSeq,
  askCatchUp,
  CATCH_UP_START,
  snapshotSettled,
  type CatchUpState,
} from '@/lib/agent-catch-up';
import {
  buildSessionStrip,
  indexSessions,
  parentOf,
  rootOf,
  sessionsInWorkspace,
  type ChildrenByParent,
} from '@/lib/agent-session-tree';
import { useAgentSessionState } from '@/stores/agent-session-state';
import { useAgentPermissionStore } from '@/stores/agent-permissions';
import { useInAppNotifications } from '@/stores/in-app-notifications';
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
import { type TranscriptMark } from '@/lib/transcript-scroll';
import { createTranscriptFollow, type TranscriptFollow } from '@/lib/transcript-follow';
import { TRANSCRIPT_ESTIMATED_ITEM_SIZE } from '@/lib/transcript-sizing';
import {
  buildTimelineGroupsCached,
  createTimelineGroupCache,
  reconcileShellParts,
  type TimelineRenderGroup,
} from '@/lib/agent-timeline-groups';
import { AgentPermissionCard } from './agent-permission-card';
import { AgentFormCard } from './agent-form-card';
import { AgentComposer } from './agent-composer';
import { runningShellCount } from '@/components/agent-background-tray';
import { ThinkingIndicator } from './agent-thinking-indicator';
import { AGENT_TYPE } from '@/constants/agent-type';
import { gatewayAuthHeaders, gatewayUrl } from '@/lib/gateway-client';
import { appChrome } from '@/constants/appearance';

/**
 * How many history timeline items the workbench reveals per page. The gateway
 * timeline only supports forward deltas, so history is paged on the client by
 * growing the rendered window downwards from the latest page.
 */
const HISTORY_PAGE_SIZE = 40;

/**
 * How many root sessions one listing asks for.
 *
 * The strip draws a handful of chips and the sessions sheet lists them newest
 * first, so a bound with `order: 'desc'` cuts the oldest rather than the ones
 * anybody is looking at -- and this response is the largest single thing the
 * agent screen fetches.
 */
const SESSION_LIST_LIMIT = 50;

/**
 * How long the screen's own notice stays before it fades out by itself.
 *
 * Long enough to be read on the way past, short enough that it is gone before
 * the reader wants the space back. It is dismissible either way.
 */
const SCREEN_NOTICE_DWELL_MS = 4200;

/**
 * The gap between the header's bottom edge and the screen's own notice.
 *
 * `topInset` is already the first row under the header plus the timeline's own
 * clearance (`HEADER_INSET` in `src/app/agent.tsx`); a notice wants to sit a
 * little higher than the first message without ever reaching the pills.
 */
const SCREEN_NOTICE_HEADER_GAP = 14;

/** A catalog that has not answered yet, as one object rather than a new `{}`. */
const NO_CATALOG_DEFAULTS: CatalogDefaults = {};

/** Between a notice and the first transcript row it is standing over. */
const NOTICE_RESERVE_GAP = 8;

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

  /**
   * The screen's own notice, under the header rather than over it.
   *
   * "New session" used to be an app-wide toast, and an app-wide toast is
   * placed against the safe-area inset -- which is exactly where this screen's
   * workspace pill and new-session control live, so the one notice the reader
   * did not ask for covered the two controls they did. This one belongs to the
   * screen, so it can start below the chrome, and it is dismissible.
   */
  const [screenNotice, setScreenNotice] = useState<{
    id: number;
    title: string;
    body: string;
  } | null>(null);
  /**
   * The screen's other notice: the workspace folder is gone, and it stays.
   *
   * Not a toast and not on a timer -- it is not news about something that
   * happened, it is the state of the ground under this session, true until the
   * reader moves it somewhere that exists. It carries the one action that
   * changes that. See `badgeLoads` below for what it also stops.
   */
  const [workspaceMissing, setWorkspaceMissing] = useState<WorkspaceMissingState | null>(null);
  const screenNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showScreenNotice = useCallback((title: string, body: string) => {
    if (screenNoticeTimerRef.current) clearTimeout(screenNoticeTimerRef.current);
    setScreenNotice({ id: Date.now(), title, body });
    screenNoticeTimerRef.current = setTimeout(() => setScreenNotice(null), SCREEN_NOTICE_DWELL_MS);
  }, []);
  useEffect(
    () => () => {
      if (screenNoticeTimerRef.current) clearTimeout(screenNoticeTimerRef.current);
    },
    []
  );

  /**
   * How much of the top of the screen a notice is standing on.
   *
   * A notice is an overlay, and an overlay over a transcript is a lid on the
   * row the reader was reading -- the permission card's own title, in the case
   * that made this worth fixing. Padding the *content* would not have helped:
   * the notice sits at a fixed place on the screen, not at the top of the
   * scroll. So the transcript's viewport gives the notice its room and takes
   * it back, which is a move the reader can follow rather than a row that was
   * simply covered.
   *
   * Two sources, one gap: this screen's own notice, and the app-wide deck
   * (`InAppNotificationHost`) that an approval push lands in. They stand in
   * the same place, so the room they need is the larger of the two.
   */
  const [screenNoticeHeight, setScreenNoticeHeight] = useState(0);
  const inAppNoticeHeight = useInAppNotifications((state) =>
    state.items.length > 0 ? state.overlayHeight : 0
  );
  const noticeReserve = useSharedValue(0);
  // How far down the screen a notice reaches, not how tall it is: each one
  // starts below the chrome, and the room to leave is the bottom edge.
  const reserved = Math.max(
    screenNotice || workspaceMissing
      ? Math.max(0, topInset - SCREEN_NOTICE_HEADER_GAP) + screenNoticeHeight
      : 0,
    inAppNoticeHeight
  );
  const reservedWithGap = reserved > 0 ? reserved + NOTICE_RESERVE_GAP : 0;
  useEffect(() => {
    noticeReserve.value = withTiming(reservedWithGap, timing('dropdown'));
  }, [reservedWithGap, noticeReserve]);
  const transcriptAreaStyle = useAnimatedStyle(() => ({ paddingTop: noticeReserve.value }));

  /**
   * How much of the screen the composer is standing on, as measured rather
   * than guessed.
   *
   * The empty card is centred between the header and the dock, and the dock's
   * height is whatever its contents come to. It was a constant 185 before,
   * which was right on no device and worst on the two that matter: with a
   * session strip up the card sank under the dock, and with the composer
   * offline it floated well above it.
   */
  const [dockHeight, setDockHeight] = useState(0);
  const emptyBottomReserve = emptyCardBottomReserve(dockHeight, bottomInset);
  /*
    The transcript area already carries the notice's reserve as padding, so
    the card's own top padding is the rest of the header inset, not all of it.
    Animated on the same shared value the reserve is, so the card holds still
    while a notice opens and closes rather than jumping the difference.
  */
  const emptyReserveStyle = useAnimatedStyle(() => ({
    marginTop: emptyCardTopReserve(topInset, noticeReserve.value),
  }));

  /**
   * An approval notice outlives the question it asked, and should not.
   *
   * The push arrives while the app is in front, so the reader often answers
   * the card itself -- or another device does, or the agent gives up waiting.
   * The notice knew none of that and stood there until its X was pressed,
   * asking for a decision that had already been made. When the last request
   * leaves `permissions` -- which is what `agent.permission.resolved` does to
   * it -- the notices about them go too.
   */
  const wasWaitingRef = useRef(false);

  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  /**
   * The same list, for the callbacks that only read it.
   *
   * What a new session should run is partly a question about the sessions this
   * host already has (`resolveNewSessionDefaults`), and that question is asked
   * when the reader presses something -- never during a render. A ref answers
   * it without making every session refresh rebuild the screen's handlers.
   */
  const sessionsRef = useRef<readonly AgentSessionInfo[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);
  const [availableAgents, setAvailableAgents] = useState<AgentInfo[]>([]);
  /**
   * Every model the host publishes, kept for the two things a `ModelRef`
   * cannot answer on its own: the name the catalogue gives it -- "Nemotron 3.5
   * Lightning Free", not this app's guess at a title from the id -- and the
   * context window, for a session the gateway stated no `limit` for.
   */
  const [catalogModels, setCatalogModels] = useState<readonly ModelInfo[]>([]);
  /**
   * What the host says it prefers, kept rather than read once and dropped.
   *
   * It was applied to the chips and then forgotten, so the create path could
   * not use it -- and a host with a real default configured deserves to have
   * it sent rather than guessed at.
   */
  const [catalogDefaults, setCatalogDefaults] = useState<CatalogDefaults>(NO_CATALOG_DEFAULTS);
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
  /**
   * Whether the app is in front, for the stream handler.
   *
   * A ref rather than a dependency: taking `appActive` into `handleStreamEvent`
   * would tear the SSE connection down and rebuild it every time the reader
   * switched apps, which is the one moment a stream should be left alone.
   */
  const appActiveRef = useRef(true);
  /** The workspace on screen, for the calls that are made outside a render. */
  const activeDirectoryRef = useRef<string | undefined>(undefined);
  /**
   * The directory the open session said it was in.
   *
   * What tells "the reader switched workspace" from "the session we just opened
   * told us where it lives" -- only the first is worth re-listing for.
   */
  const snapshotDirectoryRef = useRef<string | undefined>(undefined);
  const [permissions, setPermissions] = useState<PermissionRequest[]>([]);
  useEffect(() => {
    if (permissions.length > 0) {
      wasWaitingRef.current = true;
      return;
    }
    if (!wasWaitingRef.current) return;
    wasWaitingRef.current = false;
    useInAppNotifications.getState().dismissKind('approval');
  }, [permissions.length]);
  const [forms, setForms] = useState<FormRequest[]>([]);
  // What is waiting behind the current turn, as the gateway last stated it.
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  /**
   * A rollback that is staged and not yet applied.
   *
   * `info.revert` on a cold open, `agent.revert.changed` while the screen is
   * live. It is the plate above the composer, and it is the whole of what makes
   * `/undo` answerable: the one-shot route it used to call rolled back on the
   * spot, with no statement of what it had taken.
   */
  const [stagedRevert, setStagedRevert] = useState<AgentSessionRevert | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  // A compaction in flight, which is a pill above the composer rather than a
  // row: the row lands in the timeline when the boundary is reached.
  const [compaction, setCompaction] = useState<{
    status: 'running' | 'failed';
    reason: CompactionReason;
  } | null>(null);
  /**
   * Where this session is in the gateway's event sequence, and whether a
   * catch-up is owed. See `lib/agent-catch-up.ts`: the marker is raised, never
   * assigned, and a catch-up asked for before the first snapshot is remembered
   * rather than dropped. A ref, never state: bumping it must not re-run the
   * stream effect or re-render anything.
   */
  const syncRef = useRef<CatchUpState>(CATCH_UP_START);
  const [loading, setLoading] = useState(true);
  const [hasDiffs, setHasDiffs] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  /*
    Whether the reader is browsing history, and whether anything arrived while
    they were: together, the two facts the jump-to-latest pill is drawn from.
    New output never moves their viewport, so the pill is the whole of what the
    transcript is allowed to do about it.

    Held outside React because `onScroll` fires on every frame of every drag,
    and as `useState` here each of those frames re-rendered this whole
    component -- composer, header, sheets, footer and the list's element tree
    -- to decide whether one pill was on screen. Exactly one view reads these,
    so exactly one view subscribes. See `lib/transcript-follow.ts`.
  */
  const follow = useMemo(() => createTranscriptFollow(), []);

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
   *
   * "Chose" used to mean "chose since this app was launched", which made a
   * relaunch forget the model the reader had been working on all week. It now
   * reaches the store, the sessions already on this host, the catalog's
   * defaults and -- last -- the catalog's first free model, because omitting
   * `model` is only safe on a host that has a default configured. See
   * `lib/agent-session-defaults.ts` for the whole ladder and why its bottom
   * rung is not "send nothing".
   *
   * `sessionsRef` rather than `sessions`: the list is refreshed on every turn
   * boundary, and this callback is a dependency of most of the screen's
   * handlers. Reading it through a ref keeps a session list arriving from
   * rebuilding them all.
   */
  const newSessionParams = useCallback(
    (directory?: string) => ({
      ...resolveNewSessionDefaults({
        picked: {
          ...(pickedAgentRef.current && selectedAgent ? { agent: selectedAgent } : {}),
          ...(pickedModelRef.current && selectedModel ? { model: selectedModel } : {}),
        },
        ...loadRememberedAgentDefaults(sessionId, directory),
        sessions: sessionsRef.current,
        ...(directory ? { directory } : {}),
        catalogDefaults,
        models: catalogModels,
        agents: availableAgents,
      }),
      ...(directory ? { directory } : {}),
    }),
    [selectedAgent, selectedModel, sessionId, catalogDefaults, catalogModels, availableAgents]
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
  useEffect(() => {
    activeDirectoryRef.current = activeDirectory;
  }, [activeDirectory]);

  /**
   * The session on screen, remembered for the next time this screen opens.
   *
   * Written here rather than in each handler because every way into a session
   * ends here: a chip in the strip, a row in the sessions sheet, a swipe across
   * the title, a workspace switch, a session just created, a child opened from
   * its parent. One place, and no path that quietly forgets.
   *
   * It follows the directory as well as the session, so a session moved to a
   * worktree is remembered where it now lives rather than where it used to.
   */
  useEffect(() => {
    if (!activeAsid) return;
    rememberOpenedAgentSession(sessionId, activeDirectory, activeAsid);
  }, [sessionId, activeDirectory, activeAsid]);

  /**
   * Whether the badge reads may run: context, diff, shells, worktrees.
   *
   * They are all about the session's workspace folder, and the host does not
   * always still have it -- a worktree removed, a throwaway clone deleted.
   *
   * OpenCode answers every directory-scoped read about it with a `500`, which
   * reached the device as a `502` and read like a passing fault: the badge
   * loads asked again on every entry and every focus, four `404`s at a time,
   * and the reader was told nothing. The gateway now names it --
   * `404 workspace_missing`, with the path -- so the screen says the one
   * sentence there is to say and stops asking until the ground changes.
   *
   * Bound to the session and to the directory, so a move to a worktree or a
   * switch to another workspace clears it by arithmetic. `badgeLoadsAllowed`
   * is that arithmetic, kept pure in `agent-workspace-missing.ts`.
   */
  const badgeLoads = badgeLoadsAllowed({
    asid: activeAsid,
    directory: activeDirectory,
    missing: workspaceMissing,
  });
  /**
   * What each session on this screen has already been told, so it is told once.
   *
   * State alone would be answered again on the way back: the reader steps from
   * a session whose folder is gone to another one and returns, and the screen
   * -- having cleared the notice for the session in between -- asks the four
   * reads a second time and collects four more `404`s. A session's own answer
   * is remembered for as long as the screen is up, and it stops applying the
   * moment that session is somewhere else.
   */
  const workspaceMissingRef = useRef(new Map<string, WorkspaceMissingState>());
  const noteWorkspaceMissing = useCallback(
    (missing: WorkspaceMissing | undefined, asid: string | undefined) => {
      const next = workspaceMissingState(missing, asid);
      if (!next) return;
      workspaceMissingRef.current.set(next.asid, next);
      setWorkspaceMissing((prev) =>
        prev && prev.asid === next.asid && sameDirectory(prev.directory, next.directory)
          ? prev
          : next
      );
    },
    []
  );
  useEffect(() => {
    // The session or the ground changed. Either this session is known to be
    // standing on a folder that is gone -- and says so without asking again --
    // or whatever was said about it no longer describes where it is.
    const remembered = activeAsid ? workspaceMissingRef.current.get(activeAsid) : undefined;
    // Nothing is ever dropped from the map: an entry is only *used* when it
    // still describes where the session is, so a session that moved somewhere
    // real simply stops matching. Deleting on a mismatch looked tidier and was
    // wrong -- the directory lags the session by a render on the way back into
    // a session, and the entry was thrown away in that window and asked for
    // again.
    const applies =
      remembered !== undefined &&
      !badgeLoadsAllowed({ asid: activeAsid, directory: activeDirectory, missing: remembered });
    setWorkspaceMissing((prev) => {
      if (applies) {
        return prev &&
          prev.asid === remembered.asid &&
          sameDirectory(prev.directory, remembered.directory)
          ? prev
          : remembered;
      }
      return prev &&
        badgeLoadsAllowed({ asid: activeAsid, directory: activeDirectory, missing: prev })
        ? null
        : prev;
    });
  }, [activeAsid, activeDirectory]);

  /**
   * The catalog for the workspace on screen: agents, skills, commands, models.
   *
   * Read *with* the active directory, because OpenCode scopes agents, commands
   * and skills per project: without it the answer is the global set and a user's
   * own agent under `.opencode/agent` is missing from the composer's chips, from
   * the mode picker, and from `defaults`. The directory is not known on the first
   * pass -- it arrives with the session's snapshot -- so this reads once
   * unscoped and again the moment there is a workspace to name, and again on
   * every workspace switch and on a session moved to a worktree, whose
   * `agent.session.updated` sets `activeDirectory` the same way.
   *
   * `shouldRefetchAgentCatalog` is the rule, kept pure in `agent-catalog-scope`
   * and tested there. The ref is what this effect already read last, so a
   * re-render that changes nothing about the scope does not ask again.
   */
  const catalogScopeRef = useRef<AgentCatalogScope | null>(null);
  useEffect(() => {
    const scope: AgentCatalogScope = { sessionId, directory: activeDirectory };
    if (!shouldRefetchAgentCatalog(catalogScopeRef.current, scope)) return;
    catalogScopeRef.current = scope;
    let mounted = true;
    getAgentCatalog(sessionId, undefined, scope.directory ? { directory: scope.directory } : {})
      .then((catalog) => {
        if (!mounted) return;
        if (catalog?.agents && catalog.agents.length > 0) {
          setAvailableAgents(catalog.agents);
        }
        if (catalog?.skills && catalog.skills.length > 0) {
          setSkills(catalog.skills);
        }
        setCommands(catalog?.commands ?? []);
        setCatalogModels(catalog?.models ?? []);
        setCatalogDefaults(catalog?.defaults ?? NO_CATALOG_DEFAULTS);
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
  }, [sessionId, activeDirectory, applySelectedModel]);

  /**
   * The chips say what a new session is about to run, which is the remembered
   * model rather than the host's default.
   *
   * Only while there is no session on screen. A session that exists has a model
   * of its own and the screen shows that one -- `loadSnapshot` applies
   * `info.model`, and this must never talk over it. So the moment `activeAsid`
   * names a session, the memory stops having anything to say about the display;
   * what it decided about the *create* is already in that session's own model.
   *
   * Runs again when the catalog lands and when the reader moves to another
   * workspace, because both change the answer: the first is what makes a
   * remembered model verifiable at all, and the second is which workspace's
   * memory applies.
   */
  useEffect(() => {
    if (activeAsid) return;
    if (pickedModelRef.current && pickedAgentRef.current) return;
    const resolved = resolveNewSessionDefaults({
      picked: {},
      ...loadRememberedAgentDefaults(sessionId, activeDirectory),
      sessions: sessionsRef.current,
      ...(activeDirectory ? { directory: activeDirectory } : {}),
      catalogDefaults,
      models: catalogModels,
      agents: availableAgents,
    });
    if (!pickedModelRef.current && resolved.model) applySelectedModel(resolved.model);
    if (!pickedAgentRef.current && resolved.agent) setSelectedAgent(resolved.agent);
  }, [
    sessionId,
    activeAsid,
    activeDirectory,
    catalogDefaults,
    catalogModels,
    availableAgents,
    sessions,
    applySelectedModel,
  ]);

  const initialCheckDoneRef = useRef(Boolean(initialAsid));
  /** Whether the unscoped listing came back whole, i.e. under its own limit. */
  const hostListCompleteRef = useRef(false);

  /**
   * The roots this host holds, listed once per scope.
   *
   * `activeAsid` used to be a dependency, and this function *sets* it -- so the
   * effect that runs it re-declared the moment it picked a session and listed
   * the whole thing a second time, twenty kilobytes for an answer the app
   * already had. Whether a session has been picked is read from the ref that
   * mirrors it instead, which is the same fact without the feedback loop.
   */
  const refreshSessions = useCallback(
    async (directory = activeDirectoryRef.current) => {
      try {
        // Roots only, and scoped to the workspace on screen: a subagent session
        // is a row in its parent's tree, never a sibling of it in the strip.
        // Bounded, because the strip draws a handful of chips and every surface
        // that reads this list sorts by recency: `desc` is newest first, so
        // what the limit cuts is the oldest.
        const list = await listAgentSessions(sessionId, {
          roots: true,
          limit: SESSION_LIST_LIMIT,
          order: 'desc',
          ...(directory ? { directory } : {}),
        });
        setIsOffline(false);
        if (list) {
          if (!directory) hostListCompleteRef.current = list.length < SESSION_LIST_LIMIT;
          setSessions(list);
          // Coming in from Home lands on the session the reader last opened,
          // and only falls back to newest activity when there is no such
          // session any more. Newest activity alone meant an agent finishing a
          // turn elsewhere could take the screen away from the session the
          // reader had chosen -- see `agent-session-pick.ts`.
          const opening = pickSessionToOpen(list, loadRememberedAgentSession(sessionId, directory));
          if (opening && !activeAsidRef.current) {
            setActiveAsid(opening.asid);
            setSessionInfo(opening);
            if (opening.model) {
              applySelectedModel(opening.model);
            }
            if (opening.agent) setSelectedAgent(opening.agent);
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
    },
    [sessionId, applySelectedModel]
  );

  /**
   * The listing, once per scope that is worth listing.
   *
   * The first read is unscoped, which is every root on the host; the session
   * that opens then tells us its directory, and re-listing for *that* directory
   * asks for a subset of what is already in hand. The scopes the reader chooses
   * themselves -- switching workspace -- are the ones worth a request, and this
   * is what tells the two apart.
   */
  const listedScopeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const scope = activeDirectory ?? '';
    if (listedScopeRef.current !== undefined) {
      if (listedScopeRef.current === scope) return;
      // A directory that arrived from the session we just opened is a directory
      // the listing already covers -- but only when the listing in hand is the
      // host's, and all of it. Skipping on the directory alone was wrong twice:
      // after the reader had been in project A the list in hand was A's, so
      // opening a session of project B from "All projects" left the strip
      // filtering A's sessions for B's directory and drawing one chip; and a
      // host-wide list cut at its limit does not hold every session of B
      // either.
      if (
        scope &&
        scope === snapshotDirectoryRef.current &&
        listedScopeRef.current === '' &&
        hostListCompleteRef.current
      ) {
        listedScopeRef.current = scope;
        return;
      }
    }
    listedScopeRef.current = scope;
    void refreshSessions(scope || undefined).catch(() => {});
  }, [activeDirectory, refreshSessions]);

  const handleTimelineScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      if (contentSize.height <= 0) return;
      // For the jump-to-latest affordance, and nothing else. The store drops
      // an unchanged answer, so a drag that stays at the bottom -- or stays
      // away from it -- notifies nobody and renders nothing.
      follow.setGeometry({
        offset: contentOffset.y,
        viewport: layoutMeasurement.height,
        content: contentSize.height,
      });
    },
    [follow]
  );

  const handleJumpToLatest = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    listRef.current?.scrollToEnd({ animated: true });
    follow.reset();
  }, [follow]);

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

  /**
   * "Read, at this moment" -- the gateway's own answer, put where the dot is
   * drawn from.
   *
   * Not a local guess: `…/view` answers with the millisecond it marked, and
   * that is what goes into `time_viewed`. Without it the mark waits for
   * `agent.session.updated` to come round, which is long enough for the dot to
   * blink on after a turn the reader sat and watched end.
   */
  const applyViewed = useCallback((asid: string, viewed: number | undefined) => {
    if (!viewed) return;
    const stamp = (session: AgentSessionInfo): AgentSessionInfo =>
      session.asid === asid && (session.time_viewed ?? 0) < viewed
        ? { ...session, time_viewed: viewed }
        : session;
    setSessions((prev) => prev.map(stamp));
    setChildrenByParent((prev) => {
      let changed = false;
      const next: Record<string, AgentSessionInfo[]> = {};
      for (const [parent, children] of Object.entries(prev)) {
        next[parent] = children.map((child) => {
          const marked = stamp(child);
          if (marked !== child) changed = true;
          return marked;
        });
      }
      return changed ? next : prev;
    });
    setSessionInfo((prev) => (prev ? stamp(prev) : prev));
  }, []);

  const refreshShells = useCallback(async () => {
    if (!badgeLoads) {
      setShells([]);
      return;
    }
    setShells(await listAgentShells(activeDirectory));
  }, [activeDirectory, badgeLoads]);

  /**
   * Whether there is anything to open the changes sheet on.
   *
   * Read when a session loads *and* whenever a turn ends: the agent writing a
   * file is the one thing that changes this answer, and a flag read once at
   * load meant the changes chip was missing from exactly the sessions that
   * had written something.
   */
  const refreshDiffs = useCallback(async () => {
    if (!activeAsid || !badgeLoads) {
      setHasDiffs(false);
      return;
    }
    try {
      const answer = await getAgentVcsDiff(sessionId, activeAsid);
      noteWorkspaceMissing(answer.missing, activeAsid);
      setHasDiffs(answer.files.length > 0);
    } catch {
      setHasDiffs(false);
    }
  }, [sessionId, activeAsid, badgeLoads, noteWorkspaceMissing]);

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
    if (!activeAsid || !badgeLoads) return;
    const usage = await getAgentContext(activeAsid);
    setContextUsage(usage);
  }, [activeAsid, badgeLoads]);

  /**
   * The four reads that feed the composer's chips, reachable without being
   * depended on.
   *
   * Each of them closes over `activeAsid` or `activeDirectory`, so taking them
   * as dependencies of the snapshot loader gave that loader a new identity
   * every time the snapshot set the directory -- and the effect that runs it
   * then ran a second complete entry: another session snapshot, another
   * context, another shells (now scoped), another inbox, another diff. That was
   * most of the seventeen requests the screen opened with.
   */
  const sideLoadsRef = useRef({
    context: refreshContext,
    shells: refreshShells,
    inbox: refreshInbox,
    diffs: refreshDiffs,
  });
  useEffect(() => {
    sideLoadsRef.current = {
      context: refreshContext,
      shells: refreshShells,
      inbox: refreshInbox,
      diffs: refreshDiffs,
    };
  }, [refreshContext, refreshShells, refreshInbox, refreshDiffs]);

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
      const asid = activeAsid;
      if (!asid) {
        if (initialCheckDoneRef.current) {
          setLoading(false);
        }
        return;
      }
      if (mode === 'enter') setLoading(true);
      try {
        const snap = await getAgentSessionSnapshot(sessionId, asid);
        const info = snap.info;
        if (info) {
          setSessionInfo(info);
          if (info.directory) {
            snapshotDirectoryRef.current = info.directory;
            setActiveDirectory(info.directory);
          }
        }
        setInbox(snap.inbox);
        // A rollback staged before the app was opened is still staged.
        setStagedRevert(info?.revert ?? null);

        if (mode === 'enter') {
          setTimeline(snap.timeline);
          // Enter every session on its latest page: only the newest slice is
          // rendered at first and older history loads on demand from the top.
          setWindowStart(Math.max(0, snap.timeline.length - HISTORY_PAGE_SIZE));
          follow.reset();
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
        /**
         * Raised to the snapshot's point, not assigned to it -- and a catch-up
         * that was asked for before this landed is paid here rather than lost.
         * See `lib/agent-catch-up.ts`.
         */
        const settled = snapshotSettled(syncRef.current, snap.seq);
        syncRef.current = settled.state;
        if (settled.from !== null) catchUpRef.current();
        if (info?.model) {
          applySelectedModel(info.model);
        }
        if (info?.agent) setSelectedAgent(info.agent);

        /**
         * Reading it is what makes it read.
         *
         * `markAgentSessionViewed` existed in the client with no caller and
         * `isSessionUnread` with no reader, so every session on the host was
         * permanently unread and nothing drew the fact. The idle the session
         * reached is what is acknowledged -- not "now" -- so a turn that ends
         * between this call leaving and landing is still unread afterwards,
         * which is the honest answer.
         */
        if (info) {
          const idle = info.time_idle;
          const viewedAsid = info.asid;
          void (
            idle === undefined
              ? markAgentSessionViewed(viewedAsid)
              : markAgentSessionViewed(viewedAsid, idle)
          )
            .then((viewed) => applyViewed(viewedAsid, viewed))
            .catch(() => {});
        }

        /**
         * The chips, after the transcript.
         *
         * None of these draws a word of the conversation: the token gauge, the
         * background count and the changes dot are all composer furniture, and
         * running them on the way in put three requests in front of the first
         * frame. `snap.inbox` has already been applied above, so the inbox is
         * not asked for again at all -- that read was answering a question the
         * snapshot had just answered.
         */
        InteractionManager.runAfterInteractions(() => {
          if (activeAsidRef.current !== asid) return;
          void sideLoadsRef.current.context();
          void sideLoadsRef.current.shells();
          void sideLoadsRef.current.diffs();
        });
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
        // Anything else is a session that exists and could not be read. The
        // entry guard is released so this session can be opened again: a
        // snapshot that failed once -- the gateway's address not hydrated yet,
        // a dropped request -- must not leave the screen permanently empty.
        openedAsidRef.current = undefined;
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
      applyViewed,
      follow,
      handleAutoPermission,
      showToast,
      t,
    ]
  );

  /**
   * Entering a session is one snapshot, once.
   *
   * The effect used to depend on `loadSnapshot`, and `loadSnapshot` changed
   * identity whenever anything it called did -- so opening the screen ran the
   * whole entry twice. What the reader is entering is an `asid`, so that is
   * what this is keyed on: the loader still re-declares when the session
   * changes, and the ref says whether that session has already been opened.
   */
  const openedAsidRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activeAsid) {
      openedAsidRef.current = undefined;
      if (initialCheckDoneRef.current) setLoading(false);
      return;
    }
    if (openedAsidRef.current === activeAsid) return;
    openedAsidRef.current = activeAsid;
    void loadSnapshot('enter').catch(() => {});
  }, [activeAsid, loadSnapshot]);

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
      syncRef.current = advanceSeq(syncRef.current, event.seq);

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

        case 'agent.timeline.removed':
          /**
           * Rows the gateway says are gone. A committed rollback is the one
           * that sends many at once: OpenCode deletes the boundary message and
           * everything after it and has no event of its own for that.
           *
           * Nothing is scrolled and nothing is re-anchored. The rows leave from
           * under the reader's eyes, which is what they asked for, and every
           * group above them keeps its identity -- see `agent-revert.ts`.
           */
          setTimeline((prev) => removeTimelineItems(prev, event.ids));
          break;

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
            // A turn that ended under the reader's eyes has been read. The
            // dot is for the sessions they were not looking at.
            if (appActiveRef.current && event.asid) {
              const viewedAsid = event.asid;
              void markAgentSessionViewed(viewedAsid)
                .then((viewed) => applyViewed(viewedAsid, viewed))
                .catch(() => {});
            }
            void refreshSessions();
            void refreshContext();
            void refreshShells();
            void refreshDiffs();
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
            // A session update states the staged boundary when there is one.
            // It never states its absence -- a field an event did not mention
            // keeps its previous value -- so clearing is the revert event's job.
            if (info.revert) setStagedRevert(info.revert);
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

        case 'agent.revert.changed':
          // A subagent's own rollback is not the plate above this composer.
          if (!forActiveSession) break;
          setStagedRevert(event.state === 'staged' ? event.revert : null);
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
        case 'agent.worktree.changed':
          // `ready` as well as the two inventory states: 2.0.1 emits only
          // `worktree.resolved` and `worktree.updated`, and the other is
          // mapped in case a flow that does emit it turns up. `failed` is not
          // here on purpose -- a create that failed refuses its own request,
          // and the sheet already has that message on the row the reader is
          // looking at. Announcing it twice is the second one being wrong.
          if (event.state !== 'failed') setWorktreeRevision((n) => n + 1);
          break;
      }
    },
    [
      activeAsid,
      loadSnapshot,
      refreshSessions,
      refreshContext,
      refreshShells,
      refreshDiffs,
      applyViewed,
      handleAutoPermission,
    ]
  );

  /**
   * Whatever the stream missed.
   *
   * Asked for on every (re)connect and on every return to the foreground. A
   * `410` means the point asked for has fallen out of the gateway's ring
   * buffer, and then the snapshot is the only honest answer -- taken silently,
   * so a reader reading history is not thrown to the bottom by it.
   *
   * Asking before the first snapshot has landed -- which is the order entering
   * a session actually takes, because the stream connects first -- used to be a
   * silent no-op, and everything the gateway emitted in that window was lost
   * until the reader left the screen and came back. The gate remembers the
   * debt instead; see `lib/agent-catch-up.ts`.
   */
  const catchUpRef = useRef<() => void>(() => {});
  const catchUp = useCallback(() => {
    const asid = activeAsidRef.current;
    if (!asid) return;
    // Nothing to catch up *from* yet -- the stream connects before the first
    // snapshot answers, which is exactly when this used to be dropped. The gate
    // remembers, and `openSession` pays it the moment the snapshot lands.
    const asked = askCatchUp(syncRef.current);
    syncRef.current = asked.state;
    if (asked.from === null) {
      // Nothing to catch up *from*, and no snapshot has landed for this
      // session either -- the first one failed. A stream connect is a good
      // moment to try again, and the reconnect backoff bounds how often.
      if (openedAsidRef.current !== asid) void loadSnapshot('silent').catch(() => {});
      return;
    }
    void getAgentTimelineDelta(sessionId, asid, asked.from)
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
        syncRef.current = advanceSeq(syncRef.current, delta.latest_seq);
      })
      .catch(() => {});
  }, [sessionId, loadSnapshot]);

  useEffect(() => {
    catchUpRef.current = catchUp;
  }, [catchUp]);

  // Returning to the foreground is a reconnect the stream cannot see: the
  // socket may have been held open by the OS and delivered nothing.
  const appActive = useAppActive();
  useEffect(() => {
    appActiveRef.current = appActive;
    if (appActive) catchUpRef.current();
  }, [appActive]);

  /**
   * Coming back to a session that is already open is reading it again.
   *
   * The snapshot's own `…/view` covers arriving; this covers the app being
   * brought *forward* onto a session that finished a turn in the background --
   * the transition, not the state, or entering the screen would post it twice
   * for the one arrival. No `idle` on this one: the reader is looking at it
   * now, and "now" is what the route defaults to.
   */
  const wasForegroundRef = useRef(true);
  useEffect(() => {
    const returned = appActive && !wasForegroundRef.current;
    wasForegroundRef.current = appActive;
    if (!returned || !activeAsid) return;
    const viewedAsid = activeAsid;
    void markAgentSessionViewed(viewedAsid)
      .then((viewed) => applyViewed(viewedAsid, viewed))
      .catch(() => {});
  }, [appActive, activeAsid, applyViewed]);

  /**
   * The stream handler, behind a ref for the same reason the sequence is.
   *
   * The effect below opens one SSE connection, and it used to depend on this
   * handler -- whose own dependencies include `activeAsid` and `activeDirectory`.
   * Entering a session changes both, so the live stream was aborted and
   * reopened in the middle of the entry it was opened for, and the catch-up
   * that follows a connect ran twice. The connection now depends on the two
   * things that really identify it.
   */
  const handleStreamEventRef = useRef(handleStreamEvent);
  useEffect(() => {
    handleStreamEventRef.current = handleStreamEvent;
  }, [handleStreamEvent]);

  // Real-time SSE stream — the only sync channel. Engine output arrives over
  // it; a dropped connection reconnects with a short backoff instead of being
  // papered over by polling.
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
          handleStreamEventRef.current(event);
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
  }, [sessionId, activeAsid]);

  const handleSelectModel = useCallback(
    (model: ModelRef) => {
      pickedModelRef.current = true;
      applySelectedModel(model);
      // Written because the *reader* chose it, which is the only thing the
      // memory records: a default the app merely observed -- the catalog's, or
      // the one a session came back carrying -- is the host's answer, not
      // theirs. The next new session in this workspace starts here.
      rememberAgentChoice(sessionId, activeDirectoryRef.current, { model });
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

  /**
   * A skill from the host's catalog, run as one.
   *
   * The slash menu has listed skills as `/<id>` since it was written, and a
   * picked one went out as a prompt -- so the model was handed the literal
   * "/commit-message" and answered it as prose. `POST …/skill` is the route
   * that exists for it; the failure lands on this screen's own notice and the
   * draft comes back rather than being swallowed.
   */
  const handleInvokeSkill = useCallback(
    async (skill: string, args: string): Promise<boolean> => {
      if (!activeAsid) return false;
      try {
        await invokeAgentSkill(sessionId, activeAsid, { skill });
        // A skill takes no arguments on the wire. Anything typed after it is
        // said out loud rather than dropped in silence.
        if (args) {
          showScreenNotice(
            t`Skill started`,
            t`“${args}” was not sent: a skill takes no arguments.`
          );
        }
        return true;
      } catch (err) {
        console.warn('Failed to run skill:', err);
        showScreenNotice(
          t`Could not run that skill`,
          formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
        return false;
      }
    },
    [activeAsid, sessionId, showScreenNotice, t]
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

  /**
   * Move a queued prompt to the front of the turn, or back into line.
   *
   * `setAgentInboxDelivery` existed with no caller: a prompt's delivery was
   * decided when it was sent and the only thing that could be done to it
   * afterwards was to cancel it. Optimistic, then corrected --
   * `agent.inbox.changed` carries the whole queue and is the state that counts.
   */
  const handleSetInboxDelivery = useCallback(
    (inboxId: string, delivery: 'steer' | 'queue') => {
      if (!activeAsid) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setInbox((prev) => prev.map((item) => (item.id === inboxId ? { ...item, delivery } : item)));
      setAgentInboxDelivery(activeAsid, inboxId, delivery).catch((err) => {
        console.warn('Failed to change delivery:', err);
        void refreshInbox();
        showScreenNotice(
          t`Could not change delivery`,
          formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
      });
    },
    [activeAsid, refreshInbox, showScreenNotice, t]
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

    // Optimistically add user text item.
    //
    // With an order key, not on the strength of its id: a locally made
    // `msg_1758…` sorts after the engine's `msg_019…`, so the reply to this
    // message used to render above it and jump back into place when the turn
    // ended. The key puts the row after everything on screen and before
    // anything the engine makes next, and the acknowledged row inherits it.
    const tempKey = `temp_usr_${Date.now()}`;
    const tempUserItem: TimelineItem = {
      id: tempKey,
      // The key the list will draw this row under, kept when the engine's own
      // row takes its place: see `TimelineItem.row_key`.
      row_key: tempKey,
      message_id: `msg_${Date.now()}`,
      ordinal: 0,
      seq: syncRef.current.seq + 1,
      updated_ms: Date.now(),
      role: 'user',
      part: { type: 'text', text },
      attachments,
      queued: isQueued,
      order: orderKeyAfter(timeline),
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
      // The reader's own pick, remembered the same way the model is.
      rememberAgentChoice(sessionId, activeDirectoryRef.current, { agent });
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
    [activeAsid, sessionId, showToast, t]
  );

  /**
   * How many "Always allow" replies have landed.
   *
   * `allow_always` is the one answer whose consequence outlives the prompt, so
   * the context sheet's list of saved rules has to be told that it has changed.
   * The count rather than the list: the sheet is the only thing that reads the
   * rules, and it reads them from the gateway.
   */
  const [savedPermissionsRevision, setSavedPermissionsRevision] = useState(0);
  /**
   * How many times a project's worktree inventory has moved under us.
   *
   * `agent.worktree.changed` carries no `asid` and no `seq`: it belongs to a
   * project rather than to a session, so it reaches every reader and is not
   * replayable from anyone's ring buffer. Nothing here needs its payload --
   * the sheet re-lists from the route, which is the only thing that can answer
   * authoritatively -- so what is kept is the count, and the sheet watches it.
   */
  const [worktreeRevision, setWorktreeRevision] = useState(0);

  const handlePermissionDecision = useCallback(
    async (permId: string, decision: PermissionDecision) => {
      if (!activeAsid) return;
      try {
        await replyAgentPermission(sessionId, activeAsid, permId, decision);
        if (decision === 'allow_always') setSavedPermissionsRevision((count) => count + 1);
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
      showScreenNotice(
        t`Auto-approve is on`,
        t`The agent stops asking; dangerous commands stay blocked.`
      );
    }
  }, [setYoloMode, showScreenNotice, t]);

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
        title: t`OpenCode service offline`,
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
      syncRef.current = CATCH_UP_START;
      refreshSessions();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showScreenNotice(t`New session`, t`Started with a clean context.`);
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
    showScreenNotice,
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

  /**
   * A new name for a session, everywhere it is shown, before the engine has
   * answered -- and the old one back if it refuses.
   *
   * `renameAgentSession` existed with no caller: the only title a session could
   * ever have was the one OpenCode auto-titled it with on its first turn. The
   * rename lands in three places at once (the header pill, the strip's chip and
   * the sheet's row), which is why it is written here rather than in the sheet:
   * they all read the same lists.
   */
  const handleRenameSession = useCallback(
    (asid: string, title: string) => {
      const next = title.trim();
      if (!asid || !next) return;
      const previous =
        sessions.find((session) => session.asid === asid)?.title ??
        (sessionInfo?.asid === asid ? sessionInfo.title : undefined);
      if (previous === next) return;

      const apply = (value: string) => {
        setSessions((prev) =>
          prev.map((session) => (session.asid === asid ? { ...session, title: value } : session))
        );
        setChildrenByParent((prev) => applyChildTitle(prev, asid, value));
        setSessionInfo((prev) => (prev && prev.asid === asid ? { ...prev, title: value } : prev));
      };

      apply(next);
      renameAgentSession(asid, next).catch((err) => {
        console.warn('Failed to rename session:', err);
        // Back to what it was called, rather than leaving a name on screen that
        // exists nowhere else.
        if (previous !== undefined) apply(previous);
        showScreenNotice(
          t`Could not rename`,
          formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
      });
    },
    [sessions, sessionInfo, showScreenNotice, t]
  );

  /**
   * Delete a session, and go somewhere honest if it was the one on screen.
   *
   * The latest of what is left, or the empty state -- never a new session made
   * on the reader's behalf: deleting one thing must not create another. The
   * confirmation is the caller's; by the time this runs it has been given.
   */
  const handleDeleteSession = useCallback(
    (asid: string) => {
      if (!asid) return;
      const previousSessions = sessions;
      const previousChildren = childrenByParent;
      const wasActive = asid === activeAsid;

      const remaining = sessions.filter((session) => session.asid !== asid);
      setSessions(remaining);
      setChildrenByParent((prev) => dropSession(prev, asid));
      if (wasActive) {
        const next = latestSession(remaining);
        setTimeline([]);
        setWindowStart(0);
        setPermissions([]);
        setForms([]);
        setInbox([]);
        syncRef.current = CATCH_UP_START;
        setActiveAsid(next?.asid);
        setSessionInfo(next ?? null);
      }

      deleteAgentSession(asid).catch((err) => {
        console.warn('Failed to delete session:', err);
        setSessions(previousSessions);
        setChildrenByParent(previousChildren);
        if (wasActive) setActiveAsid(asid);
        showScreenNotice(
          t`Could not delete`,
          formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
      });
    },
    [sessions, childrenByParent, activeAsid, showScreenNotice, t]
  );

  const handleSelectWorkspace = useCallback(
    async (directory: string, project?: AgentProject) => {
      setActiveDirectory(directory);
      try {
        // A workspace that already has sessions opens on the one the reader
        // last had open there, or on its most recent one; only an empty
        // workspace gets a new session made for it.
        const existing = await listAgentSessions(sessionId, { roots: true, directory });
        const opening = existing
          ? pickSessionToOpen(existing, loadRememberedAgentSession(sessionId, directory))
          : null;
        const target =
          opening ?? (await createAgentSession(sessionId, newSessionParams(directory)));
        setActiveAsid(target.asid);
        setSessionInfo(target);
        setTimeline([]);
        setWindowStart(0);
        setPermissions([]);
        setForms([]);
        syncRef.current = CATCH_UP_START;
        refreshSessions();
      } catch (err) {
        console.warn('Failed to switch workspace session:', err);
        setIsOffline(true);
        showToast({
          variant: 'danger',
          title: t`Could not create session`,
          message: formatAgentErrorMessage(err, t`Failed to switch project`),
        });
      }
    },
    [sessionId, newSessionParams, t, refreshSessions, showToast]
  );

  /**
   * Point the open session at another directory, and keep it open.
   *
   * Not `handleSelectWorkspace`: that one *leaves* -- it finds or starts a
   * session in the workspace picked and swaps the transcript for that
   * session's. A move keeps this session, its history and whatever it is
   * running, and changes the ground under it. A running session may be moved;
   * the engine handles delivery, and refusing here would be the app inventing
   * a rule OpenCode does not have.
   *
   * The reply is applied *and* `agent.session.updated` follows with the same
   * directory, which is deliberate belt and braces: the event is what moves
   * the header pill and the strip, and the reply is what makes the sheet's own
   * dismissal land on a screen that has already changed.
   */
  const handleMoveSession = useCallback(
    async (directory: string) => {
      const asid = activeAsid;
      if (!asid) return;
      try {
        const moved = await moveAgentSession(asid, directory);
        setActiveDirectory(directory);
        if (moved) {
          setSessionInfo((prev) =>
            prev && prev.asid === moved.asid ? { ...prev, ...moved } : moved
          );
          setSessions((prev) =>
            prev.map((session) =>
              session.asid === moved.asid ? { ...session, ...moved } : session
            )
          );
        }
        refreshSessions();
      } catch (err) {
        console.warn('Failed to move session:', err);
        // A target that is not there any more is named, not spelled as a
        // status -- the same sentence the screen and both sheets use. Nothing
        // is latched: the session has not moved, so this is about the folder
        // that was picked and not the one it is still standing in.
        const detail = err instanceof Error ? err.message : String(err);
        const gone = detail.includes('workspace_missing') ? { directory } : null;
        showScreenNotice(
          t`Could not move this session`,
          gone
            ? t`Project folder is missing: ${gone.directory}`
            : formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
      }
    },
    [activeAsid, refreshSessions, showScreenNotice, t]
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

  /**
   * The two catalog sheets carry the workspace as well as the gateway session.
   *
   * Both read the catalog themselves when they mount, and a catalog read
   * without a directory is the global one -- so a project-defined agent was
   * absent from the mode picker even once the workbench had it. The directory
   * travels as a route param for the same reason `sessionId` does: it is
   * identity, it is what the sheet has to be able to ask with, and a deep link
   * has to be able to state it.
   */
  const openModelSheet = useCallback(() => {
    router.push({
      pathname: '/agent-model',
      params: { sessionId, ...(activeDirectory ? { directory: activeDirectory } : {}) },
    });
  }, [router, sessionId, activeDirectory]);

  const openModeSheet = useCallback(() => {
    router.push({
      pathname: '/agent-mode',
      params: { sessionId, ...(activeDirectory ? { directory: activeDirectory } : {}) },
    });
  }, [router, sessionId, activeDirectory]);

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

  // A shell card that names its shell opens the tray on that row; the
  // composer's pill opens the tray at its top.
  const openBackgroundTray = useCallback(
    (shellId?: string) => {
      const params = {
        ...(activeDirectory ? { directory: activeDirectory } : {}),
        ...(shellId ? { shell: shellId } : {}),
      };
      router.push({ pathname: '/agent-shells', params });
    },
    [router, activeDirectory]
  );

  const openDiffSheet = useCallback(() => {
    if (!activeAsid) return;
    router.push({ pathname: '/agent-vcs-diff', params: { sessionId, asid: activeAsid } });
  }, [router, sessionId, activeAsid]);

  const handleToggleReasoning = useCallback(() => {
    setShowReasoning((prev) => !prev);
  }, []);

  /**
   * Stage a rollback to one message, and show what it would do.
   *
   * Never commit: `POST …/revert` is stage-and-apply in one call, which is what
   * `/undo` used to be -- four characters typed and a turn's work gone, with no
   * statement of what had been taken. This asks for the boundary *and the files
   * it would put back*, and the plate above the composer is where the reader
   * decides.
   */
  const handleStageRevert = useCallback(
    (messageId: string) => {
      if (!activeAsid || !messageId) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      stageAgentRevert(activeAsid, messageId)
        .then((staged) => {
          // The stream says the same thing a moment later; this is so the plate
          // is up before it does.
          if (staged) setStagedRevert(staged);
        })
        .catch((err) => {
          console.warn('Failed to stage revert:', err);
          showScreenNotice(
            t`Could not stage the rollback`,
            formatAgentErrorMessage(err, t`OpenCode service is offline`)
          );
        });
    },
    [activeAsid, showScreenNotice, t]
  );

  /** Apply what is staged. The rows it deletes arrive as `agent.timeline.removed`. */
  const handleCommitRevert = useCallback(() => {
    if (!activeAsid) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setRevertBusy(true);
    commitAgentRevert(activeAsid)
      .then(() => {
        // `agent.revert.changed: committed` takes the plate down; clearing it
        // here as well keeps the two from disagreeing on a slow stream.
        setStagedRevert(null);
      })
      .catch((err) => {
        console.warn('Failed to apply revert:', err);
        showScreenNotice(
          t`Could not undo`,
          formatAgentErrorMessage(err, t`OpenCode service is offline`)
        );
      })
      .finally(() => setRevertBusy(false));
  }, [activeAsid, showScreenNotice, t]);

  /**
   * Withdraw it and keep everything.
   *
   * This is what `/redo` was misnamed for: there has never been a redo in v2,
   * only a staging that can be cleared.
   */
  const handleKeepRevert = useCallback(() => {
    if (!activeAsid) return;
    const previous = stagedRevert;
    setStagedRevert(null);
    clearAgentRevert(activeAsid).catch((err) => {
      console.warn('Failed to clear revert:', err);
      setStagedRevert(previous);
      showScreenNotice(
        t`Could not keep it`,
        formatAgentErrorMessage(err, t`OpenCode service is offline`)
      );
    });
  }, [activeAsid, stagedRevert, showScreenNotice, t]);

  /**
   * The app's own commands, dispatched where the routes and the session live.
   *
   * `/undo` stages a rollback to the last thing the reader said and shows what
   * it would take; `/keep` withdraws it. Neither was reachable before: the
   * client functions existed with no caller, and the one `/undo` would have
   * called applied the rollback without asking.
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
          handleStageRevert(lastUser.message_id);
          return;
        }
        case 'keep': {
          if (!stagedRevert) {
            showToast({
              variant: 'info',
              title: t`Nothing staged`,
              message: t`There is no rollback waiting to be applied.`,
            });
            return;
          }
          handleKeepRevert();
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
    [
      activeAsid,
      timeline,
      stagedRevert,
      handleStageRevert,
      handleKeepRevert,
      handleCompactContext,
      handleClearContext,
      showToast,
      t,
    ]
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
            onUndoToHere={handleStageRevert}
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
    [
      showReasoning,
      markdownStyle,
      handleEditQueuedItem,
      handleCancelQueuedItem,
      handleStageRevert,
      toolActions,
    ]
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

  /**
   * The directory the open session is in, as its project's own inventory has it.
   *
   * Asked of the engine rather than worked out here, because every local way
   * of working it out is wrong, and the device showed both. `activeProject` is
   * matched on a path *prefix*: a session in `/tmp/muqun-c10/repo` matches a
   * known project whose canonical is `/tmp`, which makes the repository itself
   * look like a worktree called "repo" -- a branch line on a session that is
   * in no worktree at all. And matching by `project_id` instead only answers
   * when `/api/agent-projects` happens to list that project, which for a
   * repository opened by path it does not.
   *
   * `GET /api/agent-worktrees` resolves whatever directory it is given to the
   * project that owns it and lists that project's checkouts, the root among
   * them as the entry with no `strategy`. So one read answers both halves --
   * which directory is the project, and whether this one is a worktree of it
   * -- and `sessionWorktreeName` is handed the list rather than a guess.
   * `readJson` dedupes it, and it is re-read only when the directory changes
   * or the inventory says it moved.
   */
  const [worktreeEntries, setWorktreeEntries] = useState<readonly WorktreeDirectory[]>([]);
  useEffect(() => {
    if (!activeDirectory || !badgeLoads) {
      setWorktreeEntries([]);
      return;
    }
    let active = true;
    void listAgentWorktrees(activeDirectory)
      .then((listing) => {
        if (!active) return;
        setWorktreeEntries(listing.entries);
        // The one refusal that speaks. Everything else about this read stays
        // quiet, below.
        noteWorkspaceMissing(listing.missing, activeAsidRef.current);
      })
      .catch(() => {
        // Quiet: with no inventory the header says nothing, which is the same
        // thing it says for a session sitting in its own project.
        if (active) setWorktreeEntries([]);
      });
    return () => {
      active = false;
    };
  }, [activeDirectory, worktreeRevision, badgeLoads, noteWorkspaceMissing]);

  const activeWorktree = useMemo(() => {
    const root = worktreeEntries.find((entry) => !entry.strategy)?.directory;
    return sessionWorktreeName(activeDirectory, root, worktreeEntries);
  }, [activeDirectory, worktreeEntries]);

  useEffect(() => {
    useAgentSessionState.getState().setWorkspace(activeDirectory, activeProject, activeWorktree);
  }, [activeDirectory, activeProject, activeWorktree]);

  // Rendered window over the full timeline: entering a session shows the
  // latest page; earlier pages are prepended on demand.
  //
  // A `shell` part that is the other side of a tool call in the same session
  // is dropped here rather than drawn a second time, and a detached one takes
  // its running state from the shell list the tray is drawn from.
  //
  // Over the whole timeline, not the window: the tool call a `shell` part
  // mirrors is often hundreds of rows above it, outside the page being drawn,
  // and a window-sized search would find nothing and draw the duplicate.
  const reconciledTimeline = useMemo(
    () => reconcileShellParts(timeline, shells),
    [timeline, shells]
  );
  const visibleTimeline = useMemo(
    () => (windowStart > 0 ? reconciledTimeline.slice(windowStart) : reconciledTimeline),
    [reconciledTimeline, windowStart]
  );

  /**
   * What arrived while the reader was up in the history.
   *
   * Measured against the transcript as it stood when they were last level with
   * its end, so scrolling up to re-read something does not by itself put a
   * button over the transcript -- and reaching the end again clears it without
   * a tap. The mark carries the last row's sequence as well as the row count,
   * because an answer streaming into a row already on screen adds no row and
   * is still the thing the reader would want to go and see.
   */
  const transcriptMark = useMemo<TranscriptMark>(
    () => ({ rows: timeline.length, seq: timeline[timeline.length - 1]?.seq ?? 0 }),
    [timeline]
  );
  useEffect(() => {
    follow.setMark(transcriptMark);
  }, [follow, transcriptMark]);

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
      const detail = sessionInfo?.error?.message ?? '';
      return {
        tone: theme.colors.danger,
        label: t`The turn failed`,
        detail,
        /**
         * A failure the picker can answer says so.
         *
         * "Model jev-latest is not supported" is the host having no configured
         * default, so OpenCode ran the first entry of its own list and then
         * refused it. The reader did not choose that model and cannot tell
         * from the sentence that choosing one is the whole fix -- so the plate
         * offers the picker rather than leaving them to find it.
         */
        action: engineFailureAction(detail),
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

  /*
    Both of these were written inline, which made them a new object and a new
    element on every render of this component -- so every stream tick, status
    change and opened sheet re-rendered `LegendList` itself with props it could
    not tell apart from real ones. They change when the insets or the theme
    change, which is to say almost never.
  */
  const timelineContentStyle = useMemo(
    () => [styles.timelineContent, { paddingTop: topInset + 10, paddingBottom: bottomInset + 185 }],
    [topInset, bottomInset]
  );

  const timelineRefresh = useMemo(
    () => (
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
    ),
    [
      loadingEarlier,
      windowStart,
      handleLoadEarlier,
      topInset,
      theme.colors.primary,
      theme.colors.textMuted,
      theme.colors.surfaceRaised,
    ]
  );

  const listFooter = useMemo(() => {
    const hasFormsOrPerms = footerPermissions.length > 0 || forms.length > 0;
    if (!hasFormsOrPerms && !isRunning && !statusNotice) return null;
    /*
      A turn blocked on a question is still `running`, and the footer said
      "Thinking…" over a form whose only blocker was the reader. The agent is
      not thinking; it is waiting, and saying so is what tells them the next
      move is theirs.
     */
    const waitingOnReader = forms.length > 0;
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
                {waitingOnReader ? (
                  <Trans>Waiting for your answer</Trans>
                ) : (
                  <Trans>Thinking…</Trans>
                )}
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
              {statusNotice.action === 'choose-model' ? (
                <Animated.View entering={riseIn()} style={styles.statusNoticeAction}>
                  <PressableScale
                    testID="agent-status-notice-choose-model"
                    accessibilityRole="button"
                    accessibilityLabel={t`Choose a model`}
                    onPress={openModelSheet}
                    style={[
                      styles.statusNoticeButton,
                      {
                        backgroundColor: withAlpha(theme.colors.danger, 0.14),
                        borderColor: withAlpha(theme.colors.danger, 0.4),
                      },
                    ]}>
                    <Text variant="caption" weight="semibold" color={theme.colors.danger}>
                      <Trans>Choose a model</Trans>
                    </Text>
                  </PressableScale>
                </Animated.View>
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
      </View>
    );
  }, [
    footerPermissions,
    forms,
    isRunning,
    statusNotice,
    loadSnapshot,
    openModelSheet,
    handlePermissionDecision,
    handleFormSubmit,
    scrollFooterAboveKeyboard,
    surfaceBackground,
    t,
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
   * The strip's order, the selection and the strip's own switch handler, put
   * where the header pill can read them.
   *
   * The pill swipes between sessions, and to do that it has to know what is
   * either side of the current one *before* the finger lands: whether the
   * gesture is live at all, and which edges get a mark. That is the strip's
   * order and nothing else, so it is published rather than recomputed -- a
   * second answer to "what is next" is a second answer that can be wrong.
   *
   * `setActiveAsid` travels with it for the same reason the sheet bridge
   * carries it: a committed swipe must be the same act as tapping a chip, not
   * a parallel route into the same state.
   */
  const sessionOrder = useMemo(() => sessionStrip.map((node) => node.session), [sessionStrip]);
  useEffect(() => {
    useAgentSessionState.getState().setSessionRouting({
      sessionOrder,
      activeAsid,
      switching: loading,
      switchSession: setActiveAsid,
    });
  }, [sessionOrder, activeAsid, loading]);
  // Leaving the screen takes the order with it, so a header mounted over a
  // different session cannot draw a mark for a neighbour that is no longer on
  // the other side of it.
  useEffect(
    () => () => {
      useAgentSessionState.getState().setSessionRouting({
        sessionOrder: [],
        activeAsid: undefined,
        switching: false,
        switchSession: () => {},
      });
    },
    []
  );

  /**
   * Every session in hand, for the surfaces that want one list.
   *
   * The list route is asked for roots only now, so the sessions sheet -- which
   * groups by `parent_id` itself -- would otherwise never see a subagent
   * again. Memoised because the bridge commits on reference change.
   */
  const allSessions = useMemo(() => [...sessionIndex.values()], [sessionIndex]);

  /**
   * The open root's tree: once when the root changes, and again when a turn
   * ends -- which is when a subagent has finished and a new one may exist.
   *
   * One effect, not two. There were two, both calling this on the same commit,
   * so entering a session asked for the children twice; the second differed
   * only in returning early while a turn was running, which is the guard this
   * one carries.
   */
  const childrenRootRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const rootChanged = childrenRootRef.current !== activeRootAsid;
    if (!rootChanged && isRunning) return;
    childrenRootRef.current = activeRootAsid;
    void refreshChildren(activeRootAsid).catch(() => {});
  }, [refreshChildren, activeRootAsid, isRunning]);

  const currentSession = useMemo(() => {
    return sessions.find((s) => s.asid === activeAsid) ?? sessionInfo;
  }, [sessions, activeAsid, sessionInfo]);

  const activeTokens = currentSession?.tokens ?? sessionInfo?.tokens;

  /**
   * The catalogue's own entry for the model this session runs on.
   *
   * A `ModelRef` is three strings; everything else about a model -- its name as
   * its publisher spells it, how much it can hold -- is in the catalogue.
   */
  const activeModelRef = selectedModel ?? currentSession?.model ?? sessionInfo?.model ?? undefined;
  const activeModelInfo = useMemo(() => {
    if (!activeModelRef?.model_id) return undefined;
    return catalogModels.find(
      (model) =>
        model.id === activeModelRef.model_id &&
        (!activeModelRef.provider_id || model.provider_id === activeModelRef.provider_id)
    );
  }, [catalogModels, activeModelRef]);

  /** The catalogue's name for it, which is the one the reader chose from. */
  const activeModelName = activeModelInfo?.name || formatModelName(activeModelRef, '');

  /**
   * The window the context gauge measures against.
   *
   * The session's own `limit` when the gateway stated one, and the catalogue's
   * entry for the model otherwise -- the window is a property of the model, and
   * "window not reported" was this app declining to read a number it already
   * had in hand.
   */
  const contextLimit = sessionInfo?.limit?.context ?? activeModelInfo?.limit?.context;

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

  /**
   * What the plate says: the messages counted off the transcript on screen, and
   * the files the gateway worked out. Memoised so a stream tick that changes
   * neither does not re-render the composer.
   */
  const revertPreview = useMemo(() => {
    if (!stagedRevert) return null;
    return {
      messages: revertedMessageCount(timeline, stagedRevert.message_id),
      files: stagedRevert.files ?? EMPTY_REVERT_FILES,
    };
  }, [stagedRevert, timeline]);

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
      activeProject,
      sessionInfo: sessionInfo ?? undefined,
      tokens: activeTokens,
      cost: sessionInfo?.cost,
      selectedModel,
      selectedModelName: activeModelName,
      contextLimit,
      selectedAgent,
      showReasoning,
      yoloMode,
      todos: activeTodos ?? EMPTY_TODOS,
      inbox,
      compaction,
      contextUsage,
      commands,
      savedPermissionsRevision,
      worktreeRevision,
      models: catalogModels,
    };
    useAgentSheetBridge.getState().publish(snapshot);
  }, [
    sessionId,
    activeAsid,
    allSessions,
    knownProjects,
    activeDirectory,
    activeProject,
    sessionInfo,
    activeTokens,
    selectedModel,
    activeModelName,
    contextLimit,
    selectedAgent,
    showReasoning,
    yoloMode,
    activeTodos,
    inbox,
    compaction,
    contextUsage,
    commands,
    savedPermissionsRevision,
    worktreeRevision,
    catalogModels,
  ]);

  const sheetActions = useMemo<AgentSheetActions>(
    () => ({
      selectSession: setActiveAsid,
      createSession: () => {
        void handleCreateNewSession();
      },
      renameSession: handleRenameSession,
      deleteSession: handleDeleteSession,
      selectModel: handleSelectModel,
      selectAgentMode: handleSelectAgentMode,
      selectWorkspace: (directory, project) => {
        void handleSelectWorkspace(directory, project);
      },
      moveSession: (directory) => {
        void handleMoveSession(directory);
      },
      toggleReasoning: handleToggleReasoning,
      toggleYolo: handleToggleYoloMode,
      compactContext: handleCompactContext,
      clearContext: handleClearContext,
    }),
    [
      handleCreateNewSession,
      handleRenameSession,
      handleDeleteSession,
      handleSelectModel,
      handleSelectAgentMode,
      handleSelectWorkspace,
      handleMoveSession,
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
      {/* Main Content Stream, standing clear of whatever notice is up. */}
      <Animated.View style={[styles.transcriptArea, transcriptAreaStyle]}>
        {loading ? (
          /*
            The shape of what is coming, which is what every other surface in
            this app answers a wait with. This branch is also the whole of the
            switch: choosing another session or another workspace re-enters
            `loadSnapshot`, which raises `loading` again, so the transcript
            that was there fades out under the placeholder and the one that
            arrives rises through it -- the same cross-fade the terminal
            workspace does between panes, rather than one transcript being
            replaced by another between two frames.
          */
          <AgentTranscriptSkeleton paddingTop={topInset + 20} />
        ) : timeline.length === 0 && permissions.length === 0 && forms.length === 0 ? (
          <Animated.View
            style={[
              styles.emptyScrollWrapper,
              emptyReserveStyle,
              { paddingBottom: emptyBottomReserve },
            ]}>
            {/*
              No `layout` here. A single centred card has nothing to reflow
              around, and a layout animation on a view that is also leaving
              takes the exit over: the card was left in the native tree at the
              position it had under the old notice reserve, a translucent
              second copy sitting on top of the live one and swallowing every
              tap meant for the pill and the two buttons.
            */}
            <Animated.View
              entering={riseIn()}
              exiting={fadeOut('short')}
              style={[
                styles.emptyContainer,
                {
                  backgroundColor: surfaceBackground(theme.colors.surface),
                  borderColor: theme.colors.border,
                },
              ]}>
              {isOffline ? (
                <>
                  <Bot size={44} color={theme.colors.textMuted} />
                  <Text
                    variant="subheading"
                    weight="semibold"
                    color={theme.colors.text}
                    style={styles.emptyTitle}>
                    <Trans>OpenCode service offline</Trans>
                  </Text>
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    style={styles.emptySubtitle}>
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
                    <Text
                      variant="caption"
                      weight="semibold"
                      color={theme.colors.primary}
                      style={styles.emptyNewBtnText}>
                      <Trans>Check again</Trans>
                    </Text>
                  </PressableScale>
                </>
              ) : (
                <>
                  <Bot size={44} color={theme.colors.primary} />
                  <Text
                    variant="subheading"
                    weight="semibold"
                    color={theme.colors.text}
                    style={styles.emptyTitle}>
                    <Trans>Welcome to OpenCode Agent</Trans>
                  </Text>
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    style={styles.emptySubtitle}>
                    <Trans>Ask questions, inspect files, or run commands in your project.</Trans>
                  </Text>
                  <View style={styles.emptyActionsRow}>
                    <PressableScale
                      testID="agent-empty-new-session-btn"
                      onPress={handleCreateNewSession}
                      style={[
                        styles.emptyNewBtn,
                        {
                          backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.14)),
                        },
                      ]}>
                      <PlusCircle size={14} color={theme.colors.primary} />
                      {/* Sentence case, like every other button on this
                        surface: `variant="label"` is the kit's 11pt all-caps
                        instrument style, and a sign is not a button. */}
                      <Text
                        variant="caption"
                        weight="semibold"
                        color={theme.colors.primary}
                        style={styles.emptyNewBtnText}>
                        <Trans>New session</Trans>
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
                      <Text
                        variant="caption"
                        weight="semibold"
                        color={theme.colors.text}
                        style={styles.emptyNewBtnText}>
                        <Trans>Choose project</Trans>
                      </Text>
                    </PressableScale>
                  </View>
                </>
              )}
            </Animated.View>
          </Animated.View>
        ) : (
          /*
            The transcript rises in, once, through the placeholder it replaces.
            On the container rather than on the rows: a preset on each cell
            would re-run every time the list brought one back into the draw
            distance, so scrolling would animate rows the reader has already
            read, and the entrance of the screen would be indistinguishable
            from the list doing its job. One rise, of the whole transcript, is
            what the home cards and the terminal workspace do.
          */
          <Animated.View
            entering={riseIn()}
            exiting={fadeOut('short')}
            style={styles.timelineScroll}>
            {/*
              The list that knows about the keyboard, from Legend List's own
              `keyboard` entry point over keyboard-controller's chat scroll
              view. What stood here before was a plain list with a footer whose
              *height* followed the keyboard frame by frame: a layout change on
              every frame of the keyboard's travel, inside a virtualised list
              that re-measures its footer, re-runs its end-alignment and
              re-decides whether to follow the end each time. The owner saw
              exactly that -- the transcript stuttering as the keyboard rose.
              This moves the content with the keyboard on the UI thread, as an
              inset and an offset, and lays nothing out while it travels.
            */}
            <KeyboardAwareLegendList<TimelineRenderGroup>
              ref={listRef}
              /*
            Lift only for a reader at the latest message. Someone who has
            scrolled up to read is not moved by a keyboard any more than by
            new output -- the same rule `maintainScrollAtEnd` keeps below.
          */
              keyboardLiftBehavior="whenAtEnd"
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
              /*
            One allocation hint, measured rather than guessed. Legend List 3
            removed `getEstimatedItemSize`, so there is no per-kind estimate to
            give any more: this number only decides how many item containers
            exist before anything has been measured, after which the list uses
            what it measured and the per-type averages `getItemType` buckets
            for it. The 70 that was here was less than half the real average of
            165dp, so every mount built containers for more than twice the rows
            a screen holds. See `lib/transcript-sizing.ts` for the measurement.
          */
              estimatedItemSize={TRANSCRIPT_ESTIMATED_ITEM_SIZE}
              /*
            The dataset's identity, stated rather than inferred. Switching
            session replaces `data` wholesale, and without a `dataKey` the list
            reads that as the same list having changed enormously -- it keeps
            the previous session's measurements and scroll intent and reconciles
            them against rows they do not describe. With it, the switch is a
            switch: sizes and position start clean and the list is not
            remounted to say so.
          */
              dataKey={activeAsid}
              /*
            A short transcript sits on the bottom of the viewport rather than
            hanging from the top of it, which is what the docs' chat guide
            prescribes in place of `inverted` -- and `inverted`, the same guide
            says, is what causes the animation and scroll-edge trouble this
            screen must not have.
          */
              alignItemsAtEnd={true}
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
              /*
            The transcript says where the reader is with the jump-to-latest
            pill and the pull indicator, and with nothing else. A scrollbar
            over the artwork is a third answer to the same question, drawn in
            a colour the theme pack does not choose.
          */
              showsVerticalScrollIndicator={false}
              refreshControl={timelineRefresh}
              ListFooterComponent={listFooter}
              style={styles.timelineScroll}
              contentContainerStyle={timelineContentStyle}
            />
          </Animated.View>
        )}
      </Animated.View>

      {/*
        The screen's own notices: under the header, never over it.

        Two of them, in one column and measured as one, because the room the
        transcript gives up is the room they actually take. The standing one is
        first: a folder that is gone outlives whatever the transient one has to
        say about a single action.
      */}
      {screenNotice || workspaceMissing ? (
        <View
          pointerEvents="box-none"
          onLayout={(event) => setScreenNoticeHeight(Math.round(event.nativeEvent.layout.height))}
          style={[
            styles.screenNoticeWrap,
            { top: Math.max(0, topInset - SCREEN_NOTICE_HEADER_GAP) },
          ]}>
          {workspaceMissing ? (
            <Animated.View entering={fadeInDown('short')} exiting={fadeOutUp('short')}>
              <View
                testID="agent-workspace-missing-notice"
                style={[
                  styles.screenNotice,
                  {
                    backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                    borderColor: theme.colors.border,
                  },
                ]}>
                <StatusDot color={theme.colors.warning} filled size={7} />
                <View style={styles.screenNoticeText}>
                  <Text variant="caption" weight="bold" color={theme.colors.text} numberOfLines={2}>
                    {t`Project folder is missing: ${workspaceMissing.directory}`}
                  </Text>
                </View>
                {/*
                  The one action that changes the fact. Not a dismiss: there is
                  nothing to dismiss -- the folder is still gone afterwards --
                  and not a retry either, because nothing failed.
                */}
                <PressableScale
                  testID="agent-workspace-missing-choose"
                  accessibilityRole="button"
                  accessibilityLabel={t`Choose project`}
                  onPress={openWorkspaceSheet}
                  style={styles.screenNoticeAction}>
                  <Text variant="caption" weight="bold" color={theme.colors.primary}>
                    {t`Choose project`}
                  </Text>
                </PressableScale>
              </View>
            </Animated.View>
          ) : null}
          {screenNotice ? (
            <Animated.View
              key={screenNotice.id}
              entering={fadeInDown('short')}
              exiting={fadeOutUp('short')}>
              <PressableScale
                testID="agent-screen-notice"
                accessibilityRole="button"
                accessibilityLabel={t`Dismiss the notice: ${screenNotice.title}`}
                onPress={() => setScreenNotice(null)}
                style={[
                  styles.screenNotice,
                  {
                    backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                    borderColor: theme.colors.border,
                  },
                ]}>
                <StatusDot color={theme.colors.primary} filled size={7} />
                <View style={styles.screenNoticeText}>
                  <Text variant="caption" weight="bold" color={theme.colors.text}>
                    {screenNotice.title}
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted} numberOfLines={2}>
                    {screenNotice.body}
                  </Text>
                </View>
                <X size={14} color={theme.colors.textMuted} />
              </PressableScale>
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {/*
        The one thing the transcript does about output that landed behind the
        reader: offer the way back. Never a scroll of its own -- a viewport
        that moves under someone reading is the behaviour this whole screen is
        built to avoid -- and never a standing button either: it appears when
        something has actually arrived, and goes when they are level with it.
      */}
      <JumpToLatestPill
        follow={follow}
        enabled={!loading}
        bottom={bottomInset + 196}
        onPress={handleJumpToLatest}
      />

      {/* YOLO mode indicator — tap to switch auto-approval off again */}
      {!loading && yoloMode ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.yoloBannerWrap, { bottom: bottomInset + 196 }]}>
          <PressableScale
            testID="agent-yolo-indicator"
            accessibilityRole="button"
            accessibilityLabel={t`Auto-approve is on — tap to turn it off`}
            onPress={() => setYoloMode(false)}
            style={[
              styles.yoloBanner,
              {
                backgroundColor: surfaceBackground(withAlpha(theme.colors.danger, 0.16)),
                borderColor: withAlpha(theme.colors.danger, 0.45),
              },
            ]}>
            <ShieldAlert size={13} color={theme.colors.danger} />
            <Text
              variant="caption"
              weight="bold"
              color={theme.colors.danger}
              numberOfLines={1}
              style={styles.yoloBannerHint}>
              <Trans>Auto-approving every action</Trans>
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
        topInset={topInset}
        onDockHeight={setDockHeight}
        tasks={activeTodos}
        tokens={activeTokens}
        contextUsage={contextUsage}
        contextLimit={contextLimit}
        modelName={activeModelName}
        revert={revertPreview}
        onCommitRevert={handleCommitRevert}
        onKeepRevert={handleKeepRevert}
        revertBusy={revertBusy}
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
        onInvokeSkill={handleInvokeSkill}
        onClientCommand={handleClientCommand}
        inbox={inbox}
        onCancelInboxItem={handleCancelInboxItem}
        onSetInboxDelivery={handleSetInboxDelivery}
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
 * The way back to the newest row, and the only view that reads the scroll.
 *
 * Its own component so that a drag costs one render of a pill rather than one
 * render of the workbench. `useSyncExternalStore` is the right shape here
 * precisely because the store is written from an `onScroll` callback that is
 * not React's to schedule -- it subscribes, it does not poll, and it tears
 * nothing when the value changes mid-render.
 */
const JumpToLatestPill = memo(function JumpToLatestPill({
  follow,
  enabled,
  bottom,
  onPress,
}: {
  follow: TranscriptFollow;
  enabled: boolean;
  bottom: number;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const { visible } = useSyncExternalStore(follow.subscribe, follow.getSnapshot);
  if (!enabled || !visible) return null;
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      style={[styles.jumpToLatestWrap, { bottom }]}>
      <GlassChrome surface="navigation" style={styles.jumpToLatestPill}>
        <PressableScale
          testID="agent-jump-to-latest-btn"
          accessibilityRole="button"
          accessibilityLabel={t`Scroll to latest message`}
          onPress={onPress}
          style={styles.jumpToLatestInner}>
          <ChevronDown size={15} color={theme.colors.text} strokeWidth={2.2} />
          <Text variant="caption" weight="semibold" color={theme.colors.text}>
            <Trans>Latest</Trans>
          </Text>
        </PressableScale>
      </GlassChrome>
    </Animated.View>
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
        // The acknowledged row takes the optimistic row's place, exactly: its
        // own id would sort it somewhere else, and the reader would watch
        // their own message move.
        // And its key, for the same reason the order is inherited: the row is
        // the one already on screen, so it keeps the identity it was measured
        // and drawn under. Without this the list discards the height it
        // measured and remounts the row the moment the send is acknowledged.
        const { order, row_key: rowKey } = next[optimistic];
        next[optimistic] = {
          ...item,
          ...(order === undefined ? {} : { order }),
          row_key: rowKey ?? next[optimistic].id,
        };
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

/** A rename, applied to whichever branch of the tree carries that id. */
function applyChildTitle(
  previous: ChildrenByParent,
  asid: string,
  title: string
): ChildrenByParent {
  let changed = false;
  const next: Record<string, AgentSessionInfo[]> = {};
  for (const [parent, children] of Object.entries(previous)) {
    next[parent] = children.map((child) => {
      if (child.asid !== asid || child.title === title) return child;
      changed = true;
      return { ...child, title };
    });
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

const EMPTY_REVERT_FILES: readonly FileDiffItem[] = Object.freeze([]);

/** Anchor on a change of data, not only on rows changing size. */
const MAINTAIN_TIMELINE_POSITION = { data: true, size: true } as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  transcriptArea: {
    flex: 1,
  },
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingHorizontal: 14,
    // The rows carry their own rhythm (`TRANSCRIPT_ROW_GAP`); a gap here as
    // well is what made a message boundary twice the gap of a row boundary.
    gap: 0,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    paddingHorizontal: 20,
    marginHorizontal: 8,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  // Size only; the weight is the kit's prop on both titles that wear this.
  // `expo-font` registers a reader's interface face under Typeface.NORMAL and
  // nothing else, so Android rounds a 700 request up to BOLD, misses, and ends
  // on a system family that does not contain theirs. This card is the surface
  // that made it visible: "Welcome to OpenCode Agent" stayed in the platform's
  // bold while its own subtitle, one line below, followed the reader. A style
  // `fontWeight` wins over the kit's capped prop, so this key stays weightless.
  emptyTitle: {
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
  statusNoticeAction: {
    alignSelf: 'flex-start',
    paddingTop: 6,
  },
  statusNoticeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  footerContainer: {
    gap: 10,
    marginTop: 4,
  },
  screenNoticeWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 6,
    alignItems: 'center',
    gap: 8,
  },
  screenNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 480,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: appChrome.shadow.notice,
  },
  screenNoticeText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  screenNoticeAction: {
    paddingVertical: 2,
    paddingLeft: 4,
  },
  jumpToLatestWrap: {
    position: 'absolute',
    right: 14,
    zIndex: 5,
  },
  jumpToLatestPill: {
    height: 34,
    borderRadius: 17,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpToLatestInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    paddingHorizontal: 12,
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
