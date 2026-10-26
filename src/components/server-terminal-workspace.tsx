import { assetFromLocalPdf, assetFromLocalVideo } from '@/lib/session-assets';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { AudioPlaybackError } from '@/lib/audio-playback-session';
import { GuideCommand } from '@/components/guide-command';
import { ComposerAttachmentButton } from '@/components/composer-attachment-button';
import { TerminalNotice, terminalNoticeStyles } from '@/components/terminal-notice';
import { NoticeDeck } from '@/components/notice-deck';
import { revealableSubtreeImportance } from '@/lib/hidden-subtree';
import { ComposerSendGuard } from '@/lib/composer-send-guard';
import {
  Spinner,
  useThemeMode,
  useThemeTokens,
  useToast,
  PressableScale,
  Text,
} from '@osuki-dev/ui';
import { resolvePanelPick } from '@/lib/resolve-panel-pick';
import { paneChipRevealOffset } from '@/lib/pane-chip-reveal';
import {
  type Href,
  useFocusEffect,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from 'expo-router';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useActiveConnection } from '@/stores/active-connection';
import { noteGatewayGeneration, onGatewayRestart } from '@/stores/gateway-connection-generation';
import { useScreenVisible } from '@/hooks/use-screen-visible';
import { DeliveryOwnership, DeliverySelection } from '@/lib/bound-delivery';
import { StatusBar } from 'expo-status-bar';
import {
  AgentIcon,
  NoticeIcon,
  HistoryIcon,
  KeyboardIcon,
  EditIcon,
  TerminalWindowIcon,
  CloseIcon,
  QuickActionIcon,
} from '@/icons';
import {
  type ComponentProps,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  type LayoutChangeEvent,
  Pressable,
  type ScrollViewInstance,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { Trans, useLingui } from '@lingui/react/macro';

import AppDrawer from '@/components/app-drawer';
import { HomeOverview } from '@/components/home-overview';
import { ApprovalBanner } from '@/components/approval-banner';
import { ArtifactsButton } from '@/components/artifacts-button';
import { GitDiffButton } from '@/components/git-diff-button';
import { AssetViewer } from '@/components/asset-viewer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { AwayDigestCard } from '@/components/away-digest-card';
import { featureFlags } from '@/constants/feature-flags';
import { CollaborationNotice } from '@/components/collaboration-notice';
import { DETAIL_HEADER_HEIGHT } from '@/components/detail-header';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { GlassChrome } from '@/components/glass-chrome';
import { NO_SIDE_INSETS, sideInsetPadding, type SideInsets } from '@/hooks/use-side-insets';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { navHeaderButtonStyle } from '@/components/nav-header';
import { PaneChatView } from '@/components/pane-chat-view';

import { AgentWorkbench } from '@/components/agent-workbench';
import { gatewaySupportsAgentSessions } from '@/lib/agent-session';
import { PadServerRail } from '@/components/pad-server-rail';
import { PadHomeOverlay } from '@/components/pad-home-overlay';
import {
  PadAgentDetail,
  PadAgentSessionAction,
  usePadAgentOpener,
  usePadAgentSessionControls,
  usePadAgentTitle,
} from '@/components/pad-agent-detail';
import { usePadDetail } from '@/hooks/use-pad-detail';
import { phoneAgentParams } from '@/lib/pad-detail';
import { GatewayTunnelBadge } from '@/components/gateway-tunnel-badge';
import { StatusDot } from '@/components/status-dot';
import { SwitchIndicator } from '@/components/switch-indicator';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { EditorControls } from '@/components/editor-controls';
import { TerminalComposer, type TerminalComposerProps } from '@/components/terminal-composer';
import { TerminalPanel } from '@/components/terminal-output';
import {
  createPaneOutputStore,
  type PaneOutput,
  type PaneOutputStore,
  usePaneOutput,
} from '@/terminal/pane-output-store';
import { VirtualKeyboard } from '@/components/virtual-keyboard';
import { TerminalKeyRow } from '@/components/terminal-key-row';
import { usePaneShortcuts } from '@/hooks/use-pane-shortcuts';
import { keyDeliverable, resolveTerminalKeys, terminalKeyDelivery } from '@/lib/terminal-key-row';
import { WorkspaceTitleSwitcher } from '@/components/workspace-title-switcher';
import { appChrome } from '@/constants/appearance';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';
import {
  isSendableAsKeystrokes,
  paneInputDelivery,
  paneKeystrokes,
  type PaneInputSource,
} from '@/lib/pane-input';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useComposerAssignment } from '@/hooks/use-composer-assignment';
import { TerminalThemeDrop, type TerminalThemeDropState } from '@/components/terminal-theme-drop';
import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { prepareThemeAssets, type PreparedThemeAssets } from '@/theme/assets';
import { ThemeImportRequest } from '@/theme/import-request';
import { unpackTheme } from '@/theme/package';
import { THEME_LIMITS } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import type { AgentProfile } from '@/lib/agent-spawn';
import { AgentAssignmentBar } from '@/components/agent-assignment-bar';
import {
  assignmentStripState,
  collaborationAgents,
  collaborationAvailability,
} from '@/lib/agent-collaboration';
import { useAwayDigest } from '@/hooks/use-away-digest';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { GatewayStorageError } from '@/components/gateway-storage-error';
import { useGatewayTunnel } from '@/hooks/use-gateway-tunnel';
import { usePaneApproval } from '@/hooks/use-pane-approval';
import { usePaneEvents } from '@/hooks/use-pane-events';
import { layoutNeedsRefresh, type PaneLayout } from '@/lib/pane-event-names';
import {
  useLatestRef,
  useLazyRef,
  useResetSignal,
  useStableHandler,
} from '@/hooks/use-render-refs';
import { useSettledHeight } from '@/hooks/use-settled-height';
import { useTabSwipe } from '@/hooks/use-tab-swipe';
import { usePaneViewMode } from '@/hooks/use-pane-view-mode';
import {
  describePickerFailure,
  isImageAttachment,
  pickAttachments,
  type AttachmentSource,
  describeBlockedSend,
  takePickTruncationNotice,
} from '@/lib/attachments';
import {
  ATTACHMENT_CONNECTION_GENERATION,
  type AttachmentDestination,
} from '@/lib/attachment-queue';
import {
  createFileMentionSearch,
  FILE_MENTION_LIMIT,
  findFileMentionTrigger,
  INITIAL_PANE_OUTPUT_LINES,
  insertFileMention,
  listPaneFiles,
  listPaneParts,
  MAX_PANE_OUTPUT_LINES,
  PANE_OUTPUT_PAGE_LINES,
  loadAgentProfiles,
  readAssetBytes,
  gatewaySupportsAgentEvents,
  gatewaySupportsAgentSpawn,
  gatewaySupportsApprovals,
  loadPanes,
  readPaneOutput,
  readPaneRange,
  readPaneHistory,
  readPaneTail,
  resolveAssetById,
  resolveAssetByPath,
  type PaneOutputSource,
  type PanePart,
  sendAgentText,
  sendPaneKeys,
  sendBoundPaneText,
  type FileMentionHit,
  type FileMentionSearch,
  type FileMentionTrigger,
  type HealthResponse,
  type HerdrEntity,
  type PaneComposer,
  type SessionAsset,
  type SessionsResponse,
} from '@/lib/gateway-client';
import { ComposerPopup } from '@/components/composer-popup';
import { useDraftStoreComposerPopup } from '@/hooks/use-composer-popup';
import { useStoreSelector } from '@/hooks/use-store-selector';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import {
  createComposerDraftStore,
  type ComposerDraft,
  type ComposerDraftStore,
} from '@/lib/composer-draft-store';
import { composerBackdropBottom } from '@/lib/composer-popup';
import { withAlpha } from '@/lib/color';
import { slashCommandTrigger, type PaneSlashCommand } from '@/lib/pane-composer';
import { asAgentWidgetStatus, syncAgentWidget } from '@/lib/agent-widget';
import { paneGoneError } from '@/lib/agent-request-error';
import { describeGatewayFailure, type GatewayFailure } from '@/lib/network-error';
import {
  backendPagesHistory,
  canOfferHistoryPull,
  historyExhaustedNotice,
  historyRefreshNotice,
  historyPullUsesRange,
  tailPageFoundNothing,
  historyPullBlockedAfter,
  historyPullNotice,
  pullEarlierPage,
  capturedProbeDue,
  capturedProbeState,
  capturedReprobeDelay,
  capturedTraversalNeedsRefresh,
  PANE_CAPTURED_HISTORY_CAPABILITY,
  type CapturedCursor,
  type HistoryPullNotice,
} from '@/lib/terminal-history-pull';
import { PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY } from '@/lib/terminal-history-segments';
import { DEMO_SERVER_ID, demoRecord, isDemoRecord } from '@/lib/demo-gateway';
import type { HomeServerEntry } from '@/lib/home-commands';
import { demoSshHost } from '@/lib/demo-ssh';
import {
  field,
  numberField,
  optionalNumberField,
  panelTitle,
  statusColor,
} from '@/lib/herdr-entity';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { sshHomeRows } from '@/lib/ssh-home';
import type { PaneAddress } from '@/lib/pane-address';
import {
  emptyPaneCache,
  foldPaneFrame,
  notePaneRevision,
  panePrefetchAccepted,
  panePrefetchTargets,
  paneReadIsCurrent,
  paneWindowWorthFiling,
  recallPaneWindow,
  rememberPaneWindow,
  forgetPaneWindow,
  retainPanes,
  warmPaneWindow,
  type PaneCache,
  type PaneWindow,
} from '@/lib/pane-cache';
import {
  hasEarlierPaneParts,
  hasEarlierPartsAfterPage,
  panePartsRefreshKey,
  paneTranscriptRows,
  reconcilePaneParts,
} from '@/lib/pane-parts';
import { asAgentActivityStatus, syncAgentActivity } from '@/lib/live-activity';
import { dockPresentation } from '@/lib/dock-presentation';
import { fadeIn, fadeInDown, fadeOut, fadeOutDown, listLayout, riseIn, timing } from '@/lib/motion';
import { mirroredServerAgents, mirroredServerPanes } from '@/lib/server-agents';
import {
  gatewayConnectionPhase,
  resolveServerReachability,
  type ServerReachability,
} from '@/lib/server-reachability';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';
import { recordUsage, usageScope } from '@/lib/shortcut-usage';
import {
  recallTabPane,
  rememberTabPane,
  type TabCycleDirection,
  type TabCycleTarget,
  type TabPaneMemory,
} from '@/lib/tab-swipe';
import { allowsWebServiceOpen } from '@/lib/web-service';
import { SimfarmPreview } from '@/components/simfarm-preview';
import { useServerSimfarm } from '@/stores/server-simfarm';
import { useSimfarmSplit } from '@/stores/simfarm-split';
import {
  recallWorkspaceSelection,
  rememberWorkspaceSelection,
  type WorkspaceCycleTarget,
  type WorkspaceMemory,
} from '@/lib/workspace-cycle';
import { useAppSettings } from '@/stores/app-settings';
import { useComposerAssignmentStore } from '@/stores/composer-assignment';
import { useComposerDraftStore } from '@/stores/composer-draft';
import { usePanelPickerStore } from '@/stores/panel-picker';
import {
  encodeSessionChoices,
  resolveSessionId,
  sameSessionChoices,
  type SessionChoice,
} from '@/lib/session-switcher';
import { loadWorkspaceSnapshot } from '@/lib/workspace-snapshot';
import {
  terminalBackendRows,
  terminalBackendState,
  type TerminalBackendState,
} from '@/lib/terminal-backend-state';
import { terminalBackendCopy } from '@/lib/terminal-backend-copy';
import {
  followLanding,
  initialSelection,
  reconcileSelection,
  type HeldTarget,
  type Selection,
} from '@/lib/workspace-selection';
import { useAppActive } from '@/hooks/use-app-active';
import { useServerAgents } from '@/stores/server-agents';
import { useHomeRecentsStore } from '@/stores/home-recents';
import { homeTargetKey, isLiveHomeTerminalVisit, type HomeTarget } from '@/lib/home-recents';
import { HOME_CONTINUE_REFRESH_MS } from '@/lib/home-continue-refresh';
import {
  classifyHomeTargetAvailability,
  isHomeTargetReady,
  type HomeTargetAvailability,
} from '@/lib/home-target-availability';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useAgents } from '@/stores/agents';
import { refreshAgentsDiscovery, useAgentsDiscoveryRefresh } from '@/hooks/use-agent-features';
import { keyFailureOutcome, paneVocabulary, vocabularyForSession } from '@/lib/key-vocabulary';
import { useServerChannels } from '@/stores/server-channels';
import { serverPrewarmGate, useServerReachability } from '@/stores/server-reachability';
import { useServerSession } from '@/stores/server-session';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import {
  type TerminalKey,
  isFullScreenTuiPane,
  isLazygitPane,
  parseNvimMode,
  keyboardCombinationKeys,
} from '@/lib/terminal-keys';
import { parseTerminalSnapshot, terminalFrameText } from '@/terminal/terminal-core';
import {
  foldPaneRead,
  foldPaneWindow,
  forgetPaneReadSettling,
  hasEarlierAfterPage,
  hasEarlierTerminalOutput,
  nextPageRange,
  paneReadRange,
  type PaneReadOrigin,
  seedPageRange,
  terminalOutputLineCount,
  terminalOwnsScreen,
  terminalViewportRows,
} from '@/terminal/history';
import { createStreamReadFence } from '@/terminal/stream-read-fence';
import { useTerminalTheme } from '@/hooks/use-theme-pack';
import {
  forgetWarmWorkspace,
  rememberWarmWorkspace,
  warmWorkspace,
  type WarmWorkspace,
} from '@/lib/server-warm-cache';
import {
  mirroredPaneWindow,
  paneWindowShape,
  rememberMirroredPaneWindow,
} from '@/lib/pane-window-mirror';
import { startWorkspacePoller } from '@/lib/workspace-poller';
import { recoverWith, rethrow, settleAfter } from '@/lib/compiler-safe-control-flow';

/** The cache and this screen describe the same snapshot, so they share a type. */
type ServerData = WarmWorkspace;

type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/**
 * What the dock keeps clear of the home indicator with the keyboard down.
 *
 * Not the full `insets.bottom`. That is 34pt on an indicator phone, and the dock
 * is a surface the indicator is allowed to sit on -- what has to stay clear is
 * the *field*, not the glass under it. A full safe area left a visible dead band
 * below the composer that read as a layout mistake. 14 is the app's own floating
 * anchor gap (`floatingEntries`), so the field clears the indicator by the same
 * margin everything else on this screen does.
 *
 * `Math.min` with the real inset, so a device without an indicator is not given
 * clearance it does not need, and the 8pt floor still applies with the keyboard
 * up -- there is no indicator to clear when the keyboard covers it.
 */
const DOCK_INDICATOR_CLEARANCE = 14;
/** The dock's and its popup's side gutter, measured from the side safe-area insets. */
const COMPOSER_GUTTER = 12;

/** Output re-read cadence with the stream up: a safety net, not a heartbeat. */
const OUTPUT_POLL_STREAMING_MS = 10_000;
/** With the stream down, reads are the only way new output arrives. */
const OUTPUT_POLL_FALLBACK_MS = 1_000;

type ConnectionStatus = {
  phase: ConnectionPhase;
  attempt: number;
  message?: string;
  backendUnavailable?: boolean;
  /**
   * This server has no usable record of this device, so Retry can only fail
   * again. The notice offers pairing instead.
   */
  needsPairing?: boolean;
};

type RefreshResult = { ok: true; data: ServerData } | { ok: false; failure: GatewayFailure } | null;

type StrictHomeTarget = HeldTarget;

type MissingHomeTarget = Extract<
  HomeTargetAvailability,
  { kind: 'missing-session' | 'missing-pane' }
>;

/**
 * What is known about the structured view of the selected pane.
 *
 * `supported` is the gateway's own answer about *this pane* (`data.pane.parts`
 * is `native` or `dictionary`), not a guess and not the envelope's
 * `capabilities.parts` -- that flag is a fact about the gateway build and is
 * `true` for every pane a modern one serves, so reading it as the gate offered
 * a "conversation" made of screen scrapings for every agent with no marker
 * table. `failed` is deliberately kept apart from it, so a read that breaks
 * drops back to the terminal without also claiming the pane lost the capability
 * -- the next change retries.
 */
type PanePartsState = {
  paneId: string;
  /** The gateway answered at least once, so whether it offers parts is known. */
  answered: boolean;
  supported: boolean;
  failed: boolean;
  /** Consecutive failures, so an endpoint that only ever throws is left alone. */
  failures: number;
  parts: PanePart[];
  /**
   * The shift that keys `parts` in the rows of the first read, so a window that
   * slid under new output does not hand every row a new id. See
   * `reconcilePaneParts`.
   */
  partsOffset: number;
  /**
   * What this pane's composer can offer, from the same envelope. Kept here
   * rather than fetched on its own: the probe that decides whether there is a
   * structured view already carries the descriptor, so the slash picker costs
   * no request of its own and none at all on a gateway too old to have one.
   */
  composer: PaneComposer | null;
};

const initialPartsState: PanePartsState = {
  paneId: '',
  answered: false,
  supported: false,
  failed: false,
  failures: 0,
  parts: [],
  partsOffset: 0,
  composer: null,
};

const MAX_PANE_PARTS_PROBES = 3;

const initialData: ServerData = {
  health: null,
  sessionId: 'default',
  workspaces: [],
  tabs: [],
  panes: [],
  agents: [],
};

const MAX_RECONNECT_DELAY_MS = 8_000;
/** How long an open waits for the pane's first text before the held-back work goes anyway. */
const OPEN_SETTLE_GRACE_MS = 800;
/** One pane's captured-history state, filed with its window (`PaneWindow.captured`). */
type CapturedPaneState = {
  generation: number;
  rows: number;
  refreshRequired: boolean;
  empty: boolean;
  cursor: CapturedCursor | null;
  off: boolean;
  exhausted: boolean;
  open: boolean;
};

/** How often a pane with nothing captured yet asks again while its output grows. */
const CAPTURED_REPROBE_MS = 30_000;
/** At most one pane-list read per this long, however fast `layout_updated` comes. */
const LAYOUT_CHECK_MS = 2_000;

/**
 * How long a selection has to stand still before its neighbours are warmed.
 *
 * Long enough that a burst of swipes rearms the timer instead of firing per
 * pane passed through, and long enough that the selected pane's own first read
 * -- the one the reader is actually waiting on -- has the transport to itself.
 * Short enough to have landed well inside the second the reader spends looking
 * at the pane before deciding to move again.
 */
const PANE_PREFETCH_DELAY_MS = 400;

/**
 * Cells, always.
 *
 * Colour has to be asked for at the gateway, so this used to follow the reading
 * the pane was in: `text` for the reflowed view, `ansi` for the grid. Card #841
 * removed the reflowed view -- the quick-actions row was its only switch -- and
 * with one reading left there is nothing for the format to follow.
 *
 * Kept as a name rather than inlined at the six call sites because it is also
 * the head of `outputShape`, which is the key a remembered window is filed
 * under. A window filed by an install that still had two formats is still filed
 * under `ansi:`, so nobody's scrollback is orphaned by this.
 */
const PANE_OUTPUT_FORMAT = 'ansi' as const;

/**
 * Everything about a pane that decides how it is read, from the pane alone.
 *
 * Four questions that keep being asked of the same two fields, answered once so
 * they cannot drift apart: whether the reader is driving an editor, whether the
 * program has taken the whole screen, which of the gateway's two output views
 * the pane has to be read from, and -- built from the last two -- what a window
 * of it is a window *of*.
 *
 * The shape is the reason this is a function rather than four expressions
 * scattered down the render. `PaneWindow.shape` is the key a remembered window
 * is filed under and the one thing `recallPaneWindow` will refuse a window
 * over, and the warm cache's prefetched first screen now carries one too
 * (`firstPaneScreen` in `lib/workspace-snapshot`) -- which is asked about a
 * thousand lines above the render that builds `outputShape`, on a snapshot
 * rather than on this screen's own state. Two spellings of the same string
 * would eventually disagree by a colon, and the symptom would be a window
 * silently never handed back rather than anything that looks like a bug.
 *
 * `profile` is the gateway's resolved answer and wins where it has one; it is
 * absent until the shortcuts request lands, which is exactly the state the
 * first frame is in.
 */
function paneReading(
  pane: HerdrEntity | undefined,
  profile: string | null | undefined
): { editor: boolean; ownsScreen: boolean; source: PaneOutputSource; shape: string } {
  const editor = isFullScreenTuiPane(
    profile,
    field(pane, 'terminal_title_stripped'),
    field(pane, 'foreground_command')
  );
  // `alternate_on` is a fact about the pane and outranks the editor heuristic;
  // a gateway too old to send it leaves the caller with what it had before.
  const ownsScreen = terminalOwnsScreen(pane?.raw.scroll) ?? editor;
  const source: PaneOutputSource = editor ? 'visible' : 'recent-unwrapped';
  return {
    editor,
    ownsScreen,
    source,
    shape: paneWindowShape(PANE_OUTPUT_FORMAT, source, ownsScreen),
  };
}

/**
 * The warm prefetch's first screen, as a window this screen's own cache can
 * hand back.
 *
 * A cache entry rather than only a seeded `output`, because seeding the string
 * alone did not survive the render that resolves the selection. The screen
 * mounts with `selection` at `initialSelection` -- pane id `''` -- and
 * `reconcileSelection` fills it in from the first snapshot; that change trips
 * `paneSwitched`, and the switch render restores the arriving pane's window
 * from the cache. With nothing filed there the restore was
 * `setOutput(restored?.output ?? '')`, so the seeded screen was replaced by a
 * blank one render after it painted and stayed blank until the screen's own
 * read landed. Filing it means the restore finds it and the seed survives the
 * only thing that was erasing it.
 *
 * Both halves are built here rather than at the two call sites, so the one
 * decision about which pane and which shape is made once. The cache is built
 * here too rather than from the returned window on the calling render, because
 * `useRef`'s argument is evaluated on every render and only used on the first
 * -- an allocation per render of a screen that renders often, for a value
 * nobody reads.
 *
 * `revision: -1` deliberately. The warm read happens after the snapshot it
 * travels with, so the snapshot's own revision is a lower bound on what this
 * text holds and claiming it would be claiming more than is known. -1 is what
 * the screen already used for an unseeded window, so the first poll stays the
 * full reconciliation it is today -- this keeps the text, not the freshness.
 *
 * The profile is deliberately left undefined: the shortcuts request has not
 * been made on the frame this runs, so `outputShape` in the render below is
 * built from the same absence and the two agree.
 */
/**
 * The warm snapshot, if it describes the session this open is for.
 *
 * The cache holds one snapshot per server, of whichever session was warmed
 * last -- Home's focus warm takes the remembered session. A route that names a
 * pane in another session must not paint that snapshot as its first frame: it
 * would land connected on the wrong session, read the pane there (where it does
 * not exist) and only switch once the real snapshot answered. Without a session
 * to compare against, the snapshot stands as before.
 */
function usableWarmWorkspace(
  serverId: string,
  sessionId: string | undefined
): WarmWorkspace | null {
  const warm = warmWorkspace(serverId);
  return warm && (!sessionId || warm.sessionId === sessionId) ? warm : null;
}

type WarmPaneSeed = {
  output: string;
  cache: PaneCache;
  pane?: HerdrEntity;
  /**
   * The pane the route named, with the session it is in, when both are known
   * before anything has been asked of the gateway. The screen lands on it at
   * once -- the canvas mounts on the first frame and the pane's own read is
   * issued beside the snapshot rather than after it (`routePaneRead`) --
   * instead of showing "Opening…" until `/api/sessions` and the snapshot have
   * answered. Null for an unscoped open, which lands wherever the snapshot says.
   */
  target: { sessionId: string; paneId: string; shape: string } | null;
};

function warmPaneSeed(
  serverId: string,
  route: { sessionId?: string; paneId?: string }
): WarmPaneSeed {
  // The session a route pane lives in: the route's own, else the one Home's
  // mirror last listed this server's panes under. Without either, a pane id
  // alone cannot be read (ids are per session) and the open stays unscoped.
  const sessionId =
    route.sessionId ??
    useServerAgents.getState().byServer[serverId]?.sessionId ??
    warmWorkspace(serverId)?.sessionId;
  const warm = usableWarmWorkspace(serverId, sessionId);
  const target =
    route.paneId && sessionId
      ? {
          sessionId,
          paneId: route.paneId,
          // Read as a pane whose program does not own the screen. An editor
          // pane is read another way, and the mirror's window for it would
          // be declined below on its shape, exactly as the cache declines.
          shape: paneReading(undefined, undefined).shape,
        }
      : null;
  const none = { output: '', cache: emptyPaneCache, target };
  let paneId: string;
  let shape: string;
  let output: string;
  let scroll: unknown;
  let pane: HerdrEntity | undefined;
  if (target && (!warm?.firstPane || warm.firstPane.paneId !== target.paneId)) {
    // The pane the route named, as the last screen to show it left it: the
    // drawer's window, or this screen's own from an earlier visit.
    const mirrored = mirroredPaneWindow(serverId, target.sessionId, target.paneId);
    if (!mirrored || mirrored.shape !== target.shape) return none;
    paneId = target.paneId;
    shape = mirrored.shape;
    output = mirrored.output;
    scroll = undefined;
    pane = mirrored.pane;
  } else {
    if (!warm?.firstPane) return none;
    paneId = reconcileSelection(warm, initialSelection).paneId;
    if (!paneId || warm.firstPane.paneId !== paneId) return none;
    pane = warm.panes.find((entity) => entity.id === paneId);
    // The shape has to match or the window is declined: a pane that has handed
    // its tty to an editor is read another way, and painting a stale main-screen
    // window over it would be worse than the blank it replaces. This is the same
    // comparison `recallPaneWindow` makes of every cached window, made here
    // against one that arrived from outside the cache.
    if (warm.firstPane.shape !== paneReading(pane, undefined).shape) return none;
    shape = warm.firstPane.shape;
    output = warm.firstPane.output;
    scroll = pane?.raw.scroll;
  }
  if (!output) return none;
  const window: PaneWindow = {
    shape,
    output,
    lineLimit: INITIAL_PANE_OUTPUT_LINES,
    revision: -1,
    canLoadEarlier: hasEarlierTerminalOutput(
      output,
      INITIAL_PANE_OUTPUT_LINES,
      MAX_PANE_OUTPUT_LINES,
      scroll
    ),
    earlierRows: terminalOutputLineCount(output),
    rangeUnsupported: false,
    lastRead: null,
  };
  return { output, cache: warmPaneWindow(emptyPaneCache, paneId, window), target, pane };
}

/**
 * How long a selection has to stand still before the event stream is re-opened
 * against it.
 *
 * The pane whose output the gateway inlines is a query parameter on the SSE
 * URL (`stream_pane`), so changing which pane that is means a new stream: a
 * sealed request envelope, a fresh connection, and a full `refreshData` on the
 * `onConnected` that follows. Paid on every pane switch that is a stop on the
 * way somewhere else, that is the most expensive thing a swipe does and the
 * least useful -- the stream is re-pointed at a pane the reader has already
 * left by the time it opens.
 *
 * So the stream follows the selection at walking pace. Nothing is lost while
 * it waits: the one-second refresh is already the safety net for exactly this
 * (a missed event, a change that did not bump the revision), and the cache has
 * meanwhile painted the pane the reader asked for. What is gained is that
 * A -> B -> A, and a swipe through six panes, cost one re-open instead of one
 * per pane.
 */
const PANE_STREAM_SETTLE_MS = 350;

/**
 * The shape every inlined frame arrives in, whatever pane it is for.
 *
 * `usePaneEvents` opens the stream with `stream_format=ansi` and
 * `stream_source=recent-unwrapped` fixed, so a frame is always a window of
 * that shape -- it does not follow the format the screen happens to be reading
 * the selected pane under. Written down here because the cache has to match a
 * frame against the shape of the window it would fold into, and guessing that
 * from the selected pane's format would be right only by coincidence.
 */
const PANE_FRAME_SHAPE = 'ansi:recent-unwrapped';

/**
 * Slack left around the active pane chip when scrolling it into view, so it
 * never ends up flush against the edge of the strip with the next chip cut off
 * behind it.
 */
const PANE_CHIP_REVEAL_MARGIN = 24;
const PANE_CHIP_HEIGHT = 32;
// Android's horizontal ScrollView can briefly report no cross-axis size while
// this dynamically-mounted strip is entering. Reserve the row explicitly so
// its children can never paint into the terminal-key row below it.
const PHONE_PANE_STRIP_HEIGHT = PANE_CHIP_HEIGHT + 2;
// Three maximum-width chips plus their two gaps and the strip's trailing inset.
const PAD_PANE_STRIP_MAX_WIDTH = 614;

/**
 * How long "Connected" stays up after a reconnect succeeds.
 *
 * Long enough to be read as an answer to the notice that was there a moment
 * ago, short enough that it is gone before it becomes another thing covering
 * the terminal.
 */
const CONNECTION_RECOVERED_MS = 1_400;

/**
 * The composer dock, as something whose height can be animated.
 *
 * `SafeAreaView` is an ordinary view under the inset provider, so wrapping it
 * here is all it takes; it is created at module scope because
 * `createAnimatedComponent` returns a new component type each call, and one
 * created during render would remount the whole dock on every render.
 */

/**
 * `esc`, in the shape the key row sends keys in.
 *
 * The approval banner grows its own escape while the row that normally carries
 * one is hidden behind it, and it sends this -- the same key down the same
 * endpoint through the same `sendTerminalKey`, so the banner's way out is not a
 * second code path that can rot apart from the row's.
 */
export type ServerTerminalWorkspaceProps = {
  /** Supplied by the persistent Pad workspace; compact routes read the URL. */
  serverId?: string;
  sessionId?: string;
  paneId?: string;
  workspaceId?: string;
  tabId?: string;
  notificationId?: string;
  /** Stable Home route liveness, independent of this server owner subtree. */
  sourceRouteActive?: () => boolean;
  /** This workspace is the `/servers/[serverId]` route owner, not Home's root host. */
  routeBound?: boolean;
};

/**
 * The terminal controller and surface shared by compact navigation and the
 * persistent Pad workspace. Keeping one component means both compositions own
 * exactly one poller, event stream, attachment queue, and pane selection.
 */
/**
 * The pane-switch handoff in `ServerTerminalWorkspace`: file the window being
 * left, recall the one being entered.
 *
 * Moved here verbatim from the component body, and called from the same place
 * in the same render, so nothing about when it runs has changed. It reads and
 * writes the window's bookkeeping refs *during render* on purpose -- the
 * component's docblock at the call site says why an effect is a coalescing
 * interval too late -- and React Compiler refuses to compile a component that
 * touches refs in render. `'use no memo'` keeps the compiler out of this one
 * hook, so the whole workspace around it can be compiled.
 */
function usePaneWindowHandoff(
  paneSwitched: boolean,
  {
    outputStore,
    paneId,
    outputShape,
    paneCacheRef,
    paneWindowOwnerRef,
    heldShapeRef,
    outputLineLimitRef,
    canLoadEarlierOutputRef,
    earlierOutputRowsRef,
    rangeUnsupportedRef,
    lastReadRef,
    capturedHereRef,
    setCanLoadEarlierOutput,
  }: {
    outputStore: PaneOutputStore;
    paneId: string;
    outputShape: string;
    paneCacheRef: { current: PaneCache };
    paneWindowOwnerRef: { current: string };
    heldShapeRef: { readonly current: string };
    outputLineLimitRef: { readonly current: number };
    canLoadEarlierOutputRef: { readonly current: boolean };
    earlierOutputRowsRef: { readonly current: number };
    rangeUnsupportedRef: { readonly current: boolean };
    lastReadRef: { readonly current: unknown };
    capturedHereRef: { readonly current: CapturedPaneState | null };
    setCanLoadEarlierOutput: (value: boolean) => void;
  }
): void {
  'use no memo';
  /* oxlint-disable react/refs, react/purity -- deliberate, for this block only:
     every ref touched here is the window's own bookkeeping, none of it is read
     into what this render draws, and nothing but a switch writes any of it --
     which is the render this is. The alternative is an effect, and an effect
     is a coalescing interval late. See the docblock above and
     `useCoalescedValue`, which adjusts its own state during render for the
     same reason and with the same suppression. */
  if (paneSwitched) {
    const {
      window: { output, capturedRows },
      revision,
    } = outputStore.get();
    const cache = paneCacheRef.current;
    const leaving = paneWindowOwnerRef.current;
    // A pane that never painted has nothing to hand back, and caching the
    // blank would let the recall claim a hit that shows the reader nothing --
    // worse than a miss, because a miss at least knows it is one.
    //
    // `output` is the store's, which on this render is still the outgoing
    // pane's window; the depth beside it is read from the refs, which
    // no post-commit write has reached yet either.
    //
    // A program leaving the alternate screen is a switch with the same pane on
    // both sides, and its last frame is not filed: the cache holds one window
    // per pane, and that slot is holding the scrollback filed on the way in,
    // which the recall below is about to ask for. See `paneWindowWorthFiling`.
    // The shape is read from `heldShapeRef`, not `outputShape` -- on this
    // render the latter already says `main`.
    const held: PaneWindow | null =
      leaving &&
      output &&
      paneWindowWorthFiling(leaving, paneId, heldShapeRef.current.endsWith(':alt'))
        ? {
            shape: heldShapeRef.current,
            output,
            lineLimit: outputLineLimitRef.current,
            revision,
            canLoadEarlier: canLoadEarlierOutputRef.current,
            earlierRows: earlierOutputRowsRef.current,
            rangeUnsupported: rangeUnsupportedRef.current,
            lastRead: lastReadRef.current,
            captured: capturedHereRef.current
              ? { ...capturedHereRef.current, rows: capturedRows }
              : capturedRows > 0
                ? {
                    generation: -1,
                    rows: capturedRows,
                    cursor: null,
                    refreshRequired: false,
                    empty: false,
                    off: false,
                    exhausted: false,
                    open: false,
                  }
                : undefined,
          }
        : null;
    const remembered = held ? rememberPaneWindow(cache, leaving, held) : cache;
    // What the window would have been if the pane had never been left: the
    // folded string, and the four facts that say how deep it is. Restoring the
    // depth alongside the text is not optional -- a window put back at the
    // initial limit would have the next refresh ask for one page of a pane the
    // reader had paged five back, and `foldPaneRead` would honour that answer.
    const restored = recallPaneWindow(remembered, paneId, outputShape);
    paneCacheRef.current = remembered;
    paneWindowOwnerRef.current = paneId;
    // Without announcing it: the canvas reads the store in this same pass,
    // and telling subscribers now would update them while this renders. The
    // screen flushes it once the commit is in.
    outputStore.setDuringRender({
      window: {
        output: restored?.output ?? '',
        capturedRows: (restored?.captured as CapturedPaneState | undefined)?.rows ?? 0,
      },
      revision: restored?.revision ?? -1,
    });
    setCanLoadEarlierOutput(restored?.canLoadEarlier ?? false);
  }
  /* oxlint-enable react/refs, react/purity */
}

/**
 * The terminal, reading the pane's output from the screen's store rather than
 * from a prop, so a frame of output re-renders this and the canvas below it --
 * not the screen that owns the store. See `pane-output-store.ts`.
 */
function PaneTerminalPanel({
  outputStore,
  ...props
}: Omit<ComponentProps<typeof TerminalPanel>, 'output'> & { outputStore: PaneOutputStore }) {
  const output = usePaneOutput(outputStore, selectPaneOutputText);
  return <TerminalPanel {...props} output={output} />;
}

function selectPaneOutputText({ window }: PaneOutput): string {
  return window.output;
}

