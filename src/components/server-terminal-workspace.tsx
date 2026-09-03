import { Spinner, Text, useThemeMode, useThemeTokens, useToast } from '@osuki-dev/ui';
import { type Href, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  Bot,
  Keyboard as KeyboardIcon,
  Paperclip,
  PenLine,
  SquareTerminal,
  X,
  Zap,
} from 'lucide-react-native';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  Keyboard,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';

import AppDrawer from '@/components/app-drawer';
import { ApprovalBanner } from '@/components/approval-banner';
import { ArtifactsButton } from '@/components/artifacts-button';
import { AssetViewer } from '@/components/asset-viewer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { AwayDigestCard } from '@/components/away-digest-card';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { GlassChrome } from '@/components/glass-chrome';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { navHeaderButtonStyle } from '@/components/nav-header';
import { PaneChatView } from '@/components/pane-chat-view';
import { PadServerRail } from '@/components/pad-server-rail';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { SwitchIndicator } from '@/components/switch-indicator';
import { TerminalBoundary } from '@/components/terminal-boundary';
import { composerStyles, TerminalComposer } from '@/components/terminal-composer';
import { TerminalPanel } from '@/components/terminal-output';
import { VirtualKeyboard } from '@/components/virtual-keyboard';
import { WorkspaceTitleSwitcher } from '@/components/workspace-title-switcher';
import { appChrome } from '@/constants/appearance';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useAwayDigest } from '@/hooks/use-away-digest';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { usePaneApproval } from '@/hooks/use-pane-approval';
import { usePaneEvents } from '@/hooks/use-pane-events';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { useTabSwipe } from '@/hooks/use-tab-swipe';
import { usePaneViewMode } from '@/hooks/use-pane-view-mode';
import {
  describePickerFailure,
  isImageAttachment,
  pickAttachments,
  type AttachmentSource,
} from '@/lib/attachments';
import {
  createFileMentionSearch,
  FILE_MENTION_LIMIT,
  findFileMentionTrigger,
  gatewayTransport,
  INITIAL_PANE_OUTPUT_LINES,
  insertFileMention,
  listPaneFiles,
  listPaneParts,
  MAX_PANE_OUTPUT_LINES,
  PANE_OUTPUT_PAGE_LINES,
  loadPaneShortcuts,
  gatewaySupportsAgentEvents,
  gatewaySupportsAgentSpawn,
  gatewaySupportsApprovals,
  readPaneOutput,
  readPaneRange,
  readPaneTail,
  resolveAssetById,
  resolveAssetByPath,
  type PaneOutputSource,
  type PanePart,
  sendAgentText,
  sendPaneKeys,
  sendPaneText,
  type FileMentionHit,
  type FileMentionSearch,
  type FileMentionTrigger,
  type HealthResponse,
  type HerdrEntity,
  type PaneComposer,
  type PaneShortcuts,
  type SessionAsset,
} from '@/lib/gateway-client';
import { ComposerPopup } from '@/components/composer-popup';
import { useComposerPopup } from '@/hooks/use-composer-popup';
import { editorActionDescription, terminalKeyDescription } from '@/i18n/labels';
import { composerBackdropBottom } from '@/lib/composer-popup';
import { withAlpha } from '@/lib/color';
import { slashCommandTrigger, type PaneSlashCommand } from '@/lib/pane-composer';
import { asAgentWidgetStatus, syncAgentWidget } from '@/lib/agent-widget';
import { describeGatewayFailure, type GatewayFailure } from '@/lib/network-error';
import { DEMO_SERVER_ID, demoRecord, isDemoRecord } from '@/lib/demo-gateway';
import { demoSshHost } from '@/lib/demo-ssh';
import { field, numberField, panelTitle, statusColor } from '@/lib/herdr-entity';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { sshHomeRows } from '@/lib/ssh-home';
import type { PaneAddress } from '@/lib/pane-address';
import {
  hasEarlierPaneParts,
  hasEarlierPartsAfterPage,
  paneTranscriptRows,
} from '@/lib/pane-parts';
import { asAgentActivityStatus, syncAgentActivity } from '@/lib/live-activity';
import { dockPresentation } from '@/lib/dock-presentation';
import {
  fadeIn,
  fadeInDown,
  fadeOut,
  fadeOutDown,
  INSTANT,
  listLayout,
  PRESS,
  riseIn,
  timing,
} from '@/lib/motion';
import { mirroredServerAgents, mirroredServerPanes } from '@/lib/server-agents';
import type { ServerAgent } from '@/lib/server-agents';
import { reachabilityFromProbe, type ServerReachability } from '@/lib/server-reachability';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';
import { loadUsage, orderByUsage, recordUsage, usageScope } from '@/lib/shortcut-usage';
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
import { useComposerDraftStore } from '@/stores/composer-draft';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useServerAgents } from '@/stores/server-agents';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerReachability } from '@/stores/server-reachability';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import {
  type TerminalKey,
  INSERT_MODE_KEYS,
  isFullScreenTuiPane,
  keyCap,
  parseNvimMode,
  terminalKeysForPane,
  terminalKeysFromGateway,
  withEditorActions,
} from '@/lib/terminal-keys';
import { parseTerminalSnapshot, terminalFrameText } from '@/terminal/terminal-core';
import {
  foldPaneRead,
  hasEarlierAfterPage,
  hasEarlierTerminalOutput,
  mergeTerminalWindow,
  nextPageRange,
  paneReadRange,
  type PaneReadOrigin,
  seedPageRange,
  terminalOutputLineCount,
  terminalOwnsScreen,
  terminalViewportRows,
} from '@/terminal/history';
import { useTerminalTheme } from '@/hooks/use-theme-pack';

type ServerData = {
  health: HealthResponse | null;
  sessionId: string;
  workspaces: HerdrEntity[];
  tabs: HerdrEntity[];
  panes: HerdrEntity[];
  agents: HerdrEntity[];
};

type Selection = {
  workspaceId: string;
  tabId: string;
  paneId: string;
};

type ConnectionPhase = 'connecting' | 'connected' | 'reconnecting' | 'offline';

type ConnectionStatus = {
  phase: ConnectionPhase;
  attempt: number;
  message?: string;
  /**
   * This server has no usable record of this device, so Retry can only fail
   * again. The notice offers pairing instead.
   */
  needsPairing?: boolean;
};

type RefreshResult = { ok: true } | { ok: false; failure: GatewayFailure } | null;

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

const initialSelection: Selection = { workspaceId: '', tabId: '', paneId: '' };
const MAX_RECONNECT_DELAY_MS = 8_000;

/**
 * How long a chosen panel is given to turn up in this screen's snapshot.
 *
 * Three quick asks rather than one, because the pick can name a panel that was
 * created a heartbeat ago: the sheet gets the new pane's id back from the
 * create call, and this screen only learns the pane exists on its next refresh.
 * A single check would report every freshly made panel as missing.
 */
const PANEL_PICK_ATTEMPTS = 3;
const PANEL_PICK_RETRY_MS = 200;

/**
 * Half the pane carousel: the outgoing pane travels this far before the
 * incoming one comes back from the opposite side.
 *
 * Short of a full-width push on purpose. The pane fills the screen and its
 * content is text being read, so a long throw costs more than it says; this is
 * far enough to be unmistakably a direction and near enough that the reading
 * position does not feel thrown away.
 */
const PANE_SLIDE_DISTANCE = 36;

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
const AnimatedSafeAreaView = Animated.createAnimatedComponent(SafeAreaView);

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
  notificationId?: string;
};

/**
 * The terminal controller and surface shared by compact navigation and the
 * persistent Pad workspace. Keeping one component means both compositions own
 * exactly one poller, event stream, attachment queue, and pane selection.
 */