export function ServerTerminalWorkspace({
  serverId: providedServerId,
  sessionId: providedSessionId,
  paneId: providedPaneId,
  workspaceId: providedWorkspaceId,
  tabId: providedTabId,
  notificationId: providedNotificationId,
  sourceRouteActive,
  routeBound = false,
}: ServerTerminalWorkspaceProps = {}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  const escapeKey: TerminalKey = { label: 'ESC', key: 'esc', accessibilityLabel: t`Escape` };

  const routeParams = useLocalSearchParams<{
    serverId: string;
    sessionId?: string;
    paneId?: string;
    workspaceId?: string;
    tabId?: string;
    notificationId?: string;
    overview?: string;
    asid?: string;
    directory?: string;
    agentId?: string;
    intent?: string;
  }>();
  // A template literal rather than the bare `??` chain: the value is the same
  // string, and it is what tells React Compiler this is a primitive -- without
  // it the compiler assumed `serverId` could be an object mutated later and
  // declined to compile this component.
  const serverId = `${providedServerId ?? routeParams.serverId ?? ''}`;
  const routeSessionId = providedSessionId ?? routeParams.sessionId;
  const routePaneId = providedPaneId ?? routeParams.paneId;
  const routeWorkspaceId = providedWorkspaceId ?? routeParams.workspaceId;
  const routeTabId = providedTabId ?? routeParams.tabId;
  const routeTargetKey = [
    serverId,
    routeSessionId ?? '',
    routeWorkspaceId ?? '',
    routeTabId ?? '',
    routePaneId ?? '',
  ].join('\u0000');
  const [padRequestedPaneId, setPadRequestedPaneId] = useState<string | undefined>();
  const [strictTarget, setStrictTarget] = useState<StrictHomeTarget | null>(() =>
    routeSessionId || routeWorkspaceId || routeTabId || routePaneId
      ? {
          serverId,
          sessionId: routeSessionId,
          workspaceId: routeWorkspaceId,
          tabId: routeTabId,
          paneId: routePaneId,
          afterGeneration: 1,
        }
      : null
  );
  const routeTargetKeyRef = useRef<string | null>(null);
  const activeStrictTarget = strictTarget?.serverId === serverId ? strictTarget : null;
  const requestedSessionId = activeStrictTarget?.sessionId ?? routeSessionId;
  const rememberedPaneId = useServerSession(
    (state) => state.panesByServer[serverId]?.[requestedSessionId ?? state.byServer[serverId] ?? '']
  );
  // Keep the legacy route effect's request unscoped. Explicit Home targets are
  // checked by the strict effect below, so that effect cannot reconcile them
  // to a fallback before the authoritative availability result arrives.
  const requestedPaneId = activeStrictTarget ? undefined : (padRequestedPaneId ?? rememberedPaneId);
  const strictRequestedWorkspaceId = activeStrictTarget?.workspaceId;
  const strictRequestedTabId = activeStrictTarget?.tabId;
  const strictRequestedPaneId = activeStrictTarget?.paneId;
  const notificationId = providedNotificationId ?? routeParams.notificationId;
  const router = useRouter();
  const isFocused = useIsFocused();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  /**
   * The three columns, and whether the middle one gives room to the third.
   *
   * `responsiveWorkspaceLayout` decides: it declines to open the preview where
   * the terminal would be left too narrow to read, so this screen never has to
   * ask that question itself and a window dragged narrower closes the preview
   * on its own rather than squeezing both halves into uselessness.
   */
  const previewOpen = useSimfarmSplit((state) => state.openByServer[serverId] === true);
  const toggleSimfarmSplit = useSimfarmSplit((state) => state.toggle);
  const workspaceLayout = responsiveWorkspaceLayout(windowWidth, previewOpen);
  const isPadLayout = workspaceLayout.mode === 'pad';
  // The root stack decides sheet vs full-screen on the window alone (no
  // preview column), so the question "is a sheet over this a sheet" does too.
  const screenVisible = useScreenVisible(responsiveWorkspaceLayout(windowWidth).mode === 'pad');
  // The detail column (a pane or an agent session) and whether Home covers it.
  // `overview=home` and agent deep-link params are applied by the hook itself.
  const padShell = usePadDetail(serverId, {
    asid: routeParams.asid,
    sessionId: routeParams.sessionId,
    directory: routeParams.directory,
    agentId: routeParams.agentId,
    intent: routeParams.intent,
    overview: routeParams.overview,
  });
  const padDispatch = padShell.dispatch;
  const overviewVisible = padShell.state.overviewVisible;
  const padDetail = padShell.state.detail;
  const padDetailIsPane = padDetail.kind === 'pane';
  const paneHidden = overviewVisible || !padDetailIsPane;
  const setOverviewVisible = (visible: boolean) =>
    padDispatch({ type: visible ? 'show-home' : 'hide-home' });
  // The root Home route's owner, as opposed to a `/servers/[serverId]` route.
  const rootOwned = providedServerId !== undefined;
  const openAgentInPlace = usePadAgentOpener(serverId, padDispatch, rootOwned);
  // A Pad narrowed below Pad width while it shows an agent session has no rail
  // and no agent header -- a dead end. The phone shows agent sessions on
  // `/agent`, so the session moves there and this workspace returns to its
  // pane. A route-bound workspace is replaced (as the phone would have it);
  // the root Home owner stays under the pushed screen.
  const compactAgentDetail =
    !isPadLayout && isFocused && !overviewVisible && padDetail.kind === 'agent' ? padDetail : null;
  useEffect(() => {
    if (!compactAgentDetail) return;
    padDispatch({ type: 'open-pane' });
    const href = { pathname: '/agent', params: phoneAgentParams(compactAgentDetail) } as Href;
    if (rootOwned) router.push(href);
    else router.replace(href);
  }, [compactAgentDetail, padDispatch, rootOwned, router]);
  const padAgentTitle = usePadAgentTitle();
  const padAgentControls = usePadAgentSessionControls();
  // Spent once the hook has read it, so the next `overview=home` navigation
  // is a change it sees rather than the same value it already applied.
  const routeOverview = routeParams.overview;
  useEffect(() => {
    if (routeOverview === 'home') router.setParams({ overview: undefined });
  }, [routeOverview, router]);
  const overviewTargetRequest = useRef(0);
  const workspaceHandoff = useSyncExternalStore(
    homeWorkspaceHandoffStore.subscribe,
    () => homeWorkspaceHandoffStore.getState().handoff,
    () => homeWorkspaceHandoffStore.getState().handoff
  );
  const simfarmPorts = useServerSimfarm((state) => state.byServer);
  const hydrateSimfarmPorts = useServerSimfarm((state) => state.hydrate);
  useEffect(() => {
    void hydrateSimfarmPorts();
  }, [hydrateSimfarmPorts]);
  const rememberSimfarmPort = useCallback(
    (port: number) => {
      // The store's action, read when the port is found rather than subscribed
      // to: it never changes, and a selector over it only gave React Compiler
      // a dependency it could not prove stable.
      if (serverId) void useServerSimfarm.getState().remember(serverId, port);
    },
    [serverId]
  );
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  // The phone dock's horizontal rows run under a side status bar (iPhone Duo)
  // to the glass and rest clear of it; the Pad dock stands off the edge.
  const dockBleed = isPadLayout ? NO_SIDE_INSETS : { left: insets.left, right: insets.right };
  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const { record, records, loading, hydrationError, retryHydration, selectRecord, disconnect } =
    useGatewayRecord();
  const { showToast } = useToast();
  const demoMode = isDemoRecord(record);
  /**
   * Where a file picked right now would be staged for.
   *
   * A ref read at stage time rather than a value captured here, because the pane
   * changes under this hook and what has to be recorded is where a file was
   * staged -- not where the screen happened to start. The getter is stable so
   * the picker's identity does not churn on every pane change.
   *
   * `connectionGeneration` is a constant, and deliberately the same constant the
   * collaboration stack passes: the field is reserved for a real per-connection
   * counter that neither stack has yet, and picking a different placeholder here
   * would make two destinations that describe the same place compare unequal.
   */
  const attachmentDestinationRef = useRef<AttachmentDestination | undefined>(undefined);
  const attachmentDestination = useCallback(() => attachmentDestinationRef.current, []);
  const {
    attachments,
    capturePicker,
    retryUpload,
    removeAttachment,
    clearAttachments,
    uploading: attachmentsUploading,
    awaitUploads,
  } = useAttachmentUploads(record, attachmentDestination);
  const panelPick = usePanelPickerStore((state) => state.pick);
  const panelReturn = usePanelPickerStore((state) => state.returnTarget);
  const clearPanelPick = usePanelPickerStore((state) => state.clearPick);
  /**
   * Which of this gateway's sessions the reader is in, and how they said so.
   *
   * The unified machine picker is always available. Three things can name the
   * session the workspace lands on --
   * a pick made in this visit, a pane deep link from a push notification, and
   * what the reader was last reading here. They are ranked in that order below.
   */
  const [sessions, setSessions] = useState<SessionChoice[]>([]);
  // Every configured session, the disconnected ones too: `sessions` above is
  // only what can be switched to, so it cannot say *why* it is empty.
  const [backendSessions, setBackendSessions] = useState<NonNullable<SessionsResponse['sessions']>>(
    []
  );
  // The last load was refused because the terminal backend is down, and which
  // backend it named. Set by a failed poll, cleared by any successful load.
  const [backendUnreachable, setBackendUnreachable] = useState<{ backend?: string } | null>(null);
  const [chosenSessionId, setChosenSessionId] = useState<string | null>(null);
  const sessionPick = useServerSession((state) => state.pick);
  const clearSessionPick = useServerSession((state) => state.clearPick);
  const hydrateServerSession = useServerSession((state) => state.hydrate);
  const rememberedSessionId = useServerSession((state) => state.byServer[serverId]);
  /**
   * What the reader wants, before the gateway is consulted about whether it
   * still exists. A pick made a moment ago outranks a notification's deep link,
   * which outranks the memory of the last visit -- and `resolveSessionId` turns
   * any of them, or none of them, into a session this gateway actually has.
   */
  const preferredSessionId = chosenSessionId ?? requestedSessionId ?? rememberedSessionId;
  const resolvedSessionRef = useRef<{
    serverId: string;
    preference: string | null | undefined;
    sessionId: string;
  } | null>(null);
  const showTerminalKeyRow = useAppSettings((state) => state.showTerminalKeyRow);
  const terminalTextSize = useAppSettings((state) => state.terminalTextSize);
  // Seeded from the prefetch when it read the pane this screen is about to
  // land on, in the shape this screen reads -- or, for a route that names a
  // pane, from the last window any screen drew of it (`lib/pane-window-mirror`).
  // Everything else about the workspace already painted from the warm
  // snapshot on the first frame; without this the terminal under it stayed
  // empty until its own read returned, which made the instant chrome
  // advertise the one thing that was not.
  //
  // The decision -- which pane, which shape, and whether the read is usable at
  // all -- is `warmPaneSeed`, made once and read three times: for the window
  // the canvas starts from, into `paneCacheRef` for every frame after the
  // selection resolves, and for the pane the screen lands on before the
  // snapshot (`target`). The poll below corrects or confirms whatever this
  // paints, exactly as it does for `data`.
  const [warmSeed] = useState(() =>
    warmPaneSeed(serverId, { sessionId: routeSessionId, paneId: routePaneId })
  );
  // Opening a server the app was just in paints its workspace instead of
  // spelling out `Connecting`. The snapshot only decides the first frame: the
  // poller below runs immediately and corrects or confirms it. Declined when
  // it is of another session than the route's pane (`usableWarmWorkspace`).
  const [warmSnapshot] = useState(() => usableWarmWorkspace(serverId, warmSeed.target?.sessionId));
  const [data, setData] = useState<ServerData>(
    () =>
      warmSnapshot ??
      // The session the route's pane is in, so that everything keyed on the
      // session before the snapshot lands -- the pane's first read, the zoom,
      // the stream -- is asked of the right one rather than of `default`.
      (warmSeed.target ? { ...initialData, sessionId: warmSeed.target.sessionId } : initialData)
  );
  const [snapshotGeneration, setSnapshotGeneration] = useState(0);
  const snapshotGenerationRef = useRef(0);
  // For the refresh deciding whether anyone waits on a new generation.
  const dataRef = useLatestRef(data);
  const strictTargetRef = useLatestRef(activeStrictTarget);
  const [missingRequestedTarget, setMissingRequestedTarget] = useState<MissingHomeTarget | null>(
    null
  );
  const strictTargetAvailability =
    activeStrictTarget && data.health && snapshotGeneration >= activeStrictTarget.afterGeneration
      ? classifyHomeTargetAvailability({
          explicit: true,
          snapshot: 'confirmed',
          targetSessionId: requestedSessionId,
          targetPaneId: strictRequestedPaneId,
          currentSessionId: data.sessionId,
          availableSessionIds: sessions.map((session) => session.id),
          availablePaneIds: data.panes.map((pane) => pane.id),
        })
      : null;
  const strictWorkspaceMissing = Boolean(
    strictRequestedWorkspaceId &&
    !data.workspaces.some((workspace) => workspace.id === strictRequestedWorkspaceId)
  );
  const strictTabMissing = Boolean(
    strictRequestedTabId &&
    !data.tabs.some(
      (tab) =>
        tab.id === strictRequestedTabId &&
        (!strictRequestedWorkspaceId || field(tab, 'workspace_id') === strictRequestedWorkspaceId)
    )
  );
  const strictPaneContextMismatch = Boolean(
    strictRequestedPaneId &&
    data.panes.some(
      (pane) =>
        pane.id === strictRequestedPaneId &&
        ((strictRequestedWorkspaceId &&
          field(pane, 'workspace_id') !== strictRequestedWorkspaceId) ||
          (strictRequestedTabId && field(pane, 'tab_id') !== strictRequestedTabId))
    )
  );
  const strictTargetStructureUnavailable = Boolean(
    activeStrictTarget &&
    data.health &&
    snapshotGeneration >= activeStrictTarget.afterGeneration &&
    (strictWorkspaceMissing || strictTabMissing || strictPaneContextMismatch)
  );
  const targetUnavailable =
    missingRequestedTarget !== null ||
    strictTargetStructureUnavailable ||
    strictTargetAvailability?.kind === 'missing-pane' ||
    strictTargetAvailability?.kind === 'missing-session';

  useEffect(() => {
    if (routeTargetKeyRef.current === routeTargetKey) return;
    routeTargetKeyRef.current = routeTargetKey;
    // A link naming a pane brings the pane back from an agent detail. Not a
    // bare sessionId: agent links carry one too.
    if (routePaneId || routeWorkspaceId || routeTabId) padDispatch({ type: 'open-pane' });
    if (routeSessionId || routeWorkspaceId || routeTabId || routePaneId) {
      setStrictTarget({
        serverId,
        sessionId: routeSessionId,
        workspaceId: routeWorkspaceId,
        tabId: routeTabId,
        paneId: routePaneId,
        afterGeneration: snapshotGenerationRef.current + 1,
      });
    } else {
      setStrictTarget(null);
    }
    setMissingRequestedTarget(null);
  }, [
    padDispatch,
    routePaneId,
    routeSessionId,
    routeTabId,
    routeTargetKey,
    routeWorkspaceId,
    serverId,
  ]);
  const [deliveryOwnership] = useState(() => new DeliveryOwnership());
  // A route that names a pane lands on it from the first frame. The workspace
  // and tab are filled in by the snapshot (`selectionForPane`), and a pane the
  // snapshot does not list is reported unavailable by the strict effect below
  // -- the same answers as before, only the canvas no longer waits for them.
  const [landing] = useState<Selection>(() =>
    warmSeed.target ? { ...initialSelection, paneId: warmSeed.target.paneId } : initialSelection
  );
  // One frame after mount: the canvas gets the first commit to itself.
  const [dockArmed, setDockArmed] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDockArmed(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const [selectionOwner] = useState(
    () => new DeliverySelection(landing, sameSelection, deliveryOwnership)
  );
  const [selection, publishSelection] = useState<Selection>(landing);
  const setSelection = useCallback(
    (next: Selection | ((current: Selection) => Selection)) => {
      const resolved = selectionOwner.update(next);
      publishSelection(resolved);
      return resolved;
    },
    [selectionOwner]
  );
  const targetReady =
    !strictTargetStructureUnavailable &&
    isHomeTargetReady({
      explicit: Boolean(activeStrictTarget),
      availability:
        strictTargetAvailability ??
        (activeStrictTarget
          ? { kind: 'pending', sessionId: activeStrictTarget.sessionId ?? data.sessionId }
          : { kind: 'unscoped' }),
      targetSessionId: requestedSessionId,
      targetPaneId: strictRequestedPaneId,
      currentSessionId: data.sessionId,
      selectedPaneId: selection.paneId,
    }) &&
    (!strictRequestedWorkspaceId || selection.workspaceId === strictRequestedWorkspaceId) &&
    (!strictRequestedTabId || selection.tabId === strictRequestedTabId);
  // "Opening…" is for a target the screen cannot show yet. A pane the
  // selection already holds -- the route's own, landed on before the snapshot
  // -- is shown, under the connecting notice, and either confirmed or
  // replaced by the unavailable state when the snapshot answers.
  const targetPending =
    Boolean(activeStrictTarget) &&
    !targetUnavailable &&
    !targetReady &&
    !(strictRequestedPaneId && selection.paneId === strictRequestedPaneId);
  // The window on screen and the revision it was read at, in a store rather
  // than state: both change on every frame a streaming pane sends, and as
  // state they re-rendered this whole screen -- key row, drawer chrome, chips
  // -- each time. The canvas subscribes to the output (`PaneTerminalPanel`);
  // this screen only to the few answers it derives, each re-rendering it only
  // when that answer moves. See `pane-output-store.ts`.
  const [outputStore] = useState(() =>
    createPaneOutputStore({ window: { output: warmSeed.output, capturedRows: 0 }, revision: -1 })
  );
  // The draft and its caret live in a store, not in this component's state:
  // both change on every keystroke, and as state they re-rendered this whole
  // screen -- terminal, key row, chips -- twice per character. Only the field
  // subscribes to the text; this screen subscribes to the few answers it draws
  // from it (`hasDraftText`, the slash popup, the `@` mention), and reads the
  // text itself only when it acts on it. The caret is half of what decides
  // whether an `@` mention is open, tracked rather than assumed so moving it
  // back into an old `@word` reopens the picker the same as typing would.
  const [draftStore] = useState(createComposerDraftStore);
  const setDraft = useCallback(
    (text: string, caret?: number) => draftStore.setState({ text, caret }),
    [draftStore]
  );
  // Set for exactly one render after a mention is inserted, to put the caret
  // past the path. `undefined` the rest of the time: a permanently controlled
  // selection fights the platform's own caret handling on Android.
  //
  // Written but not yet read: the composer's `selection` prop this is meant to
  // feed has not been wired up, so picking a mention currently leaves the
  // platform caret wherever the text change put it. Kept rather than deleted
  // because the state is half of a feature the file-mention work still owes;
  // wiring it is a behavioural change and belongs to that card, not to lint.
  // oxlint-disable-next-line no-unused-vars -- see above.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [mentionHits, setMentionHits] = useState<FileMentionHit[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [sending, setSending] = useState(false);
  const [composerSendGuard] = useState(() => new ComposerSendGuard());
  useFocusEffect(useCallback(() => () => deliveryOwnership.invalidate(), [deliveryOwnership]));
  useEffect(
    () =>
      useGatewayConnectionStore.subscribe((next, previous) => {
        if (next.record !== previous.record) deliveryOwnership.invalidate();
      }),
    [deliveryOwnership]
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  // The dock's measured height, throttled: the reason it cannot be written
  // straight out of `onLayout` is the whole of `useSettledHeight`.
  const [composerHeight, measureComposerHeight] = useSettledHeight(96);
  /**
   * The most the command popup may take: the room between the header and the
   * dock with the keyboard up, and never more than 45% of the screen. Without
   * it the panel grew to six two-line rows, ran up through the header and hid
   * the terminal it was opened from. The rows past it scroll.
   */
  const keyboardHeight = useKeyboardState((state) => state.height);
  const commandPopupMaxHeight = Math.max(
    0,
    Math.min(
      windowHeight * 0.45,
      windowHeight - insets.top - DETAIL_HEADER_HEIGHT - keyboardHeight - composerHeight - 24
    )
  );
  // The keyboard button swaps the compact key row for a full on-screen QWERTY
  // that types straight into the pane -- the way to drive a TUI like nvim from
  // a phone. Off by default so the output stays visible.
  const [keyboardMode, setKeyboardMode] = useState(false);
  // Bumped each time the on-screen keyboard opens, so the pane's shortcuts --
  // and with them whether it takes extended keys right now -- are asked again:
  // a shell that has just started Claude Code gets its chords back without a
  // pane switch.
  const [keyboardOpens, setKeyboardOpens] = useState(0);
  const openKeyboard = useCallback(() => {
    Keyboard.dismiss();
    setKeyboardMode(true);
    setKeyboardOpens((count) => count + 1);
  }, []);
  // Asked for, per visit to the keyboard: an editor's composer stands down so
  // the file gets the height, and this is the reader saying they want it back
  // for one line. Cleared whenever the keyboard closes or the pane changes,
  // both of which end the visit it belongs to.
  const [composerRevealed, setComposerRevealed] = useState(false);
  const [stickBottomNonce, setStickBottomNonce] = useState(0);
  const openThemeEditor = useOpenThemeEditor();
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  /** A theme package arriving from the output. Null when the terminal holds none. */
  const [themeDrop, setThemeDrop] = useState<TerminalThemeDropState | null>(null);
  // The prepared artwork behind a ready card. Held in a ref because it is not
  // rendered from -- the card shows a name and the editor shows the rest -- and
  // because it has to be disposed exactly once however the card leaves.
  const themeCandidateRef = useRef<ThemeEditorCandidate | null>(null);
  /**
   * The download and staging behind a card that has not become one yet.
   *
   * The ref above is disposed on the way out, but a download still in flight
   * owns nothing it can see: the cleanup ran against an empty ref, and the
   * assignment that followed landed on a screen that had gone, leaving a whole
   * staged directory under `Paths.cache` that nothing collects. So the work is
   * owned from the moment it starts, cancelled here, and handed to the ref only
   * through `ThemeImportRequest.handoff` -- the same boundary `ThemeLinkImport`
   * uses, and it throws on an aborted signal before it marks the transfer, which
   * is what closes the gap between checking and assigning.
   */
  const themeRequestRef = useRef<ThemeImportRequest | null>(null);
  useEffect(
    () => () => {
      themeRequestRef.current?.cancel();
      themeRequestRef.current = null;
      themeCandidateRef.current?.prepared?.dispose();
      themeCandidateRef.current = null;
    },
    []
  );
  /** Whether the event stream is delivering. Decides how often output is re-read. */
  const [streamUp, setStreamUp] = useState(false);
  /**
   * The agent kinds this gateway will start, loaded the first time the
   * attachment menu is opened rather than on every screen mount.
   *
   * The catalog is a fact about the host, not about this pane, so one fetch per
   * connection is enough; a failure leaves the list empty, which draws the menu
   * exactly as it was before assistants could be started from it.
   */
  const [assistantKinds, setAssistantKinds] = useState<AgentProfile[]>([]);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  // An artifact opened from a path printed in the output, or from a part that
  // names it. Resolving either is a request, so a ref guards against a second
  // tap starting another one -- a ref rather than state because it only gates
  // the handler and nothing renders from it.
  const [openAsset, setOpenAsset] = useState<SessionAsset | null>(null);
  const openingAssetRef = useRef(false);
  const [partsState, setPartsState] = useState<PanePartsState>(initialPartsState);
  // The chat view's half of pagination. It cannot reuse the terminal's window:
  // a part is a claim about a span of source rows, so a transcript cannot be
  // merged out of two reads the way raw lines can. Paging it means re-reading
  // the whole transcript at a wider limit, which is why the limit -- not a
  // merged buffer -- is what is remembered here.
  const [loadingEarlierParts, setLoadingEarlierParts] = useState(false);
  const [canLoadEarlierParts, setCanLoadEarlierParts] = useState(false);

  const assignmentRequest = useComposerAssignmentStore((state) => state.request);
  const clearAssignmentRequest = useComposerAssignmentStore((state) => state.clear);
  const prefilledDraft = useComposerDraftStore((state) => state.draft);
  const clearPrefilledDraft = useComposerDraftStore((state) => state.clearDraft);
  const [error, setError] = useState<string | null>(null);
  // The opening frame is out, so what was held back for it may go: the pane
  // zoom, the approval and parts probes, the shortcuts, the discovery refresh.
  // True a frame after the canvas first has the pane's text, or after a short
  // grace when none arrives -- an empty pane still needs its banner and keys.
  // Measured against a paired gateway these requests, issued beside the pane's
  // first read, queued it behind them (145 ms against 2-50 ms alone) and their
  // answers re-rendered the screen while it was still parsing the first frame.
  const [openSettled, setOpenSettled] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>(() => ({
    // A warm snapshot is a reply this process received on an open connection a
    // moment ago (`server-warm-cache`). Painting it under a banner that says
    // Connecting is the flash the cache exists to remove. The poller runs at
    // once either way and corrects this if the gateway has since gone.
    phase: warmSnapshot ? 'connected' : 'connecting',
    attempt: 0,
  }));
  const [retryNonce, setRetryNonce] = useState(0);
  const [loadingEarlierOutput, setLoadingEarlierOutput] = useState(false);
  const [canLoadEarlierOutput, setCanLoadEarlierOutput] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<HistoryPullNotice | null>(null);
  // Closed by a pull that ended without a page (`historyPullBlockedAfter`), so
  // the gesture is neither offered nor fired again into the same failure. The
  // ref is what `loadEarlierOutput` reads; the state is what the terminal sees.
  const [historyPullBlocked, setHistoryPullBlocked] = useState(false);
  const historyPullBlockedRef = useRef(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const activeServerRef = useRef<string | null>(null);
  const activePaneRef = useRef<string | null>(null);
  // The pane whose output is being delivered, which outlives `activePaneRef`
  // under a sheet. See `watching`.
  const watchedServerRef = useRef<string | null>(null);
  const watchedPaneRef = useRef<string | null>(null);
  // Held in a ref rather than read from state so the poller does not have to be
  // rebuilt -- and the poll loop restarted -- when health first arrives.
  const healthRef = useRef<HealthResponse | null>(null);
  const dataRequestIdRef = useRef(0);
  const dataInFlightRef = useRef<Promise<RefreshResult> | null>(null);
  const outputRequestIdRef = useRef(0);
  // A read that lands after a newer streamed frame is not applied: see
  // `createStreamReadFence`.
  const [streamReadFence] = useState(createStreamReadFence);
  const outputLineLimitRef = useRef(INITIAL_PANE_OUTPUT_LINES);
  const loadingEarlierOutputRef = useRef(false);
  const partsLineLimitRef = useRef(INITIAL_PANE_OUTPUT_LINES);
  // How far back the last page actually reached, so a page that returns no more
  // than the one before it can retire the affordance whatever the gateway's row
  // metric claims. See `hasEarlierAfterPage` (card #646).
  const earlierOutputRowsRef = useRef(0);
  // The whole `read` envelope of the last output response applied for this
  // pane, kept -- not just the text -- so `paneReadRange` can see the `range`
  // riding alongside it. Only a fallback for `loadEarlierOutput` now: the
  // served range is a fact about the instant that read landed, and a refresh
  // or frame folded in afterwards can evict a paged-in line off the top
  // without this ever hearing about it, so `seedPageRange` -- asked fresh off
  // the pane's live scroll metrics on every call, not just the first -- is
  // preferred whenever it can answer. This is what is left when it cannot:
  // the pane record momentarily missing scroll metrics. `null` for a pane or
  // gateway that never sends a range at all, which is every pane's very first
  // read (the gateway's tail read deliberately omits `range`) and stays that
  // way for herdr panes and gateways older than range addressing.
  const lastReadRef = useRef<unknown>(null);
  // Set the first time a range-addressed request comes back shaped like
  // something other than the page asked for -- the signature of a backend
  // that accepts `start`/`end` without complaint and simply ignores them,
  // always serving its own tail instead (herdr's does; there is no capability
  // flag that says so up front). Sticky for the pane's lifetime once caught,
  // so a range request is attempted at most once against a pane that cannot
  // honour it rather than on every pull, and `loadEarlierOutput` falls back to
  // widening the tail -- exactly what every pane did before this feature
  // existed -- for the rest of the session.
  const rangeUnsupportedRef = useRef(false);
  // The gateway's captured history for this pane (`pullEarlierPage`): where the
  // next page starts, and whether the pane turned out not to be captured.
  // Per pane and per connection; never persisted.
  // Panes the gateway said are gone (`404 backend_target_not_found`, or a
  // `pane.closed` event), by the snapshot generation they were marked at: never
  // read again -- the streaming poll stopped asking about a pane closed on the
  // host, every 10 s, for as long as the screen stayed open -- unless a pane
  // list taken after the mark shows the id again.
  const gonePanesRef = useRef(new Map<string, number>());
  const [goneVersion, setGoneVersion] = useState(0);
  const capturedCursorRef = useRef<CapturedCursor | null>(null);
  const paneScreenRowsRef = useRef(0);
  const capturedOffRef = useRef(false);
  const capturedRefreshRequiredRef = useRef(false);
  const capturedRefreshApprovedRef = useRef(false);
  // Whether the captured history has rows above the window to give: asked
  // once when the pane opens (`capturedProbe` bumps ask again), and again
  // while output grows on a pane that had none yet. The pull is offered on its
  // account even where the window's own metrics say nothing is above it (an
  // alternate-screen pane's always do), and never when it has nothing.
  const [capturedOpen, setCapturedOpen] = useState(false);
  const [capturedProbe, setCapturedProbe] = useState(0);
  const capturedProbedAtRef = useRef(0);
  // The pane's captured history gave its last page (or the window reached its
  // cap): nothing more is offered, and it is not asked again.
  const capturedExhaustedRef = useRef(false);
  // The probe already asked for this pane at this `capturedProbe`: a focus
  // return or an overview toggle does not ask again.
  const capturedProbedKeyRef = useRef('');
  // What the open pane's captured history came to -- its cursor, whether it
  // is off, exhausted, on offer -- filed with the pane's window when the pane
  // is left and restored only with that window, so going back to a pane picks
  // up where it was, and a cursor never comes back without the rows it was
  // read against. `generation` drops what was filed before a reconnect.
  const capturedHereRef = useRef<CapturedPaneState | null>(null);
  const capturedGenerationRef = useRef(0);
  // The last probe found the capture empty: worth asking again as output grows.
  const capturedEmptyRef = useRef(false);
  const [capturedEmptyProbe, setCapturedEmptyProbe] = useState<{ output: string } | null>(null);
  const offerCaptured = (paneId: string | null | undefined, open: boolean) => {
    setCapturedOpen(open);
    if (!paneId || activePaneRef.current !== paneId) return;
    capturedHereRef.current = {
      generation: capturedGenerationRef.current,
      rows: 0, // The window transition files the rendered provenance with this state.
      refreshRequired: capturedRefreshRequiredRef.current,
      empty: capturedEmptyRef.current,
      cursor: capturedCursorRef.current,
      off: capturedOffRef.current,
      exhausted: capturedExhaustedRef.current,
      open,
    };
  };
  /** Forget every pane's captured state and ask the open pane again. */
  const restartCaptured = () => {
    capturedGenerationRef.current += 1;
    capturedHereRef.current = null;
    capturedCursorRef.current = null;
    capturedRefreshRequiredRef.current = false;
    capturedRefreshApprovedRef.current = false;
    capturedEmptyRef.current = false;
    setCapturedEmptyProbe(null);
    capturedOffRef.current = false;
    capturedExhaustedRef.current = false;
    setCapturedOpen(false);
    setCapturedProbe((probe) => probe + 1);
  };
  const earlierPartsRowsRef = useRef(0);
  const loadingEarlierPartsRef = useRef(false);
  const appliedNotificationTargetRef = useRef<string | null>(null);
  // The revision last read for the selected pane. An event repeating a revision
  // we already have is ignored, which is what turns "poll every 1.2s" into
  // "read only when something changed".
  const readRevisionRef = useRef<{ paneId: string; revision: number }>({
    paneId: '',
    revision: -1,
  });
  // The same idea for the structured view: the content key last read as parts.
  const readPartsKeyRef = useRef<{ paneId: string; contentKey: string }>({
    paneId: '',
    contentKey: '',
  });
  const partsRequestIdRef = useRef(0);
  /**
   * The windows of the panes recently left, so coming back to one paints in
   * the frame the tap happened in rather than after a round trip.
   *
   * A ref, not state: nothing renders from the cache itself -- what renders is
   * the `output` the recall seeds -- and a cache that re-rendered the screen
   * every time a neighbour's revision ticked would undo the very cost it is
   * here to remove. The rules it obeys (the bounds, the revision ordering, the
   * refusal of a reply overtaken in flight) are `lib/pane-cache`, tested
   * without a screen.
   *
   * Starts holding the warm prefetch's first screen when there is one, so the
   * render that resolves the selection restores it rather than blanking over
   * it -- see `warmPaneSeed`, which is also what `output` above was seeded
   * from. Filed under the landing pane's own id and shape, so it is subject to
   * exactly the same refusal as any other window: a pane that turned into an
   * editor before the screen opened is declined here too.
   */
  const paneCacheRef = useRef<PaneCache>(warmSeed.cache);
  /**
   * Which pane the `output` on screen belongs to.
   *
   * Not the same question as `selection.paneId`: on the render that changes
   * the selection, the window is still the outgoing pane's, and this is what
   * says whose it is so it can be filed under the right name.
   */
  const paneWindowOwnerRef = useRef('');
  /**
   * Bumped on every selection change, and carried by each warming request, so
   * a burst of swipes leaves exactly one useful warm-up behind it instead of
   * one per pane passed through. See `panePrefetchAccepted`.
   */
  const prefetchGenerationRef = useRef(0);
  const refreshOutputRef = useRef<() => void>(() => {});
  const applyPaneOutputRef = useRef<
    (paneId: string, value: string, revision?: number, origin?: PaneReadOrigin) => void
  >(() => {});
  const panesRef = useRef<HerdrEntity[]>([]);
  // Where each workspace was last left, so swiping the title back to one
  // returns to the pane the user was reading rather than to whatever the
  // gateway currently calls focused. A ref because nothing renders from it and
  // it must not take part in any dependency list.
  const workspaceMemoryRef = useRef<WorkspaceMemory>({});
  // The same idea one level down, for the two-finger tab swipe: which pane each
  // tab was last read on. Kept separate from the workspace memory rather than
  // derived from it because a workspace remembers only the tab it left on,
  // while swiping across four tabs and back has to restore all four.
  const tabPaneMemoryRef = useRef<TabPaneMemory>({});
  // Pane changes keep the native canvas and its text geometry stable. The
  // switch notice supplies the brief visual acknowledgement.
  // The pane strip scrolls, and with more panes than fit, swiping to one off
  // its right-hand end used to leave the strip highlighting nothing: the
  // active chip was simply somewhere the user could not see, so the only
  // indicator of which pane is open pointed at empty space.
  const paneStripRef = useRef<ScrollViewInstance>(null);
  const paneChipLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const paneStripViewportRef = useRef(0);
  const paneStripOffsetRef = useRef(0);
  // The composer rides the same keyboard offset as the terminal. Sharing one
  // source means it can never get stuck up while the keyboard is down, which is
  // what a separate KeyboardStickyView occasionally did.
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.value }],
  }));
  /**
   * The dock's bottom clearance, on the UI thread with the keyboard.
   *
   * It used to be a SafeAreaView's inset with 8pt padded on top of it, and the
   * inset stayed while the keyboard was up. On a phone with a home indicator
   * that is 42pt of empty glass under the field with the keyboard down, and a
   * 34pt gap between the field and the keys with it up -- the keyboard covers
   * the indicator, so the room reserved for it has nothing left to clear.
   *
   * The inset is the clearance, not a base to pad from: `max(8, inset)` keeps
   * the 8 only where there is no indicator. And it falls with the keyboard --
   * `keyboardOffset` is negative while up, so the inset is spent point for
   * point as the dock rises, and the field lands flush on the keys.
   */
  const dockBottomFloor = isPadLayout ? appChrome.layout.padWorkspaceGutter : 8;
  const dockClearanceStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(
      dockBottomFloor,
      Math.min(DOCK_INDICATOR_CLEARANCE, insets.bottom) + keyboardOffset.value
    ),
  }));
  // A dismissal backdrop covers the pane and stops where the composer starts.
  // Why it is bounded rather than an absolute fill is `composerBackdropBottom`;
  // the short version is that a full-screen backdrop's centre is a pane chip.
  const menuBackdropStyle = useAnimatedStyle(() => ({
    bottom: composerBackdropBottom(composerHeight, keyboardOffset.value),
  }));
  const refreshDataRef = useRef<() => void>(() => {});

  const routeRecord =
    records.find((item) => item.serverId === serverId) ??
    (serverId === DEMO_SERVER_ID ? demoRecord : undefined);
  const selectedServer = Boolean(record && record.serverId === serverId);
  // A tunnelled gateway is only reachable once its SSH forward is up. Hold the
  // tunnel while this server is the selected one, and gate readiness on it: the
  // shared client's base URL points at the loopback forward, which is empty
  // until `open`. A direct record reports `open` at once and holds nothing.
  const tunnel = useGatewayTunnel(record, selectedServer);
  const tunnelReady = !tunnel.tunnelled || tunnel.phase === 'open';
  const appActive = useAppActive();
  const ready = !overviewVisible && padDetailIsPane && isFocused && selectedServer && tunnelReady;
  /**
   * Whether the reader can still see this screen -- which is not whether it is
   * focused.
   *
   * The sheets are pushed routes (`panels`, `artifacts`, `commands`), and a
   * native form sheet at a 0.65 detent leaves the pane in full view above it.
   * React Navigation blurs the screen underneath all the same, because its
   * focus is a position in the stack rather than a statement about pixels.
   *
   * Asking `isFocused` for anything the reader can see cost a visible jump
   * (card #639): every `bottomInset` below is the composer's height, the
   * composer was gated on focus, and so opening the panels sheet collapsed the
   * inset to zero in one frame. That inset is the canvas's viewport, and the
   * reaction that follows it re-pins the scroll offset without animating, so
   * the output leapt a composer's height on the way in and again on the way
   * out. Two things are separated here: `ready` still governs polling and the
   * active-pane bookkeeping, which genuinely should stand down when another
   * screen is in charge; `onScreen` governs layout and gesture state, which
   * must not move while it is still being looked at.
   */
  const onScreen = selectedServer;
  /**
   * Whether the selected pane's output keeps arriving -- `ready`, except that a
   * sheet over the screen does not stop it.
   *
   * The pane stays in view under a sheet and through the sheet's whole slide
   * back down, and the event stream used to be gated on `ready`: opening Quick
   * actions closed the stream, the pane sat frozen on the frame it had when the
   * sheet rose, and dismissing reopened the socket and re-read the whole window.
   * The reader watched the stale frame slide back into view and then jump --
   * by however much the pane had printed meanwhile -- the moment the socket was
   * back: the flash on returning from a sheet. Only the output path (the
   * stream, its safety-net poll, and the read they trigger) follows this;
   * everything that acts on the pane still waits for `ready`.
   */
  const watching =
    !overviewVisible && padDetailIsPane && screenVisible && selectedServer && tunnelReady;
  const hasLoadedData = Boolean(data.health);

  useLayoutEffect(() => {
    if (!ready) deliveryOwnership.invalidate();
    activeServerRef.current = ready ? serverId : null;
    activePaneRef.current = ready ? selection.paneId : null;
    return () => deliveryOwnership.invalidate();
  }, [ready, selection.paneId, serverId, data.sessionId, deliveryOwnership]);

  useLayoutEffect(() => {
    watchedServerRef.current = watching ? serverId : null;
    watchedPaneRef.current = watching ? selection.paneId : null;
  }, [watching, selection.paneId, serverId]);

  useEffect(() => {
    if (isFocused && !loading && routeRecord && record?.serverId !== routeRecord.serverId) {
      void selectRecord(routeRecord.serverId);
    }
  }, [isFocused, loading, record?.serverId, routeRecord, selectRecord]);

  // The remembered session, read once per launch. It lands as a preference
  // rather than as a navigation: the first refresh has usually not answered yet
  // when it arrives, and when it has, the switch effect below moves the screen.
  useEffect(() => {
    void hydrateServerSession();
  }, [hydrateServerSession]);

  // Regaining focus means a sheet just closed -- most likely the panels sheet,
  // where a rename/create/delete may have happened. Pull fresh data so the pane
  // title and strip reflect it at once, without waiting for the slow poll or a
  // structural event that may have been missed.
  useEffect(() => {
    if (isFocused && hasLoadedData) refreshDataRef.current();
  }, [isFocused, hasLoadedData]);

  /**
   * Everything on this screen that belongs to the terminal being left.
   *
   * Written once because it is needed twice. Leaving the server is the obvious
   * caller; switching to another of the gateway's sessions is the other, and it
   * is the same journey -- the pane strip, the output, the scrollback, the
   * staged attachments and the pane the reader was looking at are all facts
   * about a session, and carrying any of them across would put the last
   * session's terminal under the new session's name until the first read
   * landed. What comes back afterwards is `refreshData` and
   * `reconcileSelection`, exactly as it is for a server switch; there is no
   * second path.
   */
  const resetSessionState = useCallback(() => {
    deliveryOwnership.invalidate();
    dataRequestIdRef.current += 1;
    outputRequestIdRef.current += 1;
    // Every remembered window is a fact about the session being left, and pane
    // ids are only unique within one -- so the cache goes with the output, for
    // the same reason and in the same breath.
    paneCacheRef.current = emptyPaneCache;
    prefetchGenerationRef.current += 1;
    partsRequestIdRef.current += 1;
    readPartsKeyRef.current = { paneId: '', contentKey: '' };
    setPartsState(initialPartsState);
    outputStore.setRevision(-1);
    setData(initialData);
    snapshotGenerationRef.current = 0;
    setSnapshotGeneration(0);
    setSelection(initialSelection);
    outputStore.setWindow({ output: '', capturedRows: 0 });
    setDraft('');
    setError(null);
    setMissingRequestedTarget(null);
    setLoadingData(true);
    healthRef.current = null;
    workspaceMemoryRef.current = {};
    tabPaneMemoryRef.current = {};
    setConnection({ phase: 'connecting', attempt: 0 });
    composerSendGuard.reset();
    setSending(false);
    setSendingKey(null);
    outputLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierOutputRowsRef.current = 0;
    lastReadRef.current = null;
    rangeUnsupportedRef.current = false;
    restartCaptured();
    gonePanesRef.current.clear();
    loadingEarlierOutputRef.current = false;
    appliedNotificationTargetRef.current = null;
    setLoadingEarlierOutput(false);
    setHistoryNotice(null);
    historyPullBlockedRef.current = false;
    setHistoryPullBlocked(false);
    setCanLoadEarlierOutput(false);
    setHistoryRevision(0);
    partsLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierPartsRowsRef.current = 0;
    loadingEarlierPartsRef.current = false;
    setLoadingEarlierParts(false);
    setCanLoadEarlierParts(false);
    // Attachments were uploaded to the server being left, so their paths mean
    // nothing on the next one.
    setAttachmentMenuOpen(false);
    setPreviewAttachmentId(null);
    clearAttachments();
  }, [
    outputStore,
    clearAttachments,
    composerSendGuard,
    deliveryOwnership,
    setDraft,
    setSelection,
    setData,
    setSnapshotGeneration,
    setMissingRequestedTarget,
  ]);

  useEffect(() => {
    if (selectedServer) return;
    resetSessionState();
    // The session list and the pick made in it belong to the gateway being
    // left, and unlike everything above they must not survive a session switch
    // on the same server -- which is why they are cleared here rather than in
    // `resetSessionState`.
    setSessions([]);
    setBackendSessions([]);
    setBackendUnreachable(null);
    setChosenSessionId(null);
  }, [resetSessionState, selectedServer, serverId]);

  /**
   * The gateway restarted: every pane buffer it had is gone, and it is
   * answering from new ones that started empty. Everything held here was
   * folded from the old buffers, so folding the new reads under it is what
   * left stale -- and doubled -- history on screen until the App was reopened.
   *
   * Narrower than `resetSessionState`: the session, the navigator and the
   * selection are still true (herdr outlives the gateway), only what was read
   * out of the gateway's buffers is not. So the window, the remembered windows
   * of every other pane, the depth the next read asks at, the transcript, and
   * the fold's own memory of windows a resize was settling all go, the
   * terminal is pinned back to the bottom, and the selected pane is read again
   * from scratch. Runs synchronously inside the `noteGatewayGeneration` that
   * saw the new generation, so the bumped request ids turn the answer that
   * carried it away before it can be folded into anything.
   */
  const resetPaneHistory = useCallback(() => {
    outputRequestIdRef.current += 1;
    partsRequestIdRef.current += 1;
    prefetchGenerationRef.current += 1;
    paneCacheRef.current = emptyPaneCache;
    forgetPaneReadSettling();
    forgetWarmWorkspace(serverId);
    readRevisionRef.current = { paneId: '', revision: -1 };
    outputStore.setRevision(-1);
    outputStore.setWindow({ output: '', capturedRows: 0 });
    outputLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierOutputRowsRef.current = 0;
    lastReadRef.current = null;
    rangeUnsupportedRef.current = false;
    restartCaptured();
    loadingEarlierOutputRef.current = false;
    setLoadingEarlierOutput(false);
    setHistoryNotice(null);
    historyPullBlockedRef.current = false;
    setHistoryPullBlocked(false);
    setCanLoadEarlierOutput(false);
    setHistoryRevision(0);
    setStickBottomNonce((value) => value + 1);
    readPartsKeyRef.current = { paneId: '', contentKey: '' };
    setPartsState(initialPartsState);
    partsLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierPartsRowsRef.current = 0;
    loadingEarlierPartsRef.current = false;
    setLoadingEarlierParts(false);
    setCanLoadEarlierParts(false);
    // The transcript comes back through its own effect, which sees the reset
    // parts state as unanswered; the terminal is asked here.
    refreshOutputRef.current();
  }, [outputStore, serverId]);

  useEffect(() => {
    if (!serverId) return;
    return onGatewayRestart(serverId, resetPaneHistory);
  }, [resetPaneHistory, serverId]);

  useEffect(() => {
    if (watching) return;
    outputRequestIdRef.current += 1;
  }, [watching]);

  useEffect(() => {
    if (ready) return;
    dataRequestIdRef.current += 1;
    composerSendGuard.reset();
    setSending(false);
    setSendingKey(null);
  }, [composerSendGuard, ready]);

  const refreshData = useCallback(
    async (showLoading = false): Promise<RefreshResult> => {
      if (!ready) return null;
      // A poll re-armed while the first load is still out (the poller effect
      // restarts as its inputs settle) joins that load rather than starting
      // another: the transport already answered both with one request, but
      // each answer was applied, and the screen re-rendered, once per poll.
      if (dataInFlightRef.current) {
        if (showLoading) setLoadingData(true);
        return dataInFlightRef.current;
      }
      const requestId = ++dataRequestIdRef.current;
      const requestServerId = serverId;
      const isCurrentRequest = () =>
        activeServerRef.current === requestServerId &&
        dataRequestIdRef.current === requestId &&
        useGatewayConnectionStore.getState().record?.serverId === requestServerId;
      if (showLoading) setLoadingData(true);
      const run: Promise<RefreshResult> = settleAfter(
        async () => {
          return recoverWith<RefreshResult>(
            async () => {
              // Health costs a herdr round-trip and is only read as a "have we loaded
              // anything yet" flag, so it is fetched once rather than every poll.
              // The first load takes the Home probe's `/health` body rather than
              // asking again (the warm prefetch does the same), and names the
              // session the route's pane is in, so the snapshot is asked for
              // beside `/api/sessions` instead of after it.
              const firstLoad = dataRef.current.health === null;
              const health =
                healthRef.current ?? (firstLoad ? serverPrewarmGate(serverId).health : null);
              const hint =
                firstLoad && warmSeed.target ? { sessionId: warmSeed.target.sessionId } : undefined;
              const previous = resolvedSessionRef.current;
              // A backend coming back must reveal a choice, not pull the reader away
              // from the live fallback they are now using. Explicit picks reset this.
              // This is the one part of the load the home screen cannot share: it
              // needs state only this screen has. What it decides is the preference,
              // which is all `loadWorkspaceSnapshot` is told.
              const stablePreference =
                previous?.serverId === serverId && previous.preference === preferredSessionId
                  ? previous.sessionId
                  : preferredSessionId;
              const loaded = await loadWorkspaceSnapshot(
                stablePreference,
                health,
                isCurrentRequest,
                hint
              );
              if (!loaded || !isCurrentRequest()) return null;
              const { snapshot: next, choices, allSessions } = loaded;
              setSessions((current) => (sameSessionChoices(current, choices) ? current : choices));
              setBackendSessions((current) =>
                JSON.stringify(current) === JSON.stringify(allSessions) ? current : allSessions
              );
              const { sessionId } = next;
              const sessionConfirmedAgain =
                previous?.serverId !== serverId ||
                previous.preference !== preferredSessionId ||
                previous.sessionId !== sessionId;
              resolvedSessionRef.current = { serverId, preference: preferredSessionId, sessionId };
              healthRef.current = next.health;
              rememberWarmWorkspace(serverId, next);
              // Only a confirmed, still-owned request may refresh Home's mirror.
              // Initial/reset data and a cached first frame are not new observations.
              if (!isDemoRecord(record)) {
                void useServerAgents.getState().record({
                  serverId,
                  sessionId,
                  checkedAtMs: Date.now(),
                  agents: mirroredServerPanes(next.panes, next.agents, next.health?.capabilities),
                });
              }
              // A new generation only when something waits on one: a changed
              // workspace, a strict target or a gone pane waiting for a
              // snapshot taken after it, or a session confirmed again (the
              // Home visit). The 12 s poll that finds nothing new used to bump
              // it anyway, re-rendering this whole screen to learn nothing.
              const waitingFor = strictTargetRef.current?.afterGeneration;
              const strictTargetWaiting =
                waitingFor !== undefined && snapshotGenerationRef.current < waitingFor;
              const dataChanged = !sameServerData(dataRef.current, next);
              if (
                dataChanged ||
                strictTargetWaiting ||
                gonePanesRef.current.size > 0 ||
                sessionConfirmedAgain
              ) {
                const nextSnapshotGeneration = snapshotGenerationRef.current + 1;
                snapshotGenerationRef.current = nextSnapshotGeneration;
                setSnapshotGeneration(nextSnapshotGeneration);
              }
              setData((current) => (sameServerData(current, next) ? current : next));
              const strictTargetAtRequest = activeStrictTarget;
              setSelection((current) => {
                if (
                  strictTargetAtRequest?.serverId === serverId &&
                  ((strictTargetAtRequest.sessionId &&
                    next.sessionId !== strictTargetAtRequest.sessionId) ||
                    (strictTargetAtRequest.workspaceId &&
                      !next.workspaces.some(
                        (workspace) => workspace.id === strictTargetAtRequest.workspaceId
                      )) ||
                    (strictTargetAtRequest.tabId &&
                      !next.tabs.some(
                        (tab) =>
                          tab.id === strictTargetAtRequest.tabId &&
                          (!strictTargetAtRequest.workspaceId ||
                            field(tab, 'workspace_id') === strictTargetAtRequest.workspaceId)
                      )) ||
                    (strictTargetAtRequest.paneId &&
                      !next.panes.some((pane) => pane.id === strictTargetAtRequest.paneId)))
                ) {
                  return current;
                }
                const reconciled = reconcileSelection(next, current);
                return sameSelection(current, reconciled) ? current : reconciled;
              });
              setError(null);
              setBackendUnreachable(null);
              // Structural refreshes share request ownership with the watchdog. Their
              // confirmed success is readiness evidence too, even if they superseded
              // the watchdog's in-flight read.
              setConnection((current) =>
                current.phase === 'connected' && current.attempt === 0
                  ? current
                  : { phase: 'connected', attempt: 0 }
              );
              return { ok: true, data: next };
            },
            (failure) => {
              if (!isCurrentRequest()) return null;
              return {
                ok: false,
                failure: describeGatewayFailure(failure, t`Computer unavailable.`),
              };
            }
          );
        },
        () => {
          if (isCurrentRequest()) setLoadingData(false);
          if (dataInFlightRef.current === run) dataInFlightRef.current = null;
        }
      );
      dataInFlightRef.current = run;
      return run;
    },
    [
      activeStrictTarget,
      preferredSessionId,
      ready,
      record,
      serverId,
      t,
      setSelection,
      setSessions,
      setBackendSessions,
      setBackendUnreachable,
      setSnapshotGeneration,
      setData,
      dataRef,
      strictTargetRef,
      warmSeed,
    ]
  );

  useEffect(() => {
    // `appActive`, not just `ready`. `ready` carries `isFocused`, which is
    // *navigation* focus -- it stays true while this screen sits under a
    // backgrounded app. Without this the slow poll went on waking the radio
    // every twelve seconds, with four parallel requests each time
    // (`loadWorkspaceSnapshot`), for a screen nobody was looking at: the one
    // remaining thing this workspace did in someone's pocket. The stream and
    // the output poll already stood down here; this did not.
    //
    // Deliberately not folded into `ready` itself: its falling edge cancels
    // in-flight requests, so backgrounding mid-send would turn into a lost
    // send. Coming back re-runs this effect, and `poll` reads immediately --
    // which is the same catch-up the stream's reconnect performs.
    if (!ready || !appActive) return;
    let attempt = 0;

    function onResult(result: NonNullable<RefreshResult>): number | null {
      if (result.ok) {
        attempt = 0;
        // Structural changes arrive over the event stream; this slow poll only
        // covers a missed event or a stream that never connected.
        return 12000;
      }

      attempt += 1;
      const failure = result.failure;
      setBackendUnreachable((current) =>
        failure.kind !== 'backend'
          ? null
          : current?.backend === failure.backendKind
            ? current
            : { backend: failure.backendKind }
      );
      setConnection({
        phase: result.failure.retryable && attempt < 3 ? 'reconnecting' : 'offline',
        attempt,
        message: result.failure.message,
        backendUnavailable: result.failure.kind === 'backend',
        needsPairing: result.failure.needsPairing,
      });
      if (result.failure.retryable) {
        return Math.min(1000 * 2 ** Math.min(attempt - 1, 3), MAX_RECONNECT_DELAY_MS);
      }
      return null;
    }

    setConnection((current) => {
      // Returning from the background and route/data reconciliation both restart this
      // poller. Keep a healthy connection stable while that refresh runs; only an
      // actual failed request should move it into the reconnecting state.
      if (hasLoadedData && current.phase === 'connected') return current;
      return { phase: hasLoadedData ? 'reconnecting' : 'connecting', attempt: 0 };
    });
    return startWorkspacePoller({ refresh: refreshData, initial: !hasLoadedData, onResult });
  }, [appActive, hasLoadedData, ready, refreshData, retryNonce, serverId, t]);

  // A burst of structural events (opening a workspace spawns several) should
  // cause one refresh, not one per event.
  useEffect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    refreshDataRef.current = () => {
      if (handle) return;
      handle = setTimeout(() => {
        handle = undefined;
        void refreshData(false);
      }, 250);
    };
    return () => {
      if (handle) clearTimeout(handle);
      refreshDataRef.current = () => {};
    };
  }, [refreshData]);

  // A pane the gateway says is gone: stop asking about it, read the workspace
  // again so the selection moves to a pane that exists, and say so where the
  // reader was looking.
  const markPaneGoneRef = useRef<(paneId: string) => void>(() => {});
  useEffect(() => {
    markPaneGoneRef.current = (paneId) => {
      if (gonePanesRef.current.has(paneId)) return;
      gonePanesRef.current.set(paneId, snapshotGenerationRef.current);
      // Its window, and the captured history filed with it, go with it.
      paneCacheRef.current = forgetPaneWindow(paneCacheRef.current, paneId);
      if (activePaneRef.current === paneId) restartCaptured();
      setGoneVersion((version) => version + 1);
      if (activePaneRef.current === paneId) {
        setError(t`This terminal is no longer available. Choose another terminal.`);
      }
      refreshDataRef.current();
    };
  }, [t]);
  // A pane list taken after the mark that shows the id again (a backend that
  // reused it): it is a pane again.
  useEffect(() => {
    for (const [paneId, markedAt] of gonePanesRef.current) {
      if (snapshotGeneration > markedAt && data.panes.some((pane) => pane.id === paneId)) {
        gonePanesRef.current.delete(paneId);
        setGoneVersion((version) => version + 1);
      }
    }
  }, [data.panes, snapshotGeneration]);

  // tmux's `layout_updated` is its only activity event: it carries every
  // window and pane created, closed or moved, and also moves with every title
  // or command change on the host, every 500 ms next to a working agent. So it
  // is answered with one pane-list read -- at once after a quiet spell, at most
  // every LAYOUT_CHECK_MS while it keeps coming -- and the workspace is read
  // again only when that list shows structure or an open-pane resize.
  const layoutCheckRef = useRef<() => void>(() => {});
  useEffect(() => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    let lastCheckAt = 0;
    const sessionId = data.sessionId;
    const layoutOf = (pane: HerdrEntity): PaneLayout => ({
      id: pane.id,
      tab: field(pane, 'tab_id'),
      workspace: field(pane, 'workspace_id'),
      width: numberField(pane, 'width'),
      height: numberField(pane, 'height'),
    });
    layoutCheckRef.current = () => {
      if (handle || !sessionId) return;
      const wait = Math.max(0, lastCheckAt + LAYOUT_CHECK_MS - Date.now());
      handle = setTimeout(() => {
        handle = undefined;
        lastCheckAt = Date.now();
        const held = panesRef.current.map(layoutOf);
        loadPanes(sessionId).then(
          (fresh) => {
            if (layoutNeedsRefresh(held, fresh.map(layoutOf), activePaneRef.current)) {
              refreshDataRef.current();
            }
          },
          // The 12 s poll still reads the workspace; a failed check is not news.
          () => {}
        );
      }, wait);
    };
    return () => {
      if (handle) clearTimeout(handle);
      layoutCheckRef.current = () => {};
    };
  }, [data.sessionId]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && selectedServer) setRetryNonce((value) => value + 1);
    });
    return () => subscription.remove();
  }, [selectedServer]);

  // The switcher sheet is a route, so it hands its pick back through the store
  // rather than through navigation params -- the same channel, and for the same
  // reason, as the panels sheet next door. Taken as a preference here; the
  // effect below is what actually moves the screen, so a pick naming the
  // session already open costs nothing.
  useEffect(() => {
    if (!sessionPick || sessionPick.serverId !== serverId) return;
    padDispatch({ type: 'open-pane' });
    resolvedSessionRef.current = null;
    clearSessionPick();
    setMissingRequestedTarget(null);
    setStrictTarget({
      serverId,
      sessionId: sessionPick.sessionId,
      afterGeneration: snapshotGenerationRef.current + 1,
    });
    setChosenSessionId(sessionPick.sessionId);
  }, [clearSessionPick, padDispatch, serverId, sessionPick]);

  /**
   * Switching session, as a navigation.
   *
   * One rule covers every way the answer can change -- a pick from the sheet, a
   * remembered choice arriving from the keychain after the first refresh
   * already landed, a deep link -- because all of them are the same question:
   * is the session the reader is owed the one on screen? When it is not,
   * everything belonging to the old session goes (`resetSessionState`) and the
   * refresh path brings the new one back, with `retryNonce` restarting the poll
   * and the event stream the way Retry and a return from the background do.
   *
   * Nothing happens until the gateway has answered once. Before that there is
   * no session on screen to be wrong, and `refreshData` will resolve the
   * preference itself on its first pass.
   */
  useEffect(() => {
    if (!hasLoadedData || sessions.length === 0) return;
    const previous = resolvedSessionRef.current;
    const preference =
      previous?.serverId === serverId && previous.preference === preferredSessionId
        ? previous.sessionId
        : preferredSessionId;
    if (resolveSessionId(sessions, preference) === data.sessionId) return;
    resetSessionState();
    setRetryNonce((value) => value + 1);
  }, [data.sessionId, hasLoadedData, preferredSessionId, resetSessionState, serverId, sessions]);

  const selectedWorkspace = useMemo(
    () => data.workspaces.find((item) => item.id === selection.workspaceId),
    [data.workspaces, selection.workspaceId]
  );
  const tabPanes = useMemo(
    () => data.panes.filter((item) => field(item, 'tab_id') === selection.tabId),
    [data.panes, selection.tabId]
  );
  // The ring the two-finger swipe cycles: the tabs of the workspace on screen,
  // in the order Herdr has them rather than in id order, so "next" means the
  // next one along in the panels sheet too.
  const workspaceTabs = useMemo(
    () => data.tabs.filter((item) => field(item, 'workspace_id') === selection.workspaceId),
    [data.tabs, selection.workspaceId]
  );
  const selectedPane = useMemo(
    () => data.panes.find((item) => item.id === selection.paneId),
    [data.panes, selection.paneId]
  );
  // A cached window must carry its grid into the first frame too. Its display
  // facts do not confirm the session or enable any operation before health.
  const displayPane =
    selectedPane ??
    (!data.health && warmSeed.pane?.id === selection.paneId ? warmSeed.pane : undefined);
  const selectedAgent = useMemo(
    () => data.agents.find((item) => field(item, 'pane_id') === selection.paneId),
    [data.agents, selection.paneId]
  );
  const lastHomeVisit = useRef<string | null>(null);
  const homeVisit = useRef<{ target: HomeTarget; title: string } | null>(null);
  // `resolvedSessionRef` is not reactive: a session pick clears it, and the
  // refresh that confirms the session again may leave `data` unchanged. The
  // snapshot generation it bumps right after is what re-runs this effect.
  useEffect(() => {
    homeVisit.current = null;
    if (!isFocused || overviewVisible || !padDetailIsPane) {
      lastHomeVisit.current = null;
      return;
    }
    if (demoMode || !selectedServer || !selectedPane || !data.sessionId) return;
    if (!targetReady) return;
    if (connection.phase !== 'connected') return;
    const observed = resolvedSessionRef.current;
    if (observed?.serverId !== serverId || observed.sessionId !== data.sessionId) return;
    const target: HomeTarget = {
      kind: 'gateway-terminal',
      serverId,
      sessionId: data.sessionId,
      paneId: selectedPane.id,
    };
    const key = homeTargetKey(target);
    homeVisit.current = { target, title: panelTitle(selectedPane, selectedAgent) };
    if (lastHomeVisit.current === key) return;
    lastHomeVisit.current = key;
    void useHomeRecentsStore.getState().visit(target, panelTitle(selectedPane, selectedAgent));
  }, [
    connection.phase,
    data.sessionId,
    demoMode,
    isFocused,
    overviewVisible,
    padDetailIsPane,
    selectedAgent,
    selectedPane,
    selectedServer,
    serverId,
    snapshotGeneration,
    targetReady,
  ]);
  // A visit is stamped once per selection, but agents keep refreshing their
  // own times. While the pane stays in use, touch it in memory on Continue's
  // cadence (no keychain write); persist one real visit when it is left.
  useEffect(() => {
    if (
      !appActive ||
      !isFocused ||
      overviewVisible ||
      !padDetailIsPane ||
      connection.phase !== 'connected'
    )
      return;
    const timer = setInterval(() => {
      const visit = homeVisit.current;
      if (visit) useHomeRecentsStore.getState().touch(visit.target);
    }, HOME_CONTINUE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [appActive, connection.phase, isFocused, overviewVisible, padDetailIsPane]);
  const homePanes = useRef({ sessionId: data.sessionId, panes: data.panes });
  useEffect(() => {
    homePanes.current = { sessionId: data.sessionId, panes: data.panes };
  }, [data.panes, data.sessionId]);
  // Leaving: blur, overview, background, another server, or unmount. A pane
  // switch is not a leave -- the new pane's own visit covers it. React runs
  // every cleanup of a commit before any setup, so `homeVisit` and `homePanes`
  // still describe the pane being left when this cleanup reads them.
  useEffect(() => {
    if (!appActive || !isFocused || overviewVisible || !padDetailIsPane) return;
    return () => {
      const visit = homeVisit.current;
      const { sessionId, panes } = homePanes.current;
      if (visit && isLiveHomeTerminalVisit(visit.target, sessionId, panes))
        void useHomeRecentsStore.getState().visit(visit.target, visit.title);
    };
  }, [appActive, isFocused, overviewVisible, padDetailIsPane, serverId]);
  const agentKind = useMemo(() => {
    if (!selectedAgent) return '';
    return (
      field(selectedAgent, 'kind') ||
      field(selectedAgent, 'agent') ||
      selectedAgent.title ||
      ''
    ).toLowerCase();
  }, [selectedAgent]);
  const isOpenCodeAgent = agentKind.includes('opencode') || agentKind.includes('open-code');

  // Which of the two readings of this pane is on screen: the conversation or
  // the raw grid. The hook owns the whole decision -- the setting, this pane's
  // own last choice, and what the pane can actually show -- so the screen only
  // has to say what each mode draws.
  const agentPane = Boolean(selectedAgent);
  const supportsAgentSessions = gatewaySupportsAgentSessions(data.health?.capabilities);
  const partsForPane = partsState.paneId === selection.paneId ? partsState : initialPartsState;
  const paneView = usePaneViewMode({
    serverId,
    paneId: selection.paneId,
    agent: agentPane,
    parts: partsForPane.supported,
    agentSessions: supportsAgentSessions && isOpenCodeAgent,
  });
  const chatViewChosen = paneView.mode === 'chat';
  // What the user asked for and what can actually be drawn are two different
  // things: a failed read falls back to the terminal without forgetting the
  // choice, so the view returns by itself once the gateway answers again.
  const chatViewShown =
    chatViewChosen && ((supportsAgentSessions && isOpenCodeAgent) || !partsForPane.failed);
  const hideTerminalDock = chatViewShown && supportsAgentSessions && isOpenCodeAgent;

  const refreshParts = useCallback(
    async (contentKey: string) => {
      const requestPaneId = selection.paneId;
      if (!ready || connection.phase !== 'connected' || !requestPaneId || !agentPane) return;
      if (!openSettled) return;
      // A page is being pulled in; letting the ordinary refresh land first would
      // replace the wider transcript with the narrower one under the reader.
      if (loadingEarlierPartsRef.current) return;
      const last = readPartsKeyRef.current;
      // Claimed before the request rather than after it, so the 1 s output
      // interval cannot stack a second read of the same content on the first.
      if (last.paneId === requestPaneId && last.contentKey === contentKey) return;
      readPartsKeyRef.current = { paneId: requestPaneId, contentKey };

      const requestId = ++partsRequestIdRef.current;
      const requestServerId = serverId;
      const isCurrentRequest = () =>
        activeServerRef.current === requestServerId &&
        activePaneRef.current === requestPaneId &&
        partsRequestIdRef.current === requestId;
      // Read at whatever window the reader has paged back to: a transcript is
      // re-read whole, so a refresh at the initial limit would silently throw
      // away every page they pulled in.
      const lineLimit = partsLineLimitRef.current;
      return recoverWith(
        async () => {
          const result = await listPaneParts(data.sessionId, requestPaneId, lineLimit);
          if (!isCurrentRequest()) return;
          setPartsState((current) => {
            const held = current.paneId === requestPaneId ? current : initialPartsState;
            const reconciled = reconcilePaneParts(held.parts, held.partsOffset, result.parts);
            return {
              paneId: requestPaneId,
              answered: true,
              supported: result.structured,
              failed: false,
              failures: 0,
              parts: reconciled.parts,
              partsOffset: reconciled.offset,
              composer: result.composer,
            };
          });
          const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
          earlierPartsRowsRef.current = paneTranscriptRows(result.parts);
          setCanLoadEarlierParts(
            hasEarlierPaneParts(result.parts, lineLimit, MAX_PANE_OUTPUT_LINES, scroll)
          );
        },
        () => {
          if (!isCurrentRequest()) return;
          // Silent on purpose: the structured view is an alternative reading of
          // output the user can already see, so a failure here is not an error
          // to report -- it drops back to the terminal and marks the toggle.
          setPartsState((current) => {
            const base = current.paneId === requestPaneId ? current : initialPartsState;
            return { ...base, paneId: requestPaneId, failed: true, failures: base.failures + 1 };
          });
        }
      );
    },
    [agentPane, connection.phase, data.sessionId, openSettled, ready, selection.paneId, serverId]
  );

  /**
   * The chat view's pull-down: widen the transcript window by one page.
   *
   * The terminal view's `loadEarlierOutput`, one endpoint over. It re-reads the
   * whole transcript rather than fetching only what is new, because parts are
   * spans of source rows and two reads of different windows cannot be stitched
   * together the way two windows of raw lines can.
   */
  const loadEarlierParts = useCallback(async () => {
    const requestPaneId = selection.paneId;
    const currentLimit = partsLineLimitRef.current;
    if (
      !ready ||
      connection.phase !== 'connected' ||
      !requestPaneId ||
      loadingEarlierPartsRef.current ||
      currentLimit >= MAX_PANE_OUTPUT_LINES
    )
      return;

    const requestId = ++partsRequestIdRef.current;
    const requestServerId = serverId;
    const nextLimit = Math.min(MAX_PANE_OUTPUT_LINES, currentLimit + PANE_OUTPUT_PAGE_LINES);
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId &&
      activePaneRef.current === requestPaneId &&
      partsRequestIdRef.current === requestId;

    loadingEarlierPartsRef.current = true;
    setLoadingEarlierParts(true);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            const result = await listPaneParts(data.sessionId, requestPaneId, nextLimit);
            if (!isCurrentRequest()) return;
            partsLineLimitRef.current = nextLimit;
            // This transcript was read under a wider window than the content key
            // describes, so the next change has to re-read rather than be skipped as
            // "already have that content".
            readPartsKeyRef.current = { paneId: '', contentKey: '' };
            setPartsState((current) => {
              const held = current.paneId === requestPaneId ? current : initialPartsState;
              const reconciled = reconcilePaneParts(held.parts, held.partsOffset, result.parts);
              return {
                paneId: requestPaneId,
                answered: true,
                supported: result.structured,
                failed: false,
                failures: 0,
                parts: reconciled.parts,
                partsOffset: reconciled.offset,
                composer: result.composer,
              };
            });
            const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
            const reachedRows = earlierPartsRowsRef.current;
            earlierPartsRowsRef.current = paneTranscriptRows(result.parts);
            setCanLoadEarlierParts(
              hasEarlierPartsAfterPage(
                result.parts,
                nextLimit,
                MAX_PANE_OUTPUT_LINES,
                scroll,
                reachedRows
              )
            );
          },
          () => {
            // Same silence as the ordinary read: the transcript already on screen is
            // still true, and the pull can simply be tried again.
            if (isCurrentRequest()) setCanLoadEarlierParts(false);
          }
        );
      },
      () => {
        if (isCurrentRequest()) {
          loadingEarlierPartsRef.current = false;
          setLoadingEarlierParts(false);
        }
      }
    );
  }, [connection.phase, data.sessionId, ready, selection.paneId, serverId]);

  useEffect(() => {
    if (!agentPane) return;
    // One answer per pane establishes whether there is a chat view at all,
    // which is what decides whether the cycle has a third stop. After that only
    // the view being looked at is kept fresh, so a user who stays on the
    // terminal never pays for a transcript nobody reads. A probe that keeps
    // throwing is retried on the next change a few times and then dropped.
    const settled = partsForPane.answered || partsForPane.failures >= MAX_PANE_PARTS_PROBES;
    if (settled && !chatViewChosen) return;
    // New content for this pane, however it was noticed (see
    // `panePartsRefreshKey` for why the revision alone is not enough), taken
    // straight from the output store: following it re-renders nothing here.
    const follow = () => {
      const { revision, window } = outputStore.get();
      void refreshParts(panePartsRefreshKey(revision, window.output));
    };
    follow();
    return outputStore.subscribe(follow);
  }, [
    agentPane,
    chatViewChosen,
    outputStore,
    partsForPane.answered,
    partsForPane.failures,
    refreshParts,
  ]);

  // The Lock Screen follows the panel the user is watching, so the card is
  // read off the same selection the screen already draws. Broken out into
  // strings because `data.agents` is replaced on every refresh: comparing the
  // entity itself would push an ActivityKit update on each poll.
  const liveActivityEnabled = useAppSettings((state) => state.liveActivityEnabled);
  const watchedAgentId = selectedAgent?.id ?? null;
  const watchedAgentName = selectedAgent?.title ?? '';
  const watchedAgentStatus = selectedAgent?.status ?? '';
  // Label or the agent's own name only: a pane's terminal title is the
  // conversation topic for an agent pane, and that does not belong on a Lock
  // Screen card.
  const watchedAgentDetail = [selectedWorkspace?.title, selectedPane?.label || selectedAgent?.title]
    .filter(Boolean)
    .join(' · ');
  // Deliberately without teardown on unmount: the card is meant to outlive this
  // screen, which is the whole point of glancing at it while the app is away.
  useEffect(() => {
    // An agent session in the detail column is not a pane being watched; the
    // card is left as it was rather than cleared, as Home leaves it.
    if (!padDetailIsPane) return;
    if (!liveActivityEnabled || !watchedAgentId) {
      void syncAgentActivity(null);
      return;
    }
    void syncAgentActivity({
      agentId: watchedAgentId,
      agentName: watchedAgentName,
      status: asAgentActivityStatus(watchedAgentStatus),
      detail: watchedAgentDetail,
    });
  }, [
    liveActivityEnabled,
    padDetailIsPane,
    watchedAgentDetail,
    watchedAgentId,
    watchedAgentName,
    watchedAgentStatus,
  ]);

  // The Android home-screen tile shows every agent, not just the watched one,
  // so it is fed the whole list this screen just loaded. Nothing is scheduled
  // here: the widget mirrors what the app already knows, and `syncAgentWidget`
  // drops a push that would not change the tile, so a poll that found no news
  // costs nothing. `data.agents` in the deps is deliberate for the same reason.
  const androidWidgetEnabled = useAppSettings((state) => state.androidWidgetEnabled);
  useEffect(() => {
    if (!androidWidgetEnabled || !selectedServer || !record) return;
    void syncAgentWidget({
      version: 1,
      serverId: record.serverId,
      serverLabel: record.label,
      sessionId: data.sessionId,
      checkedAtMs: Date.now(),
      agents: mirroredServerAgents(data.agents, data.panes).map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: asAgentWidgetStatus(agent.status),
        paneId: agent.paneId ?? '',
      })),
    });
  }, [androidWidgetEnabled, data.agents, data.panes, data.sessionId, record, selectedServer]);

  // The rail reads the same cached mirror as Classic Home. Successful refreshes
  // above record all panes with their resolved titles; initial/reset state and
  // cached first frames do not become new observations. The shared Home model
  // applies the reader's agent-only filter without rewriting stored snapshots.
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);

  useEffect(() => {
    void hydrateServerAgents();
  }, [hydrateServerAgents]);

  // And the same trick for what this gateway can do. The home card's `...` menu
  // has to decide whether to offer New Task about a server it is not connected
  // to, and this is the only screen that ever hears the answer. Unlike the
  // agent mirror this is not behind a setting: it gates an entry point rather
  // than drawing one, and a reader who turned the agent rows off did not ask to
  // lose a menu item.
  const recordServerCapabilities = useServerCapabilities((state) => state.record);
  // Whether this gateway serves captured pane history (`pullEarlierPage`).
  const servesCapturedHistory = useServerCapabilities(
    (state) => state.byServer[serverId]?.includes(PANE_CAPTURED_HISTORY_CAPABILITY) === true
  );
  const servesSegmentedHistory = useServerCapabilities(
    (state) =>
      state.byServer[serverId]?.includes(PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY) === true
  );
  useEffect(() => {
    if (!selectedServer || !record || isDemoRecord(record) || !data.health) return;
    void recordServerCapabilities(record.serverId, data.health.capabilities);
  }, [data.health, record, recordServerCapabilities, selectedServer]);

  // The pane's viewport height separates the served historical prefix from
  // its mutable screen. A missing metric keeps ordinary reads on their fallback.
  const selectedPaneScreenRows = terminalViewportRows(displayPane?.raw.scroll) ?? 0;
  const capturedViewportReady = selectedPaneScreenRows > 0;
  // Does the open pane have captured rows above the window? One row is asked
  // for: both `not_captured` and an empty capture can precede the first sample.
  // Keep the native-scrollback fallback and probe again after output advances.
  useEffect(() => {
    const paneId = selection.paneId;
    const sessionId = data.sessionId;
    if (
      !ready ||
      !servesCapturedHistory ||
      servesSegmentedHistory ||
      !paneId ||
      !sessionId ||
      !record
    )
      return;
    // Once per pane and per ask: a pull already under way, or a history
    // already given in full, knows more than this would.
    // Boundary discovery is a new ask even when the first probe already saw
    // rows. Otherwise an early successful probe could leave history hidden.
    const key = `${paneId}\u0000${capturedProbe}\u0000${capturedViewportReady}\u0000${servesSegmentedHistory}`;
    if (
      !capturedProbeDue({
        off: capturedOffRef.current,
        exhausted: capturedExhaustedRef.current,
        cursor: capturedCursorRef.current,
        askedAlready: capturedProbedKeyRef.current === key,
      })
    ) {
      return;
    }
    capturedProbedKeyRef.current = key;
    let current = true;
    capturedProbedAtRef.current = Date.now();
    const probedOutput = outputStore.get().window.output;
    const probeRead = readPaneHistory(sessionId, paneId, null, 1).then(capturedProbeState);
    void probeRead.then((probe) => {
      if (!current || activePaneRef.current !== paneId) return;
      // A pull landed meanwhile: its answer stands.
      if (
        loadingEarlierOutputRef.current ||
        capturedExhaustedRef.current ||
        capturedCursorRef.current ||
        capturedRefreshRequiredRef.current
      )
        return;
      capturedOffRef.current = probe.off;
      // Empty, or no answer: worth asking again as output grows.
      capturedEmptyRef.current = probe.empty;
      setCapturedEmptyProbe(capturedEmptyRef.current ? { output: probedOutput } : null);
      // A window already at its cap has no room for more above it.
      offerCaptured(
        paneId,
        probe.hasRows &&
          paneScreenRowsRef.current > 0 &&
          outputLineLimitRef.current < MAX_PANE_OUTPUT_LINES
      );
    });
    return () => {
      current = false;
    };
  }, [
    capturedProbe,
    data.sessionId,
    ready,
    selection.paneId,
    servesCapturedHistory,
    servesSegmentedHistory,
    capturedViewportReady,
    outputStore,
    record,
  ]);
  // A pane with nothing captured yet gains rows as its output scrolls: ask
  // again, at most every CAPTURED_REPROBE_MS, while output keeps coming.
  // Watched from the store rather than rendered from it, so the output going
  // by re-renders nothing here: the first change past the probe sets the one
  // timer, and later frames leave it be.
  useEffect(() => {
    if (capturedOpen || !servesCapturedHistory || servesSegmentedHistory) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (timer) return;
      const remaining = capturedReprobeDelay(
        capturedEmptyProbe?.output ?? null,
        outputStore.get().window.output,
        capturedProbedAtRef.current,
        Date.now(),
        CAPTURED_REPROBE_MS
      );
      if (remaining === null) return;
      timer = setTimeout(() => setCapturedProbe((probe) => probe + 1), remaining);
    };
    check();
    const unsubscribe = outputStore.subscribe(check);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [
    outputStore,
    capturedOpen,
    capturedEmptyProbe,
    servesCapturedHistory,
    servesSegmentedHistory,
  ]);

  // Whether this pane is an editor, which is what "is this a full-screen
  // program" means until `alternate_on` is plumbed through -- see
  // `isFullScreenTuiPane`'s own doc for the two questions this conflates and
  // why that is safe today (agent panes never match an editor name, so
  // nothing about them changes).
  //
  // Four decisions hang off this one fact -- which output to read, whether a
  // send needs Enter after it, whether the grid clears the floating header, and
  // whether the editor's own commands go on the key row. `foreground_command`
  // is the field that makes this correct on a pane like `%27` in the card #795
  // report: a shell that exec'd nvim never rewrites its tmux pane title, so
  // both the title and the gateway's own title-derived `profile` still say
  // `shell` for as long as the pane lives, and only `foreground_command`
  // (`#{pane_current_command}`) tracks what the pane is actually running.
  //
  // Read off `paneReading`, which answers this and the three questions below
  // it from the same two fields -- see its docblock for why the shape in
  // particular has exactly one spelling in this app.
  // Which keys and slash commands this pane responds to is the gateway's
  // answer (`usePaneShortcuts`). Asked again on every keyboard open, so a
  // shell that has just started an agent gets its chords back without a pane
  // switch, and whenever the pane's title turns: a pane opened as a shell
  // would otherwise keep its 'shell' profile for as long as it lived, and a
  // resolved profile outranks the editor title fallback by design. Held back
  // until the opening frame is out (`openSettled`).
  const selectedPaneTitle = displayPane ? field(displayPane, 'terminal_title_stripped') : null;
  const shortcuts = usePaneShortcuts({
    sessionId: data.sessionId,
    paneId: selection.paneId,
    enabled: ready && connection.phase === 'connected' && openSettled,
    refreshKey: `${keyboardOpens}\u0000${selectedPaneTitle ?? ''}`,
  });
  const selectedPaneReading = paneReading(selectedPane, shortcuts?.profile);
  const fullScreenPane = selectedPaneReading.editor;
  /*
    An editor arrives bare.

    This opened the keyboard on arrival, and the argument for it was sound as
    far as it went: an editor is driven a keystroke at a time, and the composer
    -- a line buffer that needs Enter -- is the wrong instrument. What it
    produced was not an editor, though. It was nvim in the top third of a phone
    with the app's QWERTY under it, on a screen the reader most often opened to
    *read* a file. The maintainer's rule for these panes: if nvim is open then
    this is a whole nvim, and a whole nvim is the whole pane.

    So the arrival is now the opposite: the dock leaves (`dock.editorMode`) and
    the keyboard stays down behind a floating handle, one tap away. Keyed on the
    pane, exactly as before, so a reader who opened the panel keeps it open for
    as long as they are on this pane.
  */
  const lazygitPane = isLazygitPane(
    shortcuts?.profile,
    field(selectedPane, 'terminal_title_stripped'),
    field(selectedPane, 'foreground_command')
  );
  const autoKeyboardPaneRef = useRef<string | null>(null);
  useEffect(() => {
    const paneId = selection.paneId;
    if (!paneId || !fullScreenPane) return;
    if (autoKeyboardPaneRef.current === paneId) return;
    autoKeyboardPaneRef.current = paneId;
    setKeyboardMode(false);
  }, [fullScreenPane, selection.paneId]);

  /**
   * Where the reader parked the editor's floating button. Two axes, because
   * the button is dragged in two and rests against a rail rather than on a
   * track.
   *
   * Held by the screen rather than by the component so it survives leaving nvim
   * and coming back, and switching to another pane and back: a reader who moved
   * the button off the line they were editing has said something, and saying
   * it again on every arrival is the defect the drag exists to fix.
   */
  const editorHandleX = useSharedValue(0);
  const editorHandleY = useSharedValue(0);

  // Leaving the pane, or the keyboard, ends the visit a revealed composer
  // belonged to: the next arrival starts with the file having the height again.
  useEffect(() => {
    if (!keyboardMode) setComposerRevealed(false);
  }, [keyboardMode, selection.paneId]);

  // A ref mirror of the value above, synced a layout effect ahead of paint.
  // `applyPaneOutput` reads this instead of closing over `fullScreenPane`
  // directly: the 1-second poll and an SSE frame push both call it, and one of
  // them can still be in flight from an older render's closure when the other
  // lands. Measured live (card #795, defect 2): two overlapping reads of a
  // pane just detected as an editor -- one issued a moment before detection
  // flipped, one after -- can disagree about whether the pane owns its
  // screen, and the older one folds the newer one's text underneath itself
  // instead of replacing, byte for byte the two-stacked-frames bug the
  // ownsScreen bypass exists to prevent. A closure captures the value at the
  // render that created it; this ref always holds the latest one, so both
  // calls agree by the time either actually applies its read, however late it
  // resolves.
  const fullScreenPaneRef = useRef(fullScreenPane);
  useLayoutEffect(() => {
    fullScreenPaneRef.current = fullScreenPane;
  }, [fullScreenPane]);
  /**
   * What the fold is told about the pane, as opposed to about the program.
   *
   * `alternate_on` and the command heuristic disagree, and the disagreement is
   * the defect: a real nvim pane reported `alternate_on: true` while
   * `isFullScreenTuiPane` did not recognise it, so its read was folded into
   * scrollback as if the pane were printing -- putting the shell prompt it was
   * launched from above nvim's own first line. What is *drawn* is a fact about
   * the pane, so the fold reads these; the chrome (the key row, the editor
   * controls, the surface) keeps following the editor predicate, because that
   * is a question about what the reader is driving.
   */
  const paneOwnsScreenRef = useRef(false);
  // Whether the pane's program has taken the whole screen, which is a different
  // question from whether it is an editor and has to be asked separately.
  // `alternate_on` is 1 for an agent as well as for nvim, so this is true of
  // both; `fullScreenPane` above is true of nvim only. The surface follows this
  // one -- what clears the floating header, and whose colours the grid must
  // stop resolving against the app theme -- while the key row and the mode
  // follow the editor one.
  //
  // Falls back to `fullScreenPane` rather than to `false` when the gateway did
  // not say: against a gateway too old to send the field, an editor keeps the
  // clearance it already had and nothing regresses. An agent's pane on that
  // same old gateway stays as it was too, which is the bug this fixes -- but
  // only a gateway that reports the field can fix it, and pretending otherwise
  // would mean guessing from the pane's name.
  const paneOwnsScreen = selectedPaneReading.ownsScreen;
  // The pane's own width, as the gateway reports it -- the authoritative grid
  // size, not the widest-line guess `parseTerminalSnapshot` falls back to when
  // this is absent. `undefined` (rather than 0) for a pane the gateway did not
  // report a width for, so the parser's own inference stays untouched.
  const selectedPaneColumns = displayPane
    ? numberField(displayPane, 'width') || undefined
    : undefined;
  // The other axis of the same report, and read for the same reason: the pane's
  // own grid is what the snapshot should be laid out on, rather than however
  // many lines the read happened to return. `undefined` for a gateway that did
  // not say -- a herdr pane on a gateway older than the one that reads the
  // shell's own terminal size for it -- which leaves the parser's own
  // measurement in charge exactly as it is now.
  const selectedPaneRows = displayPane
    ? numberField(displayPane, 'height') || undefined
    : undefined;
  // Where the program is actually working, when the gateway knows. Nothing
  // sends these yet; they are read as optional so a gateway that starts sending
  // them needs no app change, and their absence is a documented case of
  // `terminalOpenView` rather than a hole in it.
  // `optionalNumberField`, not `numberField`: a cursor's 0 is the first column,
  // so the "absent" answer has to be distinguishable from it. Read through
  // `numberField` instead, every pane on today's gateway -- which sends neither
  // field -- would claim a cursor in its top-left corner and be placed there,
  // which is the exact position this change exists to stop.
  const selectedPaneCursorColumn = optionalNumberField(displayPane, 'cursor_x');
  const selectedPaneCursorRow = optionalNumberField(displayPane, 'cursor_y');

  // nvim's own mode, read off the screen it just painted rather than asked
  // for -- tmux's formats carry nothing about it (`#{pane_mode}` is empty for
  // an nvim pane). Gated on `fullScreenPane`, the same "is this actually an
  // editor" answer the row and the layout already trust -- which now already
  // incorporates `foreground_command` (see `fullScreenPane` above), so this
  // does not need a signal of its own. Parsed from the same text every other
  // reader of pane content uses, not a second request -- this is a fact about
  // a frame the app already has. Subscribed as the answer alone, so the
  // frames an editor paints re-render this screen only when the mode turns.
  const nvimMode = usePaneOutput(outputStore, ({ window }) =>
    fullScreenPane ? nvimModeOf(window.output, selectedPaneColumns) : null
  );

  // What this pane's backend says it can deliver, from the discovery mirror.
  // Asked again whenever the screen connects, so a tmux whose extended-keys
  // option changed is seen on the next visit. Undefined on a gateway older
  // than the field, which keeps the SSH encoder as the judge.
  useAgentsDiscoveryRefresh(serverId, ready && connection.phase === 'connected' && openSettled);
  const terminalPlane = useAgents((state) => state.index.servers[serverId]?.terminal ?? null);
  const backendVocabulary = vocabularyForSession(terminalPlane, data.sessionId);
  // A gateway with no terminal backend running answers with an empty session
  // rather than an error, and a pane never arrives on its own -- so without
  // this the canvas's loader spun forever (iOS pass, finding 1).
  const backendState = useMemo(
    () =>
      terminalBackendState({
        loaded: hasLoadedData,
        paneCount: data.panes.length,
        backends: terminalBackendRows(backendSessions, terminalPlane),
        plane: terminalPlane,
        sessionId: data.sessionId,
        unreachable: backendUnreachable,
      }),
    [
      backendSessions,
      backendUnreachable,
      data.panes.length,
      data.sessionId,
      hasLoadedData,
      terminalPlane,
    ]
  );
  // Retry asks discovery again as well as the workspace: the backend rows and
  // the hint read discovery, which the connected-only refresh above would not
  // re-ask while the backend is down. The nonce restarts the poller, whose
  // first read is immediate and whose result updates the state.
  const retryBackend = useCallback(() => {
    void refreshAgentsDiscovery(serverId, undefined, { force: true });
    setRetryNonce((value) => value + 1);
  }, [serverId]);
  // Narrowed by the pane's own answer: tmux can speak extended keys and the
  // program in this pane may still not have asked for them.
  const paneExtended = shortcuts?.keyboard?.extended;
  const keyVocabulary = useMemo(
    () => paneVocabulary(backendVocabulary, paneExtended),
    [backendVocabulary, paneExtended]
  );

  // The gateway lists a key like `⌃↵` whatever the backend can deliver; a key
  // this pane cannot take is left off the row rather than drawn as a tap that
  // fails. A sequence (`["\\", "enter"]`) is offered when each of its keys is.
  // Only with a vocabulary: without one, nothing was filtered before.
  const deliverableKey = useCallback(
    (item: TerminalKey) => keyDeliverable(item, keyVocabulary),
    [keyVocabulary]
  );

  // The row follows what the pane is actually running: an agent's own actions,
  // an editor's motions, or shell line editing.
  // Ordered by how often these keys have actually been pressed, for this server
  // and this kind of pane. Recomputed when the pane changes, never on a tap: a
  // row that rearranges under a thumb is worse than one a session out of date.
  const terminalKeys = useMemo(
    () =>
      resolveTerminalKeys({
        serverId,
        shortcuts,
        vocabulary: keyVocabulary,
        fullScreenPane,
        lazygitPane,
        nvimMode,
      }),
    [fullScreenPane, keyVocabulary, lazygitPane, nvimMode, serverId, shortcuts]
  );
  const keyScope = shortcuts ? usageScope(serverId, shortcuts.profile, 'keys') : null;
  // Typing "/" in an agent pane offers what that agent actually accepts.
  //
  // The catalog is the gateway's per-pane composer descriptor, which rides on
  // the parts envelope the screen already reads. A gateway too old to carry one
  // still has the shortcuts endpoint, whose command list is the same data under
  // an older name, so the picker degrades to that rather than to nothing; with
  // neither, `slashCatalog` is empty and "/" is an ordinary character -- no
  // panel, no request, nothing rendered.
  const slashCatalog = useMemo<PaneSlashCommand[]>(() => {
    const descriptor = partsForPane.composer;
    if (descriptor && descriptor.slashCommands.length > 0) return descriptor.slashCommands;
    if (!shortcuts || shortcuts.commands.length === 0) return [];
    return shortcuts.commands.map((entry) => ({
      name: entry.command,
      description: entry.description ?? '',
      argsHint: entry.argument_hint ?? '',
      source: entry.source === 'workspace' ? 'workspace' : 'builtin',
    }));
  }, [partsForPane.composer, shortcuts]);
  const slashTrigger = useMemo(() => slashCommandTrigger(slashCatalog), [slashCatalog]);
  const slashPopup = useDraftStoreComposerPopup({ store: draftStore, trigger: slashTrigger });

  // -- @ file mentions ------------------------------------------------------
  //
  // Gated on the pane's own composer descriptor, which rides the parts answer.
  // Not merely "false when the gateway is old": a gateway that has never heard
  // of the flag, an agent with no command table, and an agent that does not do
  // `@` mentions all land in the same place, which is `@` being an ordinary
  // character. The picker is opt-in, so nothing about typing changes until a
  // gateway says this pane can use it.
  const fileMentionsEnabled =
    partsForPane.composer?.fileMentions === true && Boolean(agentPane) && !sending;
  const mentionTrigger = useStoreSelector<ComposerDraft, FileMentionTrigger | null>(
    draftStore,
    (draft) =>
      fileMentionsEnabled
        ? findFileMentionTrigger(draft.text, draft.caret ?? draft.text.length)
        : null,
    sameMentionTrigger
  );
  // The span itself is the dependency for the request, not the object, which is
  // rebuilt on every keystroke; the query and its position are what change.
  const mentionQuery = mentionTrigger?.query ?? null;
  const mentionSessionRef = useLatestRef({
    sessionId: data.sessionId,
    paneId: selection.paneId,
  });
  // One search for the life of the screen: it owns the debounce and the
  // generation counter, so a second instance would mean two sets of in-flight
  // reads racing to answer the same panel.
  const mentionSearchRef = useLazyRef<FileMentionSearch>(() =>
    createFileMentionSearch({
      search: (query) => {
        const { sessionId, paneId } = mentionSessionRef.current;
        if (!sessionId || !paneId) return Promise.resolve([]);
        return listPaneFiles(sessionId, paneId, query, FILE_MENTION_LIMIT);
      },
      // Only the newest generation reaches here, so the results are always for
      // what is on screen now; a slow answer for an older prefix is dropped
      // inside the search rather than filtered out again here.
      onResults: (_query, hits) => setMentionHits(hits),
    })
  );

  useEffect(() => {
    const search = mentionSearchRef.current;
    if (!search) return;
    if (mentionQuery === null) {
      // Closed: drop the timer and invalidate anything in flight, so a reply
      // that lands after the panel is gone cannot reopen it.
      search.cancel();
      setMentionHits([]);
      return;
    }
    // A bare `@` is the opening screen and should not wait out the debounce --
    // there is nothing to coalesce yet. Everything after it is typing.
    search.request(mentionQuery, { immediate: mentionQuery.length === 0 });
  }, [mentionQuery, mentionSearchRef]);

  // Switching panes changes the workspace the paths are relative to, so nothing
  // from the old one may stay on screen.
  useEffect(() => {
    mentionSearchRef.current?.cancel();
    setMentionHits([]);
  }, [mentionSearchRef, selection.paneId]);

  useEffect(() => () => mentionSearchRef.current?.cancel(), [mentionSearchRef]);

  const chooseMention = useCallback(
    (hit: FileMentionHit) => {
      if (!mentionTrigger) return;
      const next = insertFileMention(draftStore.getState().text, mentionTrigger, hit.path);
      // Both: the stored caret is what closes the picker on the very next
      // render, and the prop is what actually moves the platform caret.
      // Leaving either out shows the panel for a frame after the pick.
      setDraft(next.text, next.caret);
      setPendingCaret(next.caret);
      mentionSearchRef.current?.cancel();
      setMentionHits([]);
    },
    [draftStore, mentionSearchRef, mentionTrigger, setDraft]
  );

  // `onScreen`, not `ready`: a sheet sliding up over the composer must not also
  // unmount it, or it is seen to blink out from under the sheet -- and every
  // layout inset below is derived from this. See `onScreen`.
  // Data in hand is enough. The warm snapshot Home prefetched paints the pane on
  // the first frame, and the dock used to wait on top of it for this screen's
  // own first refresh (health, sessions and the session snapshot -- several
  // round trips, each a tmux fork on the gateway) before drawing at all. On a
  // loaded Mac that was the 3-6 s the iOS pass saw the dock arrive after the
  // terminal. Its shortcuts and vocabulary fill in as they land.
  const composerVisible =
    onScreen &&
    (((hasLoadedData || !loadingData) && Boolean(selectedPane) && targetReady) ||
      // The route's pane, landed on before the snapshot: the dock mounts a
      // frame after the canvas, while the pane's first read is still out,
      // instead of as one blocking commit once the snapshot confirms it. Its
      // controls stay disabled until `targetReady`, as they already were.
      (dockArmed &&
        Boolean(landing.paneId) &&
        selection.paneId === landing.paneId &&
        !targetUnavailable));
  // Attachments are the gateway's own upload endpoint, which the bundled demo
  // data has no counterpart for.
  const attachmentsAvailable = composerVisible && !demoMode;
  // A staged file is worth sending on its own; it started uploading the moment
  // it was picked, so Send is usually only collecting paths that already exist.
  const hasDraftText = useStore(draftStore, (draft) => draft.text.trim().length > 0);
  const hasSendableContent = hasDraftText || attachments.length > 0;
  /**
   * Whether the next send starts an assistant instead of typing into this pane.
   *
   * The composer already talks to the agent in front of the reader; this is the
   * one collaboration action that has nowhere better to live, because everything
   * it needs -- the text, the attachments, the cwd -- is already here. Handing
   * work to an assistant that is *not* on screen stays refused; see
   * `supportsExistingAgentDelivery`.
   */
  // In an effect rather than during render. Files are staged from an event
  // handler, which always runs after the effects for the render that put that
  // pane on screen, so the destination a file records is still this pane's.
  useEffect(() => {
    attachmentDestinationRef.current =
      selection.paneId && data.sessionId
        ? {
            serverId,
            sessionId: data.sessionId,
            sourcePaneId: selection.paneId,
            connectionGeneration: ATTACHMENT_CONNECTION_GENERATION,
          }
        : undefined;
  }, [serverId, data.sessionId, selection.paneId]);
  /**
   * Whether a task can be assigned in this session, and if not, what would fix
   * it -- the Gateway's own answer about *this* session, never a constant.
   *
   * It replaces `AGENT_SPAWN_SHIPPED`, which answered "no" to every gateway on
   * every machine and so made the strip unreachable in a shipped build. The
   * capability answer is the switch now, and `collaborationAvailability` turns
   * it into one of five words rather than a boolean, because a `no` has to name
   * the upgrade that would help: Herdr's, the Gateway's, or neither.
   *
   * `backendKind` comes from the session list rather than from `/health`,
   * because that is what the reader actually switched to; a legacy gateway that
   * names no backend means Herdr, which is what `SessionChoice` fills in.
   */
  const collaborationReason = useMemo(
    () =>
      data.health
        ? collaborationAvailability(
            data.health,
            data.sessionId,
            sessions.find((session) => session.id === data.sessionId)?.kind ?? ''
          )
        : ('unavailable' as const),
    [data.health, data.sessionId, sessions]
  );
  /**
   * Fetch the agent catalog once, the first time the reader opens the menu that
   * shows it. It describes the host rather than this pane, so one fetch per
   * mount is enough; a failure leaves the list empty and the menu is exactly
   * what it was before assistants could be started from it.
   */
  const loadAssistantKinds = useCallback(async () => {
    if (assistantKinds.length > 0) return;
    if (!gatewaySupportsAgentSpawn(data.health?.capabilities)) return;
    if (collaborationReason !== 'ready') return;
    try {
      const profiles = await loadAgentProfiles();
      setAssistantKinds(profiles);
    } catch {
      // Silent: the menu still attaches files, which is what it was opened for.
    }
  }, [assistantKinds.length, collaborationReason, data.health?.capabilities]);
  const assignment = useComposerAssignment({
    serverId,
    sessionId: data.sessionId,
    sourcePaneId: selection.paneId,
    tabId: selection.tabId,
    cwd: field(selectedPane, 'cwd'),
  });
  /**
   * The other assistants in this session, from the poll this screen already
   * runs. No extra request: `data.agents` and `data.panes` are refreshed for
   * the pane strip, and this is the same join `collaborationAgents` has always made.
   */
  const assignmentCandidates = useMemo(() => {
    // The assistant in front of the reader leads the row.
    //
    // `collaborationAgents` excludes the source pane, and that was right when
    // this was "delegate to someone else". The strip is not that: it answers
    // "who is this for", and the one on screen is a legitimate answer -- often
    // the intended one. Pressing a shortcut that carries instructions while
    // looking at codex and being offered only claude is the case that showed
    // it. It is also the safest target of the three: sending to it is the
    // ordinary composer send, over a pane whose output is streaming, and no
    // instance-bound contract is needed to make it honest.
    const others = collaborationAgents(
      data.agents,
      data.panes,
      selection.paneId,
      selection.workspaceId
    );
    const here = data.agents.find((agent) => field(agent, 'pane_id') === selection.paneId);
    const current = here
      ? [
          {
            paneId: selection.paneId,
            instanceId: field(here, 'instance_id'),
            name: panelTitle(selectedPane, here),
            status: here.status ?? 'unknown',
            cwd: field(selectedPane, 'cwd'),
            sameWorkspace: true,
          },
        ]
      : [];
    return [...current, ...others].flatMap((candidate) =>
      candidate.instanceId ? [candidate] : []
    );
  }, [data.agents, data.panes, selection.paneId, selection.workspaceId, selectedPane]);
  // PDFs and videos use the shared viewer. The image viewer pages between images,
  // so the tapped tile's position is resolved within that subset.
  const previewImages = useMemo<PreviewImage[]>(
    () =>
      attachments
        .filter((item) => isImageAttachment(item.mime))
        .map((item) => ({ id: item.id, uri: item.localUri })),
    [attachments]
  );
  const previewAttachment = attachments.find((item) => item.id === previewAttachmentId);
  const previewFile =
    assetFromLocalVideo(previewAttachment) ?? assetFromLocalPdf(previewAttachment);
  const previewIndex = previewAttachmentId
    ? previewImages.findIndex((item) => item.id === previewAttachmentId)
    : -1;
  useLayoutEffect(() => {
    paneOwnsScreenRef.current = paneOwnsScreen;
    paneScreenRowsRef.current = selectedPaneScreenRows;
  }, [paneOwnsScreen, selectedPaneScreenRows]);

  const outputSource = selectedPaneReading.source;
  // The pair that says what a window is a window *of*. A pane can change shape
  // while nobody is looking -- a shell hands its tty to nvim and the source it
  // has to be read from turns with it -- so a remembered window is only handed
  // back to a pane still being read the same way. See `PaneWindow.shape`.
  //
  // It also records whether the pane owns the screen. Entering and leaving an
  // alternate screen is a change of picture, not of depth: nvim's frame and the
  // shell's scrollback are two windows of one pane, and folding either into the
  // other is what put a prompt above nvim's first line. Carried here, the
  // boundary is crossed the way a pane switch is -- the main-screen window is
  // filed on the way in and handed back whole on the way out, which is the
  // reader's history surviving the editor.
  const outputShape = selectedPaneReading.shape;
  // Matches the terminal surface exactly, whichever pack is showing -- read
  // from the same palette the renderer draws with rather than restated, so the
  // chrome behind the grid can never be a shade off it.
  const terminalBackground = useTerminalTheme().background;
  // Chrome floats over the terminal, which now follows the selected pack. The
  // control tint therefore comes from that pack's text hue, not from two
  // mode-only blue-grey literals.
  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  // The live values of everything the window is made of, so the pane being
  // left can be remembered from a cleanup that closed over its id and nothing
  // else. Refs rather than a dependency list on purpose: adding `output` to
  // the switch effect's deps would re-run the switch on every fold.
  const canLoadEarlierOutputRef = useLatestRef(canLoadEarlierOutput);
  const outputShapeRef = useLatestRef(outputShape);
  /**
   * The shape the window *currently on screen* is made of -- which is not
   * `outputShapeRef` at the moment a pane is left.
   *
   * `useLatestRef` is written during render, so on the render that changes the
   * selection it already holds the incoming pane's shape, and the cleanup that
   * remembers the outgoing pane's window runs after that render. Reading it
   * there would file a shell's scrollback under an editor's screen.
   *
   * So this follows the reads instead of the render: it is set wherever a read
   * is folded in, and wherever a window is restored, which by construction is
   * every way the window can come to be. A shape that turns mid-pane -- a
   * shell handing its tty to nvim -- is picked up on the first read after the
   * turn, with no special case.
   */
  const heldShapeRef = useRef(outputShape);

  /**
   * The window exactly as it stands, in the one shape the cache stores.
   *
   * A callback rather than eight reads written out in the cleanup below, and
   * not only for tidiness: the usual advice about refs in a cleanup -- copy
   * `.current` into a variable on the way in -- is exactly wrong here. These
   * are not nodes whose identity may have gone stale; they *are* the window's
   * depth, and a copy taken when the effect ran would have missed every fold
   * since. What is wanted is the value as of the last render of the pane being
   * left, which is what these hold at the moment the cleanup runs.
   */
  /**
   * Hand the pane being left over to the cache, and hand the pane arriving its
   * window back -- both during the render that changes the selection.
   *
   * During render, and not from an effect, for exactly the reason
   * `useCoalescedValue` adjusts its own state during render: the frame that
   * carries the new pane's terminal id is the frame that must carry the new
   * pane's window. The canvas throttles the snapshots it parses and records,
   * and it flushes that throttle on the render the terminal id changes in --
   * stamping a fresh window as it goes. A restore arriving one render later
   * therefore lands *inside* a window it has to wait out, and the switch pays
   * a full coalescing interval it was supposed to avoid. Measured on the
   * loopback lab it was the difference between a first frame at 33 ms and one
   * at 254 ms, on a switch that had the answer in hand the whole time.
   *
   * Both halves belong here, in this order, and not one here and one in an
   * effect. The outgoing window has to be read while `output` and the depth
   * refs still describe it, which is true on this render and false on the next
   * one; and the recall has to see the cache the remember has already written
   * to, or a switch straight back would miss what it had just put down.
   *
   * `useResetSignal` is what makes this run once per switch rather than every
   * render -- see its docblock, which describes this case by name.
   */
  const paneSwitched = useResetSignal(`${selection.paneId}|${outputShape}`);
  // The handoff itself lives in `usePaneWindowHandoff` -- the same statements,
  // run here, in this render -- so React Compiler can compile this component
  // around it. See the hook's docblock.
  usePaneWindowHandoff(paneSwitched, {
    outputStore,
    paneId: selection.paneId,
    outputShape,
    paneCacheRef,
    paneWindowOwnerRef,
    heldShapeRef,
    outputLineLimitRef,
    canLoadEarlierOutputRef,
    earlierOutputRowsRef,
    rangeUnsupportedRef,
    lastReadRef,
    capturedHereRef,
    setCanLoadEarlierOutput,
  });
  // A window the handoff put down during that render reaches the store's
  // other readers once the commit is in, before paint.
  useLayoutEffect(() => {
    outputStore.flush();
  });

  // Clearing belongs here rather than in the poller: opening a sheet over the
  // terminal unfocuses this screen, and blanking on every refocus made the
  // output flash even though the pane never changed.
  //
  // The window itself is no longer set here -- it is adjusted during the
  // switch render above, where the canvas can see it on the same frame. What
  // is left is everything that is only ever read after the commit: the request
  // generations, the depth the next read asks at, and the transcript's own
  // state. Restoring those here rather than during render keeps the render
  // free of writes that a discarded render would have to undo.
  //
  // A *layout* effect rather than an ordinary one so the depth refs agree with
  // the window before anything can read them -- the 1 s refresh and the event
  // stream both fire after the commit, and an effect that ran after paint
  // would leave a restored window paired with the previous pane's depth for
  // one frame's worth of requests.
  useLayoutEffect(() => {
    const paneId = selection.paneId;
    // The same recall the switch render made, against a cache nothing can have
    // changed in between: no request can land between a render and its own
    // layout effect. Asked again rather than carried across in a ref, which
    // would be a render-time write for the sake of skipping a find over at
    // most four entries.
    const restored = recallPaneWindow(paneCacheRef.current, paneId, outputShapeRef.current);
    heldShapeRef.current = outputShapeRef.current;
    outputRequestIdRef.current += 1;
    outputLineLimitRef.current = restored?.lineLimit ?? INITIAL_PANE_OUTPUT_LINES;
    earlierOutputRowsRef.current = restored?.earlierRows ?? 0;
    lastReadRef.current = restored?.lastRead ?? null;
    rangeUnsupportedRef.current = restored?.rangeUnsupported ?? false;
    // The pane's captured history as it was left, only with the window it was
    // filed with, and only from this connection; otherwise it is asked again.
    const filed = restored?.output
      ? (restored.captured as CapturedPaneState | undefined)
      : undefined;
    const captured =
      filed && filed.generation === capturedGenerationRef.current ? filed : undefined;
    capturedHereRef.current = captured ?? null;
    capturedCursorRef.current = captured?.cursor ?? null;
    capturedOffRef.current = captured?.off ?? false;
    capturedRefreshRequiredRef.current = captured?.refreshRequired ?? false;
    capturedRefreshApprovedRef.current = false;
    capturedEmptyRef.current = captured?.empty ?? false;
    setCapturedEmptyProbe(captured?.empty ? { output: restored?.output ?? '' } : null);
    capturedExhaustedRef.current = captured?.exhausted ?? false;
    setCapturedOpen(captured?.open ?? false);
    if (!captured) setCapturedProbe((probe) => probe + 1);
    loadingEarlierOutputRef.current = false;
    setLoadingEarlierOutput(false);
    setHistoryNotice(captured?.refreshRequired ? historyRefreshNotice() : null);
    historyPullBlockedRef.current = captured?.refreshRequired ?? false;
    setHistoryPullBlocked(historyPullBlockedRef.current);
    setHistoryRevision(0);
    // The revision the restored window was folded to, so the refresh that
    // follows is a reconciliation rather than a repeat, and an event merely
    // restating what is already on screen is ignored exactly as it would have
    // been had the pane never been left.
    readRevisionRef.current = { paneId, revision: restored?.revision ?? -1 };
    // The transcript is deliberately not cached. A part is a claim about a
    // span of source rows rather than a rectangle of them, so two reads of
    // different windows cannot be stitched together (see `loadEarlierParts`),
    // and a transcript restored under a window it was not read at would be a
    // quiet lie about what the pane said. The chat view keeps the behaviour it
    // has always had, whole.
    partsLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierPartsRowsRef.current = 0;
    loadingEarlierPartsRef.current = false;
    setLoadingEarlierParts(false);
    setCanLoadEarlierParts(false);
    partsRequestIdRef.current += 1;
    readPartsKeyRef.current = { paneId: '', contentKey: '' };
    setPartsState(initialPartsState);
  }, [outputShape, outputShapeRef, selection.paneId]);

  useEffect(() => {
    if (!requestedPaneId || !data.health) return;
    const targetKey = [
      serverId,
      requestedSessionId ?? data.sessionId,
      requestedPaneId,
      notificationId ?? 'route',
    ].join(':');
    if (appliedNotificationTargetRef.current === targetKey) return;
    const target = selectionForPane(data, requestedPaneId);
    appliedNotificationTargetRef.current = targetKey;
    if (target.paneId === requestedPaneId) {
      setSelection(target);
      setError(null);
    } else {
      setError(t`This terminal is no longer available.`);
    }
  }, [data, notificationId, requestedPaneId, requestedSessionId, serverId, t, setSelection]);

  useEffect(() => {
    if (!activeStrictTarget || !data.health) return;
    if (snapshotGeneration < activeStrictTarget.afterGeneration) return;
    if (
      !strictRequestedWorkspaceId &&
      !strictRequestedTabId &&
      !strictRequestedPaneId &&
      !activeStrictTarget.sessionId
    )
      return;
    const availability = classifyHomeTargetAvailability({
      explicit: true,
      snapshot: 'confirmed',
      targetSessionId: requestedSessionId,
      targetPaneId: strictRequestedPaneId,
      currentSessionId: data.sessionId,
      availableSessionIds: sessions.map((session) => session.id),
      availablePaneIds: data.panes.map((pane) => pane.id),
    });
    if (availability.kind === 'pending') return;
    if (availability.kind === 'missing-pane' || availability.kind === 'missing-session') {
      appliedNotificationTargetRef.current = null;
      setMissingRequestedTarget(availability);
      setError(t`This terminal is no longer available. Choose another terminal.`);
      return;
    }
    if (strictRequestedPaneId) {
      const target = selectionForPane(data, strictRequestedPaneId);
      if (target.paneId !== strictRequestedPaneId) return;
      setSelection(target);
    } else if (strictRequestedWorkspaceId || strictRequestedTabId) {
      const target = selectionForStrictTarget(data, {
        workspaceId: strictRequestedWorkspaceId,
        tabId: strictRequestedTabId,
      });
      if (!target.workspaceId || !target.tabId) return;
      setSelection(target);
    }
    setMissingRequestedTarget(null);
    setError(null);
  }, [
    activeStrictTarget,
    data,
    requestedSessionId,
    sessions,
    snapshotGeneration,
    strictRequestedTabId,
    strictRequestedWorkspaceId,
    strictRequestedPaneId,
    t,
    setSelection,
  ]);

  // The panel picker is a sheet route, so it hands its choice back through the
  // store rather than through navigation params.
  //
  // A pick naming a pane this snapshot has never heard of is not a dead pick
  // yet. Quick actions can make a panel and choose it in the same breath, and
  // the create answers well before the twelve-second poll or the event stream
  // has told this screen the pane exists -- so the pick is held for a few
  // refreshes before it is called missing, instead of being thrown away on the
  // one frame where it was guaranteed to look wrong.
  useEffect(() => {
    if (panelPick?.serverId !== serverId) return;
    padDispatch({ type: 'open-pane' });
    setMissingRequestedTarget(null);
    setStrictTarget({
      serverId,
      sessionId: data.sessionId,
      paneId: panelPick.paneId,
      afterGeneration: snapshotGenerationRef.current + 1,
    });
  }, [data.sessionId, padDispatch, panelPick, serverId]);

  useEffect(() => {
    if (!panelPick || panelPick.serverId !== serverId) return;
    const target = selectionForPane(data, panelPick.paneId);
    if (target.paneId === panelPick.paneId) {
      padDispatch({ type: 'open-pane' });
      clearPanelPick();
      setMissingRequestedTarget(null);
      setStrictTarget({
        serverId,
        sessionId: data.sessionId,
        paneId: panelPick.paneId,
        afterGeneration: snapshotGenerationRef.current,
      });
      setSelection(target);
      setError(null);
    }
  }, [clearPanelPick, data, padDispatch, panelPick, serverId, setSelection]);

  // Keep this read loop independent of data renders. The old 200ms timers
  // launched overlapping refreshes and exhausted all attempts before a slow
  // first response could arrive. Resolve directly from the returned snapshot.
  useEffect(() => {
    if (!ready || !panelPick || panelPick.serverId !== serverId) return;
    let disposed = false;
    let resolvedSessionId = data.sessionId;
    const cancelled = () => disposed || usePanelPickerStore.getState().pick !== panelPick;
    void resolvePanelPick(async () => {
      const result = await refreshData();
      if (result && !result.ok) throw new Error(result.failure.message);
      if (!result) return null;
      resolvedSessionId = result.data.sessionId;
      const target = selectionForPane(result.data, panelPick.paneId);
      return target.paneId === panelPick.paneId ? target : null;
    }, cancelled)
      .then((target) => {
        if (cancelled()) return;
        padDispatch({ type: 'open-pane' });
        clearPanelPick();
        if (target) {
          setMissingRequestedTarget(null);
          setStrictTarget({
            serverId,
            sessionId: resolvedSessionId,
            paneId: panelPick.paneId,
            afterGeneration: snapshotGenerationRef.current,
          });
          setSelection(target);
          setError(null);
        } else setError(t`This terminal is no longer available.`);
      })
      .catch((failure: unknown) => {
        if (cancelled()) return;
        clearPanelPick();
        setError(describeGatewayFailure(failure, t`Computer unavailable.`).message);
      });
    return () => {
      disposed = true;
    };
  }, [
    clearPanelPick,
    data.sessionId,
    padDispatch,
    panelPick,
    ready,
    refreshData,
    serverId,
    t,
    setSelection,
  ]);

  // A quick action that needs an argument typed comes back as a draft rather
  // than as a sent message.
  useEffect(() => {
    if (prefilledDraft === null) return;
    setDraft(prefilledDraft, prefilledDraft.length);
    clearPrefilledDraft();
  }, [clearPrefilledDraft, prefilledDraft, setDraft]);

  // A shortcut or Quick actions asked for the assistant strip. Same shape as a
  // prefilled draft: consumed once, on the screen it was meant for, and never
  // left behind for the next one.
  useEffect(() => {
    if (!assignmentRequest) return;
    if (assignmentRequest.serverId !== serverId || assignmentRequest.paneId !== selection.paneId)
      return;
    assignment.setOpen(true);
    assignment.setCommand(assignmentRequest.command ?? null);
    if (assignmentRequest.kind) assignment.choose({ type: 'new', kind: assignmentRequest.kind });
    if (assignmentRequest.prompt !== undefined) {
      setDraft(assignmentRequest.prompt, assignmentRequest.prompt.length);
    }
    void loadAssistantKinds();
    clearAssignmentRequest();
  }, [
    assignment,
    assignmentRequest,
    clearAssignmentRequest,
    loadAssistantKinds,
    selection.paneId,
    serverId,
    setDraft,
  ]);

  // The shared tail of "new output for this pane arrived" -- whether it came
  // from a read or was pushed inline over the event stream. Kept in one place so
  // both paths update the window, revision and load-earlier flag identically.
  const applyPaneOutput = useCallback(
    (requestPaneId: string, value: string, revision?: number, origin: PaneReadOrigin = 'frame') => {
      if (watchedPaneRef.current !== requestPaneId || loadingEarlierOutputRef.current) return;
      if (origin === 'frame') streamReadFence.noteFrame();
      readRevisionRef.current = {
        paneId: requestPaneId,
        revision: typeof revision === 'number' ? revision : readRevisionRef.current.revision,
      };
      if (typeof revision === 'number') outputStore.setRevision(revision);
      const lineLimit = outputLineLimitRef.current;
      // What this read was made under, so the window can only ever be handed
      // back to a pane still being read the same way. See `heldShapeRef`.
      heldShapeRef.current = outputShapeRef.current;
      // One door for every source, and the source says which it is rather than
      // the code guessing from a length. `foldPaneRead` places the read at the
      // seam its own head anchors and keeps whatever sits above it, so no
      // source can shrink the depth the reader paged to -- see the contract at
      // the top of `src/terminal/history.ts`. Cards #675 (a screen replacing a
      // window), #712 (a length taken for authority) and #721 (a refresh
      // replacing a window it is not as deep as) all died here.
      outputStore.setWindow((current) => {
        // A screen-owning pane's read is the whole of its current screen, not
        // a tail of a growing log, so it replaces rather than folds against
        // the placement heuristics built for the latter (card #795, defect 2
        // -- see `foldPaneRead`'s own doc on `ownsScreen`). Read off the
        // pane's own `alternate_on` rather than the command heuristic, and
        // paired with the pane's height so only the rows the program drew are
        // drawn; see `paneOwnsScreenRef`. Refs rather than the render-time
        // values because this updater is built once.
        return foldPaneWindow(
          current,
          value,
          origin,
          lineLimit,
          paneOwnsScreenRef.current,
          paneScreenRowsRef.current
        );
      });
      // The window as folded, for whichever screen shows this pane next.
      rememberMirroredPaneWindow(
        serverId,
        dataRef.current.sessionId,
        requestPaneId,
        heldShapeRef.current,
        outputStore.get().window.output,
        Date.now(),
        panesRef.current.find((pane) => pane.id === requestPaneId)
      );
      if (lineLimit === INITIAL_PANE_OUTPUT_LINES) {
        const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
        earlierOutputRowsRef.current = terminalOutputLineCount(value);
        // Nothing to page while the program owns the screen: its frame has no
        // history beneath it, and the scrollback the pane had before it started
        // is not this window's to widen into. It comes back whole when the
        // program exits -- see `outputShape`.
        setCanLoadEarlierOutput(
          !paneOwnsScreenRef.current &&
            hasEarlierTerminalOutput(value, lineLimit, MAX_PANE_OUTPUT_LINES, scroll)
        );
      }
      setError(null);
    },
    [dataRef, outputShapeRef, outputStore, serverId, streamReadFence]
  );

  const refreshOutput = useCallback(async () => {
    if (
      !watching ||
      connection.phase !== 'connected' ||
      !selection.paneId ||
      gonePanesRef.current.has(selection.paneId) ||
      loadingEarlierOutputRef.current
    )
      return;
    const requestId = ++outputRequestIdRef.current;
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    const isCurrentRequest = () =>
      watchedServerRef.current === requestServerId &&
      watchedPaneRef.current === requestPaneId &&
      outputRequestIdRef.current === requestId;
    const notOvertaken = streamReadFence.begin();
    return recoverWith(
      async () => {
        // As deep as the reader has already paged, not the first page again. A
        // refresh that asks for one page and then replaces the window with the
        // answer throws away everything the reader pulled up -- the history
        // vanishes and the screen jumps, once a second, which is the flicker.
        const value = await readPaneOutput(
          data.sessionId,
          requestPaneId,
          PANE_OUTPUT_FORMAT,
          outputLineLimitRef.current,
          outputSource
        );
        if (!isCurrentRequest() || !notOvertaken()) return;
        const paneRevision = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw
          .revision;
        applyPaneOutput(
          requestPaneId,
          value,
          typeof paneRevision === 'number' ? paneRevision : undefined,
          'refresh'
        );
      },
      (failure) => {
        if (paneGoneError(failure)) {
          markPaneGoneRef.current(requestPaneId);
          return;
        }
        if (isCurrentRequest()) {
          const description = describeGatewayFailure(failure, t`Could not read the terminal.`);
          if (!description.retryable) setError(description.message);
        }
      }
    );
  }, [
    applyPaneOutput,
    connection.phase,
    data.sessionId,
    outputSource,
    selection.paneId,
    serverId,
    streamReadFence,
    t,
    watching,
  ]);

  // The route's pane, read the moment the screen mounts -- beside the snapshot,
  // not after it. Until the snapshot has answered, the selection is the route's
  // pane by name only (`landing`), `refreshOutput` is waiting on `connected`,
  // and the canvas is showing the mirror's last window or nothing; this read is
  // what fills it in the meantime. Painted straight in when the pane is the one
  // being watched, filed in the cache for the switch that lands on it otherwise.
  // Once per server: a pane switch within the screen has its own reads.
  const routePaneReadRef = useRef<string | null>(null);
  useEffect(() => {
    const target = warmSeed.target;
    if (!target || !selectedServer || routePaneReadRef.current === serverId) return;
    routePaneReadRef.current = serverId;
    const { sessionId, paneId, shape } = target;
    const notOvertaken = streamReadFence.begin();
    let live = true;
    void readPaneOutput(
      sessionId,
      paneId,
      PANE_OUTPUT_FORMAT,
      INITIAL_PANE_OUTPUT_LINES,
      'recent-unwrapped'
    ).then(
      (value) => {
        if (!live || !value || !notOvertaken()) return;
        if (watchedPaneRef.current === paneId && dataRef.current.sessionId === sessionId) {
          applyPaneOutputRef.current(paneId, value, undefined, 'refresh');
          return;
        }
        paneCacheRef.current = warmPaneWindow(paneCacheRef.current, paneId, {
          shape,
          output: value,
          lineLimit: INITIAL_PANE_OUTPUT_LINES,
          revision: -1,
          canLoadEarlier: hasEarlierTerminalOutput(
            value,
            INITIAL_PANE_OUTPUT_LINES,
            MAX_PANE_OUTPUT_LINES,
            undefined
          ),
          earlierRows: terminalOutputLineCount(value),
          rangeUnsupported: false,
          lastRead: null,
        });
      },
      // The ordinary read follows the snapshot and reports its own failure.
      () => {}
    );
    return () => {
      live = false;
    };
  }, [dataRef, selectedServer, serverId, streamReadFence, warmSeed]);

  // When the opening frame is out: see `openSettled`.
  useEffect(() => {
    if (openSettled || !ready) return;
    let frame: number | null = null;
    let settling = false;
    const settle = () => {
      if (settling) return;
      settling = true;
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => setOpenSettled(true));
      });
    };
    const check = () => {
      if (outputStore.get().window.output) settle();
    };
    check();
    const unsubscribe = outputStore.subscribe(check);
    const timer = setTimeout(settle, OPEN_SETTLE_GRACE_MS);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [openSettled, outputStore, ready]);

  const loadEarlierOutput = useCallback(async () => {
    const requestPaneId = selection.paneId;
    const currentLimit = outputLineLimitRef.current;
    if (
      !ready ||
      connection.phase !== 'connected' ||
      !requestPaneId ||
      loadingEarlierOutputRef.current ||
      historyPullBlockedRef.current ||
      currentLimit >= MAX_PANE_OUTPUT_LINES
    )
      return;

    const requestId = ++outputRequestIdRef.current;
    const requestServerId = serverId;
    const nextLimit = Math.min(MAX_PANE_OUTPUT_LINES, currentLimit + PANE_OUTPUT_PAGE_LINES);
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId &&
      activePaneRef.current === requestPaneId &&
      outputRequestIdRef.current === requestId;

    const refreshApproved = capturedRefreshApprovedRef.current;
    loadingEarlierOutputRef.current = true;
    setLoadingEarlierOutput(true);
    setHistoryNotice(null);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            // Where the window's own top sits, asked fresh rather than remembered.
            // `seedPageRange` was written for the one read that cannot carry a
            // `range` -- every pane's first page -- but the same formula
            // (`total - currentLimit`, off the pane record's *live* scroll metrics)
            // is the right answer on every later page too, and it is the ONLY one
            // that stays right: the window sits at exactly `currentLimit` lines
            // once a page has been pulled, and every line the pane prints after
            // that evicts one paged-in line off the top -- `foldPaneRead` trims
            // from the top to hold the cap. The *served* range from the last page
            // (`lastRange`, below) freezes the instant that read landed and goes
            // stale the moment a single refresh runs past it, which asks for
            // exactly the span above the line that eviction just took, not above
            // where the window actually begins now -- a gap opens between the two
            // and nothing above ever notices, because `foldPaneRead` finds zero
            // overlap and prepends there too, correctly, by construction. Recomputed
            // off `total` this cannot go stale: it is not a memory of a past
            // answer, it is the same question asked again. `lastRange` is kept only
            // as a fallback for the pane record momentarily missing scroll metrics
            // -- stale is still better than nothing there -- and a pane or gateway
            // that has neither leaves both null and asks exactly the widening-tail
            // question it always has.
            const seedScroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw
              .scroll;
            const seedRange = seedPageRange(seedScroll, currentLimit);
            const lastRange = paneReadRange(lastReadRef.current);
            // A backend discovery says serves no range (herdr) pages by the
            // widening tail alone; asking it for a range first would only cost
            // a round trip it then ignores.
            const rangeAllowed =
              !rangeUnsupportedRef.current &&
              historyPullUsesRange(backendPagesHistory(terminalPlane, data.sessionId));
            const range = rangeAllowed ? (seedRange ?? lastRange) : null;
            const page = range ? nextPageRange(range, PANE_OUTPUT_PAGE_LINES) : null;
            // A range-addressed page is disjoint from the window, so it costs its
            // own rows rather than every line beneath it. Without one this is the
            // widening tail read it has always been, byte-for-byte. Which of the
            // two answered, whether the backend honoured the range (herdr's
            // accepts `start`/`end` and answers with its own tail; the Mac's tmux
            // refuses it outright, `502 backend_error`, for want of `capture-pane
            // -F`), and the one retry a transient failure gets are all decided in
            // `pullEarlierPage`, where they can be tested without a screen.
            const outcome = await pullEarlierPage({
              // The gateway's captured history first, where it serves it and
              // this pane has not turned out uncaptured; a shell pane answers
              // `not_captured` and the range/tail reads below serve it as before.
              ...(servesCapturedHistory &&
              !servesSegmentedHistory &&
              !capturedOffRef.current &&
              paneScreenRowsRef.current > 0
                ? {
                    captured: {
                      cursor: capturedCursorRef.current,
                      read: (before: string | null) =>
                        readPaneHistory(
                          data.sessionId,
                          requestPaneId,
                          before,
                          PANE_OUTPUT_PAGE_LINES
                        ),
                    },
                  }
                : {}),
              page,
              readRange: (start, end) =>
                readPaneRange(
                  data.sessionId,
                  requestPaneId,
                  start,
                  end,
                  PANE_OUTPUT_FORMAT,
                  outputSource
                ),
              readTail: () =>
                readPaneTail(
                  data.sessionId,
                  requestPaneId,
                  PANE_OUTPUT_FORMAT,
                  nextLimit,
                  outputSource
                ),
              servedStart: (read) => paneReadRange(read)?.start ?? null,
            });
            if (!isCurrentRequest()) return;
            // Remembered so the range is asked at most once, on this pull or any
            // later one: every page after it goes straight to the tail.
            if (outcome.rangeUnsupported) rangeUnsupportedRef.current = true;
            const captured = outcome.captured;
            const heldWindow = outputStore.get().window;
            const heldHistoricalRows =
              captured?.kind === 'page' && paneScreenRowsRef.current > 0
                ? Math.max(
                    heldWindow.capturedRows,
                    terminalOutputLineCount(heldWindow.output) - paneScreenRowsRef.current
                  )
                : heldWindow.capturedRows;
            if (capturedTraversalNeedsRefresh(captured, heldHistoricalRows, refreshApproved)) {
              // A new first page has no coordinates relative to the old prefix.
              // Preserve the held text and scroll anchor until the reader refreshes.
              capturedRefreshRequiredRef.current = true;
              capturedEmptyRef.current = false;
              setCapturedEmptyProbe(null);
              offerCaptured(requestPaneId, false);
              historyPullBlockedRef.current = true;
              setHistoryPullBlocked(true);
              setHistoryNotice(historyRefreshNotice());
              return;
            }
            if (captured?.kind === 'notCaptured') {
              if (refreshApproved && outcome.kind === 'page') {
                capturedRefreshRequiredRef.current = false;
                capturedRefreshApprovedRef.current = false;
              }
              capturedCursorRef.current = null;
              capturedEmptyRef.current = true;
              capturedProbedAtRef.current = Date.now();
              setCapturedEmptyProbe({ output: outputStore.get().window.output });
              offerCaptured(requestPaneId, false);
            } else if (captured?.kind === 'page') {
              capturedRefreshRequiredRef.current = false;
              capturedRefreshApprovedRef.current = false;
              capturedEmptyRef.current = false;
              setCapturedEmptyProbe(null);
              capturedCursorRef.current = captured.cursor;
              // The last page, or a window at its cap: a page more would be
              // trimmed away as it landed, so the pull is not offered again.
              if (!captured.hasMore || nextLimit >= MAX_PANE_OUTPUT_LINES) {
                capturedExhaustedRef.current = true;
              }
              offerCaptured(requestPaneId, !capturedExhaustedRef.current);
            } else if (servesCapturedHistory && !capturedOffRef.current) {
              // The captured read refused or failed: not offered on its account
              // until a reconnect.
              offerCaptured(requestPaneId, false);
            }
            const blocked = historyPullBlockedAfter(outcome.kind);
            historyPullBlockedRef.current = blocked;
            setHistoryPullBlocked(blocked);
            if (outcome.kind !== 'page') {
              // Never the error bar: that is for the pane failing, and this is
              // one gesture that did not land. The gate is closed above, so the
              // reader is told once rather than on every pull.
              setHistoryNotice(historyPullNotice(outcome));
              return;
            }
            setHistoryNotice(null);
            const { origin } = outcome;
            const { output: value, read } = outcome.fetched;
            const capturedPage = captured?.kind === 'page' ? captured : null;
            outputLineLimitRef.current = nextLimit;
            // A captured page carries no served range; the last one stays the fallback.
            if (!capturedPage) lastReadRef.current = read;
            // Through the same door as everything else. A page is the one source
            // allowed to claim depth, and it only gets it when the read demonstrably
            // reaches past the window's own head. Where Herdr plateaus below what its
            // row metric promised (card #646: a pane claiming 2765 rows that stops
            // returning more at 932) the wider read comes back no deeper than the one
            // before it, and a bare `setOutput(value)` would then hand the reader
            // *less* than they were already holding as the reward for pulling down.
            // A range page carries none of that ambiguity -- it is disjoint by
            // construction -- which is exactly why it folds through the door under
            // its own `'rangePage'` origin rather than `'page'`: the two may look
            // alike at this call site, but only a genuine range read may be believed
            // with zero overlap. See the origin's own doc in `history.ts`.
            outputStore.setWindow((current) => {
              const next = foldPaneWindow(
                current,
                value,
                origin,
                nextLimit,
                paneOwnsScreenRef.current,
                paneScreenRowsRef.current,
                captured?.reset
              );
              return next;
            });
            const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
            const reachedRows = earlierOutputRowsRef.current;
            if (!capturedPage) earlierOutputRowsRef.current = terminalOutputLineCount(value);
            // A tail read no deeper than the last one, or the last captured
            // page: nothing more is coming, so say so once rather than leave a
            // pull that does nothing.
            if (
              tailPageFoundNothing(outcome, earlierOutputRowsRef.current, reachedRows) ||
              (capturedPage && !capturedPage.hasMore)
            ) {
              setHistoryNotice(historyExhaustedNotice());
            }
            setCanLoadEarlierOutput(
              hasEarlierAfterPage(
                value,
                nextLimit,
                MAX_PANE_OUTPUT_LINES,
                scroll,
                reachedRows,
                read,
                capturedPage?.hasMore
              )
            );
            setHistoryRevision((revision) => revision + 1);
          },
          (failure) => {
            if (isCurrentRequest()) {
              historyPullBlockedRef.current = historyPullBlockedAfter('failed');
              setHistoryPullBlocked(historyPullBlockedRef.current);
              setHistoryNotice(
                historyPullNotice({
                  kind: 'failed',
                  failure: describeGatewayFailure(failure),
                  rangeUnsupported: false,
                })
              );
            }
          }
        );
      },
      () => {
        if (isCurrentRequest()) {
          loadingEarlierOutputRef.current = false;
          setLoadingEarlierOutput(false);
        }
      }
    );
  }, [
    connection.phase,
    data.sessionId,
    outputSource,
    ready,
    selection.paneId,
    serverId,
    servesCapturedHistory,
    servesSegmentedHistory,
    terminalPlane,
    outputStore,
  ]);

  // A pull's notice is news about one gesture, not a state of the pane: it
  // leaves on its own, and a Retry pressed in the meantime replaces it.
  useEffect(() => {
    if (!historyNotice || historyNotice.dismissMs === 0) return;
    const timer = setTimeout(() => setHistoryNotice(null), historyNotice.dismissMs);
    return () => clearTimeout(timer);
  }, [historyNotice]);

  // A reconnect is a new chance: whatever closed the gate may have been the
  // connection, and the gateway on the far side may be a newer one.
  const pullPhaseRef = useRef(connection.phase);
  useEffect(() => {
    const previous = pullPhaseRef.current;
    pullPhaseRef.current = connection.phase;
    if (connection.phase !== 'connected' || previous === 'connected') return;
    // The gateway on the far side may have restarted: its captured history
    // starts over, and the cursor means nothing there.
    restartCaptured();
    historyPullBlockedRef.current = historyPullBlockedAfter('reconnected');
    setHistoryPullBlocked(historyPullBlockedRef.current);
  }, [connection.phase]);

  const retryEarlierOutput = useCallback(() => {
    // Refresh is explicit: start without a cursor and replace only the prefix.
    if (capturedRefreshRequiredRef.current) {
      capturedRefreshApprovedRef.current = true;
      capturedCursorRef.current = null;
      capturedExhaustedRef.current = false;
    }
    setHistoryNotice(null);
    historyPullBlockedRef.current = false;
    setHistoryPullBlocked(false);
    void loadEarlierOutput();
  }, [loadEarlierOutput]);

  useEffect(() => {
    panesRef.current = data.panes;
    // A closed pane's id can be reused by the next one Herdr opens, so a
    // window is dropped when the session stops listing it rather than left to
    // age out of the cache under a name that has since changed hands. The
    // refreshed list is the reliable answer: the structural events say
    // something closed, not always which.
    paneCacheRef.current = retainPanes(
      paneCacheRef.current,
      data.panes.map((pane) => pane.id)
    );
  }, [data.panes, t]);

  /**
   * Brings the active pane chip into the strip's viewport, if it is not
   * already comfortably inside it.
   *
   * Only when it has to: centring on every selection would move the strip
   * under a finger that had just tapped a chip it could see perfectly well.
   */
  const revealActivePaneChip = useCallback(() => {
    const layout = paneChipLayouts.current[selection.paneId];
    const viewport = paneStripViewportRef.current;
    const offset = paneStripOffsetRef.current;
    const target = paneChipRevealOffset(layout, viewport, offset, PANE_CHIP_REVEAL_MARGIN);
    if (target === null) return;
    paneStripRef.current?.scrollTo({ x: target, animated: true });
  }, [selection.paneId]);

  useEffect(() => {
    // After paint: on the frame the selection changes the chips may not have
    // been measured yet, and an unmeasured strip has nothing to scroll to.
    const timer = setTimeout(revealActivePaneChip, 0);
    return () => clearTimeout(timer);
  }, [revealActivePaneChip, tabPanes.length]);

  useEffect(() => {
    refreshOutputRef.current = () => void refreshOutput();
  }, [refreshOutput]);

  useEffect(() => {
    applyPaneOutputRef.current = applyPaneOutput;
  }, [applyPaneOutput]);

  useEffect(() => {
    if (!appActive || !watching || connection.phase !== 'connected' || !selection.paneId) return;
    // A pane the gateway said is gone is not asked about again, on any cadence.
    if (gonePanesRef.current.has(selection.paneId)) return;
    // First read on selecting the pane; after that the event stream drives it.
    // The interval is a safety net for a missed event or a cursor-only
    // change that does not bump the revision -- not the primary path.
    //
    // A safety net for a screen nobody is looking at catches nothing and keeps
    // the radio awake, so it stands down with the app and re-arms on return --
    // the read on the way back in is this same first `refreshOutput`.
    void refreshOutput();
    // While the stream is up it inlines every change to this pane, so this is
    // a slow safety net for a missed event. It was 1Hz regardless, which is a
    // full-window read plus a line-level fold every second on a phone that had
    // already been handed the text -- the single largest steady drain on the
    // radio and the CPU this screen had. Only a stream that is actually down
    // earns the fast cadence, and only until it is back.
    const timer = setInterval(
      () => void refreshOutput(),
      streamUp ? OUTPUT_POLL_STREAMING_MS : OUTPUT_POLL_FALLBACK_MS
    );
    return () => clearInterval(timer);
  }, [
    appActive,
    connection.phase,
    goneVersion,
    refreshOutput,
    selection.paneId,
    streamUp,
    watching,
  ]);

  /**
   * Warm the two panes a swipe can reach, so the switch onto them is a paint
   * rather than a round trip.
   *
   * Deliberately late and deliberately quiet. It waits out
   * `PANE_PREFETCH_DELAY_MS` so it never competes with the selected pane's own
   * first read for the one transport the screen has -- the reader is looking
   * at that pane, not at its neighbours -- and a burst of swipes rearms the
   * timer rather than firing per pane passed through, so cycling a tab of six
   * costs two reads at the end instead of twelve on the way.
   *
   * A neighbour whose cached window the stream has not overtaken is skipped
   * entirely: there is no blank to remove there, and asking again would spend
   * a round trip to be told what is already held.
   *
   * Everything it fetches goes into the cache and nothing else. It never
   * touches `output`, `setPaneRevision` or any of the depth refs, so a warm-up
   * landing at any moment cannot move what is on screen -- which is what makes
   * it safe to run beside the reads that can. The only shape it fetches is the
   * shape the *selected* pane is read under; a neighbour that turns out to be
   * read another way (an agent as prose, an editor's screen) is refused by
   * `recallPaneWindow` on arrival and costs nothing but the read.
   */
  useEffect(() => {
    if (!ready || connection.phase !== 'connected' || !selection.paneId) return;
    const generation = ++prefetchGenerationRef.current;
    const requestServerId = serverId;
    const targets = panePrefetchTargets(
      tabPanes.map((pane) => pane.id),
      selection.paneId,
      paneCacheRef.current,
      (paneId) => {
        const revision = panesRef.current.find((pane) => pane.id === paneId)?.raw.revision;
        return typeof revision === 'number' ? revision : -1;
      }
    );
    if (targets.length === 0) return;

    const timer = setTimeout(() => {
      for (const paneId of targets) {
        void readPaneTail(
          data.sessionId,
          paneId,
          PANE_OUTPUT_FORMAT,
          INITIAL_PANE_OUTPUT_LINES,
          outputSource
        )
          .then(({ output: value, read }) => {
            // Three ways this answer can have been overtaken while it was on
            // the wire, and all three end the same way -- drop it. The
            // selection moved on (a stale generation); the server did; or the
            // stream reported this pane past the revision the read was made
            // at, which `paneReadIsCurrent` is exactly the check for.
            if (!panePrefetchAccepted(generation, prefetchGenerationRef.current)) return;
            if (activeServerRef.current !== requestServerId) return;
            const paneRaw = panesRef.current.find((pane) => pane.id === paneId)?.raw.revision;
            const revision = typeof paneRaw === 'number' ? paneRaw : -1;
            if (!paneReadIsCurrent(paneCacheRef.current, paneId, revision)) return;
            if (!value) return;
            paneCacheRef.current = warmPaneWindow(paneCacheRef.current, paneId, {
              // `outputShape`, not a shape spelled out again here. The two
              // disagreed by a component -- this filed `ansi:recent-unwrapped`
              // while every recall asks for `ansi:recent-unwrapped:main` -- and
              // `recallPaneWindow` refuses on any mismatch, so *every*
              // prefetched window was thrown away on arrival and the whole
              // warm-up spent a round trip per neighbour for nothing. Not the
              // documented refusal below, which is a real question about a real
              // neighbour; this was the string never matching itself.
              shape: outputShape,
              output: value,
              // A warm-up is always the first page -- a seed for the switch,
              // never a claim about depth. `warmPaneWindow`, not
              // `rememberPaneWindow`, is what stops that seed being written
              // over a window the reader had already paged deeper and left.
              lineLimit: INITIAL_PANE_OUTPUT_LINES,
              revision,
              canLoadEarlier: hasEarlierTerminalOutput(
                value,
                INITIAL_PANE_OUTPUT_LINES,
                MAX_PANE_OUTPUT_LINES,
                panesRef.current.find((pane) => pane.id === paneId)?.raw.scroll
              ),
              earlierRows: terminalOutputLineCount(value),
              rangeUnsupported: false,
              lastRead: read,
            });
          })
          // A warm-up nobody asked for is not news. The pane it failed for
          // simply stays a miss, which is the behaviour every pane had before
          // this existed.
          .catch(() => {});
      }
    }, PANE_PREFETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    connection.phase,
    data.sessionId,
    outputShape,
    outputSource,
    ready,
    selection.paneId,
    serverId,
    tabPanes,
  ]);

  // The permission menu this pane may be blocked on. Everything about it --
  // the read, the answer, the 409 retry rule -- lives in the hook; the screen
  // only says which pane, and only when the gateway declared it can do this.
  const approval = usePaneApproval({
    sessionId: data.sessionId,
    paneId: selection.paneId,
    supported: gatewaySupportsApprovals(data.health?.capabilities),
    enabled: ready && connection.phase === 'connected' && openSettled,
  });
  // Read through a ref for the same reason the output handlers are: the event
  // handlers are built once and must not rebuild the subscription.
  const approvalRef = useLatestRef(approval);

  // What changed on this server since it was last on screen. Same shape as the
  // approval hook: the screen says which server, and only when the gateway
  // declared it keeps the ring; everything else -- the threshold, the visit
  // mark, the summary -- is `useAwayDigest` and `lib/away-digest`.
  const away = useAwayDigest({
    serverId,
    sessionId: data.sessionId,
    supported: gatewaySupportsAgentEvents(data.health?.capabilities),
    enabled: ready && connection.phase === 'connected' && openSettled,
  });

  // What the dock shows right now. A standing approval clears it down to the
  // question, the input and the pane strip -- the rule, and why each row is on
  // one side of it or the other, is `dockPresentation`'s docblock.
  const dock = useMemo(
    () =>
      dockPresentation({
        approval: approval.state.approval,
        keyboardMode,
        paneCount: tabPanes.length,
        showTerminalKeyRow,
        attachmentsAvailable,
        stagedAttachments: attachments.length,
        screenOnTop: isFocused,
        editorPane: fullScreenPane,
        composerRevealed,
      }),
    [
      approval.state.approval,
      attachments.length,
      attachmentsAvailable,
      composerRevealed,
      fullScreenPane,
      isFocused,
      keyboardMode,
      showTerminalKeyRow,
      tabPanes.length,
    ]
  );

  // The builder is rebuilt rather than shared because Reanimated's builders are
  // mutable (see `motion.ts`); `undefined` is what leaves a row's reflow
  // un-animated while the panels sheet covers the dock -- the rule, and the
  // defect it avoids, is `animateReflow` in `dockPresentation`.
  const dockRowLayout = useMemo(
    () => (dock.animateReflow ? listLayout('short') : undefined),
    [dock.animateReflow]
  );

  // The input the platform keyboard was raised for is about to leave with the
  // rest of the dock, and a keyboard left standing over a question would cover
  // the answers to it. Asked for explicitly rather than left to the unmount,
  // which does not reliably take the keyboard down on Android.
  useEffect(() => {
    if (dock.approvalOnly) Keyboard.dismiss();
  }, [dock.approvalOnly]);

  // Home or an agent session covering the pane hides it by opacity, which
  // leaves the composer mounted. Its field must not keep focus underneath: a
  // hardware keyboard would type into a field no one can see, and Enter would
  // send it to the pane.
  useEffect(() => {
    if (paneHidden) Keyboard.dismiss();
  }, [paneHidden]);

  // Which pane the stream is opened against, which trails the selection by
  // `PANE_STREAM_SETTLE_MS`. See that constant for why it trails at all; the
  // short version is that re-pointing the stream is a reconnect, and a pane
  // passed through on the way somewhere else is not worth one.
  //
  const [streamPaneId, setStreamPaneId] = useState(selection.paneId);
  useEffect(() => {
    if (streamPaneId === selection.paneId) return;
    // The first pane of a visit does not wait. There is no reconnect to avoid
    // when there is no stream yet -- the selection arrives empty and is filled
    // in once the gateway answers -- and making that one wait would delay the
    // inline frames for the pane the reader actually arrived on.
    if (!streamPaneId) {
      setStreamPaneId(selection.paneId);
      return;
    }
    const timer = setTimeout(() => setStreamPaneId(selection.paneId), PANE_STREAM_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [selection.paneId, streamPaneId]);

  // Whether the stream below is wanted, and so whether its state is evidence
  // the Home dot may read (`stores/server-channels`).
  const streamWanted =
    selectedServer &&
    Boolean(tunnel.baseUrl && record?.token && data.sessionId) &&
    appActive &&
    watching &&
    connection.phase === 'connected';
  const setStreamChannel = useServerChannels((state) => state.setStream);
  useEffect(() => {
    if (!streamWanted) return;
    return () => setStreamChannel(serverId, null);
  }, [serverId, setStreamChannel, streamWanted]);
  useEffect(() => {
    if (!streamWanted) return;
    if (streamUp) {
      setStreamChannel(serverId, 'open');
      return;
    }
    // `retrying` only once the stream has been up while wanted: the first
    // connect is not a reconnect, and the selected row would flash
    // "Reconnecting…" on every visit. The entry is cleared when the stream
    // stops being wanted, so its presence is that "been up once".
    if (useServerChannels.getState().streams[serverId]) setStreamChannel(serverId, 'retrying');
  }, [serverId, setStreamChannel, streamUp, streamWanted]);

  // The live event stream. `pane_updated` for the selected pane reads its
  // output; structural events refresh the navigator. A (re)connect forces a
  // full read, because the stream has no replay and anything during the gap is
  // lost.
  usePaneEvents(
    // The event stream rides the same forward as every other request for a
    // tunnelled record: its base is the loopback URL, not the record's own.
    selectedServer ? tunnel.baseUrl : null,
    selectedServer ? (record?.token ?? null) : null,
    data.sessionId,
    // The settled pane, not the selected one -- see `streamPaneId` above. The
    // structural and approval events this stream also carries are session-wide
    // and unaffected by which pane it inlines.
    selectedServer ? streamPaneId || null : null,
    // Backgrounding stands the stream down; `retryNonce` above already brings
    // it back on return, which is the path that existed for a socket the OS had
    // suspended anyway. Only the stream and the poll are gated this way -- not
    // `ready` itself, whose falling edge cancels in-flight requests and would
    // turn backgrounding mid-send into a lost send. And `watching` rather than
    // `ready`, so a sheet over the pane does not close it (see `watching`).
    appActive && watching && connection.phase === 'connected',
    retryNonce,
    useMemo(
      () => ({
        onPaneRevision: (paneId: string, revision: number) => {
          if (paneId !== watchedPaneRef.current) {
            // The stream is session-wide, so this is how a pane nobody is
            // looking at says it has moved on. Only its revision arrives --
            // the gateway inlines the *text* for the one pane the stream was
            // opened against (`stream_pane`) and no other -- and a revision is
            // all that is needed here: it is what marks a remembered window as
            // overtaken, so the switch back paints it at once and then
            // reconciles, instead of trusting it forever. A pane the cache
            // does not hold is not created by this.
            paneCacheRef.current = notePaneRevision(paneCacheRef.current, paneId, revision);
            return;
          }
          const last = readRevisionRef.current;
          if (last.paneId === paneId && last.revision === revision) return;
          refreshOutputRef.current();
        },
        onPaneOutput: (paneId: string, revision: number, text: string) => {
          if (paneId !== watchedPaneRef.current) {
            const captured = paneCacheRef.current.entries.find((entry) => entry.paneId === paneId)
              ?.captured as CapturedPaneState | undefined;
            if (captured?.rows) {
              // Keep the captured provenance filed with this snapshot. The next
              // selected read reconciles its live segment using foldPaneWindow.
              paneCacheRef.current = notePaneRevision(paneCacheRef.current, paneId, revision);
              return;
            }
            // For the short interval after a switch the stream is still
            // inlining the pane just left -- the one pane other than the
            // selected one whose text is ever on the wire (see
            // `PANE_STREAM_SETTLE_MS`). Folded into that pane's remembered
            // window through the same door its own frames went through, so
            // switching straight back stays free even while it is printing.
            // Everything else -- an uncached pane, a shape that has turned, a
            // frame already overtaken -- leaves the cache exactly as it was.
            paneCacheRef.current = foldPaneFrame(
              notePaneRevision(paneCacheRef.current, paneId, revision),
              paneId,
              PANE_FRAME_SHAPE,
              revision,
              (held, lineLimit) => foldPaneRead(held, text, 'frame', lineLimit, false)
            );
            return;
          }
          // Painted straight from the event -- no read round-trip.
          // Herdr can expose new text before its coalesced revision advances,
          // so inline output must not be discarded solely on revision equality.
          applyPaneOutputRef.current(paneId, text, revision, 'frame');
        },
        onStructureChanged: () => refreshDataRef.current(),
        onPaneClosed: (paneId) => markPaneGoneRef.current(paneId),
        onLayoutChanged: () => layoutCheckRef.current(),
        onDisconnected: () => setStreamUp(false),
        onConnected: () => {
          setStreamUp(true);
          readRevisionRef.current = { paneId: '', revision: -1 };
          refreshOutputRef.current();
          refreshDataRef.current();
          // Approval transitions during the gap are gone with the socket, so a
          // reconnect re-reads rather than trusting the last event seen.
          approvalRef.current.refresh();
        },
        onApprovalChanged: (event: string, payload: unknown) =>
          approvalRef.current.handleEvent(event, payload),
        // `data.generation` on an output frame: a changed one resets every held
        // window through `resetPaneHistory` before this frame is folded.
        onOutputFrame: (payload: unknown) => noteGatewayGeneration(serverId, payload),
      }),
      [approvalRef, serverId]
    )
  );

  // Every way of arriving at a pane feeds the same memory -- the pane strip,
  // the panels sheet, a notification -- so a workspace is remembered on the
  // pane last actually looked at, not only on the ones swiped away from.
  useEffect(() => {
    workspaceMemoryRef.current = rememberWorkspaceSelection(workspaceMemoryRef.current, selection);
    tabPaneMemoryRef.current = rememberTabPane(tabPaneMemoryRef.current, selection);
  }, [selection]);

  // A hand-made switch moves the screen's held target with it (see
  // `followLanding`). The generation is read when the switch lands, not during
  // render, so the target is checked against the snapshot already on screen.
  const followSwitch = useCallback(
    (landed: Selection) => {
      const landing = {
        serverId,
        sessionId: data.sessionId,
        selection: landed,
        generation: snapshotGenerationRef.current,
      };
      setStrictTarget((held) => followLanding(held, landing));
    },
    [data.sessionId, serverId, setStrictTarget]
  );

  /**
   * A swipe on the title has landed on a workspace.
   *
   * Purely a change of what this screen is looking at -- no focus is pushed to
   * the gateway -- and the candidate selection goes through the same reconcile
   * step as a fresh load, so a remembered pane that has since been closed falls
   * back to that workspace's active tab instead of landing on nothing.
   *
   * The switcher hands over a workspace rather than a direction: it coalesces a
   * burst of swipes into one landing, and by then this screen's selection is a
   * step or more behind the finger. Applied through the updater form for the
   * same reason -- `selection` in this closure is whatever the last render saw.
   *
   * The held target follows the landing: a screen opened on a pane from Home
   * holds that pane, and the next snapshot would otherwise put the selection
   * straight back on it.
   */
  function selectWorkspace(nextWorkspaceId: string) {
    const landed = setSelection((current) => {
      if (current.workspaceId === nextWorkspaceId) return current;
      if (!data.workspaces.some((item) => item.id === nextWorkspaceId)) return current;
      workspaceMemoryRef.current = rememberWorkspaceSelection(workspaceMemoryRef.current, current);
      const candidate = recallWorkspaceSelection(workspaceMemoryRef.current, nextWorkspaceId);
      const next = reconcileSelection(data, candidate);
      return sameSelection(current, next) ? current : next;
    });
    followSwitch(landed);
    setError(null);
  }

  /**
   * A two-finger swipe on the pane has landed on a tab.
   *
   * The mirror of `selectWorkspace` one level down, and for the same reasons: a
   * change of what this screen is looking at with no focus pushed to the
   * gateway, a candidate selection put through the same reconcile step as a
   * fresh load, and a destination rather than a direction because during a
   * burst this screen's selection is behind the fingers.
   *
   * The direction is used for one thing only -- which way the pane carousel
   * travels -- so a switch that turns out to be a no-op never sets it.
   */
  const selectTab = useCallback(
    (target: TabCycleTarget, direction: TabCycleDirection) => {
      const landed = setSelection((current) => {
        if (current.tabId === target.tabId) return current;
        if (!data.tabs.some((item) => item.id === target.tabId)) return current;
        tabPaneMemoryRef.current = rememberTabPane(tabPaneMemoryRef.current, current);
        const next = reconcileSelection(data, {
          workspaceId: current.workspaceId,
          tabId: target.tabId,
          paneId: recallTabPane(tabPaneMemoryRef.current, target.tabId),
        });
        if (sameSelection(current, next)) return current;
        return next;
      });
      followSwitch(landed);
      setError(null);
    },
    [data, followSwitch, setSelection]
  );

  /**
   * What the last switch landed on, for the pill in the notice stack.
   *
   * One slot for both gestures: a swipe of the title pill cycles workspaces, a
   * two-finger swipe of the pane cycles that workspace's tabs, and they are the
   * same gesture at two levels. Tagged with the id that raised it so the
   * clearing timer of one can never take down the other's announcement.
   */
  const [switchPill, setSwitchPill] = useState<{ address: PaneAddress; testID: string } | null>(
    null
  );

  const announceSwitch = useCallback((testID: string, address: PaneAddress | null) => {
    setSwitchPill((current) => {
      if (address) return { address, testID };
      return current?.testID === testID ? null : current;
    });
  }, []);

  // Predicted, not observed: the indicator's whole job is to answer before the
  // selection catches up, so the landing is worked out the same way `selectTab`
  // and `selectWorkspace` work theirs out -- from what that tab or workspace
  // was last left on, put through the same reconcile step as a fresh load.
  const announceTabSwitch = useCallback(
    (target: TabCycleTarget | null) => {
      announceSwitch(
        TAB_SWITCH_TEST_ID,
        target
          ? paneAddressFor(data, {
              workspaceId: selection.workspaceId,
              tabId: target.tabId,
              paneId: recallTabPane(tabPaneMemoryRef.current, target.tabId),
            })
          : null
      );
    },
    [announceSwitch, data, selection.workspaceId]
  );

  const announceWorkspaceSwitch = useCallback(
    (target: WorkspaceCycleTarget | null) => {
      announceSwitch(
        WORKSPACE_SWITCH_TEST_ID,
        target
          ? paneAddressFor(
              data,
              recallWorkspaceSelection(workspaceMemoryRef.current, target.workspaceId)
            )
          : null
      );
    },
    [announceSwitch, data]
  );

  const canReturnToPane = Boolean(
    padDetailIsPane &&
    !overviewVisible &&
    panelReturn &&
    panelReturn.serverId === serverId &&
    panelReturn.sessionId === data.sessionId &&
    panelReturn.paneId === selection.paneId &&
    selectionForPane(data, panelReturn.previousPaneId).paneId === panelReturn.previousPaneId
  );
  const returnToPreviousPane = useCallback(() => {
    if (!canReturnToPane || !panelReturn) return false;
    usePanelPickerStore.getState().choosePanel({
      serverId,
      paneId: panelReturn.previousPaneId,
    });
    setKeyboardMode(false);
    return true;
  }, [canReturnToPane, panelReturn, serverId]);

  useEffect(() => {
    if (!isFocused || overviewVisible || !padDetailIsPane || !canReturnToPane) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', returnToPreviousPane);
    return () => subscription.remove();
  }, [canReturnToPane, isFocused, overviewVisible, padDetailIsPane, returnToPreviousPane]);

  /**
   * Leaving the demo is leaving the screen (card #672).
   *
   * There used to be a banner across the top of the pane saying "Demo · sample
   * data" with an Exit button on it, and it was the only way out. It was also
   * the loudest thing on a screen whose whole job is to look like the app being
   * used, and it sat in the notice stack where a real condition -- an error, a
   * dropped connection -- has to be seen. So the label is gone and the way out
   * moved onto the control that already means "leave this server": the header's
   * back button, which now also hangs the demo session up on its way past.
   *
   * A demo the user backs out of any other way is no worse off than before --
   * nothing here used to disconnect either -- and the common path now does.
   */
  const leaveDetail = useCallback(() => {
    void disconnect();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [disconnect, router]);

  const tabSwipe = useTabSwipe({
    tabs: workspaceTabs,
    tabId: selection.tabId,
    onCycle: selectTab,
    onIndicator: announceTabSwitch,
  });

  function choosePane(pane: HerdrEntity) {
    padDispatch({ type: 'open-pane' });
    setMissingRequestedTarget(null);
    setStrictTarget({
      serverId,
      sessionId: data.sessionId,
      paneId: pane.id,
      afterGeneration: snapshotGenerationRef.current,
    });
    setSelection({
      workspaceId: field(pane, 'workspace_id') || selection.workspaceId,
      tabId: field(pane, 'tab_id') || selection.tabId,
      paneId: pane.id,
    });
  }

  const openTaskTarget = useCallback(
    (target: HomeServerEntry) => {
      const request = ++overviewTargetRequest.current;
      padDispatch({ type: 'open-pane' });
      setMissingRequestedTarget(null);
      setStrictTarget({
        serverId: target.serverId,
        sessionId: target.sessionId,
        workspaceId: target.workspaceId,
        tabId: target.tabId,
        paneId: target.paneId,
        afterGeneration: snapshotGenerationRef.current + 1,
      });
      setPadRequestedPaneId(target.paneId);
      const sessionStore = useServerSession.getState();
      sessionStore.clearPick();
      if (target.sessionId) {
        sessionStore.chooseSession({ serverId: target.serverId, sessionId: target.sessionId });
      }
      const panelStore = usePanelPickerStore.getState();
      panelStore.clearPick();
      if (target.paneId) {
        panelStore.choosePanel({ serverId: target.serverId, paneId: target.paneId });
      }
      if (target.serverId !== serverId) {
        void selectRecord(target.serverId).then((selected) => {
          if (!selected || request !== overviewTargetRequest.current) return;
          if (providedServerId === undefined) {
            router.replace({
              pathname: '/servers/[serverId]',
              params: {
                serverId: target.serverId,
                ...(target.sessionId ? { sessionId: target.sessionId } : {}),
                ...(target.workspaceId ? { workspaceId: target.workspaceId } : {}),
                ...(target.tabId ? { tabId: target.tabId } : {}),
                ...(target.paneId ? { paneId: target.paneId } : {}),
              },
            } as Href);
          }
        });
        return;
      }
      if (target.serverId === serverId) {
        if (target.sessionId) setChosenSessionId(target.sessionId);
        if (target.paneId && (!target.sessionId || target.sessionId === data.sessionId)) {
          const paneSelection = selectionForPane(data, target.paneId);
          if (paneSelection.paneId === target.paneId) setSelection(paneSelection);
        }
      }
    },
    [
      data,
      providedServerId,
      router,
      selectRecord,
      serverId,
      setSelection,
      padDispatch,
      setMissingRequestedTarget,
      setStrictTarget,
      setPadRequestedPaneId,
      setChosenSessionId,
    ]
  );

  useEffect(() => {
    if (!selectedServer || !workspaceHandoff) return;
    if (workspaceHandoff.target.serverId !== serverId) {
      // A Pad rail publishes before changing the selected record. Its source
      // owner must leave this handoff for the new keyed owner to consume.
      // Handoffs from another source are an outside identity change and can be
      // retired here instead of retargeting a later visit to this machine.
      if (workspaceHandoff.sourceServerId === serverId) return;
      homeWorkspaceHandoffStore.getState().clear();
      return;
    }
    if (!isFocused) return;
    const handoff = homeWorkspaceHandoffStore.getState().consume(workspaceHandoff.id);
    if (!handoff) return;
    // An agent route handed to this owner opens in the detail column; the
    // terminal selection stays where it was.
    if (handoff.agent)
      padDispatch({
        type: 'open-agent',
        target: handoff.agent.target,
        intent: handoff.agent.intent,
      });
    else openTaskTarget(handoff.target);
  }, [isFocused, openTaskTarget, padDispatch, selectedServer, serverId, workspaceHandoff]);

  // The saved SSH hosts, for the rail's own group under the servers. Hydrated
  // here as well as on the home list, since on a Pad this screen *is* the
  // home; the demo host rides along while the demo is on, as it does there.
  const sshHosts = useSshHostsStore((state) => state.hosts);
  const sshHostsLoading = useSshHostsStore((state) => state.loading);
  const hydrateSshHosts = useSshHostsStore((state) => state.hydrate);
  useEffect(() => {
    if (sshHostsLoading) void hydrateSshHosts();
  }, [hydrateSshHosts, sshHostsLoading]);
  const railSshHosts = sshHostsLoading
    ? []
    : sshHomeRows(sshHosts, demoMode ? demoSshHost() : null);

  const railServers = useMemo<GatewayRecord[]>(() => {
    if (!routeRecord || records.some((server) => server.serverId === routeRecord.serverId)) {
      return records;
    }
    return [routeRecord, ...records];
  }, [records, routeRecord]);

  // The gateway's phase for the status lights: a backend that is down is not
  // a gateway that is down. See `gatewayConnectionPhase`.
  const gatewayPhase = gatewayConnectionPhase(connection.phase, connection.backendUnavailable);
  // Published for the guides this workspace presents (their Run decision).
  useEffect(() => {
    useActiveConnection
      .getState()
      .set(selectedServer && serverId ? { serverId, phase: gatewayPhase } : undefined);
  }, [selectedServer, serverId, gatewayPhase]);
  useEffect(() => () => useActiveConnection.getState().set(undefined), []);

  // The rail's answers rather than the probes behind them: a probe is replaced
  // on every check (its time moves even when its answer does not), and holding
  // the whole map re-rendered this screen on each. Compared shallowly, so only
  // a light that changes colour reaches it.
  const railReachabilityByServer = useServerReachability(
    useShallow((state): Record<string, ServerReachability> =>
      Object.fromEntries(
        railServers.map((server) => [
          server.serverId,
          resolveServerReachability(
            server.serverId,
            state.probes[server.serverId],
            selectedServer ? { serverId, phase: gatewayPhase } : undefined
          ),
        ])
      )
    )
  );

  function selectPadServer(server: GatewayRecord) {
    ++overviewTargetRequest.current;
    padDispatch({ type: 'open-pane' });
    homeWorkspaceHandoffStore.getState().clear();
    setPadRequestedPaneId(undefined);
    setStrictTarget(null);
    setMissingRequestedTarget(null);
    if (server.serverId === serverId) return;
    void selectRecord(server.serverId);

    router.replace({
      pathname: '/servers/[serverId]',
      params: { serverId: server.serverId },
    } as Href);
  }

  /**
   * Characters into a pane, by the one rule that decides how they travel.
   *
   * `send-text` is a *paste* -- the gateway loads a tmux buffer and pastes it
   * bracketed -- and a full-screen program reads a bracketed paste as content
   * rather than as keys. So a keypress that went out this way did not press
   * anything: `i` typed the letter into the file instead of entering insert
   * mode, and on nvim's dashboard or a file tree, where the buffer cannot be
   * written, it did nothing at all. `lib/pane-input` is the rule and the
   * reason; this is the only place on this screen that acts on it.
   */
  function sendPaneCharacters(
    paneId: string,
    text: string,
    source: PaneInputSource,
    submit = false
  ): Promise<unknown> {
    if (paneInputDelivery(source) === 'keystrokes' && isSendableAsKeystrokes(text)) {
      // The submit rides in the same request, so an Enter cannot land between
      // two halves of a command line.
      return sendPaneKeys(data.sessionId, paneId, paneKeystrokes(text, { submit }));
    }
    if (!record) return Promise.reject(new Error('Not connected to a server.'));
    const capturedRecord = record;
    const requestServerId = serverId;
    const requestSessionId = data.sessionId;
    return sendBoundPaneText(
      capturedRecord,
      requestSessionId,
      paneId,
      text,
      submit,
      deliveryOwnership.capture(
        () =>
          useGatewayConnectionStore.getState().record === capturedRecord &&
          activeServerRef.current === requestServerId &&
          activePaneRef.current === paneId
      )
    );
  }

  async function sendInput() {
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    const hasAttachments = attachments.length > 0;
    const draft = draftStore.getState().text;
    if (!targetReady || connection.phase !== 'connected' || !ready || !requestPaneId || sending)
      return;
    if (!draft.trim() && !hasAttachments) return;
    const sendToken = composerSendGuard.acquire();
    if (sendToken === null) return;
    const ownsDelivery = deliveryOwnership.capture();
    const isCurrentSend = () =>
      composerSendGuard.owns(sendToken) &&
      ownsDelivery() &&
      useGatewayConnectionStore.getState().record === record &&
      activeServerRef.current === requestServerId &&
      activePaneRef.current === requestPaneId;
    setSending(true);
    setError(null);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            // The transfers started at selection, so this is normally already
            // settled and returns without yielding. When a photo is still climbing
            // the uplink it waits it out instead of sending half a message, and the
            // wait is visible: the button holds its spinner and the tile keeps its
            // own.
            const attachmentPaths = hasAttachments ? await awaitUploads() : [];
            if (attachmentPaths === null) {
              showToast({
                variant: 'danger',
                title: t`Some files did not upload`,
                message: describeBlockedSend(attachments),
              });
              return;
            }
            if (!isCurrentSend()) return;

            // With nothing attached the draft goes over exactly as typed. Attachments
            // join with spaces, not newlines: in a plain shell pane every newline is
            // an Enter, so line-separated paths would each execute as a command.
            // Upload names are uuid-based and never contain spaces, so no quoting is
            // needed.
            const value =
              attachmentPaths.length > 0
                ? [draft.trim(), ...attachmentPaths].filter((part) => part.length > 0).join(' ')
                : draft;
            if (!value.trim()) return;

            if (assignment.active) {
              // The task goes to an assistant that does not exist yet, so this neither
              // types into the pane nor folds attachment paths into the line: the
              // references travel as their own block (`attachmentCommandText`), and a
              // bundled instruction set rides with them rather than in the field.
              if (!record) rethrow(new Error('Not connected to a server.'));
              const outcome = await assignment.assign(
                record,
                draft,
                attachments,
                {
                  serverId: requestServerId,
                  sessionId: data.sessionId,
                  sourcePaneId: requestPaneId,
                  connectionGeneration: ATTACHMENT_CONNECTION_GENERATION,
                },
                isCurrentSend
              );
              if (!isCurrentSend()) return;
              if (outcome.status === 'sent') {
                assignment.close();
                showToast({
                  variant: 'success',
                  title: t`Assistant started`,
                  message: t`It works on its own. Follow it in Agent collaboration.`,
                });
              } else {
                // Never retried automatically: a second attempt would be a second
                // assistant, and nothing here can tell whether the first received the
                // task. The text stays in the composer and the chip stays armed so the
                // reader decides, after checking the terminal that was created.
                showToast({
                  variant: 'danger',
                  title: t`Delivery not confirmed`,
                  message: t`A terminal was created. Check it before sending again — your task is still here.`,
                });
                return;
              }
            } else if (selectedAgent) {
              await sendAgentText(data.sessionId, requestPaneId, value);
            } else {
              // A shell needs Enter to run what was typed. An editor does not: Enter
              // there is a newline in the buffer, so it belongs on the key row where
              // it can be pressed deliberately.
              //
              // A composed line stays a paste, and that is not an oversight: it is
              // what keeps a two-line message one message instead of two Enters, and
              // the only channel by which an agent recognises an attachment path as
              // an image.
              await sendPaneCharacters(requestPaneId, value, 'composer', !fullScreenPane);
            }
            if (!isCurrentSend()) return;
            setDraft('');
            clearAttachments();
            setStickBottomNonce((value) => value + 1);
            // Delivery is acknowledged. Painting its output must not keep the input
            // locked behind another network round trip. Events and the existing
            // polling fallback cover output that arrives after this immediate read.
            void refreshOutput();
          },
          (failure) => {
            if (isCurrentSend()) {
              showToast({
                variant: 'danger',
                title: t`Message not sent`,
                message: describeGatewayFailure(failure, t`Could not send input.`).message,
                durationMs: 6000,
              });
            }
          }
        );
      },
      () => {
        if (composerSendGuard.release(sendToken) && activeServerRef.current === requestServerId)
          setSending(false);
      }
    );
  }

  // The virtual keyboard fires a key per tap, so it skips the spinner state the
  // row uses and just sends. An immediate read keeps the caret responsive
  // without waiting on the event stream.
  function typeKey(key: string) {
    const requestPaneId = selection.paneId;
    if (!targetReady || connection.phase !== 'connected' || !ready || !requestPaneId) {
      return Promise.resolve('failed' as const);
    }
    return sendPaneKeys(data.sessionId, requestPaneId, [key]).then(
      () => {
        refreshOutputRef.current();
        return 'sent' as const;
      },
      (err: unknown) => keyFailureOutcome(err)
    );
  }

  function typeText(text: string) {
    const requestPaneId = selection.paneId;
    if (!targetReady || connection.phase !== 'connected' || !ready || !requestPaneId) return;
    void sendPaneCharacters(requestPaneId, text, 'virtual-key')
      .then(() => refreshOutputRef.current())
      .catch(() => {});
  }

  async function sendTerminalKey(item: TerminalKey) {
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    if (!targetReady || connection.phase !== 'connected' || !ready || !requestPaneId || sendingKey)
      return;
    setSendingKey(item.key);
    setError(null);
    if (keyScope) recordUsage(keyScope, item.key);
    return settleAfter(
      async () => {
        return recoverWith(
          async () => {
            // The same rule the drawer's row sends by (`terminalKeyDelivery`):
            // a cap made of characters goes as keys, and only characters the
            // gateway cannot take as key names fall back to a paste.
            const delivery = terminalKeyDelivery(item);
            if (delivery.kind === 'keys') {
              await sendPaneKeys(data.sessionId, requestPaneId, delivery.keys);
            } else {
              await sendPaneCharacters(
                requestPaneId,
                delivery.text,
                'terminal-key',
                delivery.submit
              );
            }
            setTimeout(() => void refreshOutput(), 80);
          },
          (failure) => {
            if (activeServerRef.current === requestServerId) {
              setError(describeGatewayFailure(failure, t`Could not send key.`).message);
            }
          }
        );
      },
      () => {
        if (activeServerRef.current === requestServerId) setSendingKey(null);
      }
    );
  }

  function openQuickActions() {
    if (!targetReady || !selection.paneId) return;
    Keyboard.dismiss();
    router.push({
      pathname: '/commands',
      params: {
        sessionId: data.sessionId,
        paneId: selection.paneId,
        // The sheet can make a new panel and send this screen to it, which
        // needs the workspace the current pane lives in to make it beside,
        // and this server's id to hand the pick back through.
        serverId,
        workspaceId: selection.workspaceId,
        // A new task starts beside the pane it was asked for, so the sheet
        // needs the tab it is in and the directory it is sitting in.
        tabId: selection.tabId,
        cwd: field(selectedPane, 'cwd'),
        mode: selectedAgent ? 'agent' : 'terminal',
        backendKind: sessions.find((session) => session.id === data.sessionId)?.kind ?? '',
        // The health answer this screen is already holding. A gateway that
        // cannot spawn gets a sheet with neither New task nor Stop in it.
        canSpawn: gatewaySupportsAgentSpawn(data.health?.capabilities) ? '1' : '',
        canLazygit: data.health?.capabilities?.includes('pane_lazygit') ? '1' : '',
        canSavedHistory: data.health?.capabilities?.includes(
          PANE_CAPTURED_HISTORY_SEGMENTS_CAPABILITY
        )
          ? '1'
          : '',
        // Whether opening a plain URL on this machine is honest. The demo is
        // excluded before the transport is even consulted: its record points
        // at an address that does not exist, so every port on it is a page
        // that will never load.
        canOpenWeb:
          !demoMode && allowsWebServiceOpen(data.health?.transportSecurity?.protection) ? '1' : '',
        // Why it is off, when the why is worth saying. A tunnelled gateway
        // is loopback-bound on its own machine, so the transport reads
        // `local-only` and the gate closes -- correctly, since the tunnel
        // carries one port and vouches for no other. The reader who paired
        // through SSH deliberately is the one who will go looking for these
        // rows, so the sheet says so instead of quietly dropping them.
        webBlockedBy:
          !demoMode &&
          record?.sshTunnel &&
          !allowsWebServiceOpen(data.health?.transportSecurity?.protection)
            ? 'tunnel'
            : '',
        // What Stop is offered for, and what it would be sent to. Passed
        // rather than looked up there: this screen already polls both, and a
        // sheet that re-read them could offer Stop for an agent that stopped
        // while it was opening.
        agentTarget: selectedAgent ? field(selectedAgent, 'target') || selectedAgent.id : '',
        agentStatus: selectedAgent?.status ?? '',
      },
    } as Href);
  }

  // Cancelling a picker is not a failure, and both pickers report it as an
  // empty result, so only a thrown error is ever surfaced.
  function chooseAttachmentSource(source: AttachmentSource) {
    setAttachmentMenuOpen(false);
    const picker = capturePicker();
    if (!picker.isCurrent()) return;
    void pickAttachments(source)
      .then((files) => {
        picker.addFiles(files);
        const cut = takePickTruncationNotice();
        if (cut && picker.isCurrent())
          showToast({ variant: 'warning', title: t`Not every file was added`, message: cut });
      })
      .catch((failure: unknown) => {
        if (!picker.isCurrent()) return;
        showToast({
          variant: 'danger',
          title: t`Could not add a file`,
          message: describePickerFailure(source, failure),
        });
      });
  }

  /**
   * Open one of the session's artifacts, however it was referred to. The two
   * views name a file differently -- the terminal has a printed path, a part
   * has an asset id -- and each is resolved by asking the gateway about that
   * one file. Neither asks it to read an arbitrary path: the gateway holds both
   * to its scoped-root fence, so anything outside a root quietly finds
   * nothing.
   */
  const openMatchingAsset = useCallback(
    (resolve: (sessionId: string, tabId: string) => Promise<SessionAsset | null>) => {
      if (openingAssetRef.current) return;
      openingAssetRef.current = true;
      void resolve(data.sessionId, selection.tabId)
        .then((asset) => {
          if (asset) {
            setOpenAsset(asset);
            return;
          }
          showToast({
            variant: 'info',
            title: t`Not available`,
            message: t`This file is not among the session artifacts.`,
          });
        })
        .catch((failure: unknown) => {
          showToast({
            variant: 'danger',
            title: t`Could not open the file`,
            message: describeGatewayFailure(failure, t`The computer did not return it.`).message,
          });
        })
        .finally(() => {
          openingAssetRef.current = false;
        });
    },
    [data.sessionId, selection.tabId, showToast, t]
  );

  /** A file path tapped in the terminal view. */
  /**
   * A theme package tapped in the output, handled without leaving it.
   *
   * A `.muqun-theme` has exactly one meaning, so the tap does not route through
   * the file viewer and then ask the reader to press Preview: that second press
   * asks a question the extension already answered. It downloads into the card
   * above the Latest pill and previews from there.
   */
  const openThemePackage = useCallback(
    async (path: string, name: string) => {
      // One at a time, and the new tap owns the card: a second package dropped
      // while the first is still arriving cancels it rather than racing it into
      // the same ref. See `themeRequestRef` for why the work is owned at all.
      themeRequestRef.current?.cancel();
      const request = new ThemeImportRequest();
      themeRequestRef.current = request;
      setThemeDrop({ phase: 'downloading', name, received: 0, total: null });
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      return settleAfter(
        async () => {
          try {
            const asset = await resolveAssetByPath(
              data.sessionId,
              selection.tabId,
              path,
              field(selectedPane, 'cwd')
            );
            if (!asset) rethrow(new Error(t`This file is not among the session artifacts.`));
            const bytes = await readAssetBytes(asset, {
              // Theme archives are downloadable files, not Gateway previews.
              download: true,
              signal: request.signal,
              maxBytes: THEME_LIMITS.packageBytes,
              onProgress: (received, total) => {
                if (!request.signal.aborted)
                  setThemeDrop({ phase: 'downloading', name, received, total });
              },
            });
            const unpacked = unpackTheme(bytes);
            prepared = await prepareThemeAssets(unpacked, { signal: request.signal });
            const candidate = { manifest: unpacked.manifest, prepared };
            request.handoff(() => {
              themeCandidateRef.current?.prepared?.dispose();
              themeCandidateRef.current = candidate;
            });
            transferred = true;
            setThemeDrop({
              phase: 'ready',
              name,
              themeName: unpacked.manifest.name,
              applying: false,
            });
          } catch (failure) {
            // A download this screen itself cancelled is not news, and the card it
            // would report on has already gone with the screen.
            if (!request.isCanceled)
              setThemeDrop({
                phase: 'failed',
                name,
                message:
                  failure instanceof AudioPlaybackError
                    ? t`Update the Gateway to open or save this file.`
                    : describeGatewayFailure(failure, t`Could not open this theme.`).message,
              });
          }
        },
        () => {
          if (!transferred) prepared?.dispose();
          if (themeRequestRef.current === request) themeRequestRef.current = null;
        }
      );
    },
    [data.sessionId, selection.tabId, selectedPane, t]
  );

  const openFileLink = useCallback(
    (path: string) => {
      if (/\.muqun-theme$/i.test(path)) {
        void openThemePackage(path, path.split('/').pop() ?? path);
        return;
      }
      openMatchingAsset((sessionId, tabId) =>
        // The pane's directory travels with the path: a relative one is
        // relative to where that terminal is standing, and only this screen
        // knows where that is.
        resolveAssetByPath(sessionId, tabId, path, field(selectedPane, 'cwd'))
      );
    },
    [openMatchingAsset, openThemePackage, selectedPane]
  );

  /** An `asset-ref` part tapped in the structured view, which names an id. */
  const openAssetById = useCallback(
    (assetId: string) =>
      openMatchingAsset((sessionId, tabId) => resolveAssetById(sessionId, tabId, assetId)),
    [openMatchingAsset]
  );

  /**
   * The header's one button: everything that is running, and everywhere it
   * could be running instead.
   *
   * It used to be two buttons in this corner -- a monitor for the machines and
   * their backends, a panels glyph for the workspaces and panes inside one of
   * them -- which is one address asked in two places. The machines are a rail
   * at the top of this sheet now, so the monitor has gone and what it knew
   * travels here: the pane the reader is leaving, so returning to this machine
   * lands where they were, and the backend list the header has already decided
   * from, so the rail does not grow a chip while the sheet is opening.
   */
  function openPanelPicker() {
    Keyboard.dismiss();
    useServerSession.getState().rememberPane(serverId, data.sessionId, selection.paneId);
    router.push({
      pathname: '/panels',
      params: {
        serverId,
        sessionId: data.sessionId,
        paneId: selection.paneId,
        label: routeRecord?.label ?? record?.label ?? t`Computer`,
        embedded: providedServerId === undefined ? '0' : '1',
        sessions: encodeSessionChoices(sessions),
      },
    } as Href);
  }

  // The key row's press goes through a stable handler so the caps keep their
  // props while the reader types: `sendTerminalKey` closes over most of this
  // screen, and as a prop it re-rendered every cap on every keystroke. What a
  // cap shows -- `sending`, `disabled` -- is still read at render.
  const pressTerminalKey = useStableHandler((item: TerminalKey) => void sendTerminalKey(item));

  if (hydrationError)
    return (
      <AppDrawer>
        <GatewayStorageError busy={loading} onRetry={retryHydration} />
      </AppDrawer>
    );

  if (!loading && !routeRecord) {
    return (
      <AppDrawer>
        <View style={styles.centerState}>
          <Text variant="heading">
            <Trans>Computer not found</Trans>
          </Text>
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>Return to the computer list and pair again.</Trans>
          </Text>
        </View>
      </AppDrawer>
    );
  }

  // The pane, and only the pane. The workspace used to lead this line because
  // the header was the one place its name appeared; it no longer is -- the
  // switch indicator in the notice stack spells the whole address out -- and
  // naming it twice spent the width the pane name needs.
  const detailTitle = displayPane
    ? panelTitle(displayPane, selectedAgent)
    : (routeRecord?.label ?? record?.label ?? t`Computer`);
  const shellTitle = padDetailIsPane
    ? detailTitle
    : (padAgentTitle ?? routeRecord?.label ?? record?.label ?? t`Computer`);

  // The pane's two entries: what goes into the session, and what came out of
  // it. Written once because they are the same two buttons whether they sit in
  // the key row or float in the corner without it -- the setting moves them, it
  // does not change them. Only the fill differs: on the dock's glass they are
  // tinted circles, over the pane they are transparent and their tray is what
  // holds the light.
  // The scrolling terminal keys, written once because they are the same keys
  // wherever they are drawn: on their own row when the dock is ordinary, and
  // inside the keyboard panel when that is up. Opening the keyboard used to
  // take this row away, which on an editor meant losing `esc`, `:w` and the
  // Ctrl chords at the moment the reader started typing.
  //
  // Every prop is a primitive or a stable handler, so the row is rebuilt only
  // when a key, its state or the theme changes -- not on every render of this
  // screen, which a refreshed pane record alone would otherwise cause.
  const terminalKeysDisabled =
    !targetReady || connection.phase !== 'connected' || !selectedPane || Boolean(sendingKey);

  /**
   * The way back to a composer the app's keyboard stood down.
   *
   * A circle, and it rides in the trailing seat of the terminal keys' row --
   * opposite the leading seat the ordinary key row keeps for the keyboard
   * toggle. It used to have a row of its own, which cost the pane a full line
   * for one control, out of the height the keyboard had just been opened to
   * get.
   */
  /**
   * The one control in the key row that is not a key: who the next message is
   * for.
   *
   * A toggle rather than a menu, because the answer is a row of assistants and
   * a row is what opens above the field. It is here rather than in the header
   * for the same reason the keyboard toggle is: it changes what typing does, so
   * it belongs beside the typing.
   */
  /**
   * What the destination is called, in one place, so the chip, the placeholder
   * and the Send button cannot describe it three different ways.
   */
  const assignmentLabel =
    assignment.target === null
      ? ''
      : assignment.target.type === 'new'
        ? t`a new ${assignment.target.kind}`
        : assignment.target.name;

  // Shown on capability, not on loaded data: the catalog is fetched when the
  // strip opens, so gating the toggle on `assistantKinds` would hide the only
  // control that loads them. `assignmentStripState` holds the rest of the rule,
  // including the one a tmux session hits -- no toggle, no sentence, an ordinary
  // composer, exactly as before.
  const assignmentStrip = assignmentStripState(collaborationReason, {
    canSpawn: gatewaySupportsAgentSpawn(data.health?.capabilities),
    candidates: assignmentCandidates.length,
  });
  const assignmentToggle = assignmentStrip.toggle ? (
    <PressableScale
      testID="assignment-toggle"
      accessibilityRole="button"
      accessibilityState={{ expanded: assignment.open }}
      accessibilityLabel={
        assignment.open ? t`Stop assigning a task` : t`Assign this to an assistant`
      }
      feedback="selection"
      pressedScale={0.9}
      disabled={!targetReady || !selectedPane || sending}
      onPress={() => {
        if (assignment.open) {
          assignment.close();
          return;
        }
        assignment.setOpen(true);
        // Fetched when the row that shows them is opened, not on mount: most
        // sessions never open it, and the catalog is a request.
        void loadAssistantKinds();
      }}
      style={[
        styles.keyRowToggle,
        { borderRadius: profile.chrome.control },
        {
          backgroundColor: surfaceBackground(
            assignment.open ? theme.colors.primarySubtle : chromeGlass
          ),
        },
      ]}>
      <AgentIcon size={16} color={theme.colors.primary} />
    </PressableScale>
  ) : null;

  const composerEntry = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Write a line`}
      feedback="selection"
      pressedScale={0.9}
      onPress={() => setComposerRevealed(true)}
      style={[
        styles.keyRowToggle,
        { borderRadius: profile.chrome.control },
        { backgroundColor: surfaceBackground(chromeGlass) },
      ]}>
      <EditIcon size={16} color={chromeText} />
    </PressableScale>
  );

  /**
   * The row the keyboard carries on its own behalf: the terminal keys, and the
   * one control that is not a key.
   *
   * The same element in the dock and in the editor panel, because it is the
   * same keyboard in both.
   */
  const keyboardShortcuts = dock.keysInKeyboard ? (
    <View style={styles.keyRowWrap}>
      <TerminalKeyRow
        // The fallback chords this adds for an older gateway (alt+arrows)
        // pass the same test as the row they join.
        keys={keyboardCombinationKeys(terminalKeys, shortcuts?.keyActions === undefined).filter(
          deliverableKey
        )}
        sendingKey={sendingKey}
        disabled={terminalKeysDisabled}
        onPressKey={pressTerminalKey}
        textColor={chromeText}
        background={chromeGlass}
        activeBackground={theme.colors.primary}
        activeText={theme.colors.onPrimary}
        style={isPadLayout ? styles.padTerminalKeyViewport : undefined}
        contentContainerStyle={styles.terminalKeyList}
      />
      {dock.composerEntry ? composerEntry : null}
    </View>
  ) : undefined;

  /*
    The input, written once because it is the same field in two places now: in
    the dock on an ordinary pane, and floating in the editor panel on an editor.

    It goes for an approval. It is the strongest of the "send the pane something
    else" surfaces, and a text field left under a standing permission menu
    invites typing into a program that is not reading typing. Nothing already
    drafted is lost -- the draft lives in the screen's store, not the field, so
    the words come back with the dock.

    It sits outside the keyboard's branch rather than inside its else, because
    the keyboard is no longer the end of it: an editor can summon this back over
    the keys to paste a line without giving up `esc` and the chords to do it.
    `dock.composer` is what decides now, and it accounts for both.
  */
  /**
   * Who the next message is for, above the field that writes it.
   *
   * Written once because the composer is rendered in two places -- the ordinary
   * dock, and floating in the editor panel -- and a strip that only existed in
   * one of them was a control the reader could open and never see.
   */
  const assignmentBar =
    dock.composer && assignment.open ? (
      <AgentAssignmentBar
        candidates={assignmentStrip.upgrade ? [] : assignmentCandidates}
        kinds={assignmentStrip.upgrade ? [] : assistantKinds}
        target={assignment.target}
        onChoose={assignment.choose}
        onClose={assignment.close}
        disabled={!targetReady || sending}
        commandName={assignment.command?.name}
        upgrade={assignmentStrip.upgrade}
      />
    ) : null;

  const pendingQuestionHint =
    data.health?.capabilities?.includes('terminal_pending_user_input') &&
    (selectedAgent?.status === 'working' || selectedAgent?.status === 'idle') &&
    selectedAgent?.raw.pending_user_input === true ? (
      <Text testID="terminal-pending-question-hint" variant="caption" color={theme.colors.warning}>
        {t`Use Shift+Left on the terminal keyboard to answer the pending question.`}
      </Text>
    ) : null;

  const composerField = (
    <DraftStoreComposer
      draftStore={draftStore}
      voiceContext={`${serverId}:${data.sessionId}:${selection.paneId}`}
      entering={fadeInDown('short')}
      exiting={fadeOutDown('short')}
      layout={dockRowLayout}
      leading={
        // The paperclip keeps this seat, always.
        //
        // It used to be swapped for a chip naming the assistant while a task
        // was addressed, on the reasoning that the row had no width to spare
        // and the destination was the most important thing to say. Both halves
        // were wrong. Attaching a reference image is the single most likely
        // thing to want *while* writing a task -- reusing this queue is why
        // collaboration moved into the composer at all -- so the one mode that
        // needs the paperclip most was the one mode that hid it. And the
        // destination was never unsaid: the strip above highlights the chosen
        // assistant, the placeholder names it, and Send names it again.
        dock.attachEntry ? (
          <ComposerAttachmentButton
            testID="terminal-composer-attach"
            label={attachmentMenuOpen ? t`Close the attachment menu` : t`Attach a file`}
            expanded={attachmentMenuOpen}
            disabled={!targetReady || !selectedPane || sending}
            onPress={() => setAttachmentMenuOpen((open) => !open)}
            color={theme.colors.primary}
          />
        ) : null
      }
      inputProps={{
        testID: 'terminal-composer-input',
        onChangeText: (text) => draftStore.setState({ text }),
        // The picker follows the caret, and takes Esc from a hardware
        // keyboard. Both are inert when no catalog is in hand.
        ...slashPopup.inputProps,
        // The slash picker's handler stores the caret, which is also what
        // the @ mention trigger reads.
        editable:
          !paneHidden &&
          targetReady &&
          connection.phase === 'connected' &&
          Boolean(selectedPane) &&
          !sending,
        maxLength: 64 * 1024,
        // Summoned into the editor panel, the field arrives *instead of* the
        // app's keyboard rather than on top of it, so a reader who still had
        // to tap it before typing would have gained nothing by asking for it.
        autoFocus: dock.editorMode && composerRevealed,
        autoCapitalize: 'sentences',
        // Names the surface, never the pane. The agent's name is already
        // in the header a few points above this field, and repeating it
        // here cost more than it said: a real agent title -- one reading
        // "check dots-hyprland config compatibility", written half in a
        // double-width script -- wrapped the placeholder onto a second line
        // and grew the composer to match, on the one screen where vertical
        // space is worth most -- and on the Pad's compact composer, which
        // the tablet branch hit independently.
        placeholder: assignment.active
          ? assignment.target?.type === 'new'
            ? t`Task for a new ${assignment.target.kind}`
            : t`Task for ${assignmentLabel}`
          : selectedAgent
            ? t`Send a message`
            : fullScreenPane
              ? t`Type into this editor`
              : t`Run a terminal command`,
      }}
      send={{
        accessibilityLabel: assignment.active
          ? t`Send this task to ${assignmentLabel}`
          : selectedAgent
            ? t`Send to agent`
            : t`Run command`,
        armed: Boolean(hasSendableContent && selectedPane),
        sending,
        disabled:
          paneHidden ||
          !targetReady ||
          connection.phase !== 'connected' ||
          !hasSendableContent ||
          !selectedPane ||
          sending,
        onPress: () => void sendInput(),
      }}
    />
  );

  /*
    What floats over an editor, and what does not.

    The keyboard, the keys and the input -- and nothing else. No pane strip, no
    paperclip, no quick actions: every one of those is a row, a row is height,
    and the height would come out of the file. Panes are still reachable, from
    the panel picker in the header, which is where a reader looking for a
    different pane goes anyway.

    The key row appears here only when the composer has taken the app's keyboard
    away: the keys were riding inside it, and they are the reason the panel
    exists at all. Its toggle is the inverse of the pen -- it puts the field away
    and brings the keyboard back.
  */
  const editorPanelBody = (
    <>
      {dock.virtualKeyboard ? (
        <VirtualKeyboard
          key={`${serverId}:${data.sessionId}:${selection.paneId}`}
          disabled={!targetReady || connection.phase !== 'connected' || !selectedPane}
          onText={typeText}
          onKey={typeKey}
          onClose={() => setKeyboardMode(false)}
          shortcuts={keyboardShortcuts}
          vocabulary={keyVocabulary}
          wide={isPadLayout}
        />
      ) : null}
      {dock.keyRow ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOutDown('short')}
          style={styles.keyRowWrap}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Back to the on-screen keyboard`}
            feedback="selection"
            pressedScale={0.9}
            onPress={() => {
              Keyboard.dismiss();
              setComposerRevealed(false);
            }}
            style={[
              styles.keyRowToggle,
              { borderRadius: profile.chrome.control },
              { backgroundColor: surfaceBackground(chromeGlass) },
            ]}>
            <KeyboardIcon size={16} color={theme.colors.primary} />
          </PressableScale>
          <TerminalKeyRow
            keys={terminalKeys}
            sendingKey={sendingKey}
            disabled={terminalKeysDisabled}
            onPressKey={pressTerminalKey}
            textColor={chromeText}
            background={chromeGlass}
            activeBackground={theme.colors.primary}
            activeText={theme.colors.onPrimary}
            leading={assignmentToggle}
            // Only the trailing edge: the keyboard toggle holds the leading one.
            style={{ marginRight: -dockBleed.right }}
            contentContainerStyle={{
              paddingRight: styles.keyRowScroller.paddingRight + dockBleed.right,
            }}
          />
        </Animated.View>
      ) : null}
      {/* Above the field, because it answers a question the field then asks:
          who is this for. It is the pane strip's shape on purpose -- a row of
          named, scrollable targets -- so the two read as the same kind of
          choice rather than as two unrelated pickers. */}
      {assignmentBar}
      {/* This copy belongs to the editor panel; the ordinary dock owns its
          own menu independently of whether its virtual keyboard is open. */}
      {attachmentMenuOpen && dock.attachEntry ? (
        <View
          style={[
            styles.composerFloatingContent,
            isPadLayout && styles.padComposerFloatingContent,
          ]}>
          <AttachmentMenu onSelect={chooseAttachmentSource} textColor={chromeText} />
        </View>
      ) : null}
      {dock.composer ? pendingQuestionHint : null}
      {dock.composer ? composerField : null}
    </>
  );

  const paneEntries = (fill: string) => (
    <>
      <PressableScale
        testID="terminal-open-quick-actions"
        accessibilityRole="button"
        accessibilityLabel={t`Open quick actions`}
        feedback="selection"
        pressedScale={0.9}
        disabled={!targetReady || !selectedPane}
        onPress={openQuickActions}
        style={[
          styles.keyRowToggle,
          isPadLayout && styles.padKeyRowEntry,
          { borderRadius: profile.chrome.control },
          { backgroundColor: surfaceBackground(fill) },
        ]}>
        <QuickActionIcon size={isPadLayout ? 15 : 16} color={theme.colors.primary} />
      </PressableScale>
      {/* Quick actions is what goes into the session; this is what came out of
          it. That pairing is why files live beside it rather than as a fifth
          circle in the header. */}
      <ArtifactsButton
        sessionId={data.sessionId}
        tabId={selection.tabId}
        label={routeRecord?.label ?? record?.label ?? t`Computer`}
        disabled={!targetReady || !selectedPane}
        background={fill}
        compact={isPadLayout}
      />
      {/* And this is what the session changed in place. It draws nothing at
          all unless the gateway has the routes and this pane's directory is a
          checkout, so the row is unchanged on an older server. */}
      <GitDiffButton
        serverId={serverId}
        sessionId={data.sessionId}
        paneId={selection.paneId}
        cwd={field(selectedPane, 'cwd')}
        capabilities={data.health?.capabilities}
        disabled={!targetReady || !selectedPane}
        background={fill}
        compact={isPadLayout}
      />
    </>
  );

  // The same switcher lives on both form factors. Phones give it its own row;
  // a Pad has enough width to keep it beside the shortcut controls, preserving
  // the compact two-row dock (controls over composer) without losing pane
  // navigation. Only one branch mounts at a time, so the shared scroll ref and
  // measured chip positions always belong to the visible strip.
  const paneChips = tabPanes.map((pane) => {
    const paneAgent = data.agents.find((agent) => field(agent, 'pane_id') === pane.id);
    const active = pane.id === selection.paneId;
    return (
      <PaneChip
        key={pane.id}
        testID={`pane-chip-${pane.id}`}
        label={panelTitle(pane, paneAgent)}
        accessibilityLabel={t`Switch to ${panelTitle(pane, paneAgent)}`}
        active={active}
        agentStatusColor={paneAgent ? statusColor(paneAgent.status) : null}
        restColor={chromeText}
        activeFill={theme.colors.primary}
        activeText={theme.colors.onPrimary}
        onLayout={(event: LayoutChangeEvent) => {
          const { x, width } = event.nativeEvent.layout;
          paneChipLayouts.current[pane.id] = { x, width };
          // The chips measure asynchronously, so the one the strip should be
          // showing may only become findable here -- on first open, and after
          // a rename changes a chip's width.
          if (active) revealActivePaneChip();
        }}
        onPress={() => choosePane(pane)}
      />
    );
  });

  const padPaneSwitcher = !dock.paneChips ? null : tabPanes.length <= 3 ? (
    <View style={styles.padPaneStripInline}>{paneChips}</View>
  ) : (
    <Animated.ScrollView
      ref={paneStripRef}
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={32}
      onScroll={(event) => {
        paneStripOffsetRef.current = event.nativeEvent.contentOffset.x;
      }}
      onLayout={(event: LayoutChangeEvent) => {
        paneStripViewportRef.current = event.nativeEvent.layout.width;
        revealActivePaneChip();
      }}
      contentContainerStyle={styles.padPaneStrip}
      style={styles.padPaneStripViewport}>
      {paneChips}
    </Animated.ScrollView>
  );

  const simfarmSplit = {
    previewWidth: workspaceLayout.previewWidth,
    allowed: !demoMode && allowsWebServiceOpen(data.health?.transportSecurity?.protection),
  };
  const padRailCollapsed = padDetailIsPane && workspaceLayout.previewWidth > 0;
  // The pane's side insets, on the edges where it actually meets the glass: the
  // Pad rail owns the left edge while it stands, and the simulator preview owns
  // the right one while it is open. Controls and the grid stay inside these;
  // the dock's glass and the terminal's fill still run to the edge.
  const sideInsets = {
    left: isPadLayout && !padRailCollapsed ? 0 : insets.left,
    right: simfarmSplit.previewWidth > 0 ? 0 : insets.right,
  };

  return (
    <AppDrawer
      // Not `previewOpen`: the layout is what decides, and it declines the
      // preview on a window too narrow to hold both. Reading its answer keeps
      // the rail from standing down for a preview that never opened.
      padRailCollapsed={padRailCollapsed}
      padRail={
        <PadServerRail
          servers={railServers}
          reachabilityByServer={railReachabilityByServer}
          selectedServerId={record?.serverId ?? null}
          activeConnection={{ serverId, phase: gatewayPhase }}
          selectedPaneId={padDetailIsPane ? selection.paneId || null : null}
          selectedAsid={padDetail.kind === 'agent' ? padDetail.asid : undefined}
          workbenchSelected={false}
          commandOptions={{
            embedded: true,
            routeBound,
            sourceRouteActive,
            openAgentInPlace,
            workspaceServerId: serverId,
          }}
          onBack={() => setOverviewVisible(true)}
          onSelectServer={selectPadServer}
          onPairServer={() => router.push('/explore')}
          onOpenSettings={() => router.push('/settings')}
          onOpenSsh={() => router.push('/ssh')}
          sshHosts={railSshHosts}
          // The shell cannot open in this column: the workspace is keyed by
          // the selected gateway record, so a host leaves for its own screen.
          onSelectSshHost={(host) => router.navigate(`/ssh/${host.id}`)}
        />
      }
      // Home covers the whole frame, rail included, and stays mounted between
      // visits: the rail and the detail keep their layout under it.
      overlayVisible={overviewVisible}
      overlay={
        <PadHomeOverlay visible={overviewVisible}>
          <HomeOverview
            width={workspaceLayout.availableWidth}
            layoutMode={workspaceLayout.mode}
            embedded
            routeBound={routeBound}
            sourceRouteActive={sourceRouteActive}
            activeConnection={{ serverId, phase: gatewayPhase }}
            onExitOverview={() => padDispatch({ type: 'hide-home' })}
            onOpenAgentInPlace={openAgentInPlace}
          />
        </PadHomeOverlay>
      }
      // The header stays mounted under Home; the overlay covers it.
      detailTitle={shellTitle}
      expandDetailTitle={!padDetailIsPane}
      onDetailBack={canReturnToPane ? returnToPreviousPane : demoMode ? leaveDetail : undefined}
      detailFadeColor={padDetailIsPane ? terminalBackground : theme.colors.background}
      detailTitleSlot={
        !padDetailIsPane ? undefined : (
          // The title carries the workspace switch, so it replaces the header's
          // plain pill. It draws the same pill either way -- with one workspace
          // the gesture is simply off.
          <WorkspaceTitleSwitcher
            title={detailTitle}
            workspaces={data.workspaces}
            workspaceId={selection.workspaceId}
            onCycle={selectWorkspace}
            onIndicator={announceWorkspaceSwitch}
          />
        )
      }
      onDetailAction={padDetailIsPane && hasLoadedData ? openPanelPicker : undefined}
      /*
        The way out of the split, beside the control that arranges panes.

        The chat-view toggle that used to sit here left with the chat view
        (Ellen, 2026-07-27) and the slot stayed empty. It earns its place again
        only while the preview is up: opening it took a trip through quick
        actions, and closing it should not cost the same trip back. An icon
        alone, because it appears exactly when there is a simulator on screen to
        close and nothing else the header could mean by it.
      */
      detailAccessory={
        !padDetailIsPane
          ? [<PadAgentSessionAction key="agent-session" controls={padAgentControls} />]
          : [
              // No machine button beside the panels one. Two glyphs in this corner
              // were two halves of one question -- which machine, which backend,
              // which workspace, which panel -- and a reader had to know which half
              // theirs was in before they could press anything. `onDetailAction`
              // above is the one button, and the whole address is inside it.
              padDetailIsPane && simfarmSplit.previewWidth > 0 ? (
                <PressableScale
                  key="simulator"
                  accessibilityLabel={t`Hide the simulator`}
                  onPress={() => toggleSimfarmSplit(serverId)}
                  style={navHeaderButtonStyle}>
                  <CloseIcon size={18} color={theme.colors.text} />
                </PressableScale>
              ) : null,
            ]
      }>
      {/* The terminal and, beside it, the simulator it is changing.

          A row rather than a third column of the drawer's own: the rail belongs
          to the drawer and lists machines, while these two are one machine's
          screen split in half. `previewWidth` is 0 whenever the preview is off
          or the window is too narrow to keep both halves usable, so this is a
          row of one for the whole of the compact layout and most of the Pad. */}
      <View style={styles.workspaceHost}>
        {/* Hidden, not unmounted, under an agent detail as under Home: the
            terminal keeps its scrollback and view state for the way back. */}
        <View
          pointerEvents={paneHidden ? 'none' : 'auto'}
          accessibilityElementsHidden={paneHidden}
          importantForAccessibility={revealableSubtreeImportance(paneHidden)}
          style={[StyleSheet.absoluteFill, { opacity: paneHidden ? 0 : 1 }]}>
          <View style={styles.workspaceSplit}>
            {/* No background and no wallpaper of its own. `AppDrawer` wraps this
            screen and already paints both, and painting them again here drew a
            second full-screen image that nothing could ever see: the opaque
            fill on this view covered the drawer's copy, and HWUI does no
            occlusion culling, so the hidden one was still decoded and still
            drawn on every frame.

            Letting the drawer's single layer through is also what finally makes
            the reader's surface-opacity preference apply here: the drawer paints
            `surfaceBackground(colors.background)`, which at the default alpha of
            1 is `colors.background` exactly -- the same pixels as before -- and
            below 1 is the translucency that was being asked for and ignored. */}
            <View style={styles.page}>
              <StatusBar animated style={resolvedMode === 'dark' ? 'light' : 'dark'} />
              {/*
          One column for every notice that floats over the terminal.

          They used to be three independently absolute views pinned to the same
          `insets.top + 58`, so a demo session that hit an error showed one on
          top of the other and neither was readable. Stacked here they queue
          instead, and `listLayout` closes the gap when one of them leaves.

          `box-none` so the terminal underneath still takes taps everywhere the
          notices are not.
        */}
              <View
                pointerEvents="box-none"
                style={[
                  styles.noticeStack,
                  {
                    top: insets.top + NAV_HEADER_TOP_GAP + 58,
                    left: sideInsets.left,
                    right: sideInsets.right,
                  },
                ]}>
                <NoticeDeck>
                  {/* A dead pairing outranks whatever action happened to fail first.
              Every request fails once this server has no record of this device,
              so the pane read that lost the race writes its own sentence into
              the error bar -- and the bar has no button on it, which used to
              hide the one control that can end the situation. The notice wins
              here, because it is the thing carrying the way out. */}
                  {error && !connection.needsPairing ? (
                    <Animated.View
                      entering={fadeIn('micro')}
                      exiting={fadeOut('micro')}
                      layout={listLayout('short')}
                      style={[
                        styles.errorBar,
                        { backgroundColor: surfaceBackground(theme.colors.dangerSubtle) },
                      ]}>
                      <Text selectable variant="caption" color={theme.colors.danger}>
                        {error}
                      </Text>
                    </Animated.View>
                  ) : null}
                  {historyNotice ? (
                    <HistoryPullNoticeView notice={historyNotice} onRetry={retryEarlierOutput} />
                  ) : null}
                  {/* The tunnel's own status, above the gateway connection notice: a
                tunnelled gateway cannot connect until its SSH forward is up, so
                while it is connecting or down this is the news, and the gateway
                notice below stays quiet (it would only say "Connecting"). */}
                  {tunnel.tunnelled && tunnel.phase !== 'open' ? (
                    <Animated.View
                      entering={fadeIn('micro')}
                      exiting={fadeOut('micro')}
                      layout={listLayout('short')}>
                      <GatewayTunnelBadge record={record} variant="notice" />
                    </Animated.View>
                  ) : null}
                  {tunnelReady &&
                  (!error || connection.needsPairing) &&
                  // The unavailable state below says this, with its own Retry.
                  !(backendState.kind === 'down' && connection.backendUnavailable) ? (
                    <ConnectionNotice
                      status={connection}
                      onRetry={() => setRetryNonce((value) => value + 1)}
                      onPairAgain={() => router.push('/explore')}
                    />
                  ) : null}

                  {/* What happened while nobody was looking. Above the switch pill and
              below the standing conditions: it is news rather than a state, but
              it is news the user came back for, so a transient answer to a
              gesture queues underneath it rather than the other way round. */}
                  {featureFlags.terminalAwayDigest && away.digest ? (
                    <AwayDigestCard digest={away.digest} onDismiss={away.dismiss} />
                  ) : null}
                  <CollaborationNotice
                    context={{
                      serverId,
                      sessionId: data.sessionId,
                      paneId: selection.paneId,
                      workspaceId: selection.workspaceId,
                      tabId: selection.tabId,
                      cwd: field(selectedPane, 'cwd'),
                    }}
                    agents={data.agents}
                    connected={ready && targetReady && connection.phase === 'connected'}
                    active={isFocused}
                  />

                  {/* Last in the stack on purpose. An error bar and a connection notice
              are standing conditions and keep the top of the column; this is a
              transient answer to a gesture and clears itself, so it queues
              underneath rather than pushing a condition out of the way. */}
                  {switchPill ? (
                    <SwitchIndicator address={switchPill.address} testID={switchPill.testID} />
                  ) : null}
                </NoticeDeck>
              </View>

              <View style={styles.terminalArea}>
                {/* The two-finger tab swipe is recognised by the canvas itself, as one
              more gesture simultaneous with its pan and pinch -- React Native's
              touches never see it. See `useTabSwipe` for the measurements. */}
                <View style={[styles.terminalSwipeArea, { overflow: 'hidden' }]}>
                  {/* Keep the canvas mounted and stationary across pane changes. */}
                  <Animated.View style={styles.terminalSwipeArea}>
                    {targetUnavailable ? (
                      <View style={[styles.missingTargetState, sideInsetPadding(sideInsets, 24)]}>
                        <Text variant="heading" style={styles.unavailableText}>
                          <Trans>Terminal unavailable</Trans>
                        </Text>
                        <Text
                          variant="bodySmall"
                          color={theme.colors.textMuted}
                          style={styles.unavailableText}>
                          <Trans>
                            This terminal was removed. Choose another terminal to continue.
                          </Trans>
                        </Text>
                        <PressableScale
                          accessibilityRole="button"
                          accessibilityLabel={t`Choose another terminal`}
                          disabled={!hasLoadedData || sessions.length === 0}
                          onPress={openPanelPicker}
                          style={[
                            styles.missingTargetButton,
                            { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
                          ]}>
                          <TerminalWindowIcon size={16} color={theme.colors.primary} />
                          <Text variant="label" color={theme.colors.primary}>
                            <Trans>Choose another terminal</Trans>
                          </Text>
                        </PressableScale>
                      </View>
                    ) : backendState.kind === 'down' ? (
                      <TerminalBackendDown
                        serverId={serverId}
                        state={backendState}
                        retrying={connection.phase === 'connecting'}
                        onRetry={retryBackend}
                        sideInsets={sideInsets}
                        onBack={
                          isPadLayout
                            ? () => setOverviewVisible(true)
                            : // The root Home route's own workspace has nowhere to go back to.
                              rootOwned
                              ? undefined
                              : () => (router.canGoBack() ? router.back() : router.replace('/'))
                        }
                      />
                    ) : targetPending ? (
                      <View style={[styles.missingTargetState, sideInsetPadding(sideInsets, 24)]}>
                        <Spinner size="sm" color={theme.colors.textMuted} />
                        <Text variant="bodySmall" color={theme.colors.textMuted}>
                          <Trans>Opening…</Trans>
                        </Text>
                      </View>
                    ) : chatViewShown ? (
                      supportsAgentSessions && isOpenCodeAgent ? (
                        // One workbench at a time: under an agent detail the
                        // shell's own owns the agent session store.
                        !padDetailIsPane ? null : (
                          <AgentWorkbench
                            // The home route mounts this workspace from its warm or
                            // placeholder data first. `data.sessionId` can change
                            // from the placeholder to the real gateway session
                            // after the first snapshot arrives. A pane-only key
                            // kept the AgentWorkbench's old transcript store alive
                            // across that identity change, so the header could show
                            // the real session while its message list stayed empty.
                            key={JSON.stringify([serverId, data.sessionId, selection.paneId])}
                            serverId={serverId}
                            sessionId={data.sessionId}
                            visible={!overviewVisible}
                            topInset={insets.top + DETAIL_HEADER_HEIGHT}
                            bottomInset={insets.bottom}
                          />
                        )
                      ) : (
                        <PaneChatView
                          // Remounted per pane: the follow-the-latest position and which
                          // tool runs are open belong to the transcript being read.
                          key={selection.paneId}
                          parts={partsForPane.parts}
                          detail={paneView.detail}
                          // `answered` is the gateway having said *something* about
                          // this pane. Until it has, an empty transcript is a question
                          // in flight rather than an empty pane.
                          awaitingFirstParts={!partsForPane.answered}
                          topInset={insets.top + DETAIL_HEADER_HEIGHT}
                          bottomInset={composerVisible ? composerHeight : 0}
                          canLoadEarlier={canLoadEarlierParts}
                          loadingEarlier={loadingEarlierParts}
                          onLoadEarlier={loadEarlierParts}
                          onOpenAsset={openAssetById}
                          onOpenFile={openFileLink}
                          onToggleDetail={paneView.toggleDetail}
                        />
                      )
                    ) : (
                      <TerminalBoundary
                        resetKey={selection.paneId}
                        background={terminalBackground}
                        textColor={chromeText}>
                        <PaneTerminalPanel
                          outputStore={outputStore}
                          sessionId={data.sessionId}
                          paneId={selection.paneId}
                          // The whole composer reserves space, key row included: anything
                          // it covers is unreachable, and the "jump to latest" pill sits
                          // against this inset too.
                          //
                          // Zero on an editor, because there is no composer there to
                          // reserve for. What floats over an editor is deliberately
                          // *not* measured into this: reserving height for it would
                          // hand the pane back the problem the dock was taken away to
                          // solve, and would move the terminal every time the panel
                          // opened.
                          bottomInset={composerVisible && !dock.editorMode ? composerHeight : 0}
                          // Only a program that owns the screen gets one, and it is
                          // the same clearance the reading view above uses, so the two
                          // surfaces clear the same chrome by the same amount. Keyed
                          // on the surface rather than on "is an editor": an agent
                          // paints the whole screen too, and keying this on the editor
                          // predicate is what slid an agent's output under the pill.
                          topInset={paneOwnsScreen ? insets.top + DETAIL_HEADER_HEIGHT : 0}
                          // A stream rests at its bottom, but scrolled all the way
                          // back its oldest rows must clear the same header.
                          topClearance={insets.top + DETAIL_HEADER_HEIGHT}
                          // How many rows of the window are the live screen, so the
                          // grid can rest an editor on the screen rather than on the
                          // oldest frame of the ring-buffer history above it.
                          screenRows={selectedPaneScreenRows}
                          // Deliberately the *editor* predicate, not `paneOwnsScreen`,
                          // even though the two describe the same alternate screen.
                          //
                          // This one decides whether the grid stops resolving a
                          // truecolour scheme's defaults against the app theme (see
                          // `terminalPaneTheme`). An editor owns its whole surface and
                          // is unreadable resolved against the wrong side, which is
                          // what card #685 measured. An agent is different in practice:
                          // it paints some of its own colours and leaves the rest at
                          // the default, and the owner reads it beside light app
                          // chrome. Giving it its own surface turned the pane fully
                          // dark inside a light app -- correct by the rule, wrong on
                          // the screen, and reverted here on that evidence.
                          //
                          // The cost is stated rather than hidden: an agent that paints
                          // a dark box of its own (codex's composer) still shows that
                          // box against the app's paper. That is a narrower defect than
                          // a whole pane in the wrong mode, and it wants its own fix.
                          //
                          // The tablet branch reached this same line independently, from
                          // the other end of the same problem: forcing the terminal
                          // theme turned a light Pad workspace into one large dark
                          // rectangle. Two surfaces, two readers, one answer.
                          ownsScreen={fullScreenPane}
                          keyboardOffset={keyboardOffset}
                          // The setting, not a point size: how big that is belongs to
                          // `@/lib/terminal-text-size`, which is also where the rule
                          // that the pinch never outlives this screen is written.
                          textSize={terminalTextSize}
                          // An editor pane's own read is always `history_size: 0`
                          // (measured live, card #795) -- there is nothing earlier
                          // for a pull to reach, so the affordance is refused
                          // outright rather than trusted to the scroll-metric
                          // fallback `hasEarlierTerminalOutput` already computes
                          // (belt and suspenders: that fallback already lands on
                          // `false` here, but a screen-owning pane must never be
                          // able to arm this gesture on the strength of a metric
                          // alone).
                          // Legacy continuous capture can also extend this window.
                          // Segmented snapshots belong to the explicit history reader,
                          // never to a pull that promises more output in this terminal.
                          canLoadEarlier={canOfferHistoryPull({
                            canLoadEarlier:
                              (servesCapturedHistory && !servesSegmentedHistory && capturedOpen) ||
                              (!fullScreenPane && canLoadEarlierOutput),
                            blocked: historyPullBlocked,
                          })}
                          historyRevision={historyRevision}
                          loadingEarlier={loadingEarlierOutput}
                          onLoadEarlier={loadEarlierOutput}
                          onViewportReady={refreshOutput}
                          zoom={openSettled}
                          historyIndicatorTopInset={insets.top + NAV_HEADER_TOP_GAP + 62}
                          stickBottomNonce={stickBottomNonce}
                          onFileLink={openFileLink}
                          onTwoFingerSwipe={tabSwipe.onSwipe}
                          screenFocused={isFocused && !paneHidden}
                          paneColumns={selectedPaneColumns}
                          paneRows={selectedPaneRows}
                          paneCursorColumn={selectedPaneCursorColumn}
                          paneCursorRow={selectedPaneCursorRow}
                          sideInsets={sideInsets}
                        />
                      </TerminalBoundary>
                    )}
                    {themeDrop ? (
                      // Its card spans the pane between two gutters, so the layer it
                      // is anchored in keeps out of the side insets.
                      <View
                        pointerEvents="box-none"
                        style={[
                          StyleSheet.absoluteFill,
                          { left: sideInsets.left, right: sideInsets.right },
                        ]}>
                        <TerminalThemeDrop
                          state={themeDrop}
                          bottomInset={composerVisible ? composerHeight : 0}
                          onApply={() => {
                            const candidate = themeCandidateRef.current;
                            if (!candidate || themeDrop.phase !== 'ready') return;
                            setThemeDrop({ ...themeDrop, applying: true });
                            // The editor owns the preview from here: it is the one
                            // surface that shows both variants, the contrast verdict
                            // and the opacity floors, and a theme arriving from
                            // another machine is exactly as unreviewed as one picked
                            // by hand. The card's job was to get it here.
                            openThemeEditor(candidate, 'conversation');
                            themeCandidateRef.current = null;
                            setThemeDrop(null);
                          }}
                          onDismiss={() => {
                            // Dismissing during the download has to stop it as well as
                            // clear the card: the staging it would otherwise finish
                            // has nowhere left to be shown, and would sit in the cache
                            // directory until the screen itself went away.
                            themeRequestRef.current?.cancel();
                            themeRequestRef.current = null;
                            themeCandidateRef.current?.prepared?.dispose();
                            themeCandidateRef.current = null;
                            setThemeDrop(null);
                          }}
                        />
                      </View>
                    ) : null}
                  </Animated.View>
                </View>
              </View>

              {attachmentMenuOpen && dock.attachEntry ? (
                <Animated.View style={[styles.menuBackdrop, menuBackdropStyle]}>
                  <Pressable
                    accessibilityLabel={t`Close the attachment menu`}
                    onPress={() => setAttachmentMenuOpen(false)}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              ) : null}

              {/* Tap-outside, the half of dismissal a key press cannot cover on a
            phone. Under the composer overlay in the stack, so the panel's own
            rows still take their taps -- and bounded to the pane above it, so
            that the element a tap is aimed at is the one that gets it. */}
              {slashPopup.open ? (
                <Animated.View style={[styles.menuBackdrop, menuBackdropStyle]}>
                  <Pressable
                    accessibilityLabel={t`Close the command list`}
                    onPress={slashPopup.dismiss}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              ) : null}

              {/*
          The key row switched off, so its two entries come out here: bottom
          left, on the line the "jump to latest" pill keeps on the right, both
          of them 14 above the dock. The pane gets back the line the row was
          renting and the two controls stay a thumb from where they were.

          Its own layer rather than a child of the dock overlay, for two
          reasons. The overlay carries the fade that takes the pane's last lines
          down into the dock, and that fade is measured from the overlay's own
          box -- a tray inside it would have dragged a 50-point veil up across
          the full width of the pane, which is most of what switching the row
          off was meant to get rid of. And it rides `composerKeyboardStyle`, so
          the pair travels up with the dock when the keyboard opens instead of
          being left behind it and unreachable for as long as someone is typing.

          Under the dismissal backdrops on purpose: while a menu is open a tap
          here should close the menu, the way a tap anywhere else on the pane
          does.
        */}
              {composerVisible && dock.floatingActions && !isPadLayout && !hideTerminalDock ? (
                <Animated.View
                  // The band across from it belongs to the pill, and a full-width
                  // invisible parent lying over it would have taken the pill's taps.
                  pointerEvents="box-none"
                  entering={fadeIn('micro')}
                  exiting={fadeOutDown('short')}
                  style={[
                    styles.floatingEntries,
                    { bottom: composerHeight + 14, left: 14 + sideInsets.left },
                    composerKeyboardStyle,
                  ]}>
                  <View
                    style={[
                      styles.floatingEntriesTray,
                      { borderRadius: profile.chrome.controlTray },
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      },
                    ]}>
                    {paneEntries('transparent')}
                  </View>
                </Animated.View>
              ) : null}

              {/*
            The editor's own controls, which are the dock's replacement and not
            a smaller dock. Absolutely positioned over the pane and measured into
            nothing, so opening and closing the panel cannot move the terminal --
            see `EditorControls` for why that constraint is the whole design.
          */}
              {dock.editorMode ? (
                <EditorControls
                  expanded={dock.editorPanel}
                  onExpand={openKeyboard}
                  offsetX={editorHandleX}
                  offsetY={editorHandleY}
                  keyboardOffset={keyboardOffset}
                  // The floating header is chrome the cluster must not disappear
                  // behind: the same clearance the grid itself takes above.
                  topInset={insets.top + DETAIL_HEADER_HEIGHT}
                  bottomInset={insets.bottom}
                  sideInsets={sideInsets}
                  disabled={!targetReady || connection.phase !== 'connected' || !selectedPane}>
                  {editorPanelBody}
                </EditorControls>
              ) : null}

              {composerVisible && !dock.editorMode && !hideTerminalDock ? (
                <Animated.View
                  style={[
                    styles.composerOverlay,
                    isPadLayout && styles.padComposerOverlay,
                    isPadLayout && {
                      paddingLeft: sideInsets.left,
                      paddingRight: appChrome.layout.padWorkspaceGutter + sideInsets.right,
                    },
                    composerKeyboardStyle,
                  ]}>
                  <EdgeFade edge="bottom" color={terminalBackground} style={styles.composerFade} />
                  {/* Both of these hang off the caret in an input that is not on screen
              while a question is standing, so both go with it. */}
                  {mentionTrigger && dock.composer ? (
                    <View
                      style={[
                        styles.composerFloatingContent,
                        isPadLayout
                          ? styles.padComposerFloatingContent
                          : sideInsetPadding(sideInsets),
                      ]}>
                      <FileMentionPanel
                        hits={mentionHits}
                        query={mentionTrigger.query}
                        visibleRows={isPadLayout ? 3 : undefined}
                        maxHeight={commandPopupMaxHeight}
                        onSelect={chooseMention}
                      />
                    </View>
                  ) : null}
                  {/* The pane's own command surface, above the dock so the keyboard
                never has to come down to read it. Everything about when it
                opens, what it shows and what a tap inserts lives in
                `composer-popup.ts`; this is only where it is hung. */}
                  {dock.composer ? (
                    <View
                      style={[
                        styles.composerPopup,
                        isPadLayout
                          ? styles.padComposerPopup
                          : sideInsetPadding(sideInsets, COMPOSER_GUTTER),
                      ]}>
                      <ComposerPopup
                        rows={slashPopup.rows}
                        onPick={slashPopup.pick}
                        maxHeight={commandPopupMaxHeight}
                        testIDPrefix="slash-command"
                      />
                    </View>
                  ) : null}
                  {attachmentMenuOpen && dock.attachEntry ? (
                    <View
                      style={[
                        styles.composerFloatingContent,
                        isPadLayout
                          ? styles.padComposerFloatingContent
                          : sideInsetPadding(sideInsets),
                      ]}>
                      <AttachmentMenu onSelect={chooseAttachmentSource} textColor={chromeText} />
                    </View>
                  ) : null}
                  {/*
              The key row and the input share one blurred dock, so output fades
              out under a single surface instead of passing behind two floating
              pieces with a gap between them.
            */}
                  <GlassChrome
                    surface="composer"
                    artworkEnabled={false}
                    shape="composerDock"
                    style={[
                      styles.composerDock,
                      isPadLayout && styles.padComposerDock,
                      {
                        borderTopLeftRadius: profile.chrome.composerDock,
                        borderTopRightRadius: profile.chrome.composerDock,
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                      },
                    ]}>
                    {/*
              The dock's own height is a moving thing: an approval banner, the
              pane strip, the upload-wait row and a growing multiline input all
              live in here, and each of them used to change the dock's height
              between two frames. `listLayout` makes the dock travel to its new
              size, and `TerminalPanel` eases its bottom inset to match (see
              `bottomInset` in `skia-terminal.tsx`), so the output and the
              surface covering it move together instead of the terminal snapping
              a beat after the dock.
            */}
                    <Animated.View
                      layout={dockRowLayout}
                      onLayout={(event: LayoutChangeEvent) => {
                        measureComposerHeight(Math.ceil(event.nativeEvent.layout.height));
                      }}
                      style={[
                        styles.composerSafeArea,
                        isPadLayout
                          ? styles.padComposerSafeArea
                          : sideInsetPadding(sideInsets, COMPOSER_GUTTER),
                        dockClearanceStyle,
                      ]}>
                      {/* Inside the dock rather than floating over the pane: the dock is
                measured into `composerHeight`, so the terminal reserves room
                for the banner instead of having its last lines covered by it --
                the same lesson the quick-actions pill taught. */}
                      <ApprovalBanner
                        approval={approval.state.approval}
                        answeringIndex={approval.state.answeringIndex}
                        error={approval.state.error}
                        onAnswer={approval.answer}
                        onDismissError={approval.dismissError}
                        // The way out of the question, for exactly as long as the key row
                        // that normally carries it is standing down for the banner.
                        onEscape={
                          dock.bannerEscape ? () => void sendTerminalKey(escapeKey) : undefined
                        }
                        escapeDisabled={
                          !targetReady ||
                          connection.phase !== 'connected' ||
                          !selectedPane ||
                          Boolean(sendingKey)
                        }
                        escapeSending={sendingKey === escapeKey.key}
                      />
                      {dock.paneChips && !isPadLayout ? (
                        <Animated.ScrollView
                          ref={paneStripRef}
                          horizontal
                          keyboardShouldPersistTaps="always"
                          showsHorizontalScrollIndicator={false}
                          scrollEventThrottle={32}
                          onScroll={(event) => {
                            paneStripOffsetRef.current = event.nativeEvent.contentOffset.x;
                          }}
                          onLayout={(event: LayoutChangeEvent) => {
                            paneStripViewportRef.current = event.nativeEvent.layout.width;
                            revealActivePaneChip();
                          }}
                          // The strip appears when a tab grows a second pane and leaves
                          // when the on-screen keyboard takes the dock, or when an
                          // approval clears the dock down to its own question. All three
                          // used to be hard cuts, and the exit matters more than the
                          // entrance: it is what the dock's height travels behind.
                          entering={fadeIn('micro')}
                          exiting={fadeOutDown('short')}
                          style={[
                            styles.phonePaneStripViewport,
                            { marginLeft: -dockBleed.left, marginRight: -dockBleed.right },
                          ]}
                          contentContainerStyle={[
                            styles.paneStrip,
                            {
                              paddingLeft: styles.paneStrip.paddingHorizontal + dockBleed.left,
                              paddingRight: styles.paneStrip.paddingHorizontal + dockBleed.right,
                            },
                          ]}>
                          {paneChips}
                        </Animated.ScrollView>
                      ) : null}
                      {dock.virtualKeyboard ? (
                        // Rises out of the dock the way a keyboard does, and leaves the
                        // same way: this swap replaces the whole key row, and a control
                        // this large appearing between two frames read as a glitch.
                        <Animated.View entering={riseIn()} exiting={fadeOutDown('short')}>
                          <VirtualKeyboard
                            key={`${serverId}:${data.sessionId}:${selection.paneId}`}
                            disabled={
                              !targetReady || connection.phase !== 'connected' || !selectedPane
                            }
                            onText={typeText}
                            onKey={typeKey}
                            onClose={() => setKeyboardMode(false)}
                            shortcuts={keyboardShortcuts}
                            vocabulary={keyVocabulary}
                            wide={isPadLayout}
                          />
                        </Animated.View>
                      ) : null}
                      {!dock.virtualKeyboard ? (
                        <>
                          {isPadLayout && composerVisible && !dock.keyRow && dock.composer ? (
                            <Animated.View
                              entering={fadeInDown('short')}
                              exiting={fadeOutDown('short')}
                              layout={dockRowLayout}
                              style={styles.keyRowWrap}>
                              {padPaneSwitcher}
                              {paneEntries(chromeGlass)}
                            </Animated.View>
                          ) : null}
                          {/* The row exists to carry the terminal keys, so switching them off
                takes the row with them and its two entries go and float in the
                corner instead (see `floatingActions` below) -- a full-width
                line of the pane is too much rent for two circles.

                Everything from here down stands aside while an approval is up:
                each of these is a way to send the pane something that is not an
                answer to the question being asked, and the dock while a
                question is standing is only the question. They sink out rather
                than vanishing, and the dock's own `listLayout` above carries
                the height change into the terminal's bottom inset, so the
                output falls in behind them instead of jumping a beat later. */}
                          {composerVisible && dock.keyRow ? (
                            <Animated.View
                              entering={fadeInDown('short')}
                              exiting={fadeOutDown('short')}
                              layout={dockRowLayout}
                              style={styles.keyRowWrap}>
                              {/* The Pad's pane switcher keeps its own scroller --
                              nesting two horizontal ScrollViews would leave
                              neither able to say which one a drag belongs to. */}
                              {isPadLayout ? padPaneSwitcher : null}
                              {/* Everything else scrolls as one row. The entries
                              used to be pinned to the left while only the keys
                              moved, which fixed the row's budget at whatever
                              four circles and the keys could fit -- so a fifth
                              control had nowhere to go, and on a narrow phone
                              the keys were already losing their tail. */}
                              <TerminalKeyRow
                                keys={terminalKeys}
                                sendingKey={sendingKey}
                                disabled={terminalKeysDisabled}
                                onPressKey={pressTerminalKey}
                                textColor={chromeText}
                                background={chromeGlass}
                                activeBackground={theme.colors.primary}
                                activeText={theme.colors.onPrimary}
                                leading={
                                  <>
                                    {paneEntries(chromeGlass)}
                                    <PressableScale
                                      testID="terminal-open-keyboard"
                                      accessibilityLabel={t`Open on-screen keyboard`}
                                      feedback="selection"
                                      pressedScale={0.9}
                                      onPress={openKeyboard}
                                      style={[
                                        styles.keyRowToggle,
                                        { borderRadius: profile.chrome.control },
                                        { backgroundColor: surfaceBackground(chromeGlass) },
                                      ]}>
                                      {/* The pack's primary, like the four entries beside it: it
                                  opens a surface, as they do. It was the text
                                  colour, which is what the key caps after it
                                  wear, and read as a dead button in a lit row. */}
                                      <KeyboardIcon size={16} color={theme.colors.primary} />
                                    </PressableScale>
                                    {assignmentToggle}
                                  </>
                                }
                                style={{
                                  marginLeft: -dockBleed.left,
                                  marginRight: -dockBleed.right,
                                }}
                                contentContainerStyle={{
                                  paddingLeft: dockBleed.left,
                                  paddingRight:
                                    styles.keyRowScroller.paddingRight + dockBleed.right,
                                }}
                              />
                            </Animated.View>
                          ) : null}
                          {/* The files staged for the next message. They are not lost while
                the dock is cleared -- nothing is unstaged, no upload is
                cancelled -- they are simply not on screen for as long as the
                pane is asking about something else. */}
                          {dock.attachmentStrip ? (
                            <Animated.View
                              entering={fadeIn('micro')}
                              exiting={fadeOutDown('short')}
                              layout={dockRowLayout}>
                              <AttachmentStrip
                                previewing={Boolean(previewFile) || previewIndex >= 0}
                                attachments={attachments}
                                onRemove={removeAttachment}
                                onRetry={retryUpload}
                                onPreview={setPreviewAttachmentId}
                                textColor={chromeText}
                              />
                            </Animated.View>
                          ) : null}
                          {/* Send tapped while a photo is still going up. Without this the
                spinner on the button is indistinguishable from a slow gateway,
                and the wait looks like a hang rather than a queue. */}
                          {dock.composer && sending && attachmentsUploading ? (
                            <Animated.View
                              // It used to appear between two frames and shove the composer
                              // down with it. The dock's own `listLayout` below takes the
                              // height change; this takes the row.
                              entering={fadeIn('micro')}
                              exiting={fadeOut('micro')}
                              layout={dockRowLayout}
                              style={styles.uploadWait}>
                              <Spinner size="sm" color={theme.colors.textMuted} />
                              <Text variant="caption" color={theme.colors.textMuted}>
                                <Trans>Waiting for uploads to finish…</Trans>
                              </Text>
                            </Animated.View>
                          ) : null}
                        </>
                      ) : null}
                      {/* Written once, above: on an editor the same field floats in
                the panel instead. `dock.composer` is what decides in both
                places, and it accounts for the approval, the keyboard and the
                editor alike. */}
                      {assignmentBar}
                      {dock.composer ? pendingQuestionHint : null}
                      {dock.composer ? composerField : null}
                    </Animated.View>
                  </GlassChrome>
                </Animated.View>
              ) : null}

              {previewFile ? (
                <AssetViewer asset={previewFile} onClose={() => setPreviewAttachmentId(null)} />
              ) : null}
              {previewIndex >= 0 ? (
                <ImagePreviewModal
                  images={previewImages}
                  initialIndex={previewIndex}
                  onClose={() => setPreviewAttachmentId(null)}
                />
              ) : null}

              {openAsset ? (
                <AssetViewer asset={openAsset} onClose={() => setOpenAsset(null)} />
              ) : null}
            </View>
            {simfarmSplit.previewWidth > 0 ? (
              <View
                style={[
                  styles.previewColumn,
                  {
                    width: simfarmSplit.previewWidth,
                    paddingRight: insets.right,
                    borderLeftColor: theme.colors.border,
                  },
                ]}>
                <SimfarmPreview
                  embedded
                  gatewayUrl={record?.url}
                  allowed={simfarmSplit.allowed}
                  initialPort={simfarmPorts[record?.serverId ?? '']}
                  onPortFound={rememberSimfarmPort}
                />
              </View>
            ) : null}
          </View>
        </View>
        {padDetail.kind === 'agent' ? (
          <View
            pointerEvents={overviewVisible ? 'none' : 'auto'}
            accessibilityElementsHidden={overviewVisible}
            importantForAccessibility={revealableSubtreeImportance(overviewVisible)}
            style={[StyleSheet.absoluteFill, { opacity: overviewVisible ? 0 : 1 }]}>
            <PadAgentDetail
              detail={padDetail}
              ready={selectedServer && tunnelReady}
              visible={!overviewVisible}
              controls={padAgentControls}
            />
          </View>
        ) : null}
      </View>
    </AppDrawer>
  );
}