export function ServerTerminalWorkspace({
  serverId: providedServerId,
  sessionId: providedSessionId,
  paneId: providedPaneId,
  notificationId: providedNotificationId,
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
    notificationId?: string;
  }>();
  const serverId = providedServerId ?? routeParams.serverId ?? '';
  const [padRequestedPaneId, setPadRequestedPaneId] = useState<string | undefined>();
  const requestedSessionId = providedSessionId ?? routeParams.sessionId;
  const requestedPaneId = providedPaneId ?? padRequestedPaneId ?? routeParams.paneId;
  const notificationId = providedNotificationId ?? routeParams.notificationId;
  const router = useRouter();
  const isFocused = useIsFocused();
  const { width: windowWidth } = useWindowDimensions();
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
  const simfarmPorts = useServerSimfarm((state) => state.byServer);
  const hydrateSimfarmPorts = useServerSimfarm((state) => state.hydrate);
  const rememberSimfarmPortForServer = useServerSimfarm((state) => state.remember);
  useEffect(() => {
    void hydrateSimfarmPorts();
  }, [hydrateSimfarmPorts]);
  const rememberSimfarmPort = useCallback(
    (port: number) => {
      if (serverId) void rememberSimfarmPortForServer(serverId, port);
    },
    [rememberSimfarmPortForServer, serverId]
  );
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const insets = useSafeAreaInsets();
  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const { record, records, loading, selectRecord, disconnect } = useGatewayRecord();
  const { showToast } = useToast();
  const demoMode = isDemoRecord(record);
  const {
    attachments,
    addFiles,
    retryUpload,
    removeAttachment,
    clearAttachments,
    uploading: attachmentsUploading,
    awaitUploads,
  } = useAttachmentUploads();
  const panelPick = usePanelPickerStore((state) => state.pick);
  const clearPanelPick = usePanelPickerStore((state) => state.clearPick);
  const showTerminalKeyRow = useAppSettings((state) => state.showTerminalKeyRow);
  const terminalTextSize = useAppSettings((state) => state.terminalTextSize);
  const [data, setData] = useState<ServerData>(initialData);
  const [selection, setSelection] = useState<Selection>(initialSelection);
  // Gives the in-memory Demo mirror one stable freshness boundary for this
  // mounted workspace. Real servers continue to use their persisted mirror.
  const [demoRailCheckedAtMs] = useState(() => Date.now());
  /** How many refreshes a pending panel pick has already waited through. */
  const [panelPickAttempt, setPanelPickAttempt] = useState(0);
  const [output, setOutput] = useState('');
  const [draft, setDraft] = useState('');
  // Where the caret is in the draft, which is half of what decides whether an
  // `@` mention is open. Tracked rather than assumed, so moving the caret back
  // into an old `@word` reopens the picker the same as typing it fresh would.
  const [caret, setCaret] = useState(0);
  // Set for exactly one render after a mention is inserted, to put the caret
  // past the path. `undefined` the rest of the time: a permanently controlled
  // selection fights the platform's own caret handling on Android.
  //
  // Written but not yet read: the composer's `selection` prop this is meant to
  // feed has not been wired up, so picking a mention currently leaves the
  // platform caret wherever the text change put it. Kept rather than deleted
  // because the state is half of a feature the file-mention work still owes;
  // wiring it is a behavioural change and belongs to that card, not to lint.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- see above.
  const [pendingCaret, setPendingCaret] = useState<number | null>(null);
  const [mentionHits, setMentionHits] = useState<FileMentionHit[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(96);
  const [shortcuts, setShortcuts] = useState<PaneShortcuts | null>(null);
  // The keyboard button swaps the compact key row for a full on-screen QWERTY
  // that types straight into the pane -- the way to drive a TUI like nvim from
  // a phone. Off by default so the output stays visible.
  const [keyboardMode, setKeyboardMode] = useState(false);
  // Asked for, per visit to the keyboard: an editor's composer stands down so
  // the file gets the height, and this is the reader saying they want it back
  // for one line. Cleared whenever the keyboard closes or the pane changes,
  // both of which end the visit it belongs to.
  const [composerRevealed, setComposerRevealed] = useState(false);
  const [stickBottomNonce, setStickBottomNonce] = useState(0);
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
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
  // The pane's revision as last applied to the output. Parts are read against
  // this, so the structured view refreshes on the same beat as the terminal one
  // rather than on a poll of its own.
  const [paneRevision, setPaneRevision] = useState(-1);

  const prefilledDraft = useComposerDraftStore((state) => state.draft);
  const clearPrefilledDraft = useComposerDraftStore((state) => state.clearDraft);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>({
    phase: 'connecting',
    attempt: 0,
  });
  const [retryNonce, setRetryNonce] = useState(0);
  const [loadingEarlierOutput, setLoadingEarlierOutput] = useState(false);
  const [canLoadEarlierOutput, setCanLoadEarlierOutput] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const activeServerRef = useRef<string | null>(null);
  const activePaneRef = useRef<string | null>(null);
  // Held in a ref rather than read from state so the poller does not have to be
  // rebuilt -- and the poll loop restarted -- when health first arrives.
  const healthRef = useRef<HealthResponse | null>(null);
  const dataRequestIdRef = useRef(0);
  const outputRequestIdRef = useRef(0);
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
  const earlierPartsRowsRef = useRef(0);
  const loadingEarlierPartsRef = useRef(false);
  const appliedNotificationTargetRef = useRef<string | null>(null);
  // The revision last read for the selected pane. An event repeating a revision
  // we already have is ignored, which is what turns "poll every 1.2s" into
  // "read only when something changed".
  const readRevisionRef = useRef<{ paneId: string; revision: number }>({ paneId: '', revision: -1 });
  // The same idea for the structured view: the content key last read as parts.
  const readPartsKeyRef = useRef<{ paneId: string; contentKey: string }>({
    paneId: '',
    contentKey: '',
  });
  const partsRequestIdRef = useRef(0);
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
  // The pane switch, without remounting the terminal: tearing down and
  // rebuilding the Skia canvas on every fast switch raced the native side and
  // crashed, so the transition runs on the mounted view's own opacity and
  // transform instead.
  //
  // It is the title switcher's carousel applied to the whole pane -- the
  // outgoing content leaves the way the finger went, the incoming arrives from
  // the opposite edge. Because there is only one canvas, the jump across
  // happens at zero opacity, which is also where the new pane's output lands.
  // The dip-to-0.35 this replaces carried no direction at all and read as a
  // flicker rather than as a move between two things.
  const paneFade = useSharedValue(1);
  const paneSlide = useSharedValue(0);
  const paneTransitionStyle = useAnimatedStyle(() => ({
    opacity: paneFade.value,
    transform: [{ translateX: paneSlide.value }],
  }));
  // Which way the next switch travels: forward through the strip is +1. Set by
  // whatever caused the switch -- a chip tap or a two-finger swipe -- and read
  // once, because a workspace cycle or a gateway reconcile can also land on a
  // new pane with no direction of its own, and those should not inherit the
  // last one.
  const paneDirectionRef = useRef<1 | -1>(1);
  // The pane strip scrolls, and with more panes than fit, swiping to one off
  // its right-hand end used to leave the strip highlighting nothing: the
  // active chip was simply somewhere the user could not see, so the only
  // indicator of which pane is open pointed at empty space.
  const paneStripRef = useRef<ScrollView>(null);
  const paneChipLayouts = useRef<Record<string, { x: number; width: number }>>({});
  const paneStripViewportRef = useRef(0);
  const paneStripOffsetRef = useRef(0);
  // The composer rides the same keyboard offset as the terminal. Sharing one
  // source means it can never get stuck up while the keyboard is down, which is
  // what a separate KeyboardStickyView occasionally did.
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.value }],
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
  const ready = isFocused && selectedServer;
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
  const hasLoadedData = Boolean(data.health);

  useLayoutEffect(() => {
    activeServerRef.current = ready ? serverId : null;
    activePaneRef.current = ready ? selection.paneId : null;
  }, [ready, selection.paneId, serverId]);

  useEffect(() => {
    if (isFocused && !loading && routeRecord && record?.serverId !== routeRecord.serverId) {
      void selectRecord(routeRecord.serverId);
    }
  }, [isFocused, loading, record?.serverId, routeRecord, selectRecord]);

  // Regaining focus means a sheet just closed -- most likely the panels sheet,
  // where a rename/create/delete may have happened. Pull fresh data so the pane
  // title and strip reflect it at once, without waiting for the slow poll or a
  // structural event that may have been missed.
  useEffect(() => {
    if (isFocused && hasLoadedData) refreshDataRef.current();
  }, [isFocused, hasLoadedData]);

  useEffect(() => {
    if (selectedServer) return;
    dataRequestIdRef.current += 1;
    outputRequestIdRef.current += 1;
    partsRequestIdRef.current += 1;
    readPartsKeyRef.current = { paneId: '', contentKey: '' };
    setPartsState(initialPartsState);
    setPaneRevision(-1);
    setData(initialData);
    setSelection(initialSelection);
    setOutput('');
    setDraft('');
    setCaret(0);
    setError(null);
    setLoadingData(true);
    healthRef.current = null;
    workspaceMemoryRef.current = {};
    tabPaneMemoryRef.current = {};
    setConnection({ phase: 'connecting', attempt: 0 });
    setSending(false);
    setSendingKey(null);
    outputLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierOutputRowsRef.current = 0;
    lastReadRef.current = null;
    rangeUnsupportedRef.current = false;
    loadingEarlierOutputRef.current = false;
    appliedNotificationTargetRef.current = null;
    setLoadingEarlierOutput(false);
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
  }, [clearAttachments, selectedServer, serverId]);

  useEffect(() => {
    if (ready) return;
    dataRequestIdRef.current += 1;
    outputRequestIdRef.current += 1;
    setSending(false);
    setSendingKey(null);
  }, [ready]);

  const refreshData = useCallback(async (showLoading = false): Promise<RefreshResult> => {
    if (!ready) return null;
    const requestId = ++dataRequestIdRef.current;
    const requestServerId = serverId;
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId && dataRequestIdRef.current === requestId;
    if (showLoading) setLoadingData(true);
    try {
      // Health costs a herdr round-trip and is only read as a "have we loaded
      // anything yet" flag, so it is fetched once rather than every poll.
      const [health, sessions] = await Promise.all([
        healthRef.current ? Promise.resolve(healthRef.current) : gatewayTransport.loadHealth(),
        gatewayTransport.loadSessions(),
      ]);
      if (!isCurrentRequest()) return null;
      const sessionId = sessions.sessions?.find((item) => item.id === requestedSessionId)?.id
        ?? sessions.sessions?.[0]?.id
        ?? 'default';
      const [workspaces, tabs, panes, agents] = await Promise.all([
        gatewayTransport.loadWorkspaces(sessionId),
        gatewayTransport.loadTabs(sessionId),
        gatewayTransport.loadPanes(sessionId),
        gatewayTransport.loadAgents(sessionId),
      ]);
      if (!isCurrentRequest()) return null;
      healthRef.current = health;
      const next = { health, sessionId, workspaces, tabs, panes, agents };
      setData((current) => (sameServerData(current, next) ? current : next));
      setSelection((current) => {
        const reconciled = reconcileSelection(next, current);
        return sameSelection(current, reconciled) ? current : reconciled;
      });
      setError(null);
      return { ok: true };
    } catch (failure) {
      if (!isCurrentRequest()) return null;
      return { ok: false, failure: describeGatewayFailure(failure, t`Server unavailable.`) };
    } finally {
      if (isCurrentRequest()) setLoadingData(false);
    }
  }, [ready, requestedSessionId, serverId, t]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    async function poll(initial: boolean) {
      const result = await refreshData(initial);
      if (cancelled || !result) return;
      if (result.ok) {
        attempt = 0;
        setConnection((current) =>
          current.phase === 'connected' && current.attempt === 0
            ? current
            : { phase: 'connected', attempt: 0 }
        );
        // Structural changes arrive over the event stream; this slow poll only
        // covers a missed event or a stream that never connected.
        timer = setTimeout(() => void poll(false), 12000);
        return;
      }

      attempt += 1;
      setConnection({
        phase: result.failure.retryable && attempt < 3 ? 'reconnecting' : 'offline',
        attempt,
        message: result.failure.message,
        needsPairing: result.failure.needsPairing,
      });
      if (result.failure.retryable) {
        const retryDelay = Math.min(
          1000 * 2 ** Math.min(attempt - 1, 3),
          MAX_RECONNECT_DELAY_MS
        );
        timer = setTimeout(() => void poll(false), retryDelay);
      }
    }

    setConnection((current) => {
      // Returning from the background and route/data reconciliation both restart this
      // poller. Keep a healthy connection stable while that refresh runs; only an
      // actual failed request should move it into the reconnecting state.
      if (hasLoadedData && current.phase === 'connected') return current;
      return { phase: hasLoadedData ? 'reconnecting' : 'connecting', attempt: 0 };
    });
    void poll(!hasLoadedData);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasLoadedData, ready, refreshData, retryNonce, serverId, t]);

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

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && selectedServer) setRetryNonce((value) => value + 1);
    });
    return () => subscription.remove();
  }, [selectedServer]);

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
  const selectedAgent = useMemo(
    () => data.agents.find((item) => field(item, 'pane_id') === selection.paneId),
    [data.agents, selection.paneId]
  );
  // Which of the three readings of this pane is on screen: the conversation,
  // the reflowed text, or the raw grid. The hook owns the whole decision --
  // the setting, this pane's own last choice, and what the pane can actually
  // show -- so the screen only has to say what each mode draws.
  const agentPane = Boolean(selectedAgent);
  const partsForPane = partsState.paneId === selection.paneId ? partsState : initialPartsState;
  const paneView = usePaneViewMode({
    serverId,
    paneId: selection.paneId,
    agent: agentPane,
    parts: partsForPane.supported,
  });
  // Colour has to be asked for at the gateway, so the output format follows the
  // mode: reflowed text for reading, cells for the grid.
  const agentOutput = agentPane && paneView.mode === 'text';
  const chatViewChosen = paneView.mode === 'chat';
  // What the user asked for and what can actually be drawn are two different
  // things: a failed read falls back to the terminal without forgetting the
  // choice, so the view returns by itself once the gateway answers again.
  const chatViewShown = chatViewChosen && !partsForPane.failed;
  // New content for this pane, however it was noticed: the gateway's revision
  // where there is one, and otherwise the output itself, which `setOutput`
  // leaves untouched when nothing changed.
  const paneContentKey = paneRevision >= 0 ? `rev:${paneRevision}` : output;

  const refreshParts = useCallback(
    async (contentKey: string) => {
      const requestPaneId = selection.paneId;
      if (!ready || connection.phase !== 'connected' || !requestPaneId || !agentPane) return;
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
        activeServerRef.current === requestServerId
        && activePaneRef.current === requestPaneId
        && partsRequestIdRef.current === requestId;
      // Read at whatever window the reader has paged back to: a transcript is
      // re-read whole, so a refresh at the initial limit would silently throw
      // away every page they pulled in.
      const lineLimit = partsLineLimitRef.current;
      try {
        const result = await listPaneParts(data.sessionId, requestPaneId, lineLimit);
        if (!isCurrentRequest()) return;
        setPartsState({
          paneId: requestPaneId,
          answered: true,
          supported: result.structured,
          failed: false,
          failures: 0,
          parts: result.parts,
          composer: result.composer,
        });
        const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
        earlierPartsRowsRef.current = paneTranscriptRows(result.parts);
        setCanLoadEarlierParts(
          hasEarlierPaneParts(result.parts, lineLimit, MAX_PANE_OUTPUT_LINES, scroll)
        );
      } catch {
        if (!isCurrentRequest()) return;
        // Silent on purpose: the structured view is an alternative reading of
        // output the user can already see, so a failure here is not an error
        // to report -- it drops back to the terminal and marks the toggle.
        setPartsState((current) => {
          const base = current.paneId === requestPaneId ? current : initialPartsState;
          return { ...base, paneId: requestPaneId, failed: true, failures: base.failures + 1 };
        });
      }
    },
    [agentPane, connection.phase, data.sessionId, ready, selection.paneId, serverId]
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
      !ready
      || connection.phase !== 'connected'
      || !requestPaneId
      || loadingEarlierPartsRef.current
      || currentLimit >= MAX_PANE_OUTPUT_LINES
    ) return;

    const requestId = ++partsRequestIdRef.current;
    const requestServerId = serverId;
    const nextLimit = Math.min(MAX_PANE_OUTPUT_LINES, currentLimit + PANE_OUTPUT_PAGE_LINES);
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId
      && activePaneRef.current === requestPaneId
      && partsRequestIdRef.current === requestId;

    loadingEarlierPartsRef.current = true;
    setLoadingEarlierParts(true);
    try {
      const result = await listPaneParts(data.sessionId, requestPaneId, nextLimit);
      if (!isCurrentRequest()) return;
      partsLineLimitRef.current = nextLimit;
      // This transcript was read under a wider window than the content key
      // describes, so the next change has to re-read rather than be skipped as
      // "already have that content".
      readPartsKeyRef.current = { paneId: '', contentKey: '' };
      setPartsState({
        paneId: requestPaneId,
        answered: true,
        supported: result.structured,
        failed: false,
        failures: 0,
        parts: result.parts,
        composer: result.composer,
      });
      const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
      const reachedRows = earlierPartsRowsRef.current;
      earlierPartsRowsRef.current = paneTranscriptRows(result.parts);
      setCanLoadEarlierParts(
        hasEarlierPartsAfterPage(
          result.parts, nextLimit, MAX_PANE_OUTPUT_LINES, scroll, reachedRows
        )
      );
    } catch {
      // Same silence as the ordinary read: the transcript already on screen is
      // still true, and the pull can simply be tried again.
      if (isCurrentRequest()) setCanLoadEarlierParts(false);
    } finally {
      if (isCurrentRequest()) {
        loadingEarlierPartsRef.current = false;
        setLoadingEarlierParts(false);
      }
    }
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
    void refreshParts(paneContentKey);
  }, [
    agentPane,
    chatViewChosen,
    paneContentKey,
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

  // The same list, written down for the server list to draw. Only one gateway
  // connection is open at a time, so the home screen cannot ask the other
  // servers what they are running; what it can do is show what this screen last
  // saw, which is exactly this.
  //
  // Named through `mirroredServerPanes`, which resolves each row's pane and
  // titles it the way every other surface titles it. Copying `agent.title`
  // here was why a renamed panel kept its old name on the home screen: a
  // rename sets the *pane's* label, and the agents endpoint never hears
  // about it.
  //
  // Always the full-pane shape, not a branch on `serverCardPanes` (Settings'
  // "Panes on server cards") -- seeing `data.panes` written unconditionally is
  // by design, not a leak of a setting this screen does not otherwise care
  // about. The setting answers a *display* question, and the mirror is not
  // the display: `ServerAgentRows` filters `hasAgent` at render time against
  // whatever the setting currently says, so a change made in Settings is
  // visible on the home screen immediately rather than only after this screen
  // next writes the mirror in the newly-chosen shape. See the module doc on
  // `mirroredServerPanes` (`lib/server-agents.ts`) for the cost of that.
  const agentsByServer = useServerAgents((state) => state.byServer);
  const hydrateServerAgents = useServerAgents((state) => state.hydrate);
  const recordServerAgents = useServerAgents((state) => state.record);
  const reachabilityProbes = useServerReachability((state) => state.probes);

  useEffect(() => {
    void hydrateServerAgents();
  }, [hydrateServerAgents]);

  useEffect(() => {
    if (!selectedServer || !record || isDemoRecord(record)) return;
    void recordServerAgents({
      serverId: record.serverId,
      checkedAtMs: Date.now(),
      agents: mirroredServerPanes(data.panes, data.agents),
    });
  }, [data.agents, data.panes, record, recordServerAgents, selectedServer]);

  // And the same trick for what this gateway can do. The home card's `...` menu
  // has to decide whether to offer New Task about a server it is not connected
  // to, and this is the only screen that ever hears the answer. Unlike the
  // agent mirror this is not behind a setting: it gates an entry point rather
  // than drawing one, and a reader who turned the agent rows off did not ask to
  // lose a menu item.
  const recordServerCapabilities = useServerCapabilities((state) => state.record);
  useEffect(() => {
    if (!selectedServer || !record || isDemoRecord(record) || !data.health) return;
    void recordServerCapabilities(record.serverId, data.health.capabilities);
  }, [data.health, record, recordServerCapabilities, selectedServer]);

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
  const fullScreenPane = isFullScreenTuiPane(
    shortcuts?.profile,
    selectedPane ? field(selectedPane, 'terminal_title_stripped') : null,
    selectedPane ? field(selectedPane, 'foreground_command') : null
  );
  /*
    An editor opens straight into the keyboard.

    The pane is driven a keystroke at a time, so the composer -- a line buffer
    that needs Enter to send -- is the wrong instrument for it, and reaching the
    right one was a tap the reader had to know about. Arriving on nvim with the
    keyboard already up is the difference between a viewer and an editor.

    Only on the way *in* to an editor pane. Keyed on the pane rather than run
    whenever `fullScreenPane` is true, so closing the keyboard on an editor
    keeps it closed -- otherwise the toggle would fight the effect and the
    keyboard would spring back on the next render.
  */
  const autoKeyboardPaneRef = useRef<string | null>(null);
  useEffect(() => {
    const paneId = selection.paneId;
    if (!paneId || !fullScreenPane) return;
    if (autoKeyboardPaneRef.current === paneId) return;
    autoKeyboardPaneRef.current = paneId;
    setKeyboardMode(true);
  }, [fullScreenPane, selection.paneId]);

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
  // The pane's own viewport, off the scroll metric every pane entity carries.
  // This is what separates the ring-buffer history in the served window from
  // the live screen at its tail: a full-screen program repaints exactly its
  // viewport, so the last `viewport_rows` rows are the screen. 0 (unknown)
  // keeps the terminal on its old arithmetic.
  const selectedPaneScreenRows =
    terminalViewportRows(selectedPane?.raw.scroll) ?? 0;
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
  const paneOwnsScreen = terminalOwnsScreen(selectedPane?.raw.scroll) ?? fullScreenPane;
  // The pane's own width, as the gateway reports it -- the authoritative grid
  // size, not the widest-line guess `parseTerminalSnapshot` falls back to when
  // this is absent. `undefined` (rather than 0) for a pane the gateway did not
  // report a width for, so the parser's own inference stays untouched.
  const selectedPaneColumns = selectedPane ? numberField(selectedPane, 'width') || undefined : undefined;

  // nvim's own mode, read off the screen it just painted rather than asked
  // for -- tmux's formats carry nothing about it (`#{pane_mode}` is empty for
  // an nvim pane). Gated on `fullScreenPane`, the same "is this actually an
  // editor" answer the row and the layout already trust -- which now already
  // incorporates `foreground_command` (see `fullScreenPane` above), so this
  // does not need a signal of its own. Parsed from the same text every other
  // reader of pane content uses, not a second request -- this is a fact about
  // a frame the app already has.
  const nvimMode = useMemo(() => {
    if (!fullScreenPane || !output) return null;
    return parseNvimMode(terminalFrameText(parseTerminalSnapshot(output, undefined, selectedPaneColumns)));
  }, [fullScreenPane, output, selectedPaneColumns]);

  // The row follows what the pane is actually running: an agent's own actions,
  // an editor's motions, or shell line editing.
  // Ordered by how often these keys have actually been pressed, for this server
  // and this kind of pane. Recomputed when the pane changes, never on a tap: a
  // row that rearranges under a thumb is worse than one a session out of date.
  const terminalKeys = useMemo(() => {
    // Every nvim verb on the row -- `dd`, `u`, even bare `:` -- is a normal-mode
    // command. While nvim is typing every keystroke into the buffer, pressing
    // any of them types its literal characters instead of doing what its label
    // says, which is exactly the fat-fingered corruption a phone invites. This
    // is the one case that does not go through the usual resolve-then-merge
    // below: the usage-ordered row is deliberately not used here either, so
    // Esc stays first no matter how often the other keys have been pressed.
    if (fullScreenPane && nvimMode === 'insert') return INSERT_MODE_KEYS;
    const resolved =
      shortcuts && shortcuts.keys.length > 0
        ? terminalKeysFromGateway(shortcuts.keys)
        : terminalKeysForPane(
            selectedAgent ? field(selectedAgent, 'agent') : null,
            selectedPane ? field(selectedPane, 'terminal_title_stripped') : null
          );
    // An editor's own commands go on top of whatever was resolved rather than
    // into the table: the gateway's answer wins when there is one, so a set
    // added only to the fallback would never be seen against a real gateway.
    const base = fullScreenPane ? withEditorActions(resolved) : resolved;
    const scope = shortcuts ? usageScope(serverId, shortcuts.profile, 'keys') : null;
    return orderByUsage(base, scope ? loadUsage()[scope] : undefined, (item) => item.key);
  }, [fullScreenPane, nvimMode, selectedAgent, selectedPane, serverId, shortcuts]);
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
  const slashPopup = useComposerPopup({
    draft,
    onDraftChange: setDraft,
    trigger: slashTrigger,
  });

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
  const mentionTrigger = useMemo<FileMentionTrigger | null>(
    () => (fileMentionsEnabled ? findFileMentionTrigger(draft, caret) : null),
    [caret, draft, fileMentionsEnabled]
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
      const next = insertFileMention(draft, mentionTrigger, hit.path);
      setDraft(next.text);
      // Both, in this order: the caret state is what closes the picker on the
      // very next render, and the prop is what actually moves the platform
      // caret. Leaving either out shows the panel for a frame after the pick.
      setCaret(next.caret);
      setPendingCaret(next.caret);
      mentionSearchRef.current?.cancel();
      setMentionHits([]);
    },
    [draft, mentionSearchRef, mentionTrigger]
  );

  // `onScreen`, not `ready`: a sheet sliding up over the composer must not also
  // unmount it, or it is seen to blink out from under the sheet -- and every
  // layout inset below is derived from this. See `onScreen`.
  const composerVisible = onScreen && !loadingData && Boolean(selectedPane);
  // Attachments are the gateway's own upload endpoint, which the bundled demo
  // data has no counterpart for.
  const attachmentsAvailable = composerVisible && !demoMode;
  // A staged file is worth sending on its own; it started uploading the moment
  // it was picked, so Send is usually only collecting paths that already exist.
  const hasSendableContent = Boolean(draft.trim()) || attachments.length > 0;
  // Only images can be opened full screen, and the viewer pages between them,
  // so the tapped tile's position is resolved within that subset.
  const previewImages = useMemo<PreviewImage[]>(
    () =>
      attachments
        .filter((item) => isImageAttachment(item.mime))
        .map((item) => ({ id: item.id, uri: item.localUri })),
    [attachments]
  );
  const previewIndex = previewAttachmentId
    ? previewImages.findIndex((item) => item.id === previewAttachmentId)
    : -1;
  const outputFormat = agentOutput ? 'text' : 'ansi';
  const outputSource: PaneOutputSource = fullScreenPane ? 'visible' : 'recent-unwrapped';
  // Matches the terminal surface exactly, whichever pack is showing -- read
  // from the same palette the renderer draws with rather than restated, so the
  // chrome behind the grid can never be a shade off it.
  const terminalBackground = useTerminalTheme().background;
  // Chrome floats over the terminal, which now follows the selected pack. The
  // control tint therefore comes from that pack's text hue, not from two
  // mode-only blue-grey literals.
  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  // Clearing belongs here rather than in the poller: opening a sheet over the
  // terminal unfocuses this screen, and blanking on every refocus made the
  // output flash even though the pane never changed.
  useEffect(() => {
    setOutput('');
    outputRequestIdRef.current += 1;
    outputLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierOutputRowsRef.current = 0;
    lastReadRef.current = null;
    rangeUnsupportedRef.current = false;
    loadingEarlierOutputRef.current = false;
    setLoadingEarlierOutput(false);
    setCanLoadEarlierOutput(false);
    setHistoryRevision(0);
    partsLineLimitRef.current = INITIAL_PANE_OUTPUT_LINES;
    earlierPartsRowsRef.current = 0;
    loadingEarlierPartsRef.current = false;
    setLoadingEarlierParts(false);
    setCanLoadEarlierParts(false);
    partsRequestIdRef.current += 1;
    readPartsKeyRef.current = { paneId: '', contentKey: '' };
    setPaneRevision(-1);
    setPartsState(initialPartsState);
  }, [selection.paneId]);

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
  }, [data, notificationId, requestedPaneId, requestedSessionId, serverId, t]);

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
    if (!panelPick || panelPick.serverId !== serverId) return;
    const target = selectionForPane(data, panelPick.paneId);
    if (target.paneId === panelPick.paneId) {
      clearPanelPick();
      setPanelPickAttempt(0);
      setSelection(target);
      setError(null);
      return;
    }
    if (panelPickAttempt >= PANEL_PICK_ATTEMPTS) {
      clearPanelPick();
      setPanelPickAttempt(0);
      setError(t`This terminal is no longer available.`);
      return;
    }
    const timer = setTimeout(() => {
      void refreshData();
      setPanelPickAttempt((current) => current + 1);
    }, PANEL_PICK_RETRY_MS);
    return () => clearTimeout(timer);
  }, [clearPanelPick, data, panelPick, panelPickAttempt, refreshData, serverId, t]);

  // Which keys and slash commands this pane responds to is the gateway's
  // answer, so a newly supported agent needs a gateway update rather than an
  // app release. A failure here is not worth surfacing: the local tables cover
  // the pane until the next attempt.
  //
  // The pane id names the pane, not what it runs: when a shell hands its tty
  // to nvim the id stays put and only the title turns. The title is a
  // dependency because a pane opened as a shell would otherwise keep its
  // 'shell' profile for as long as it lived -- and a resolved profile
  // outranks the editor title fallback by design.
  const selectedPaneTitle = selectedPane ? field(selectedPane, 'terminal_title_stripped') : null;
  useEffect(() => {
    if (!ready || connection.phase !== 'connected' || !selection.paneId) {
      setShortcuts(null);
      return;
    }
    let cancelled = false;
    const requestPaneId = selection.paneId;
    void loadPaneShortcuts(data.sessionId, requestPaneId)
      .then((value) => {
        if (!cancelled && activePaneRef.current === requestPaneId) setShortcuts(value);
      })
      .catch(() => {
        if (!cancelled) setShortcuts(null);
      });
    return () => {
      cancelled = true;
    };
  }, [connection.phase, data.sessionId, ready, selection.paneId, selectedPaneTitle, t]);

  // A quick action that needs an argument typed comes back as a draft rather
  // than as a sent message.
  useEffect(() => {
    if (prefilledDraft === null) return;
    setDraft(prefilledDraft);
    setCaret(prefilledDraft.length);
    clearPrefilledDraft();
  }, [clearPrefilledDraft, prefilledDraft]);

  // The shared tail of "new output for this pane arrived" -- whether it came
  // from a read or was pushed inline over the event stream. Kept in one place so
  // both paths update the window, revision and load-earlier flag identically.
  const applyPaneOutput = useCallback(
    (
      requestPaneId: string,
      value: string,
      revision?: number,
      origin: PaneReadOrigin = 'frame'
    ) => {
      if (activePaneRef.current !== requestPaneId || loadingEarlierOutputRef.current) return;
      readRevisionRef.current = {
        paneId: requestPaneId,
        revision: typeof revision === 'number' ? revision : readRevisionRef.current.revision,
      };
      if (typeof revision === 'number') setPaneRevision(revision);
      const lineLimit = outputLineLimitRef.current;
      // One door for every source, and the source says which it is rather than
      // the code guessing from a length. `foldPaneRead` places the read at the
      // seam its own head anchors and keeps whatever sits above it, so no
      // source can shrink the depth the reader paged to -- see the contract at
      // the top of `src/terminal/history.ts`. Cards #675 (a screen replacing a
      // window), #712 (a length taken for authority) and #721 (a refresh
      // replacing a window it is not as deep as) all died here.
      setOutput((current) => {
        if (agentOutput) return mergeTerminalWindow(current, value, MAX_PANE_OUTPUT_LINES);
        // `fullScreenPaneRef.current`, not the closed-over `fullScreenPane`:
        // an editor's read is the whole of its current screen, not a tail of
        // a growing log, so it replaces rather than folds against the
        // placement heuristics built for the latter (card #795, defect 2 --
        // see `foldPaneRead`'s own doc on `ownsScreen`, and the ref's own doc
        // above for why this reads a ref instead of the render-time value).
        return foldPaneRead(current, value, origin, lineLimit, fullScreenPaneRef.current);
      });
      if (lineLimit === INITIAL_PANE_OUTPUT_LINES) {
        const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
        earlierOutputRowsRef.current = terminalOutputLineCount(value);
        setCanLoadEarlierOutput(
          hasEarlierTerminalOutput(value, lineLimit, MAX_PANE_OUTPUT_LINES, scroll)
        );
      }
      setError(null);
    },
    [agentOutput]
  );

  const refreshOutput = useCallback(async () => {
    if (
      !ready
      || connection.phase !== 'connected'
      || !selection.paneId
      || loadingEarlierOutputRef.current
    ) return;
    const requestId = ++outputRequestIdRef.current;
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId
      && activePaneRef.current === requestPaneId
      && outputRequestIdRef.current === requestId;
    try {
      // As deep as the reader has already paged, not the first page again. A
      // refresh that asks for one page and then replaces the window with the
      // answer throws away everything the reader pulled up -- the history
      // vanishes and the screen jumps, once a second, which is the flicker.
      const value = await readPaneOutput(
        data.sessionId,
        requestPaneId,
        outputFormat,
        outputLineLimitRef.current,
        outputSource
      );
      if (!isCurrentRequest()) return;
      const paneRevision = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.revision;
      applyPaneOutput(
        requestPaneId,
        value,
        typeof paneRevision === 'number' ? paneRevision : undefined,
        'refresh'
      );
    } catch (failure) {
      if (isCurrentRequest()) {
        const description = describeGatewayFailure(failure, t`Could not read the terminal.`);
        if (!description.retryable) setError(description.message);
      }
    }
  }, [
    applyPaneOutput,
    connection.phase,
    data.sessionId,
    outputFormat,
    outputSource,
    ready,
    selection.paneId,
    serverId,
    t,
  ]);

  const loadEarlierOutput = useCallback(async () => {
    const requestPaneId = selection.paneId;
    const currentLimit = outputLineLimitRef.current;
    if (
      !ready
      || connection.phase !== 'connected'
      || !requestPaneId
      || loadingEarlierOutputRef.current
      || currentLimit >= MAX_PANE_OUTPUT_LINES
    ) return;

    const requestId = ++outputRequestIdRef.current;
    const requestServerId = serverId;
    const nextLimit = Math.min(
      MAX_PANE_OUTPUT_LINES,
      currentLimit + PANE_OUTPUT_PAGE_LINES
    );
    const isCurrentRequest = () =>
      activeServerRef.current === requestServerId
      && activePaneRef.current === requestPaneId
      && outputRequestIdRef.current === requestId;

    loadingEarlierOutputRef.current = true;
    setLoadingEarlierOutput(true);
    setError(null);
    try {
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
      const seedScroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
      const seedRange = seedPageRange(seedScroll, currentLimit);
      const lastRange = paneReadRange(lastReadRef.current);
      const range = rangeUnsupportedRef.current ? null : (seedRange ?? lastRange);
      const page = range ? nextPageRange(range, PANE_OUTPUT_PAGE_LINES) : null;
      // A range-addressed page is disjoint from the window, so it costs its
      // own rows rather than every line beneath it. Without one this is the
      // widening tail read it has always been, byte-for-byte.
      let fetched = page
        ? await readPaneRange(
            data.sessionId,
            requestPaneId,
            page.start,
            page.end,
            outputFormat,
            outputSource
          )
        : await readPaneTail(
            data.sessionId,
            requestPaneId,
            outputFormat,
            nextLimit,
            outputSource
          );
      // A backend can accept `start`/`end` without complaint and still ignore
      // them, always answering with its own tail (herdr's does) -- there is no
      // capability flag that says so up front, so the only honest check is
      // whether what came back is shaped like the page that was actually
      // asked for. Compared on `start`, not `end`: a backend that shrank
      // between reads (a cleared pane, a restarted session reusing a pane id)
      // legitimately clamps `end` down while still honouring the requested
      // `start` verbatim, and reading that clamp as "ignored my range" would
      // punish a backend that fully supports it. A backend that ignores the
      // request outright answers with its own tail instead, whose `start`
      // bears no relation to the page asked for. A mismatch is remembered so
      // it is asked at most once, and this click still makes forward progress
      // rather than looking like it did nothing: fall back to the same
      // widening-tail request immediately.
      let origin: PaneReadOrigin = page ? 'rangePage' : 'page';
      if (page) {
        const servedRange = paneReadRange(fetched.read);
        if (!servedRange || servedRange.start !== page.start) {
          rangeUnsupportedRef.current = true;
          origin = 'page';
          fetched = await readPaneTail(
            data.sessionId,
            requestPaneId,
            outputFormat,
            nextLimit,
            outputSource
          );
        }
      }
      const { output: value, read } = fetched;
      if (!isCurrentRequest()) return;
      outputLineLimitRef.current = nextLimit;
      lastReadRef.current = read;
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
      setOutput((current) => foldPaneRead(current, value, origin, nextLimit, fullScreenPaneRef.current));
      const scroll = panesRef.current.find((pane) => pane.id === requestPaneId)?.raw.scroll;
      const reachedRows = earlierOutputRowsRef.current;
      earlierOutputRowsRef.current = terminalOutputLineCount(value);
      setCanLoadEarlierOutput(
        hasEarlierAfterPage(value, nextLimit, MAX_PANE_OUTPUT_LINES, scroll, reachedRows, read)
      );
      setHistoryRevision((revision) => revision + 1);
    } catch (failure) {
      if (isCurrentRequest()) {
        setError(describeGatewayFailure(failure, t`Could not load earlier output.`).message);
      }
    } finally {
      if (isCurrentRequest()) {
        loadingEarlierOutputRef.current = false;
        setLoadingEarlierOutput(false);
      }
    }
  }, [connection.phase,
    data.sessionId,
    outputFormat,
    outputSource,
    ready,
    selection.paneId,
    serverId, t]);

  useEffect(() => {
    panesRef.current = data.panes;
  }, [data.panes, t]);

  useEffect(() => {
    if (!selection.paneId) return;
    // Written as one sequence per value rather than as a completion callback:
    // assigning a shared value from inside its own callback cancels the
    // animation that is calling it, which calls it again, and the UI thread
    // recurses until it dies. (The title switcher learned this the hard way.)
    const away = paneDirectionRef.current * -PANE_SLIDE_DISTANCE;
    paneDirectionRef.current = 1;
    const out = timing('dropdown');
    const back = timing('short');
    paneFade.value = withSequence(withTiming(0, out), withTiming(1, back));
    paneSlide.value = withSequence(
      withTiming(away, out),
      // The jump to the far side happens while the pane is invisible.
      withTiming(-away, INSTANT),
      withTiming(0, back)
    );
  }, [paneFade, paneSlide, selection.paneId]);

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
    if (!layout || viewport <= 0) return;
    const offset = paneStripOffsetRef.current;
    const left = layout.x - PANE_CHIP_REVEAL_MARGIN;
    const right = layout.x + layout.width + PANE_CHIP_REVEAL_MARGIN;
    if (left >= offset && right <= offset + viewport) return;
    // Centred rather than nudged to the nearest edge: arriving here usually
    // means a swipe several panes along, and the neighbours on both sides are
    // what say where in the strip the pane sits. `scrollTo` clamps the far end
    // itself, so only the near end needs guarding.
    const target = Math.max(0, layout.x + layout.width / 2 - viewport / 2);
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
    if (!ready || connection.phase !== 'connected' || !selection.paneId) return;
    // First read on selecting the pane; after that the event stream drives it.
    // The interval is a safety net for a missed event or a cursor-only
    // change that does not bump the revision -- not the primary path.
    void refreshOutput();
    const timer = setInterval(() => void refreshOutput(), 1000);
    return () => clearInterval(timer);
  }, [connection.phase, ready, refreshOutput, selection.paneId]);

  // The permission menu this pane may be blocked on. Everything about it --
  // the read, the answer, the 409 retry rule -- lives in the hook; the screen
  // only says which pane, and only when the gateway declared it can do this.
  const approval = usePaneApproval({
    sessionId: data.sessionId,
    paneId: selection.paneId,
    supported: gatewaySupportsApprovals(data.health?.capabilities),
    enabled: ready && connection.phase === 'connected',
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
    enabled: ready && connection.phase === 'connected',
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

  // The live event stream. `pane_updated` for the selected pane reads its
  // output; structural events refresh the navigator. A (re)connect forces a
  // full read, because the stream has no replay and anything during the gap is
  // lost.
  usePaneEvents(
    selectedServer ? record?.url ?? null : null,
    selectedServer ? record?.token ?? null : null,
    data.sessionId,
    selectedServer ? selection.paneId || null : null,
    ready && connection.phase === 'connected',
    retryNonce,
    useMemo(
      () => ({
        onPaneRevision: (paneId: string, revision: number) => {
          if (paneId !== activePaneRef.current) return;
          const last = readRevisionRef.current;
          if (last.paneId === paneId && last.revision === revision) return;
          refreshOutputRef.current();
        },
        onPaneOutput: (paneId: string, revision: number, text: string) => {
          if (paneId !== activePaneRef.current) return;
          // Painted straight from the event -- no read round-trip.
          // Herdr can expose new text before its coalesced revision advances,
          // so inline output must not be discarded solely on revision equality.
          applyPaneOutputRef.current(paneId, text, revision, 'frame');
        },
        onStructureChanged: () => refreshDataRef.current(),
        onConnected: () => {
          readRevisionRef.current = { paneId: '', revision: -1 };
          refreshOutputRef.current();
          refreshDataRef.current();
          // Approval transitions during the gap are gone with the socket, so a
          // reconnect re-reads rather than trusting the last event seen.
          approvalRef.current.refresh();
        },
        onApprovalChanged: (event: string, payload: unknown) =>
          approvalRef.current.handleEvent(event, payload),
      }),
      [approvalRef]
    )
  );

  // Every way of arriving at a pane feeds the same memory -- the pane strip,
  // the panels sheet, a notification -- so a workspace is remembered on the
  // pane last actually looked at, not only on the ones swiped away from.
  useEffect(() => {
    workspaceMemoryRef.current = rememberWorkspaceSelection(workspaceMemoryRef.current, selection);
    tabPaneMemoryRef.current = rememberTabPane(tabPaneMemoryRef.current, selection);
  }, [selection]);

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
   */
  function selectWorkspace(nextWorkspaceId: string) {
    setSelection((current) => {
      if (current.workspaceId === nextWorkspaceId) return current;
      if (!data.workspaces.some((item) => item.id === nextWorkspaceId)) return current;
      workspaceMemoryRef.current = rememberWorkspaceSelection(workspaceMemoryRef.current, current);
      const candidate = recallWorkspaceSelection(workspaceMemoryRef.current, nextWorkspaceId);
      const next = reconcileSelection(data, candidate);
      return sameSelection(current, next) ? current : next;
    });
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
      setSelection((current) => {
        if (current.tabId === target.tabId) return current;
        if (!data.tabs.some((item) => item.id === target.tabId)) return current;
        tabPaneMemoryRef.current = rememberTabPane(tabPaneMemoryRef.current, current);
        const next = reconcileSelection(data, {
          workspaceId: current.workspaceId,
          tabId: target.tabId,
          paneId: recallTabPane(tabPaneMemoryRef.current, target.tabId),
        });
        if (sameSelection(current, next)) return current;
        // Set here rather than at the swipe, because only a switch that really
        // moves the screen should spend the animation.
        paneDirectionRef.current = direction === 'next' ? 1 : -1;
        return next;
      });
      setError(null);
    },
    [data]
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
    // Read off the strip the user is looking at, so the transition travels the
    // way the panes are laid out rather than the way the ids happen to sort.
    const from = tabPanes.findIndex((item) => item.id === selection.paneId);
    const to = tabPanes.findIndex((item) => item.id === pane.id);
    if (from >= 0 && to >= 0 && to !== from) paneDirectionRef.current = to > from ? 1 : -1;
    setSelection({
      workspaceId: field(pane, 'workspace_id') || selection.workspaceId,
      tabId: field(pane, 'tab_id') || selection.tabId,
      paneId: pane.id,
    });
  }

  // The saved SSH hosts, for the rail's own group under the servers. Hydrated
  // here as well as on the home list, since on a Pad this screen *is* the
  // home; the demo host rides along while the demo is on, as it does there.
  const sshHosts = useSshHostsStore((state) => state.hosts);
  const sshHostsLoading = useSshHostsStore((state) => state.loading);
  const hydrateSshHosts = useSshHostsStore((state) => state.hydrate);
  useEffect(() => {
    if (sshHostsLoading) void hydrateSshHosts();
  }, [hydrateSshHosts, sshHostsLoading]);
  const railSshHosts = sshHostsLoading ? [] : sshHomeRows(sshHosts, demoMode ? demoSshHost() : null);

  const railServers = useMemo<GatewayRecord[]>(() => {
    if (!routeRecord || records.some((server) => server.serverId === routeRecord.serverId)) {
      return records;
    }
    return [routeRecord, ...records];
  }, [records, routeRecord]);

  const railAgentsByServer = useMemo(() => {
    if (!routeRecord || !isDemoRecord(routeRecord)) return agentsByServer;
    return {
      ...agentsByServer,
      [routeRecord.serverId]: {
        serverId: routeRecord.serverId,
        checkedAtMs: demoRailCheckedAtMs,
        agents: mirroredServerAgents(data.agents, data.panes),
      },
    };
  }, [agentsByServer, data.agents, data.panes, demoRailCheckedAtMs, routeRecord]);

  const railReachabilityByServer = useMemo<Record<string, ServerReachability>>(
    () =>
      Object.fromEntries(
        railServers.map((server) => {
          if (server.serverId === serverId && selectedServer) {
            if (connection.phase === 'connected') return [server.serverId, 'live'];
            if (connection.phase === 'offline') return [server.serverId, 'offline'];
          }
          return [server.serverId, reachabilityFromProbe(reachabilityProbes[server.serverId])];
        })
      ),
    [connection.phase, railServers, reachabilityProbes, selectedServer, serverId]
  );

  function selectPadServer(server: GatewayRecord) {
    setPadRequestedPaneId(undefined);
    if (server.serverId === serverId) return;
    void selectRecord(server.serverId);

    // A compact detail can become wide during rotation or Stage Manager. Keep
    // that already-visible composition in place while its dynamic segment is
    // updated; the persistent Home workspace needs no route mutation at all.
    if (providedServerId === undefined) {
      router.replace({
        pathname: '/servers/[serverId]',
        params: { serverId: server.serverId },
      } as Href);
    }
  }

  function selectPadAgent(server: GatewayRecord, agent: ServerAgent) {
    if (!agent.paneId) {
      selectPadServer(server);
      return;
    }

    setPadRequestedPaneId(agent.paneId);
    if (server.serverId === serverId) {
      const pane = data.panes.find((item) => item.id === agent.paneId);
      if (pane) choosePane(pane);
      return;
    }

    void selectRecord(server.serverId);
    if (providedServerId === undefined) {
      router.replace({
        pathname: '/servers/[serverId]',
        params: { serverId: server.serverId, paneId: agent.paneId },
      } as Href);
    }
  }

  async function sendInput() {
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    const hasAttachments = attachments.length > 0;
    if (connection.phase !== 'connected' || !ready || !requestPaneId || sending) return;
    if (!draft.trim() && !hasAttachments) return;
    setSending(true);
    setError(null);
    try {
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
          message: t`Retry the ones marked in red, or remove them, then send again.`,
        });
        return;
      }
      if (activeServerRef.current !== requestServerId || activePaneRef.current !== requestPaneId) {
        return;
      }

      // With nothing attached the draft goes over exactly as typed. Attachments
      // join with spaces, not newlines: in a plain shell pane every newline is
      // an Enter, so line-separated paths would each execute as a command.
      // Upload names are uuid-based and never contain spaces, so no quoting is
      // needed.
      const value = attachmentPaths.length > 0
        ? [draft.trim(), ...attachmentPaths]
            .filter((part) => part.length > 0)
            .join(' ')
        : draft;
      if (!value.trim()) return;

      if (selectedAgent) {
        await sendAgentText(data.sessionId, requestPaneId, value);
      } else {
        await sendPaneText(data.sessionId, requestPaneId, value);
        if (activeServerRef.current !== requestServerId || activePaneRef.current !== requestPaneId) {
          return;
        }
        // A shell needs Enter to run what was typed. An editor does not: Enter
        // there is a newline in the buffer, so it belongs on the key row where
        // it can be pressed deliberately.
        if (!fullScreenPane) {
          await sendPaneKeys(data.sessionId, requestPaneId, ['enter']);
        }
      }
      if (activeServerRef.current !== requestServerId || activePaneRef.current !== requestPaneId) {
        return;
      }
      setDraft('');
      setCaret(0);
      clearAttachments();
      setStickBottomNonce((value) => value + 1);
      await refreshOutput();
      setTimeout(() => void refreshOutput(), 500);
    } catch (failure) {
      if (activeServerRef.current === requestServerId) {
        setError(describeGatewayFailure(failure, t`Could not send input.`).message);
      }
    } finally {
      if (activeServerRef.current === requestServerId) setSending(false);
    }
  }

  // The virtual keyboard fires a key per tap, so it skips the spinner state the
  // row uses and just sends. An immediate read keeps the caret responsive
  // without waiting on the event stream.
  function typeKey(key: string) {
    const requestPaneId = selection.paneId;
    if (connection.phase !== 'connected' || !ready || !requestPaneId) return;
    void sendPaneKeys(data.sessionId, requestPaneId, [key])
      .then(() => refreshOutputRef.current())
      .catch(() => {});
  }

  function typeText(text: string) {
    const requestPaneId = selection.paneId;
    if (connection.phase !== 'connected' || !ready || !requestPaneId) return;
    void sendPaneText(data.sessionId, requestPaneId, text)
      .then(() => refreshOutputRef.current())
      .catch(() => {});
  }

  async function sendTerminalKey(item: TerminalKey) {
    const requestServerId = serverId;
    const requestPaneId = selection.paneId;
    if (connection.phase !== 'connected' || !ready || !requestPaneId || sendingKey) return;
    setSendingKey(item.key);
    setError(null);
    if (keyScope) recordUsage(keyScope, item.key);
    try {
      if (item.text === undefined) {
        await sendPaneKeys(data.sessionId, requestPaneId, [item.key]);
      } else {
        // An editor command is characters, not a key name -- the gateway
        // validates key names and `:` is not one -- so it goes out the way the
        // composer sends a line, and a `:` command line is run the same way too.
        await sendPaneText(data.sessionId, requestPaneId, item.text);
        if (item.submit) {
          await sendPaneKeys(data.sessionId, requestPaneId, ['enter']);
        }
      }
      setTimeout(() => void refreshOutput(), 80);
    } catch (failure) {
      if (activeServerRef.current === requestServerId) {
        setError(describeGatewayFailure(failure, t`Could not send key.`).message);
      }
    } finally {
      if (activeServerRef.current === requestServerId) setSendingKey(null);
    }
  }

  function openQuickActions() {
    if (!selection.paneId) return;
    Keyboard.dismiss();
    router.push(
      {
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
          // The health answer this screen is already holding. A gateway that
          // cannot spawn gets a sheet with neither New task nor Stop in it.
          canSpawn: gatewaySupportsAgentSpawn(data.health?.capabilities) ? '1' : '',
          // Whether opening a plain URL on this machine is honest. The demo is
          // excluded before the transport is even consulted: its record points
          // at an address that does not exist, so every port on it is a page
          // that will never load.
          canOpenWeb:
            !demoMode && allowsWebServiceOpen(data.health?.transportSecurity?.protection)
              ? '1'
              : '',
          // What Stop is offered for, and what it would be sent to. Passed
          // rather than looked up there: this screen already polls both, and a
          // sheet that re-read them could offer Stop for an agent that stopped
          // while it was opening.
          agentTarget: selectedAgent ? field(selectedAgent, 'target') || selectedAgent.id : '',
          agentStatus: selectedAgent?.status ?? '',
        },
      } as Href
    );
  }

  // Cancelling a picker is not a failure, and both pickers report it as an
  // empty result, so only a thrown error is ever surfaced.
  function chooseAttachmentSource(source: AttachmentSource) {
    setAttachmentMenuOpen(false);
    void pickAttachments(source)
      .then(addFiles)
      .catch((failure: unknown) => {
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
            message: describeGatewayFailure(failure, t`The server did not return it.`).message,
          });
        })
        .finally(() => {
          openingAssetRef.current = false;
        });
    },
    [data.sessionId, selection.tabId, showToast, t]
  );

  /** A file path tapped in the terminal view. */
  const openFileLink = useCallback(
    (path: string) =>
      openMatchingAsset((sessionId, tabId) => resolveAssetByPath(sessionId, tabId, path)),
    [openMatchingAsset]
  );

  /** An `asset-ref` part tapped in the structured view, which names an id. */
  const openAssetById = useCallback(
    (assetId: string) =>
      openMatchingAsset((sessionId, tabId) => resolveAssetById(sessionId, tabId, assetId)),
    [openMatchingAsset]
  );

  function openPanelPicker() {
    Keyboard.dismiss();
    router.push(
      {
        pathname: '/panels',
        params: {
          serverId,
          sessionId: data.sessionId,
          paneId: selection.paneId,
          label: routeRecord?.label ?? record?.label ?? t`Server`,
        },
      } as Href
    );
  }

  if (!loading && !routeRecord) {
    return (
      <AppDrawer>
        <View style={styles.centerState}>
          <Text variant="heading">
            <Trans>Server not found</Trans>
          </Text>
          <Text variant="bodySmall" color={theme.colors.textMuted}>
            <Trans>Return to the server list and pair again.</Trans>
          </Text>
        </View>
      </AppDrawer>
    );
  }

  // The pane, and only the pane. The workspace used to lead this line because
  // the header was the one place its name appeared; it no longer is -- the
  // switch indicator in the notice stack spells the whole address out -- and
  // naming it twice spent the width the pane name needs.
  const detailTitle = selectedPane
    ? panelTitle(selectedPane, selectedAgent)
    : routeRecord?.label ?? record?.label ?? t`Server`;

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
  const terminalKeyStrip = (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={isPadLayout ? styles.padTerminalKeyViewport : undefined}
      contentContainerStyle={styles.terminalKeyList}>
      {terminalKeys.map((item) => (
        <TerminalKeyButton
          key={item.key}
          item={item}
          sending={sendingKey === item.key}
          disabled={connection.phase !== 'connected' || !selectedPane || Boolean(sendingKey)}
          onPress={() => void sendTerminalKey(item)}
          textColor={chromeText}
          background={chromeGlass}
          activeBackground={theme.colors.primary}
          activeText={theme.colors.onPrimary}
        />
      ))}
    </ScrollView>
  );

  const paneEntries = (fill: string) => (
    <>
      <PressableScale
        accessibilityLabel={t`Open quick actions`}
        feedback="selection"
        pressedScale={0.9}
        disabled={!selectedPane}
        onPress={openQuickActions}
        style={[
          styles.keyRowToggle,
          isPadLayout && styles.padKeyRowEntry,
          { backgroundColor: fill },
        ]}>
        <Zap size={isPadLayout ? 15 : 16} color={theme.colors.primary} />
      </PressableScale>
      {/* Quick actions is what goes into the session; this is what came out of
          it. That pairing is why files live beside it rather than as a fifth
          circle in the header. */}
      <ArtifactsButton
        sessionId={data.sessionId}
        tabId={selection.tabId}
        label={routeRecord?.label ?? record?.label ?? t`Server`}
        disabled={!selectedPane}
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

  return (
    <AppDrawer
      // Not `previewOpen`: the layout is what decides, and it declines the
      // preview on a window too narrow to hold both. Reading its answer keeps
      // the rail from standing down for a preview that never opened.
      padRailCollapsed={workspaceLayout.previewWidth > 0}
      padRail={
        <PadServerRail
          servers={railServers}
          agentsByServer={railAgentsByServer}
          reachabilityByServer={railReachabilityByServer}
          selectedServerId={record?.serverId ?? null}
          selectedPaneId={selection.paneId || null}
          onSelectAgent={selectPadAgent}
          onPairServer={() => router.push('/explore')}
          onOpenSettings={() => router.push('/settings')}
          onOpenSsh={() => router.push('/ssh')}
          sshHosts={railSshHosts}
          // The shell cannot open in this column: the workspace is keyed by
          // the selected gateway record, so a host leaves for its own screen.
          onSelectSshHost={(host) => router.navigate(`/ssh/${host.id}`)}
        />
      }
      detailTitle={detailTitle}
      onDetailBack={demoMode ? leaveDetail : undefined}
      detailFadeColor={terminalBackground}
      detailTitleSlot={
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
      }
      onDetailAction={hasLoadedData ? openPanelPicker : undefined}
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
        simfarmSplit.previewWidth > 0 ? (
          <PressableScale
            accessibilityLabel={t`Hide the simulator`}
            onPress={() => toggleSimfarmSplit(serverId)}
            style={navHeaderButtonStyle}>
            <X size={18} color={theme.colors.text} strokeWidth={2} />
          </PressableScale>
        ) : undefined
      }>
      {/* The terminal and, beside it, the simulator it is changing.

          A row rather than a third column of the drawer's own: the rail belongs
          to the drawer and lists machines, while these two are one machine's
          screen split in half. `previewWidth` is 0 whenever the preview is off
          or the window is too narrow to keep both halves usable, so this is a
          row of one for the whole of the compact layout and most of the Pad. */}
      <View style={styles.workspaceSplit}>
      <View style={[styles.page, { backgroundColor: terminalBackground }]}>
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
        <View pointerEvents="box-none" style={[styles.noticeStack, { top: insets.top + NAV_HEADER_TOP_GAP + 58 }]}>
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
              style={[styles.errorBar, { backgroundColor: theme.colors.dangerSubtle }]}>
              <Text selectable variant="caption" color={theme.colors.danger}>
                {error}
              </Text>
            </Animated.View>
          ) : null}
          {!error || connection.needsPairing ? (
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
          {away.digest ? (
            <AwayDigestCard digest={away.digest} onDismiss={away.dismiss} />
          ) : null}

          {/* Last in the stack on purpose. An error bar and a connection notice
              are standing conditions and keep the top of the column; this is a
              transient answer to a gesture and clears itself, so it queues
              underneath rather than pushing a condition out of the way. */}
          {switchPill ? (
            <SwitchIndicator address={switchPill.address} testID={switchPill.testID} />
          ) : null}
        </View>

        <View style={styles.terminalArea}>
          {/* The two-finger tab swipe is recognised by the canvas itself, as one
              more gesture simultaneous with its pan and pinch -- React Native's
              touches never see it. See `useTabSwipe` for the measurements. */}
          <View style={styles.terminalSwipeArea}>
            {/* The pane carousel, which a tab switch drives too: landing on a
                tab lands on one of its panes. See `paneTransitionStyle` for why
                the canvas underneath is never remounted. */}
            <Animated.View style={[styles.terminalSwipeArea, paneTransitionStyle]}>
              {chatViewShown ? (
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
                  topInset={insets.top + NAV_HEADER_TOP_GAP + 54}
                  bottomInset={composerVisible ? composerHeight : 0}
                  canLoadEarlier={canLoadEarlierParts}
                  loadingEarlier={loadingEarlierParts}
                  onLoadEarlier={loadEarlierParts}
                  onOpenAsset={openAssetById}
                  onToggleDetail={paneView.toggleDetail}
                />
              ) : (
                <TerminalBoundary
                  resetKey={`${selection.paneId}:${agentOutput ? 'agent' : 'terminal'}`}
                  background={terminalBackground}
                  textColor={chromeText}>
                  <TerminalPanel
                    sessionId={data.sessionId}
                    paneId={selection.paneId}
                    output={output}
                    mode={agentOutput ? 'agent' : 'terminal'}
                    edgeToEdge
                    // The whole composer reserves space, key row included: anything
                    // it covers is unreachable, and the "jump to latest" pill sits
                    // against this inset too.
                    bottomInset={composerVisible ? composerHeight : 0}
                    // Only a program that owns the screen gets one, and it is
                    // the same clearance the reading view above uses, so the two
                    // surfaces clear the same chrome by the same amount. Keyed
                    // on the surface rather than on "is an editor": an agent
                    // paints the whole screen too, and keying this on the editor
                    // predicate is what slid an agent's output under the pill.
                    topInset={paneOwnsScreen ? insets.top + NAV_HEADER_TOP_GAP + 54 : 0}
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
                    canLoadEarlier={fullScreenPane ? false : canLoadEarlierOutput}
                    historyRevision={historyRevision}
                    loadingEarlier={loadingEarlierOutput}
                    onLoadEarlier={loadEarlierOutput}
                    onViewportReady={refreshOutput}
                    historyIndicatorTopInset={insets.top + NAV_HEADER_TOP_GAP + 62}
                    stickBottomNonce={stickBottomNonce}
                    onFileLink={openFileLink}
                    onTwoFingerSwipe={tabSwipe.onSwipe}
                    screenFocused={isFocused}
                    paneColumns={selectedPaneColumns}
                  />
                </TerminalBoundary>
              )}
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
        {composerVisible && dock.floatingActions && !isPadLayout ? (
          <Animated.View
            // The band across from it belongs to the pill, and a full-width
            // invisible parent lying over it would have taken the pill's taps.
            pointerEvents="box-none"
            entering={fadeIn('micro')}
            exiting={fadeOutDown('short')}
            style={[
              styles.floatingEntries,
              { bottom: composerHeight + 14 },
              composerKeyboardStyle,
            ]}>
            <View
              style={[
                styles.floatingEntriesTray,
                {
                  backgroundColor: theme.colors.surfaceRaised,
                },
              ]}>
              {paneEntries('transparent')}
            </View>
          </Animated.View>
        ) : null}

        {composerVisible ? (
          <Animated.View
            style={[
              styles.composerOverlay,
              isPadLayout && styles.padComposerOverlay,
              composerKeyboardStyle,
            ]}>
            <EdgeFade edge="bottom" color={terminalBackground} style={styles.composerFade} />
          {/* Both of these hang off the caret in an input that is not on screen
              while a question is standing, so both go with it. */}
          {mentionTrigger && dock.composer ? (
            <View
              style={[
                styles.composerFloatingContent,
                isPadLayout && styles.padComposerFloatingContent,
              ]}>
              <FileMentionPanel
                hits={mentionHits}
                query={mentionTrigger.query}
                visibleRows={isPadLayout ? 3 : undefined}
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
                  isPadLayout && styles.padComposerPopup,
                ]}>
                <ComposerPopup
                  rows={slashPopup.rows}
                  onPick={slashPopup.pick}
                  testIDPrefix="slash-command"
                />
              </View>
            ) : null}
            {attachmentMenuOpen && dock.attachEntry && !keyboardMode ? (
              <View
                style={[
                  styles.composerFloatingContent,
                  isPadLayout && styles.padComposerFloatingContent,
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
              style={[styles.composerDock, isPadLayout && styles.padComposerDock]}>
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
            <AnimatedSafeAreaView
              edges={['bottom']}
              layout={dockRowLayout}
              onLayout={(event: LayoutChangeEvent) => {
                const nextHeight = Math.ceil(event.nativeEvent.layout.height);
                setComposerHeight((current) => (current === nextHeight ? current : nextHeight));
              }}
              style={[styles.composerSafeArea, isPadLayout && styles.padComposerSafeArea]}>
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
              onEscape={dock.bannerEscape ? () => void sendTerminalKey(escapeKey) : undefined}
              escapeDisabled={
                connection.phase !== 'connected' || !selectedPane || Boolean(sendingKey)
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
                style={styles.phonePaneStripViewport}
                contentContainerStyle={styles.paneStrip}>
                {paneChips}
              </Animated.ScrollView>
            ) : null}
            {dock.virtualKeyboard ? (
              // Rises out of the dock the way a keyboard does, and leaves the
              // same way: this swap replaces the whole key row, and a control
              // this large appearing between two frames read as a glitch.
              <Animated.View entering={riseIn()} exiting={fadeOutDown('short')}>
                <VirtualKeyboard
                  disabled={connection.phase !== 'connected' || !selectedPane}
                  onText={typeText}
                  onKey={typeKey}
                  onClose={() => setKeyboardMode(false)}
                  shortcuts={dock.keysInKeyboard ? terminalKeyStrip : undefined}
                />
              </Animated.View>
            ) : null}
            {/* The way back to the composer without putting the keyboard away.
                Closing the keyboard was the only route to it, which on an
                editor meant giving up `esc`, `:w` and the Ctrl chords for as
                long as it took to paste a line. A single control, so it floats
                in the dock's corner rather than taking a row -- the same rent
                argument as `floatingActions`. */}
            {dock.composerEntry ? (
              <Animated.View
                entering={fadeIn('micro')}
                exiting={fadeOutDown('short')}
                layout={dockRowLayout}
                style={styles.composerEntryRow}>
                <PressableScale
                  accessibilityLabel={t`Write a line`}
                  feedback="selection"
                  pressedScale={0.9}
                  onPress={() => setComposerRevealed(true)}
                  style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
                  <PenLine size={16} color={chromeText} />
                </PressableScale>
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
                {isPadLayout ? padPaneSwitcher : null}
                {paneEntries(chromeGlass)}
                <PressableScale
                  accessibilityLabel={t`Open on-screen keyboard`}
                  feedback="selection"
                  pressedScale={0.9}
                  onPress={() => {
                    Keyboard.dismiss();
                    setKeyboardMode(true);
                  }}
                  style={[styles.keyRowToggle, { backgroundColor: chromeGlass }]}>
                  <KeyboardIcon size={16} color={chromeText} />
                </PressableScale>
                {terminalKeyStrip}
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
            {/* The input goes for an approval. It is the strongest of the "send
                the pane something else" surfaces, and a text field left under a
                standing permission menu invites typing into a program that is
                not reading typing. Nothing already drafted is lost -- `draft` is
                the screen's state, not the field's, so the words come back with
                the dock.

                It sits outside the keyboard's branch rather than inside its
                else, because the keyboard is no longer the end of it: an editor
                can summon this back over the keys to paste a line without
                giving up `esc` and the chords to do it. `dock.composer` is what
                decides now, and it accounts for both. */}
            {dock.composer ? (
              <TerminalComposer
                entering={fadeInDown('short')}
                exiting={fadeOutDown('short')}
                layout={dockRowLayout}
                leading={
                  dock.attachEntry ? (
                    <PressableScale
                      accessibilityLabel={attachmentMenuOpen ? t`Close the attachment menu` : t`Attach a file`}
                      // A file picked now would join a message that is already on
                      // its way out, so the menu closes for the length of the send.
                      disabled={!selectedPane || sending}
                      onPress={() => setAttachmentMenuOpen((open) => !open)}
                      style={[
                        composerStyles.button,
                        { backgroundColor: chromeGlass },
                        attachmentMenuOpen ? { backgroundColor: theme.colors.primarySubtle } : null,
                      ]}>
                      <Paperclip size={17} color={theme.colors.primary} />
                    </PressableScale>
                  ) : null
                }
                inputProps={{
                  testID: 'terminal-composer-input',
                  value: draft,
                  onChangeText: setDraft,
                  // The picker follows the caret, and takes Esc from a hardware
                  // keyboard. Both are inert when no catalog is in hand.
                  ...slashPopup.inputProps,
                  // Both popups read the caret: the slash picker through its own
                  // inputProps handler, the @ mention trigger through `caret`.
                  // The spread must not eat the second one.
                  onSelectionChange: (event) => {
                    slashPopup.inputProps.onSelectionChange(event);
                    setCaret(event.nativeEvent.selection.start);
                  },
                  editable: connection.phase === 'connected' && Boolean(selectedPane) && !sending,
                  maxLength: 64 * 1024,
                  autoCapitalize: 'sentences',
                  // Names the surface, never the pane. The agent's name is already
                  // in the header a few points above this field, and repeating it
                  // here cost more than it said: a real agent title -- "分析
                  // dots-hyprland 配置兼容性", or "check dots-hyprland config
                  // compatibility", whose CJK half is double-width -- wrapped the
                  // placeholder onto a second line and grew the composer to match,
                  // on the one screen where
                  // vertical space is worth most -- and on the Pad's compact
                  // composer, which the tablet branch hit independently.
                  placeholder: selectedAgent
                    ? t`Send a message`
                    : fullScreenPane
                      ? t`Type into this editor`
                      : t`Run a terminal command`,
                }}
                send={{
                  accessibilityLabel: selectedAgent ? t`Send to agent` : t`Run command`,
                  armed: Boolean(hasSendableContent && selectedPane),
                  sending,
                  disabled:
                    connection.phase !== 'connected'
                    || !hasSendableContent
                    || !selectedPane
                    || sending,
                  onPress: () => void sendInput(),
                }}
              />
            ) : null}
            </AnimatedSafeAreaView>
            </GlassChrome>
          </Animated.View>
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
              { width: simfarmSplit.previewWidth, borderLeftColor: theme.colors.border },
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
    </AppDrawer>
  );
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
 * whose colour animates: a Lucide icon takes its colour as a prop, not as a
 * style, and the design system's `Text` resolves its own colour before the
 * style reaches React Native -- so in both cases there is nothing on the view
 * for the UI thread to drive. The resting copy is the one that lays out; the
 * selected copy is drawn over it.
 */
function PaneChip({
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
  const selected = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    selected.value = withTiming(active ? 1 : 0, timing('toggle'));
  }, [active, selected]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - selected.value }));
  const selectedStyle = useAnimatedStyle(() => ({ opacity: selected.value }));

  const Glyph = agentStatusColor ? Bot : SquareTerminal;
  const restGlyphColor = agentStatusColor ?? restColor;

  return (
    <PressableScale
      accessibilityLabel={accessibilityLabel}
      onLayout={onLayout}
      onPress={onPress}
      style={styles.paneChip}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.paneChipFill,
          { backgroundColor: activeFill },
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

function TerminalKeyButton({

  item,
  sending,
  disabled,
  onPress,
  textColor,
  background,
  activeBackground,
  activeText,
}: {
  item: TerminalKey;
  sending: boolean;
  disabled: boolean;
  onPress: () => void;
  textColor: string;
  background: string;
  activeBackground: string;
  activeText: string;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  // vim's vocabulary is the same in every language, so the cap is left alone;
  // what a screen reader says about it is not.
  //
  // Two tables, in this order. `editorActionDescription` is keyed by the action
  // identity and wins, because `nvim:w` has a real sentence behind it that the
  // terse `accessibilityLabel` does not. Everything else -- `esc`, `⌃C`, the
  // arrows, the shell set, whatever each agent advertises -- is keyed by its
  // English label, which is the only thing that tells the three different
  // `ctrl+r` rows apart. Anything neither table knows is the gateway's own
  // description, which the gateway has already localised from the locale header
  // we send it.
  const described =
    editorActionDescription[item.key] ?? terminalKeyDescription[item.accessibilityLabel];
  const spoken = described ? _(described) : item.accessibilityLabel;
  const cap = keyCap(item.key, item.cap);

  // `sending` is true from the instant the key is tapped until the send
  // resolves, so it doubles as the "you tapped this" highlight. The label stays
  // put -- swapping it for a spinner changed the button's width and made the
  // whole row jump.
  //
  // A key send against a healthy gateway resolves in a few tens of milliseconds,
  // and the highlight used to be applied and removed on whichever frames those
  // happened to land on: a flash, or on a fast enough send nothing at all. So
  // the release is a sequence rather than a ramp -- it reaches the highlight
  // first and only then leaves it -- which makes the beat the same length
  // whether the gateway took 20 ms or 200.
  const held = useSharedValue(0);
  // Only a key that was actually sending has a release to play. The effect
  // also runs on mount with `sending` false, and playing the sequence there
  // pulsed every key in the row -- the whole row flashed on every remount,
  // which is every pane switch and every keyboard close.
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending) {
      wasSending.current = true;
      held.value = withTiming(1, timing('micro'));
    } else if (wasSending.current) {
      wasSending.current = false;
      held.value = withSequence(withTiming(1, timing(PRESS.in)), withTiming(0, timing('micro')));
    }
  }, [held, sending]);

  const activeFillStyle = useAnimatedStyle(() => ({ opacity: held.value }));
  const restLabelStyle = useAnimatedStyle(() => ({ opacity: 1 - held.value }));
  const activeLabelStyle = useAnimatedStyle(() => ({ opacity: held.value }));

  return (
    <PressableScale
      accessibilityLabel={t`Send ${spoken}`}
      disabled={disabled}
      pressedScale={0.94}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      onPress={onPress}
      style={[
        styles.terminalKey,
        { backgroundColor: background },
        // Insert mode's Esc: bigger, and bordered in the same colour the
        // press animation below already uses for "sent", so it reads as the
        // row's one deliberate action rather than another glass chip.
        item.emphasis ? [styles.terminalKeyEmphasis, { borderColor: activeBackground }] : null,
      ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.terminalKeyFill,
          { backgroundColor: activeBackground },
          activeFillStyle,
        ]}
      />
      {/* Spelled-out combos ("Ctrl C") rather than tiny modifier glyphs, sized
          to the text since the row scrolls. The resting copy is what gives the
          key its width; the sending copy is drawn over it. */}
      <Animated.View style={restLabelStyle}>
        <Text
          variant="caption"
          color={textColor}
          style={
            item.emphasis
              ? [styles.terminalKeyText, styles.terminalKeyEmphasisText]
              : styles.terminalKeyText
          }>
          {cap}
        </Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.terminalKeyGlyph, activeLabelStyle]}>
        <Text
          variant="caption"
          color={activeText}
          style={
            item.emphasis
              ? [styles.terminalKeyText, styles.terminalKeyEmphasisText]
              : styles.terminalKeyText
          }>
          {cap}
        </Text>
      </Animated.View>
    </PressableScale>
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

  const title = connected
    ? t`Connected`
    : status.phase === 'connecting'
      ? t`Connecting`
      : status.phase === 'reconnecting'
        ? t`Reconnecting · ${status.attempt}`
        : t`Server offline`;

  // One shape for every phase, and the colour only on the dot. The state is
  // carried by the words -- a status that is legible by hue alone is not
  // legible -- so what changes between "Connecting" and "Server offline" is the
  // sentence and a 7pt light, not the object the sentence arrives in.
  const light = connected
    ? theme.colors.success
    : status.phase === 'offline'
      ? theme.colors.danger
      : theme.colors.warning;

  return (
    // Centred and sized to its text rather than stretched across the screen.
    // This used to be a full-bleed card with a 32pt saturated disc and a heavy
    // shadow, on a screen that otherwise speaks entirely in glass capsules --
    // the header's title pill and the pane's own transient answers are both
    // capsules, and this said the same kind of thing in a different language.
    // It also sat on top of the demo bar directly below it in the same stack.
    // The fade lives on the capsule rather than on this anchor, and the anchor
    // keeps only the layout transition. A Reanimated fade is an opacity
    // animation, and opacity 0 anywhere above a `GlassView` switches Liquid
    // Glass off outright; `GlassChrome` therefore takes the fade and applies it
    // to the fallback views only, animating the material itself on iOS 26.
    <Animated.View
      pointerEvents="box-none"
      layout={listLayout('short')}
      style={styles.connectionAnchor}>
      <GlassChrome
        entering={fadeIn('micro')}
        exiting={fadeOut('short')}
        style={styles.connectionPill}>
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
          <Text variant="caption" numberOfLines={2} style={styles.connectionPillText}>
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
            accessibilityLabel={t`Pair this server again`}
            onPress={onPairAgain}
            style={styles.connectionRetry}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Pair again</Trans>
            </Text>
          </PressableScale>
        ) : !connected && status.phase !== 'connecting' ? (
          <PressableScale
            accessibilityLabel={t`Retry connection`}
            onPress={onRetry}
            style={styles.connectionRetry}>
            <Text variant="caption" color={theme.colors.primary}>
              <Trans>Retry</Trans>
            </Text>
          </PressableScale>
        ) : null}
      </GlassChrome>
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
    current.sessionId === next.sessionId
    && entitySignature(current.workspaces) === entitySignature(next.workspaces)
    && entitySignature(current.tabs) === entitySignature(next.tabs)
    && entitySignature(current.panes) === entitySignature(next.panes)
    && entitySignature(current.agents) === entitySignature(next.agents)
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
        field(entity, 'workspace_id'),
        field(entity, 'tab_id'),
        field(entity, 'pane_id'),
      ].join('\u0001')
    )
    .join('\u0002');
}

function sameSelection(current: Selection, next: Selection): boolean {
  return (
    current.workspaceId === next.workspaceId
    && current.tabId === next.tabId
    && current.paneId === next.paneId
  );
}

function reconcileSelection(data: ServerData, current: Selection): Selection {
  const workspace =
    data.workspaces.find((item) => item.id === current.workspaceId) ??
    data.workspaces.find((item) => Boolean(item.raw.focused)) ??
    data.workspaces[0];
  if (!workspace) return initialSelection;

  const tabs = data.tabs.filter((item) => field(item, 'workspace_id') === workspace.id);
  const activeTabId = field(workspace, 'active_tab_id');
  const tab =
    tabs.find((item) => item.id === current.tabId) ??
    tabs.find((item) => item.id === activeTabId) ??
    tabs.find((item) => Boolean(item.raw.focused)) ??
    tabs[0];
  if (!tab) return { workspaceId: workspace.id, tabId: '', paneId: '' };

  const panes = data.panes.filter((item) => field(item, 'tab_id') === tab.id);
  const pane =
    panes.find((item) => item.id === current.paneId) ??
    panes.find((item) => Boolean(item.raw.focused)) ??
    panes.find((item) => field(item, 'agent').length > 0) ??
    panes[0];
  return { workspaceId: workspace.id, tabId: tab.id, paneId: pane?.id ?? '' };
}