/**
 * The terminal composer bound to a draft store: the one component that
 * renders on every keystroke, so the screen around it does not.
 */
function DraftStoreComposer({
  draftStore,
  inputProps,
  ...props
}: TerminalComposerProps & { draftStore: ComposerDraftStore }) {
  const value = useStore(draftStore, (draft) => draft.text);
  return <TerminalComposer {...props} inputProps={{ ...inputProps, value }} />;
}

function sameMentionTrigger(a: FileMentionTrigger | null, b: FileMentionTrigger | null): boolean {
  if (a === null || b === null) return a === b;
  return a.start === b.start && a.end === b.end && a.query === b.query;
}

/**
 * One pane in the strip along the bottom of the dock.
 *
 * Its own component only because the selected chip has to *become* selected
 * rather than simply be it: the fill, the label and the glyph used to change on
 * the frame the selection did, which on a strip you swipe through reads as the
 * highlight teleporting rather than as the strip answering.
 *
 * Everything here is an opacity ramp on the toggle token, including the fill.
 * `interpolateColor` out of `'transparent'` is the obvious way to write it and
 * is wrong: Reanimated reads `transparent` as transparent *black*, so the
 * interpolation passes through a dark cast at the midpoint, which on a glass
 * dock over a terminal is exactly where it shows. Ramping the alpha of a
 * primary-filled layer is the same journey with no detour through black.
 *
 * The glyph and the label are each two copies cross-faded rather than one copy
 * whose colour animates: a App icon takes its colour as a prop, not as a
 * style, and the design system's `Text` resolves its own colour before the
 * style reaches React Native -- so in both cases there is nothing on the view
 * for the UI thread to drive. The resting copy is the one that lays out; the
 * selected copy is drawn over it.
 */