/** Kept on the switch pills, because Maestro flows assert on them. */
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    position: 'relative',
  },
  workspaceSplit: {
    flex: 1,
    flexDirection: 'row',
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
  connectionPill: {
    maxWidth: '92%',
    minHeight: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    // A fraction of the shadow the block carried: this floats over the pane, it
    // does not sit on top of the screen.
    boxShadow: appChrome.shadow.connectionPill,
  },
  connectionPillLabel: {
    flexShrink: 1,
  },
  connectionPillText: {
    fontWeight: '600',
  },
  connectionRetry: {
    minHeight: 26,
    justifyContent: 'center',
    paddingLeft: 4,
    // The sentence yields first; the way out of the situation is never what
    // gets clipped.
    flexShrink: 0,
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
    paddingHorizontal: 12,
    paddingBottom: 8,
    gap: 7,
  },
  padComposerSafeArea: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'center',
    // The Pad dock is inset from the workspace by this same token. Reusing it
    // inside makes the controls' left clearance and the input's bottom
    // clearance visibly equal instead of inheriting compact's 12 / 8 split.
    paddingHorizontal: appChrome.layout.padWorkspaceGutter,
    paddingBottom: appChrome.layout.padWorkspaceGutter,
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
    paddingHorizontal: 12,
    marginBottom: 7,
  },
  padComposerPopup: {
    maxWidth: '100%',
  },
  composerFloatingContent: {
    width: '100%',
    maxWidth: 840,
    alignSelf: 'center',
  },
  padComposerFloatingContent: {
    maxWidth: '100%',
  },
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
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * The lone control that summons the composer back over the keyboard. Right-
   * aligned, where the send button it stands in for would be, so the thumb that
   * reaches for one reaches for the other.
   */
  composerEntryRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  padKeyRowEntry: {
    width: 34,
    height: 34,
    borderRadius: 10,
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
    maxWidth: 200,
    flexShrink: 0,
    overflow: 'hidden',
    paddingHorizontal: 12,
    borderRadius: 11,
    borderCurve: 'continuous',
  },
  // The chip's rounded fill, drawn under its content so it can fade on its own.
  paneChipFill: {
    borderRadius: 11,
    borderCurve: 'continuous',
  },
  // Sized to the glyph so the selected copy laid over the resting one lands on
  // top of it rather than filling the chip.
  paneChipGlyph: {
    width: 13,
    height: 13,
  },
  paneChipLabel: {
    flexShrink: 1,
    minWidth: 0,
    overflow: 'hidden',
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
  terminalKey: {
    height: KEY_ROW_HEIGHT,
    minWidth: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalKeyFill: {
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  terminalKeyGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalKeyText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontVariant: ['tabular-nums'],
  },
  // Insert mode's Esc. Wider and bordered rather than a louder fill, so it
  // stays legible against both theme packs without needing a colour of its
  // own -- the border already reuses `activeBackground`, which is themed.
  terminalKeyEmphasis: {
    minWidth: 64,
    paddingHorizontal: 18,
    borderWidth: 2,
  },
  terminalKeyEmphasisText: {
    fontWeight: '700',
  },
  viewToggle: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