function PaneChip({
  testID,
  label,
  accessibilityLabel,
  active,
  agentStatusColor,
  restColor,
  activeFill,
  activeText,
  onLayout,
  onPress,
}: {
  testID: string;
  label: string;
  accessibilityLabel: string;
  active: boolean;
  /** The agent's status colour, or null for a plain terminal pane. */
  agentStatusColor: string | null;
  restColor: string;
  activeFill: string;
  activeText: string;
  onLayout: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const selected = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    selected.set(withTiming(active ? 1 : 0, timing('toggle')));
  }, [active, selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - selected.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: selected.value }));

  const Glyph = agentStatusColor ? AgentIcon : TerminalWindowIcon;
  const restGlyphColor = agentStatusColor ?? restColor;

  return (
    <PressableScale
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      onPress={onPress}
      style={[styles.paneChip, { borderRadius: profile.chrome.navigationPill }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.paneChipFill,
          { borderRadius: profile.chrome.navigationPill },
          { backgroundColor: surfaceBackground(activeFill) },
          selectedStyle,
        ]}
      />
      <View style={styles.paneChipGlyph}>
        <Animated.View style={restingStyle}>
          <Glyph size={13} color={restGlyphColor} />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
          <Glyph size={13} color={activeText} />
        </Animated.View>
      </View>
      <View style={styles.paneChipLabel}>
        <Animated.View style={restingStyle}>
          <Text variant="caption" numberOfLines={1} color={restColor}>
            {label}
          </Text>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, selectedStyle]}>
          <Text variant="caption" numberOfLines={1} color={activeText}>
            {label}
          </Text>
        </Animated.View>
      </View>
    </PressableScale>
  );
}

let lastNvimRead: { output: string; columns?: number; mode: NvimMode } | null = null;

/**
 * nvim's mode in a frame, remembered for the last frame asked about: the store
 * asks again on every render and every frame, and a parse per ask is what the
 * subscription is there to save.
 */
function nvimModeOf(output: string, columns: number | undefined): NvimMode {
  if (!output) return null;
  if (lastNvimRead?.output === output && lastNvimRead.columns === columns) return lastNvimRead.mode;
  const mode = parseNvimMode(terminalFrameText(parseTerminalSnapshot(output, undefined, columns)));
  lastNvimRead = { output, columns, mode };
  return mode;
}

type NvimMode = ReturnType<typeof parseNvimMode>;

/**
 * The terminal plane is up at the gateway but no backend behind it is running.
 * Says so -- which backend, what to run on that computer to start it, and the
 * backends the gateway is configured with -- instead of a loader that never
 * ends. Retry asks again at once; the workspace keeps polling regardless, so a
 * backend started on the host is picked up without it.
 */
function TerminalBackendDown({
  serverId,
  state,
  retrying,
  onRetry,
  onBack,
  sideInsets,
}: {
  serverId: string;
  state: Extract<TerminalBackendState, { kind: 'down' }>;
  retrying: boolean;
  onRetry: () => void;
  onBack?: () => void;
  sideInsets: SideInsets;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const copy = terminalBackendCopy(state.backend);
  return (
    <View
      style={[styles.missingTargetState, sideInsetPadding(sideInsets, 24)]}
      testID="terminal-backend-down">
      <Text variant="heading">
        <Trans>Terminal unavailable</Trans>
      </Text>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.unavailableText}>
        {copy.reason}
      </Text>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.unavailableText}>
        {copy.hint}
      </Text>
      {copy.command ? (
        // The shared guide row: the command to copy. Run is never offered
        // here -- the terminal it would open a pane in is the one that is down.
        <View style={styles.backendDownCommand}>
          <GuideCommand
            serverId={serverId}
            command={copy.command}
            terminalDown
            testID="terminal-backend-down-command"
          />
        </View>
      ) : null}
      {state.backends.map((backend) => (
        <View
          key={backend.sessionId}
          style={styles.backendDownRow}
          accessible
          accessibilityLabel={`${backend.label}, ${backend.kind}, ${
            backend.connected ? t`Connected` : t`Not connected`
          }`}>
          <StatusDot
            color={backend.connected ? theme.colors.success : theme.colors.warning}
            filled
            size={7}
          />
          <Text variant="caption" color={theme.colors.textMuted}>
            {backend.label === backend.kind ? backend.label : `${backend.label} · ${backend.kind}`}
          </Text>
        </View>
      ))}
      <View style={styles.backendDownActions}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Retry`}
          accessibilityState={{ busy: retrying }}
          disabled={retrying}
          onPress={onRetry}
          testID="terminal-backend-down-retry"
          style={[
            styles.missingTargetButton,
            { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
          ]}>
          {retrying ? <Spinner size="sm" color={theme.colors.primary} /> : null}
          <Text variant="label" color={theme.colors.primary}>
            <Trans>Retry</Trans>
          </Text>
        </PressableScale>
        {onBack ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Back to Home`}
            onPress={onBack}
            testID="terminal-backend-down-back"
            style={styles.missingTargetButton}>
            <Text variant="label" color={theme.colors.textMuted}>
              <Trans>Back to Home</Trans>
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

/**
 * What a pull for earlier output has to say when it did not land a page, in
 * the same capsule as every other terminal notice: the app's sentence first,
 * the gateway's reason under it, and a Retry when one can work. It used to be
 * the error bar -- the gateway's raw sentence on a tinted strip with no icon,
 * no action and no way out but the next successful request.
 */
function HistoryPullNoticeView({
  notice,
  onRetry,
}: {
  notice: HistoryPullNotice;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const failed = notice.kind === 'failed';
  const Icon = failed ? NoticeIcon : HistoryIcon;
  return (
    <Animated.View
      pointerEvents="box-none"
      layout={listLayout('short')}
      style={styles.connectionAnchor}>
      <TerminalNotice
        accessibilityLabel={notice.caption ? `${notice.title}. ${notice.caption}` : notice.title}>
        <Icon
          size={16}

          color={failed ? theme.colors.danger : theme.colors.textMuted}
        />
        <View style={styles.connectionPillLabel}>
          <Text variant="caption" numberOfLines={2} style={terminalNoticeStyles.label}>
            {notice.title}
          </Text>
          {notice.caption ? (
            <Text variant="caption" numberOfLines={2} color={theme.colors.textMuted}>
              {notice.caption}
            </Text>
          ) : null}
        </View>
        {notice.retry ? (
          <PressableScale
            accessibilityLabel={
              notice.kind === 'refresh'
                ? t`Refresh terminal history`
                : t`Retry loading earlier output`
            }
            onPress={onRetry}
            style={terminalNoticeStyles.action}
            hitSlop={8}>
            <Text variant="caption" color={theme.colors.primary}>
              {notice.kind === 'refresh' ? <Trans>Refresh</Trans> : <Trans>Retry</Trans>}
            </Text>
          </PressableScale>
        ) : null}
      </TerminalNotice>
    </Animated.View>
  );
}

function ConnectionNotice({
  status,
  onRetry,
  onPairAgain,
}: {
  status: ConnectionStatus;
  onRetry: () => void;
  onPairAgain: () => void;
}) {
  const { t } = useLingui();

  const theme = useThemeTokens();
  // A connection that comes back used to be invisible: the notice returned
  // null the instant the phase flipped, so the only sign the gateway had
  // answered was that something stopped being wrong. Whether the reconnect had
  // worked or the app had given up looked identical. Hold the notice for a
  // beat with the good news in it, then let it fade.
  const [recovered, setRecovered] = useState(false);
  const wasDisconnected = useRef(false);

  useEffect(() => {
    if (status.phase !== 'connected') {
      wasDisconnected.current = true;
      setRecovered(false);
      return;
    }
    // Nothing to recover from: this is a screen opening onto a live gateway,
    // not a reconnect.
    if (!wasDisconnected.current) return;
    wasDisconnected.current = false;
    setRecovered(true);
    const timer = setTimeout(() => setRecovered(false), CONNECTION_RECOVERED_MS);
    return () => clearTimeout(timer);
  }, [status.phase]);

  const connected = status.phase === 'connected';
  if (connected && !recovered) return null;

  const title =
    connected || status.backendUnavailable
      ? t`Connected`
      : status.phase === 'connecting'
        ? t`Connecting`
        : status.phase === 'reconnecting'
          ? t`Reconnecting · ${status.attempt}`
          : t`Computer offline`;

  // One shape for every phase, and the colour only on the dot. The state is
  // carried by the words -- a status that is legible by hue alone is not
  // legible -- so what changes between "Connecting" and "Computer offline" is the
  // sentence and a 7pt light, not the object the sentence arrives in.
  const light = connected
    ? theme.colors.success
    : status.phase === 'offline' && !status.backendUnavailable
      ? theme.colors.danger
      : theme.colors.warning;

  return (
    // All connection transports use TerminalNotice. The outer anchor only
    // positions it; the shared shell owns sizing, fill and arrival motion.
    <Animated.View
      pointerEvents="box-none"
      layout={listLayout('short')}
      style={styles.connectionAnchor}>
      <TerminalNotice>
        {/* Filled: the app has an answer either way, including a bad one. */}
        <StatusDot color={light} filled size={7} />
        {/* Keyed on the label, so the attempt counter ticking over and the
            hand-off to "Connected" both cross-fade instead of the text simply
            being different on the next frame. */}
        {/* `flexShrink` on the wrapper, not just `numberOfLines` on the text:
            the row is capped at 92% of the screen and clips what overflows, so
            a wrapper sized to its full intrinsic width pushes the action out of
            the capsule entirely rather than letting the sentence ellipsize.
            A long message must cost characters, never the button. */}
        <Animated.View
          key={title}
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={styles.connectionPillLabel}>
          {/* Two, not one. A phase name on its own ("Connecting") never reaches
              a second line, so this costs the common case nothing -- but a
              failure that explains itself was being cut off mid-sentence, and
              the half that got dropped was the half saying what to do about
              it. */}
          <Text variant="caption" numberOfLines={2} style={terminalNoticeStyles.label}>
            {status.message && !connected ? `${title} · ${status.message}` : title}
          </Text>
        </Animated.View>
        {/* The sentence says pairing again is the way out, so the button next
            to it has to be the way in. Offering Retry here was the second half
            of the same defect: it is the only control on screen, and it cannot
            work -- the gateway will refuse every attempt identically until this
            device has a record on it again. */}
        {!connected && status.needsPairing ? (
          <PressableScale
            accessibilityLabel={t`Pair this computer again`}
            onPress={onPairAgain}
            style={terminalNoticeStyles.action}
            hitSlop={8}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Pair again</Trans>
            </Text>
          </PressableScale>
        ) : !connected && status.phase !== 'connecting' ? (
          <PressableScale
            accessibilityLabel={t`Retry connection`}
            onPress={onRetry}
            style={terminalNoticeStyles.action}
            hitSlop={8}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Retry</Trans>
            </Text>
          </PressableScale>
        ) : null}
      </TerminalNotice>
    </Animated.View>
  );
}

/**
 * The poller runs every 2.5 seconds whether or not anything changed. Returning
 * the previous object when it did not lets React bail out, which keeps every
 * memo downstream -- including the terminal's parsed frame -- alive on an idle
 * session.
 */
function sameServerData(current: ServerData, next: ServerData): boolean {
  return (
    current.sessionId === next.sessionId &&
    entitySignature(current.workspaces) === entitySignature(next.workspaces) &&
    entitySignature(current.tabs) === entitySignature(next.tabs) &&
    entitySignature(current.panes) === entitySignature(next.panes) &&
    entitySignature(current.agents) === entitySignature(next.agents)
  );
}

/** Covers every field the screen actually reads, revision included. */
function entitySignature(entities: HerdrEntity[]): string {
  return entities
    .map((entity) =>
      [
        entity.id,
        entity.title,
        // The name a user set, which is not `title` and is the only thing a
        // rename changes. Without it here, `sameServerData` decided a rename
        // was no news at all and the screen kept the entity it already had --
        // so the new name reached neither the pane strip nor the home screen's
        // mirror until something unrelated happened to move.
        entity.label ?? '',
        entity.status ?? '',
        entity.raw.revision ?? '',
        entity.raw.focused ?? '',
        field(entity, 'agent'),
        field(entity, 'agent_status'),
        field(entity, 'terminal_title_stripped'),
        // `isFullScreenTuiPane` reads this to catch a pane whose title never
        // turns (card #795, defect 1) -- confirmed live: a pane that just
        // exec'd nvim kept its shell key row and a doubled-frame render
        // (defect 2, since it was still being read and folded as a shell)
        // for as long as `sameServerData` found nothing else about the
        // session worth waking up for, because this was the one field the
        // screen had started reading that this signature did not cover.
        // Without it here, the poll that is supposed to carry the fresh
        // command to the render is the one thing that throws it away first.
        field(entity, 'foreground_command'),
        // A pane's own size, which the canvas fits its drawing to: without it
        // a resize (tmux `resize-window`, a re-split) was "no news" and the
        // old width stayed on screen until the pane was opened again.
        numberField(entity, 'width'),
        numberField(entity, 'height'),
        field(entity, 'workspace_id'),
        field(entity, 'tab_id'),
        field(entity, 'pane_id'),
      ].join('\u0001')
    )
    .join('\u0002');
}

function sameSelection(current: Selection, next: Selection): boolean {
  return (
    current.workspaceId === next.workspaceId &&
    current.tabId === next.tabId &&
    current.paneId === next.paneId
  );
}

/** Kept on the switch pills for native end-to-end assertions. */
const TAB_SWITCH_TEST_ID = 'tab-position-indicator';
const WORKSPACE_SWITCH_TEST_ID = 'workspace-position-indicator';

/**
 * A candidate selection, addressed the way the panels sheet addresses a panel.
 *
 * The candidate goes through `reconcileSelection` first, so a switch that names
 * only a tab -- or a workspace whose remembered pane has since closed -- is
 * numbered from the panel it will actually land on rather than from a blank.
 * `null` when the session no longer holds any of it, which is the same answer
 * as "nothing to announce".
 */
function paneAddressFor(data: ServerData, candidate: Selection): PaneAddress | null {
  const landing = reconcileSelection(data, candidate);
  const workspace = data.workspaces.findIndex((item) => item.id === landing.workspaceId);
  const tabs = data.tabs.filter((item) => field(item, 'workspace_id') === landing.workspaceId);
  const tab = tabs.findIndex((item) => item.id === landing.tabId);
  const panes = data.panes.filter((item) => field(item, 'tab_id') === landing.tabId);
  const panel = panes.findIndex((item) => item.id === landing.paneId);
  if (workspace < 0 || tab < 0 || panel < 0) return null;
  const pane = panes[panel];
  const agent = data.agents.find((item) => field(item, 'pane_id') === pane.id);
  return {
    workspace: workspace + 1,
    tab: tab + 1,
    panel: panel + 1,
    title: panelTitle(pane, agent),
  };
}

function selectionForPane(data: ServerData, paneId: string): Selection {
  const pane = data.panes.find((item) => item.id === paneId);
  if (!pane) return initialSelection;
  const tabId = field(pane, 'tab_id');
  const tab = data.tabs.find((item) => item.id === tabId);
  const workspaceId = field(pane, 'workspace_id') || field(tab, 'workspace_id');
  return reconcileSelection(data, { workspaceId, tabId, paneId });
}

function selectionForStrictTarget(
  data: ServerData,
  target: Pick<StrictHomeTarget, 'workspaceId' | 'tabId'>
): Selection {
  const tab = target.tabId ? data.tabs.find((item) => item.id === target.tabId) : undefined;
  if (target.tabId && !tab) return initialSelection;
  const workspace = target.workspaceId
    ? data.workspaces.find((item) => item.id === target.workspaceId)
    : tab
      ? data.workspaces.find((item) => item.id === field(tab, 'workspace_id'))
      : undefined;
  if (!workspace) return initialSelection;
  if (tab && field(tab, 'workspace_id') !== workspace.id) return initialSelection;
  return reconcileSelection(data, {
    workspaceId: workspace.id,
    tabId: tab?.id ?? '',
    paneId: '',
  });
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    position: 'relative',
  },
  workspaceSplit: {
    flex: 1,
    flexDirection: 'row',
  },
  workspaceHost: {
    flex: 1,
    position: 'relative',
  },
  previewColumn: {
    // A hairline is the whole of the seam. The two halves are one machine's
    // screen, not two documents, and a heavier divider would read as a second
    // window standing beside the first.
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  missingTargetState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  unavailableText: {
    textAlign: 'center',
  },
  backendDownCommand: { alignSelf: 'stretch' },
  backendDownActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  backendDownRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  missingTargetButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: appChrome.radius.control,
  },
  noticeStack: {
    position: 'absolute',
    zIndex: 19,
    left: 0,
    right: 0,
    gap: 8,
  },
  errorBar: {
    marginHorizontal: 12,
    borderRadius: appChrome.radius.control,
    paddingHorizontal: 12,
    paddingVertical: 9,
    boxShadow: appChrome.shadow.ambientCard,
  },
  // Centres the capsule and lets it size itself, rather than a block that spans
  // the screen whatever it has to say.
  connectionAnchor: {
    alignItems: 'center',
  },

  connectionPillLabel: {
    flexShrink: 1,
    // `flexShrink` alone cannot shrink this. A flex item's automatic minimum
    // size is its content's size, so without `minWidth: 0` the wrapper keeps
    // its full intrinsic width, the sentence never wraps to the second line it
    // is allowed, and the pill's `overflow: hidden` takes the end of it off
    // mid-word with no ellipsis to admit it -- which is how "Computer offline ·
    // Waiting for the network" reached a phone as "Waiting for the".
    minWidth: 0,
  },

  terminalArea: {
    flex: 1,
    width: '100%',
  },
  terminalSwipeArea: {
    flex: 1,
    width: '100%',
  },
  composerOverlay: {
    position: 'absolute',
    zIndex: 12,
    elevation: 12,
    left: 0,
    right: 0,
    bottom: 0,
  },
  padComposerOverlay: {
    // AppDrawer's Pad rail already contributes this gutter on the left. Adding
    // another one here made the rail-to-dock seam 24 while the bottom stayed
    // 12. The main pane owns only its outer right and bottom gutters.
    paddingLeft: 0,
    paddingRight: appChrome.layout.padWorkspaceGutter,
    paddingBottom: appChrome.layout.padWorkspaceGutter,
  },
  menuBackdrop: {
    position: 'absolute',
    zIndex: 11,
    elevation: 11,
    top: 0,
    left: 0,
    right: 0,
    // The bottom edge is animated -- `composerBackdropBottom` -- so the
    // backdrop ends at the top of the composer however high the keyboard has
    // pushed it. This is only the value before the first frame lands.
    bottom: 0,
  },
  composerSafeArea: {
    zIndex: 1,
    paddingTop: 8,
    // The sides are `COMPOSER_GUTTER` plus the side insets, set where it renders.
    gap: 7,
    // Bottom clearance is animated -- see `dockClearanceStyle`.
  },
  padComposerSafeArea: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'center',
    // The Pad dock is inset from the workspace by this same token. Reusing it
    // inside makes the controls' left clearance and the input's bottom
    // clearance visibly equal instead of inheriting compact's 12 / 8 split.
    paddingHorizontal: appChrome.layout.padWorkspaceGutter,
  },
  composerFade: {
    position: 'absolute',
    top: -72,
    left: 0,
    right: 0,
    bottom: 0,
  },
  composerDock: {
    zIndex: 1,
    borderTopLeftRadius: appChrome.radius.composerDock,
    borderTopRightRadius: appChrome.radius.composerDock,
    borderCurve: 'continuous',
    overflow: 'hidden',
    // A soft lift matching the header pill, so the dock reads as one floating
    // surface over the terminal.
    boxShadow: appChrome.shadow.composerDock,
  },
  padComposerDock: {
    width: '100%',
    alignSelf: 'center',
    // Only the Pad dock is detached from every edge. Compact keeps the
    // established edge-to-edge surface with rounded top corners.
    borderRadius: appChrome.radius.composerDock,
  },
  uploadWait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  composerPopup: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
    marginBottom: 7,
  },
  padComposerPopup: {
    maxWidth: '100%',
    paddingHorizontal: COMPOSER_GUTTER,
  },
  composerFloatingContent: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
  },
  padComposerFloatingContent: {
    maxWidth: '100%',
  },
  // The scrolling half of the key row. `alignItems` keeps circles and key caps
  // on one baseline when they differ in height; the trailing pad stops the last
  // key sitting flush against the edge when the row is longer than the screen.
  keyRowScroller: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  keyRowWrap: {
    flexDirection: 'row',
    // Stated, and centred: the row used to have no height of its own and hang
    // its children from the top, which left every difference in what a child
    // padded itself by showing up along the bottom edge.
    height: KEY_ROW_HEIGHT,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 1,
  },
  // Bottom left, 14 in from the edge and 14 above the dock: the mirror of the
  // "jump to latest" pill's own `latestAnchor`, which is what puts the two on
  // one line. Below the backdrops at 11 and the dock at 12, so an open menu
  // still covers it and still takes the tap that dismisses itself.
  floatingEntries: {
    position: 'absolute',
    zIndex: 10,
    elevation: 10,
    left: 14,
  },
  floatingEntriesTray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    // One point around 36pt buttons, so the tray comes out 38 high with a
    // 19 radius -- the pill's exact material, on the opposite corner.
    padding: 1,
    borderRadius: appChrome.radius.controlTray,
    borderCurve: 'continuous',
    boxShadow: appChrome.shadow.controlTray,
  },
  keyRowToggle: {
    width: 40,
    height: KEY_ROW_HEIGHT,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  padKeyRowEntry: {
    width: 34,
    height: 34,
  },
  terminalKeyGrid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  paneStrip: {
    height: PHONE_PANE_STRIP_HEIGHT,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 1,
    paddingBottom: 2,
  },
  phonePaneStripViewport: {
    height: PHONE_PANE_STRIP_HEIGHT,
    flexGrow: 0,
    flexShrink: 0,
    overflow: 'hidden',
  },
  padPaneStripViewport: {
    width: PAD_PANE_STRIP_MAX_WIDTH,
    // The percentage is only a compact-Pad safety rail; shortcut keys keep
    // their own horizontal scroll.
    maxWidth: '68%',
    flexShrink: 0,
  },
  padPaneStripInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  padPaneStrip: {
    gap: 6,
    alignItems: 'center',
    paddingRight: 2,
  },
  padTerminalKeyViewport: {
    flex: 1,
    minWidth: 0,
  },
  paneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: PANE_CHIP_HEIGHT,
    // No width cap: a chip is as wide as its title. The strip scrolls, so a
    // long title costs a swipe; an ellipsis cost the reader the part of the
    // title that tells two sessions of the same agent apart.
    flexShrink: 0,
    overflow: 'hidden',
    paddingHorizontal: 12,
    borderCurve: 'continuous',
  },
  // The chip's rounded fill, drawn under its content so it can fade on its own.
  paneChipFill: {
    borderCurve: 'continuous',
  },
  // Sized to the glyph so the selected copy laid over the resting one lands on
  // top of it rather than filling the chip.
  paneChipGlyph: {
    width: 13,
    height: 13,
  },
  paneChipLabel: {
    flexShrink: 0,
  },
  terminalKeyList: {
    gap: 6,
    paddingHorizontal: 1,
    // No vertical padding: it applied to these keys and to nothing else in the
    // row, which is what pushed them two points below the icon keys beside
    // them. The scroll view is exactly as tall as the row, and the row is
    // exactly as tall as a key.
    alignItems: 'center',
  },
  viewToggle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
