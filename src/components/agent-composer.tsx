import { assetFromLocalPdf } from '@/lib/session-assets';
import { useQuestionComposerDraft } from '@/hooks/use-question-composer-draft';
import { AssetViewer } from '@/components/asset-viewer';
import type { HomeComposerOutset } from '@/theme/home-composer-outset';
import { ComposerAttachmentButton } from '@/components/composer-attachment-button';
import { CompactionPill } from '@/components/agent-compaction-pill';
import type { CompactionActivity } from '@/lib/agent-compaction';
import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
  type TextInputSelectionChangeEvent,
} from 'react-native';
import { Spinner, useThemeTokens, useToast, PressableScale, Text } from '@osuki-dev/ui';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  BackIcon,
  DoneIcon,
  TaskIcon,
  DisclosureDownIcon,
  ProcessorIcon,
  CompareIcon,
  ForkIcon,
  InboxIcon,
  StackIcon,
  TerminalIcon,
  StopIcon,
  DeleteIcon,
  QuickActionIcon,
} from '@/icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  cancelAnimation,
  useReducedMotion,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { AgentRevertPlate } from '@/components/agent-revert-plate';
import { AgentUnreadDot } from '@/components/agent-unread-dot';
import { TerminalComposer } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AgentModeMenu } from '@/components/agent-mode-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { AttachmentThumbnailRow } from '@/components/attachment-thumbnail-row';
import { ImagePreviewModal, type PreviewImage } from '@/components/image-preview-modal';
import { GlassChrome } from '@/components/glass-chrome';
import { TextSegment, useSegmentHitSlop, useSegmentRowLead } from '@/components/text-segment';
import type { DockAutoHide } from '@/hooks/use-dock-auto-hide';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { ComposerPopup } from '@/components/composer-popup';
import { useComposerPopup } from '@/hooks/use-composer-popup';
import { useLatestReader } from '@/hooks/use-render-refs';
import { composerChipIds } from '@/lib/agent-composer-chips';
import { canSendAgentPrompt } from '@/lib/agent-runtime-controls';
import { slashCommandTrigger, type PaneSlashCommand } from '@/lib/pane-composer';
import {
  findFileMentionTrigger,
  insertFileMention,
  FILE_MENTION_LIMIT,
  type FileMentionHit,
  type FileMentionTrigger,
} from '@/lib/file-mentions';
import {
  deleteMentionAtomically,
  mentionRanges,
  orderMentionComputers,
  type MentionComputer,
  type MentionToken,
} from '@/lib/composer-mentions';
import { MentionSpans } from '@/components/mention-spans';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAppActive } from '@/hooks/use-app-active';
import { useInterfaceFontFamily } from '@/hooks/use-user-fonts';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import {
  pickAttachments,
  describePickerFailure,
  isImageAttachment,
  type AttachmentSource,
  type PendingAttachment,
  describeBlockedSend,
  takePickTruncationNotice,
} from '@/lib/attachments';
import {
  DURATION,
  RISE_DISTANCE,
  fadeIn,
  fadeOut,
  fadeOutDown,
  listLayout,
  riseIn,
  timing,
} from '@/lib/motion';
import { appChrome } from '@/constants/appearance';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { withAlpha } from '@/lib/color';
import type { SessionNode } from '@/lib/agent-session-tree';
import {
  AGENT_CLIENT_COMMANDS,
  readSkillInvocation,
  readSlashCommand,
  skillPopupTrigger,
  type AgentClientCommandId,
} from '@/lib/agent-commands';
import { agentClientCommandDescription, agentHostCommandDescription } from '@/i18n/labels';
import {
  contextFillRatio,
  contextTokenTotal,
  formatModelName,
  hasRealSessionTitle,
  isSessionUnread,
  isSlashSkill,
  listAgentFiles,
  inboxItemAttachments,
  inboxItemText,
  type AgentContextUsage,
  type ModeInfo,
  type CommandInfo,
  type InboxItem,
  type AgentProject,
  type AgentSessionInfo,
  type FileDiffItem,
  type ModelRef,
  type SkillInfo,
  type TodoItem,
  type TokensUsage,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { ComposerSendGuard } from '@/lib/composer-send-guard';
import {
  deliverAgentAttachmentPrompt,
  type AgentAttachmentSendRequest,
} from '@/lib/agent-attachment-send';

/** How long a direct send's receipt stays before it fades. */
const SUBMITTED_NOTICE_MS = 5000;

/** What a root's subtasks are doing; `blocked` ones are waiting on the reader. */
export interface SubtaskActivity {
  running: number;
  blocked: number;
}

/**
 * The fork on a root chip. It breathes while a subtask runs, in the attention
 * colour while one waits on the reader, and is still otherwise. Under reduce
 * motion, or with the app in the background, the state is colour alone.
 */
function TreeMark({
  color,
  state,
  testID,
}: {
  color: string;
  state: 'idle' | 'running' | 'waiting';
  testID?: string;
}) {
  const theme = useThemeTokens();
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const animate = state !== 'idle' && !reduceMotion && appActive;
  const glow = useSharedValue(1);
  useEffect(() => {
    if (!animate) {
      cancelAnimation(glow);
      glow.set(1);
      return;
    }
    glow.set(
      withRepeat(withSequence(withTiming(0.35, timing('long')), withTiming(1, timing('long'))), -1)
    );
    return () => cancelAnimation(glow);
  }, [animate, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  const tone =
    state === 'waiting'
      ? theme.colors.warning
      : state === 'running' && reduceMotion
        ? theme.colors.info
        : color;
  return (
    <Animated.View testID={testID} style={style}>
      <ForkIcon size={13} color={tone} />
    </Animated.View>
  );
}

/**
 * One root in Row 1. An inactive root selects; the root already on screen opens
 * its known descendants. Untitled sessions never show their raw id, and titles
 * cross-fade when they arrive.
 */
const SessionChip = memo(function SessionChip({
  node,
  active,
  current,
  lead,
  onPress,
  onOpenTree,
  onMeasure,
  subtaskActivity,
}: {
  node: SessionNode;
  active: boolean;
  /** This root is the session on screen, not merely a highlighted ancestor. */
  current: boolean;
  /**
   * What the chip leads with: the mode, or another agent's name, or nothing.
   * See `lib/agent-session-chip.ts`.
   */
  lead?: string;
  onPress: (asid: string) => void;
  onOpenTree?: (asid: string) => void;
  /** Where this chip sits in the strip, so the strip can bring it into view. */
  onMeasure?: (asid: string, x: number, width: number) => void;
  /** What the sessions under this root are doing, for its tree mark. */
  subtaskActivity?: SubtaskActivity | undefined;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();

  const session = node.session;
  const titled = hasRealSessionTitle(session);
  // Untitled reads as untitled; the time is the caption a listing shows, not
  // the name a chip stands under.
  const title = titled ? session.title : t`Untitled session`;
  // The gateway's two numbers, and nothing else: a chip never says "unread"
  // because this app thought something had happened over there.
  const unread = isSessionUnread(session);
  const running = subtaskActivity?.running ?? 0;
  const waiting = subtaskActivity?.blocked ?? 0;
  const pressSession = () => {
    if (current && node.hasChildren && onOpenTree) {
      onOpenTree(session.asid);
    } else {
      onPress(session.asid);
    }
  };

  return (
    <View
      style={styles.chipRow}
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onMeasure?.(session.asid, x, width);
      }}>
      <PressableScale
        testID={`agent-composer-session-chip-${session.asid}`}
        onPress={pressSession}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityHint={node.hasChildren ? t`Contains subagent sessions` : undefined}
        accessibilityActions={
          node.hasChildren && onOpenTree
            ? [{ name: 'openSessionTree', label: t`Open session tree` }]
            : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'openSessionTree') onOpenTree?.(session.asid);
        }}
        accessibilityLabel={
          unread
            ? lead
              ? t`${lead}: ${title} — finished while you were away`
              : t`${title} — finished while you were away`
            : lead
              ? `${lead}: ${title}`
              : title
        }
        style={[
          styles.sessionChip,
          { borderRadius: profile.chrome.navigationPill },
          active
            ? { backgroundColor: theme.colors.primary }
            : {
                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
              },
        ]}>
        {/* On a lit chip the primary ink is the chip itself, so the dot takes
            the ink that reads on it. */}
        {unread ? (
          <AgentUnreadDot
            testID={`agent-composer-session-unread-${session.asid}`}
            {...(active ? { tone: theme.colors.onPrimary } : {})}
          />
        ) : null}
        {/* `lead` is whatever the host called the mode or the agent, so it can
            be `code-reviewer-specialist`. It gives way before the title does:
            the title is what tells two sessions apart. */}
        {lead ? (
          <>
            <Text
              variant="caption"
              weight="semibold"
              numberOfLines={1}
              color={active ? theme.colors.onPrimary : theme.colors.primary}
              style={styles.sessionChipAgentBadge}>
              {lead}
            </Text>
            <Text
              variant="caption"
              color={active ? withAlpha(theme.colors.onPrimary, 0.6) : theme.colors.textMuted}
              style={styles.sessionChipDot}>
              •
            </Text>
          </>
        ) : null}
        {/* Keyed on the title so the arriving auto-title fades in where the
            placeholder was, rather than replacing it between two frames. */}
        <Animated.View key={title} entering={fadeIn('short')} style={styles.sessionChipTitleSlot}>
          <Text
            variant="caption"
            weight="medium"
            numberOfLines={1}
            color={
              active ? theme.colors.onPrimary : titled ? theme.colors.text : theme.colors.textMuted
            }
            style={styles.sessionChipTitle}>
            {title}
          </Text>
        </Animated.View>
        {node.hasChildren ? (
          <TreeMark
            testID={`agent-composer-session-tree-mark-${session.asid}`}
            color={active ? theme.colors.onPrimary : theme.colors.primary}
            state={waiting > 0 ? 'waiting' : running > 0 ? 'running' : 'idle'}
          />
        ) : null}
      </PressableScale>
    </View>
  );
});

/** See `AgentComposerProps.injectDraftRef`. */
export type DraftInjector = (
  text: string,
  options?: { ifEmpty?: boolean; expiredQuestionOwner?: string }
) => boolean;

export interface AgentComposerProps {
  running: boolean;
  /** Ordinary prompt delivery only; request reply controls are independent. */
  canSendWhileRunning?: boolean;
  /** Queue support is independent of steering into the current turn. */
  canQueueWhileRunning?: boolean;
  canMentionFiles?: boolean;
  /** A session observed elsewhere keeps its draft, but cannot send through this runtime. */
  interactionBlockedReason?: string;
  /** Row 1 contains roots only. Descendants belong in the tree sheet. */
  sessionStrip?: readonly SessionNode[];
  selectedRootAsid?: string;
  onOpenSessionTree?: (asid: string) => void;
  /** What the selected root's descendants are doing, for its chip's tree mark. */
  rootSubtaskActivity?: SubtaskActivity;
  /** The session above the one on screen, for the way back out of a subagent. */
  parentSession?: AgentSessionInfo;
  availableAgents?: ModeInfo[];
  /**
   * The computers `@` offers above the files, in the order they are given
   * (`orderMentionComputers` ranks them). Absent or empty: no Computers group.
   */
  mentionComputers?: readonly MentionComputer[];
  skills?: SkillInfo[];
  sessionId?: string;
  activeAsid?: string;
  activeDirectory?: string;
  activeProject?: AgentProject;
  selectedAgent?: string;
  selectedModel?: ModelRef;
  hasDiffs?: boolean;
  bottomInset?: number;
  tasks?: TodoItem[];
  tokens?: TokensUsage;
  /** What the model can still see, from `GET …/context`. */
  contextUsage?: AgentContextUsage | null;
  /**
   * Where the screen's content begins under the header.
   *
   * A popup raised from the dock grows upwards, and with the keyboard up it
   * grew straight through the header pills and past the top of the screen --
   * so its last row was cut in half by the edge it had run out of. This is the
   * line it may not cross.
   */
  topInset?: number;
  /** The session's own context window, when the engine stated one. */
  contextLimit?: number;
  /**
   * The catalogue's own name for the selected model.
   *
   * `formatModelName` reads a `ModelRef`'s id and can only guess at a title;
   * its table also drops the "Free" the catalogue puts in the name, so the chip
   * said "Nemotron 3.5 Lightning" for a model called "Nemotron 3.5 Lightning
   * Free" in the picker the reader chose it from.
   */
  modelName?: string;
  /**
   * A rollback that is staged and waiting to be confirmed.
   *
   * The plate above the dock is the whole of the preview: how many messages,
   * which files, and the two words that decide it. `null` when nothing is
   * staged, which is most of the time.
   */
  revert?: { messages: number; files: readonly FileDiffItem[] } | null;
  onCommitRevert?: () => void;
  onKeepRevert?: () => void;
  revertBusy?: boolean;
  /** A running compaction, or terminal details not yet handed back to history. */
  compaction?: CompactionActivity | null;
  onDismissCompaction?: () => void;
  cost?: number;
  sessionTitle?: string;
  /**
   * Send it. Answers whether the engine accepted it.
   *
   * The draft and the staged attachments are cleared on the strength of that
   * answer, and only on it -- a refusal used to clear both anyway, so the
   * reader lost what they had written to a gateway that was not listening.
   */
  onSend: (
    text: string,
    attachments?: string[],
    delivery?: 'steer' | 'queue'
  ) => Promise<boolean | void>;
  /** Bind attachment delivery before uploads settle; the workbench can advance its own create. */
  captureAttachmentSend?: () => AgentAttachmentSendRequest;
  onAbort: () => Promise<void>;
  onSelectSession?: (asid: string) => void;
  onSelectAgentMode?: (agent: string) => void;
  onCreateNewSession?: () => void;
  onOpenModelSheet?: () => void;
  onOpenModeSheet?: () => void;
  /**
   * Whether the session's agent has modes: the mode chip is drawn only then.
   * Absent means yes.
   */
  canPickMode?: boolean;
  /** Whether the session's agent takes attachments. Absent means yes. */
  canAttach?: boolean;
  /** Home uploads to its selected computer, not a temporarily connected neighbor. */
  attachmentTargetId?: string;
  /** Replaces the field's own invitation, e.g. to say why attaching is off. */
  placeholder?: string;
  /** What a session chip leads with; see `lib/agent-session-chip.ts`. */
  sessionLead?: (session: AgentSessionInfo) => string | undefined;
  onOpenDiffSheet: () => void;
  disabled?: boolean;
  /** The agent's display name, for the offline placeholder. */
  agentName?: string;
  onOpenSessionsSheet?: () => void;
  onOpenTasksSheet?: () => void;
  /** How many running shells the Background tasks sheet can show. */
  backgroundCount?: number;
  onOpenBackgroundTray?: () => void;
  /** The host's own slash commands, from `GET /api/agent-catalog`. */
  commands?: readonly CommandInfo[];
  /** A command from that catalog: `POST …/command`, never a typed prompt. */
  onRunCommand?: (name: string, args: string) => void;
  /**
   * A skill from that catalog: `POST …/skill`, never a typed prompt either.
   *
   * Answers whether the engine took it, because the draft is cleared on the
   * strength of that answer and comes back when it did not.
   */
  onInvokeSkill?: (skill: string, args: string) => Promise<boolean | void>;
  /** One of the app's own commands, dispatched by the screen that owns them. */
  onClientCommand?: (name: AgentClientCommandId) => void;
  /** The app's own commands the session's agent cannot answer; not listed. */
  hiddenClientCommands?: readonly AgentClientCommandId[];
  /** What is waiting behind the current turn. */
  inbox?: readonly InboxItem[];
  onCancelInboxItem?: (inboxId: string) => void;
  /**
   * Move one queued prompt between the two deliveries.
   *
   * `steer` runs it at the next step boundary -- ahead of everything queued
   * behind it -- and `queue` puts it back in line. `setAgentInboxDelivery` is
   * the route; it existed with no caller, so a prompt's place in the queue was
   * decided once, when it was sent, and could only be cancelled afterwards.
   */
  onSetInboxDelivery?: (inboxId: string, delivery: 'steer' | 'queue') => void;
  onPressTokens?: () => void;
  /**
   * Puts a line into the field. With `ifEmpty`, only when the field is empty
   * (a refused send coming back must not replace what the reader has typed
   * since); answers whether it did.
   */
  injectDraftRef?: React.MutableRefObject<DraftInjector | null>;
  draftOwnerKey?: string;
  /**
   * Empties the field, files included, if it still holds `text` -- what a
   * send from elsewhere (Home's failed row) just delivered.
   */
  clearDraftRef?: React.MutableRefObject<((text: string) => void) | null>;
  /** See `useAttachmentUploads`' `holdStaged`. */
  holdStagedAttachments?: (reason: 'blur' | 'switch') => boolean;
  /**
   * The dock's height, whenever it changes.
   *
   * The dock floats over the transcript, so nothing above it can work out how
   * much of the screen it is standing on. The empty-state card has to: it is
   * centred in the room between the header and the dock, and that room is not
   * a constant -- a session strip, a chips row and a two-line draft are all
   * optional. The first height includes decorative overflow for scroll clearance;
   * the second ends at the painted surface for clipping scrolling foreground.
   */
  onDockHeight?: (height: number, clipHeight: number) => void;
  /**
   * A line drawn as the dock's first row, inside its glass: it rides the
   * keyboard with the dock and is counted in `onDockHeight`. Home's assignment bar -- where Send
   * is about to go, before there is a session to say so -- is the one caller.
   */
  accessory?: React.ReactNode;
  /** Keep accessory animation frames out of the parent's scroll layout; report the settled size. */
  accessoryHeightAnimating?: boolean;
  /** Home consolidates its choices in one control beside the attachment button. */
  toolbarLeading?: React.ReactNode;
  /** Optional decoration inside the draft field, behind text and controls. */
  fieldBackground?: React.ReactNode;
  fieldBackgroundColor?: string;
  /** Optional bounded artwork overflow; the field and its controls remain clipped. */
  fieldBackgroundOutset?: HomeComposerOutset;
  fieldDecoration?: React.ReactNode;
  fieldDecorationOverhang?: number;
  /** The shadow the field's own plate casts; see `TerminalComposer`. */
  fieldShadow?: string;
  hideFieldDecoration?: boolean;
  fieldTextTopInset?: number;
  hideParameterRow?: boolean;
  /** Home's field reaches the dock edges; safe-area space remains outside the surface. */
  flushField?: boolean;
  /** Space outside Home's surface, in addition to the current bottom safe area. */
  outerInsets?: { horizontal: number; bottom: number };
  /** Cancels inline dictation when the dispatch destination changes. */
  voiceContext?: string;
  /**
   * The phone Home's bar: edge to edge at the foot of the screen, with the
   * safe area inside it, the cards' corner (`chrome.surface`) on its top
   * corners only, and its one edge on top -- the hairline `border` and the
   * dock's upward shadow (`appChrome.shadow.composerDock`), the edge the
   * session dock casts too. `inset` is the page gutter: the field runs from
   * gutter to gutter, like the cards, and the text rows start at its left
   * edge.
   */
  bar?: { inset: number };
  /**
   * Home's dock: the mode and model as a second line of text segments rather
   * than pills, the compact spacing between the rows, and a field one line
   * high while empty (`TerminalComposer`'s `shortPlaceholder`).
   */
  compact?: boolean;
  /** The field's height while empty, in lines (one by default); it still grows to its max. */
  fieldLines?: number;
  /**
   * Slide down out of view as Home's list scrolls down (`useDockAutoHide`).
   * The dock pins itself shown while its field is focused, the keyboard is
   * up or a send is in flight.
   */
  autoHide?: DockAutoHide;
  /** Told when the field gains or loses focus (the Pad cover keeps its left column still). */
  onFieldFocus?: (focused: boolean) => void;
  /** Home measures the mounted dock before revealing it after its computers. */
  revealed?: boolean;
  /**
   * The field's and Send's test ids. Home hosts this same dock beside a Pad
   * workspace whose own composers keep the defaults, so it names its own.
   */
  inputTestID?: string;
  sendTestID?: string;
}

export const AgentComposer = memo(function AgentComposer({
  running,
  canSendWhileRunning = true,
  canQueueWhileRunning = true,
  canMentionFiles = true,
  interactionBlockedReason,
  sessionStrip = EMPTY_STRIP,
  selectedRootAsid,
  onOpenSessionTree,
  rootSubtaskActivity,
  parentSession,
  availableAgents: availableAgentsProp,
  mentionComputers,
  skills = [],
  sessionId,
  activeAsid,
  activeDirectory,
  activeProject,
  selectedAgent,
  selectedModel,
  hasDiffs = false,
  bottomInset = 0,
  topInset = 0,
  tasks,
  tokens,
  contextUsage,
  contextLimit,
  modelName,
  revert,
  onCommitRevert,
  onKeepRevert,
  revertBusy = false,
  compaction,
  onDismissCompaction,
  cost,
  sessionTitle,
  onSend,
  captureAttachmentSend,
  onAbort,
  onSelectSession,
  onSelectAgentMode,
  onCreateNewSession,
  disabled,
  agentName,
  onOpenModelSheet,
  onOpenModeSheet,
  canPickMode = true,
  canAttach = true,
  attachmentTargetId,
  placeholder,
  sessionLead,
  onOpenDiffSheet,
  onOpenSessionsSheet,
  onOpenTasksSheet,
  backgroundCount = 0,
  onOpenBackgroundTray,
  commands = EMPTY_COMMANDS,
  onRunCommand,
  onInvokeSkill,
  onClientCommand,
  hiddenClientCommands = NO_HIDDEN_COMMANDS,
  inbox = EMPTY_INBOX,
  onCancelInboxItem,
  onSetInboxDelivery,
  onPressTokens,
  injectDraftRef,
  draftOwnerKey,
  clearDraftRef,
  holdStagedAttachments,
  onDockHeight,
  accessory,
  accessoryHeightAnimating = false,
  toolbarLeading,
  fieldBackground,
  fieldBackgroundColor,
  fieldBackgroundOutset,
  fieldDecoration,
  fieldDecorationOverhang = 0,
  fieldShadow,
  hideFieldDecoration = false,
  fieldTextTopInset,
  hideParameterRow = false,
  flushField = false,
  outerInsets,
  voiceContext,
  bar,
  compact = false,
  fieldLines,
  autoHide,
  onFieldFocus,
  revealed = true,
  inputTestID = 'agent-composer-input',
  sendTestID,
}: AgentComposerProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  /**
   * The message field is prose, so it follows the reader's interface font --
   * and it has to say so, because the field it is borrowing does not.
   *
   * `TerminalComposer` is the terminal's line field and it puts the reader's
   * monospace slot on its own `TextInput`, correctly: a shell line is a
   * literal and its alignment is part of what it says. This composer reuses
   * the same component for something else entirely. "Send a message, type /
   * for commands, $ for skills, @ for files…" is a sentence, and it was
   * being drawn in a typewriter face beside a transcript set in the reader's
   * own. The placeholder is where a reader meets that first, for the ordinary
   * reason that an empty field is nothing but its placeholder.
   *
   * The composer merges its family ahead of `inputProps.style` precisely so a
   * caller can say otherwise, and this is the caller that has to. A family and
   * nothing else: the size, the line height and the top-aligned multiline
   * behaviour are the composer's own and are not ours to restate. `null`
   * becomes `undefined` because that is React Native's way of naming the
   * platform's UI face, which is the right answer for a reader who has chosen
   * no font -- and it still has to be written, because leaving the property
   * out would let the mono family underneath stand.
   */
  const interfaceFontFamily = useInterfaceFontFamily() ?? undefined;
  const { text, setText, appendAnswer } = useQuestionComposerDraft(draftOwnerKey ?? 'shared');
  /**
   * One answer to "what is this agent called", for the chip strip and the
   * action row alike. The catalogue's name when the host publishes one, the id
   * otherwise -- a reader's own agent under `.opencode/agent` often has no
   * other name, and an id is still the truth about it.
   */
  // The mode as the chips name it: the catalog's display name when it has
  // one, else the bare id with its first letter raised (`standard` →
  // `Standard`; ids are ASCII, so no locale is involved).
  const modeLabel = (id: string) =>
    availableAgentsProp?.find((agent) => agent.id === id)?.name ||
    id.charAt(0).toUpperCase() + id.slice(1);
  const nameOfAgent = useCallback(
    (id: string) => availableAgentsProp?.find((agent) => agent.id === id)?.name || id,
    [availableAgentsProp]
  );
  const [sending, setSending] = useState(false);
  const [attachmentSendGuard] = useState(() => new ComposerSendGuard());
  const [pendingAttachmentSend, setPendingAttachmentSend] = useState<{
    request: AgentAttachmentSendRequest;
    token: symbol;
    delivery: 'steer' | 'queue' | undefined;
    submittedAttachments?: PendingAttachment[];
  } | null>(null);
  const promptAllowed =
    !interactionBlockedReason && canSendAgentPrompt(running, canSendWhileRunning);
  const [requestedDeliveryMode, setDeliveryMode] = useState<'steer' | 'queue'>('steer');
  const deliveryMode = canQueueWhileRunning ? requestedDeliveryMode : 'steer';
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  /** Which queued prompt has its actions open, if any. */
  const [inboxMenuId, setInboxMenuId] = useState<string | null>(null);

  // Session spend cannot substitute for the latest context measurement.
  const contextPill = useMemo(() => {
    const live = contextUsage?.tokens ?? null;
    const total = contextUsage?.total_tokens ?? contextTokenTotal(live);
    if (total <= 0) return null;
    const ratio = contextFillRatio(
      live,
      contextUsage?.limit?.context ?? contextLimit,
      contextUsage?.total_tokens
    );
    let tokStr = `${total}`;
    if (total >= 1_000_000) tokStr = `${(total / 1_000_000).toFixed(1)}M`;
    else if (total >= 1_000) tokStr = `${(total / 1_000).toFixed(1)}k`;
    const costStr =
      cost === undefined || cost === null ? null : cost === 0 ? t`Free` : `$${cost.toFixed(2)}`;
    return { label: costStr === null ? tokStr : `${tokStr} • ${costStr}`, ratio };
  }, [contextUsage, contextLimit, cost, t]);

  const modelDisplayName = useMemo(
    () => modelName || formatModelName(selectedModel, t`Model`),
    [modelName, selectedModel, t]
  );

  const inputRef = useRef<TextInputInstance>(null);
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [mentionHits, setMentionHits] = useState<FileMentionHit[]>([]);

  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  const record = useGatewayConnectionStore((state) => state.record);
  const attachmentUploads = useAttachmentUploads(record, undefined, holdStagedAttachments);
  const { clearAttachments } = attachmentUploads;
  const readStagedAttachments = useLatestReader(attachmentUploads.attachments);
  const submittingAttachments = Boolean(
    sending && pendingAttachmentSend && !pendingAttachmentSend.submittedAttachments
  );
  // Only staged files belong in the composer. An ACK clears them through the
  // owned submission callback; it does not establish a canonical timeline row.
  const visibleAttachments = attachmentUploads.attachments;

  // Staged images page in the lightbox; device-picked PDFs use the file viewer.
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const previewImages = useMemo<PreviewImage[]>(
    () =>
      visibleAttachments
        .filter((item) => isImageAttachment(item.mime))
        .map((item) => ({ id: item.id, uri: item.localUri })),
    [visibleAttachments]
  );
  const previewPdf = assetFromLocalPdf(
    visibleAttachments.find((item) => item.id === previewAttachmentId)
  );
  const previewIndex = previewAttachmentId
    ? previewImages.findIndex((item) => item.id === previewAttachmentId)
    : -1;

  useEffect(() => {
    // A source change discards only this still-locked source's staged files. Its late
    // ACK/error cannot clear a replacement draft or end a newer request. An
    // owned first-session create advances the captured owner and keeps it.
    if (!pendingAttachmentSend || pendingAttachmentSend.request.isCurrent()) return;
    const wasSending = attachmentSendGuard.release(pendingAttachmentSend.token);
    if (wasSending || pendingAttachmentSend.submittedAttachments) {
      setPendingAttachmentSend(null);
      setPreviewAttachmentId(null);
      if (wasSending) {
        setSending(false);
        clearAttachments();
      }
    }
  }, [
    draftOwnerKey,
    activeDirectory,
    record,
    pendingAttachmentSend,
    attachmentSendGuard,
    clearAttachments,
  ]);
  useEffect(() => () => attachmentSendGuard.reset(), [attachmentSendGuard]);
  // The receipt of a direct send is a moment, not a fixture.
  const acknowledgedFiles = pendingAttachmentSend?.submittedAttachments;
  useEffect(() => {
    if (!acknowledgedFiles) return;
    const timer = setTimeout(
      () =>
        setPendingAttachmentSend((previous) =>
          previous?.submittedAttachments === acknowledgedFiles ? null : previous
        ),
      SUBMITTED_NOTICE_MS
    );
    return () => clearTimeout(timer);
  }, [acknowledgedFiles]);

  const removeStagedAttachment = (id: string) => {
    if (!attachmentSendGuard.isPending()) attachmentUploads.removeAttachment(id);
  };
  const retryStagedAttachment = (id: string) => {
    if (!attachmentSendGuard.isPending()) attachmentUploads.retryUpload(id);
  };

  /**
   * The app's own commands, and the host's.
   *
   * Every entry used to be a literal that was typed into the prompt and sent to
   * the model as text -- `/init`, `/review`, `/mode`, `/model`, `/help` -- and
   * the model read them as prose. Half of them are the app's own navigation and
   * belong to the screen; the rest are the host's, listed by
   * `GET /api/agent-catalog` and run by `POST …/command`. Neither is a prompt.
   */
  const builtinCommands: PaneSlashCommand[] = useMemo(
    () =>
      AGENT_CLIENT_COMMANDS.filter((command) => !hiddenClientCommands.includes(command.id)).map(
        (command) => ({
          name: command.name,
          description: _(agentClientCommandDescription[command.id]),
          argsHint: '',
          source: 'builtin' as const,
        })
      ),
    [_, hiddenClientCommands]
  );

  const serverCommands: PaneSlashCommand[] = useMemo(
    () =>
      commands.map((command) => {
        const key = command.name.replace(/^\//, '');
        const known = agentHostCommandDescription[key];
        return {
          name: command.name.startsWith('/') ? command.name : `/${command.name}`,
          description: known ? _(known) : (command.description ?? command.mode ?? ''),
          argsHint: command.template ? '…' : '',
          source: 'workspace' as const,
        };
      }),
    [commands, _]
  );

  /**
   * The host's skills, as the lines the reader may actually type.
   *
   * Only the ones the catalog marks `slash`: the rest are the agent's own to
   * reach for, and listing every skill on the host under "/" buried the few
   * that are meant to be asked for. Named like a host command -- its own name
   * first, then what it does -- because that is what the row beside it does.
   */
  const skillCommands: PaneSlashCommand[] = useMemo(
    () =>
      (skills ?? []).filter(isSlashSkill).map((skill) => ({
        name: `/${skill.id}`,
        description:
          skill.name && skill.description && skill.name.toLowerCase() !== skill.id.toLowerCase()
            ? `${skill.name} · ${skill.description}`
            : skill.description || skill.name,
        argsHint: '',
        source: 'workspace' as const,
      })),
    [skills]
  );

  const slashCatalog = useMemo(() => {
    const seen = new Set<string>();
    const rows = [];
    for (const command of [...builtinCommands, ...serverCommands, ...skillCommands]) {
      const key = command.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(command);
    }
    return rows;
  }, [builtinCommands, serverCommands, skillCommands]);
  const slashTrigger = useMemo(() => slashCommandTrigger(slashCatalog), [slashCatalog]);

  /**
   * The chips row, as a list rather than as ten nested conditions.
   *
   * See `lib/agent-composer-chips.ts`: each chip is there on its own terms,
   * and the row scrolls rather than dropping one to fit.
   */
  const chipIds = useMemo(
    () =>
      new Set(
        composerChipIds({
          canOpenSessions: Boolean(onOpenSessionsSheet),
          canPickMode,
          canOpenModel: Boolean(onOpenModelSheet),
          taskCount: tasks?.length ?? 0,
          canOpenTasks: Boolean(onOpenTasksSheet),
          inboxCount: inbox.length,
          backgroundCount,
          canOpenBackground: Boolean(onOpenBackgroundTray),
          hasContextPill: Boolean(contextPill),
          hasDiffs: Boolean(hasDiffs),
          running,
          canSendWhileRunning,
          canQueueWhileRunning,
        })
      ),
    [
      onOpenSessionsSheet,
      canPickMode,
      onOpenModelSheet,
      tasks,
      onOpenTasksSheet,
      inbox.length,
      backgroundCount,
      onOpenBackgroundTray,
      contextPill,
      hasDiffs,
      running,
      canSendWhileRunning,
      canQueueWhileRunning,
    ]
  );

  const slashPopup = useComposerPopup({
    draft: text,
    onDraftChange: setText,
    trigger: slashTrigger,
  });
  // Every skill the screen was given, not only the slash menu's subset. An
  // empty list leaves `$` as a plain character.
  const skillTrigger = useMemo(() => skillPopupTrigger(skills ?? []), [skills]);
  const skillPopup = useComposerPopup({
    draft: text,
    onDraftChange: setText,
    trigger: skillTrigger,
  });

  // File mentions (@) trigger
  const effectiveCaret = caret ?? text.length;
  const mentionTrigger = useMemo<FileMentionTrigger | null>(
    () => findFileMentionTrigger(text, effectiveCaret),
    [effectiveCaret, text]
  );
  const mentionQuery = mentionTrigger?.query ?? null;

  useEffect(() => {
    if (mentionQuery === null || !canMentionFiles) {
      setMentionHits([]);
      return;
    }
    let active = true;
    listAgentFiles(sessionId, activeAsid, mentionQuery, FILE_MENTION_LIMIT)
      .then((hits) => {
        if (active) setMentionHits(hits);
      })
      .catch(() => {
        if (active) setMentionHits([]);
      });
    return () => {
      active = false;
    };
  }, [mentionQuery, sessionId, activeAsid, canMentionFiles]);

  // Which words of the draft are mentions: every computer this composer
  // offers (typed by hand or picked) and the file paths picked in this draft.
  const [fileTokens, setFileTokens] = useState<readonly string[]>([]);
  useEffect(() => {
    if (!text) setFileTokens((current) => (current.length ? [] : current));
  }, [text]);
  const mentionTokens = useMemo<MentionToken[]>(
    () => [
      ...(mentionComputers ?? []).map((computer) => ({
        text: `@${computer.name}`,
        kind: 'computer' as const,
      })),
      ...fileTokens.map((path) => ({ text: path, kind: 'file' as const })),
    ],
    [mentionComputers, fileTokens]
  );
  const ranges = useMemo(() => mentionRanges(text, mentionTokens), [text, mentionTokens]);
  // The caret after a pick or an atomic delete, held for exactly the render
  // that shows it (the `useComposerPopup` rule: a permanently controlled
  // selection fights the user on Android).
  const [heldCaret, setHeldCaretState] = useState<{ draft: string; caret: number } | null>(null);
  // The same caret, readable from the native selection callback, which can
  // run before the render that set it (Android reports the old caret first).
  const heldCaretRef = useRef<{ draft: string; caret: number } | null>(null);
  const setHeldCaret = (next: { draft: string; caret: number } | null) => {
    heldCaretRef.current = next;
    setHeldCaretState(next);
  };
  const changeText = (next: string) => {
    const whole = deleteMentionAtomically(text, next, ranges, effectiveCaret);
    if (whole) {
      setText(whole.text);
      setCaret(whole.caret);
      setHeldCaret({ draft: whole.text, caret: whole.caret });
      return;
    }
    setText(next);
  };
  // Android can apply the new text after the `selection` prop of the same
  // render and leave its own caret; place it once more after the commit.
  useEffect(() => {
    if (!heldCaret || heldCaret.draft !== text) return;
    const place = () => inputRef.current?.setSelection(heldCaret.caret, heldCaret.caret);
    place();
    // Once more after the native text update has landed (a frame later),
    // then let go: the reader's own caret moves are theirs again.
    const timer = setTimeout(() => {
      place();
      heldCaretRef.current = null;
    }, CARET_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [heldCaret, text]);
  const selection =
    heldCaret && heldCaret.draft === text
      ? { start: heldCaret.caret, end: heldCaret.caret }
      : (skillPopup.inputProps.selection ?? slashPopup.inputProps.selection);
  // Span mode starts as soon as a mention can appear (an `@` or a token in the
  // draft), so the field switches from `value` to spans on a keystroke rather
  // than in the same commit as a pick -- Android drops the first colouring
  // otherwise.
  const spans =
    ranges.length > 0 || (mentionTokens.length > 0 && text.includes('@')) ? (
      <MentionSpans text={text} ranges={ranges} />
    ) : undefined;

  const offeredComputers = useMemo(
    () =>
      mentionTrigger && mentionComputers?.length
        ? orderMentionComputers(mentionComputers, mentionTrigger.query)
        : [],
    [mentionComputers, mentionTrigger]
  );

  const chooseMention = useCallback(
    (hit: FileMentionHit) => {
      if (!mentionTrigger) return;
      const next = insertFileMention(text, mentionTrigger, hit.path);
      setText(next.text);
      setCaret(next.caret);
      setHeldCaret({ draft: next.text, caret: next.caret });
      setFileTokens((current) => (current.includes(hit.path) ? current : [...current, hit.path]));
      setMentionHits([]);
    },
    [text, mentionTrigger, setText]
  );
  const chooseComputer = (computer: MentionComputer) => {
    if (!mentionTrigger || !computer.reachable) return;
    const next = insertFileMention(text, mentionTrigger, `@${computer.name}`);
    setText(next.text);
    setCaret(next.caret);
    setHeldCaret({ draft: next.text, caret: next.caret });
  };

  const handleSelectionChange = useCallback(
    (event: TextInputSelectionChangeEvent) => {
      const next = event.nativeEvent.selection.start;
      // A held caret stays until the field reports it: Android applies the
      // new text after the selection of the same commit and moves its own
      // caret, which would otherwise be taken as where the reader put it.
      const held = heldCaretRef.current;
      if (held && next !== held.caret) {
        inputRef.current?.setSelection(held.caret, held.caret);
        return;
      }
      setCaret(next);
      setHeldCaret(null);
      slashPopup.inputProps.onSelectionChange(event);
      skillPopup.inputProps.onSelectionChange(event);
    },
    [slashPopup.inputProps, skillPopup.inputProps]
  );

  const chooseAttachmentSource = useCallback(
    (source: AttachmentSource) => {
      setAttachmentMenuOpen(false);
      if (
        attachmentTargetId !== undefined &&
        useGatewayConnectionStore.getState().record?.serverId !== attachmentTargetId
      )
        return;
      const picker = attachmentUploads.capturePicker();
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
    },
    [attachmentUploads, attachmentTargetId, showToast, t]
  );

  const readText = useLatestReader(text);
  useEffect(() => {
    if (injectDraftRef) {
      injectDraftRef.current = (draftText, options) => {
        if (options?.expiredQuestionOwner) {
          if (options.expiredQuestionOwner !== draftOwnerKey) return false;
          appendAnswer(draftText);
          return true;
        }
        if (options?.ifEmpty && readText().trim()) return false;
        setText(draftText);
        setTimeout(() => inputRef.current?.focus(), 50);
        return true;
      };
    }
  }, [injectDraftRef, readText, draftOwnerKey, appendAnswer, setText]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    const hasAttachments = attachmentUploads.attachments.length > 0;
    if ((!trimmed && !hasAttachments) || sending || interactionBlockedReason) return;
    setPendingAttachmentSend((previous) => (previous?.submittedAttachments ? null : previous));

    // A slash command is a command. It used to be sent as the literal text it
    // was typed as, and whatever the model made of it was the result.
    if (!hasAttachments) {
      const parsed = readSlashCommand(trimmed, commands, skills);
      if (parsed?.kind === 'server' && onRunCommand) {
        onRunCommand(parsed.name, parsed.args);
        setText('');
        return;
      }
      const skillCall =
        parsed?.kind === 'skill'
          ? { name: parsed.name, args: parsed.args }
          : readSkillInvocation(trimmed, skills);
      if (skillCall && onInvokeSkill) {
        // The draft stays put until the engine has taken it: a skill the
        // gateway refused with the composer already emptied is a line the
        // reader has to remember and retype. `$id` and `$id args` use this
        // same path; `/` still only matches skills the catalog marks slash.
        setSending(true);
        await settleAfter(
          async () => {
            const accepted = await onInvokeSkill(skillCall.name, skillCall.args);
            if (accepted === false) return;
            setText('');
          },
          () => {
            setSending(false);
          }
        );
        return;
      }
      if (parsed?.kind === 'client' && onClientCommand) {
        onClientCommand(parsed.name);
        setText('');
        return;
      }
    }

    if (!promptAllowed || disabled) return;
    if (hasAttachments && captureAttachmentSend) {
      const token = attachmentSendGuard.acquire();
      if (!token) return;
      const captured = captureAttachmentSend();
      const request = {
        ...captured,
        isCurrent: () => attachmentSendGuard.owns(token) && captured.isCurrent(),
      };
      const delivery = running ? deliveryMode : undefined;
      setPendingAttachmentSend({ request: captured, token, delivery });
      setSending(true);
      return settleAfter(
        async () => {
          const result = await deliverAgentAttachmentPrompt(
            request,
            trimmed,
            attachmentUploads.awaitUploads,
            () => {
              // A queued send becomes an inbox row, which is its receipt.
              if (delivery !== 'queue') {
                const submittedAttachments = readStagedAttachments().map((item) =>
                  item.status === 'done' ? item : { ...item, status: 'done' as const }
                );
                setPendingAttachmentSend((previous) =>
                  previous?.token === token ? { ...previous, submittedAttachments } : previous
                );
              }
              setText((current) => (current.trim() === trimmed ? '' : current));
              attachmentUploads.clearAttachments();
            },
            delivery
          );
          if (result === 'upload-failed') {
            showToast({
              variant: 'danger',
              title: t`Upload failed`,
              message: t`Please retry or remove failed attachments.`,
            });
          } else if (result === 'obsolete' && attachmentSendGuard.owns(token)) {
            // A late result can beat the source-change effect. The field is
            // still locked by this request, so discard only its old staged files.
            attachmentUploads.clearAttachments();
            setPreviewAttachmentId(null);
          }
        },
        () => {
          if (attachmentSendGuard.release(token)) {
            setPendingAttachmentSend((previous) =>
              previous?.token === token && !previous.submittedAttachments ? null : previous
            );
            setSending(false);
          }
        }
      );
    }
    setSending(true);
    return settleAfter(
      async () => {
        let uploadedFilePaths: string[] = [];
        if (hasAttachments) {
          const paths = await attachmentUploads.awaitUploads();
          if (!paths) {
            showToast({
              variant: 'danger',
              title: t`Upload failed`,
              message: describeBlockedSend(attachmentUploads.attachments),
            });
            return;
          }
          // Switching computers during an upload must not dispatch old host
          // paths to the replacement destination, or silently drop the files.
          if (
            attachmentTargetId !== undefined &&
            (paths.length === 0 ||
              record?.serverId !== attachmentTargetId ||
              useGatewayConnectionStore.getState().record !== record)
          )
            return;
          uploadedFilePaths = paths;
        }
        const accepted = await onSend(
          trimmed,
          uploadedFilePaths.length > 0 ? uploadedFilePaths : undefined,
          running ? deliveryMode : undefined
        );
        // `void` from a caller that does not report is taken as accepted, which
        // is the behaviour every other composer in this app has.
        if (accepted === false) return;
        setText('');
        attachmentUploads.clearAttachments();
      },
      () => {
        setSending(false);
      }
    );
  }, [
    text,
    setText,
    attachmentUploads,
    attachmentTargetId,
    record,
    sending,
    promptAllowed,
    interactionBlockedReason,
    disabled,
    onSend,
    captureAttachmentSend,
    attachmentSendGuard,
    readStagedAttachments,
    setPreviewAttachmentId,
    showToast,
    t,
    running,
    deliveryMode,
    commands,
    skills,
    onRunCommand,
    onInvokeSkill,
    onClientCommand,
  ]);

  useEffect(() => {
    if (!clearDraftRef) return;
    clearDraftRef.current = (sent) => {
      if (readText().trim() !== sent.trim()) return;
      setText('');
      attachmentUploads.clearAttachments();
    };
    return () => {
      clearDraftRef.current = null;
    };
  }, [clearDraftRef, readText, attachmentUploads, setText]);

  /**
   * What can be done to one queued prompt.
   *
   * "Send now" is `steer`: it runs at the next step boundary, in front of
   * everything queued behind it. "Queue" is the way back, and is only offered
   * when the prompt is not already in line -- an option that does nothing is an
   * option the reader has to think about.
   */
  const inboxActions = useCallback(
    (item: InboxItem): AgentActionMenuItem[] => {
      const items: AgentActionMenuItem[] = [];
      if (onSetInboxDelivery && item.delivery !== 'steer') {
        items.push({
          id: 'steer',
          label: t`Send now`,
          Icon: QuickActionIcon,
          onPress: () => {
            setInboxMenuId(null);
            onSetInboxDelivery(item.id, 'steer');
          },
          testID: `agent-composer-inbox-steer-${item.id}`,
        });
      }
      if (onSetInboxDelivery && item.delivery === 'steer') {
        items.push({
          id: 'queue',
          label: t`Queue`,
          Icon: InboxIcon,
          onPress: () => {
            setInboxMenuId(null);
            onSetInboxDelivery(item.id, 'queue');
          },
          testID: `agent-composer-inbox-queue-${item.id}`,
        });
      }
      if (onCancelInboxItem) {
        items.push({
          id: 'cancel',
          label: t`Cancel`,
          Icon: DeleteIcon,
          tone: 'danger',
          onPress: () => {
            setInboxMenuId(null);
            onCancelInboxItem(item.id);
          },
          testID: `agent-composer-inbox-drop-${item.id}`,
        });
      }
      return items;
    },
    [onSetInboxDelivery, onCancelInboxItem, t]
  );

  // Resolve available agents (workspace agents + defaults)
  const availableAgents =
    availableAgentsProp && availableAgentsProp.length > 0
      ? availableAgentsProp
      : [
          { id: 'build', name: 'build', description: t`The default agent. Executes tools.` },
          {
            id: 'general',
            name: 'general',
            description: t`General-purpose agent for researching complex tasks.`,
          },
          {
            id: 'explore',
            name: 'explore',
            description: t`Fast agent specialized for exploring codebases.`,
          },
        ];

  const handleSelectSession = useCallback(
    (asid: string) => {
      if (asid !== activeAsid) onSelectSession?.(asid);
    },
    [activeAsid, onSelectSession]
  );

  /**
   * The strip follows the session on screen.
   *
   * Opening a session from the sessions sheet, or a subagent from a child
   * chip, changes which chip is lit -- and on a workspace with more sessions
   * than fit, the lit one was frequently off the right-hand edge, so the strip
   * went on showing a different session than the transcript above it. Each
   * chip reports where it sits; when the active one changes, the strip scrolls
   * it to the left edge.
   */
  const sessionStripRef = useRef<ScrollViewInstance>(null);
  const chipOffsetsRef = useRef<Record<string, { x: number; width: number }>>({});
  const measureChip = useCallback((asid: string, x: number, width: number) => {
    chipOffsetsRef.current[asid] = { x, width };
  }, []);

  useEffect(() => {
    if (!selectedRootAsid) return;
    // One frame after the chips have laid out: a session opened from a sheet
    // arrives with the strip rebuilding under it, and the chip's offset is not
    // known until it has.
    const timer = setTimeout(() => {
      const offset = chipOffsetsRef.current[selectedRootAsid];
      if (!offset) return;
      sessionStripRef.current?.scrollTo({
        x: Math.max(0, offset.x - SESSION_CHIP_REVEAL_MARGIN),
        animated: true,
      });
    }, DURATION.short);
    return () => clearTimeout(timer);
  }, [selectedRootAsid]);

  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const revealProgress = useSharedValue(revealed ? 1 : 0);
  useEffect(() => {
    const target = revealed ? 1 : 0;
    if (revealProgress.get() !== target) revealProgress.set(withTiming(target, timing('micro')));
  }, [revealed, revealProgress]);
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    opacity: revealProgress.get(),
    transform: [
      {
        translateY:
          keyboardOffset.get() +
          (autoHide?.offset.get() ?? 0) +
          (1 - revealProgress.get()) * RISE_DISTANCE,
      },
    ],
  }));

  /**
   * How much room a popup raised from the dock actually has.
   *
   * The dock is pinned to the bottom and slides up with the keyboard, so the
   * space above it is the window minus the keyboard, minus the dock, minus the
   * header the popup must stay clear of. The keyboard's height is read in JS
   * here rather than off the shared value the dock animates with: this is a
   * layout bound, and it only has to be right when the keyboard has settled.
   */
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardState((state) => state.height);
  const safeAreaFoot = flushField && keyboardHeight === 0 ? bottomInset : 0;
  const dockFoot = safeAreaFoot + (outerInsets?.bottom ?? 0);
  const [surfaceHeight, setSurfaceHeight] = useState(0);
  const latestSurfaceHeight = useRef(0);
  const [inputRowHeight, setInputRowHeight] = useState(0);
  // Yoga still reports every accessory animation frame. Keep its latest
  // measurement without re-rendering the whole composer for every frame.
  useEffect(() => {
    if (!accessoryHeightAnimating) setSurfaceHeight(latestSurfaceHeight.current);
  }, [accessoryHeightAnimating]);
  const [compactionRowHeight, setCompactionRowHeight] = useState(0);
  const compactionClearance = compaction ? compactionRowHeight : 0;
  const [voiceActive, setVoiceActive] = useState(false);
  const decorationHidden =
    hideFieldDecoration ||
    attachmentUploads.attachments.length > 0 ||
    attachmentMenuOpen ||
    modeMenuOpen ||
    inboxOpen ||
    slashPopup.open ||
    skillPopup.open ||
    Boolean(mentionTrigger);
  const decorationClearance =
    fieldDecoration && !decorationHidden && !voiceActive ? fieldDecorationOverhang : 0;
  const dockHeight = surfaceHeight + dockFoot;
  // Home paints only the input plate. Its options/notice overlays must not
  // erase the foreground behind their transparent or rounded edges.
  const dockClipHeight = flushField ? inputRowHeight + dockFoot : dockHeight;
  // The status row occupies transcript space, but does not move the material's clip edge.
  const reportDockHeight = useEffectEvent((height: number, clipHeight: number) =>
    onDockHeight?.(height + compactionClearance, clipHeight)
  );
  // Local height still bounds popups. Forwarding each animated accessory frame
  // to Home also changes its scroll padding and clipping, feeding the reveal
  // through another React/layout pass. Publish the latest height once it lands.
  useEffect(() => {
    if (
      surfaceHeight > 0 &&
      !accessoryHeightAnimating &&
      surfaceHeight === latestSurfaceHeight.current
    )
      reportDockHeight(dockHeight + decorationClearance, dockClipHeight);
  }, [
    surfaceHeight,
    dockHeight,
    dockClipHeight,
    decorationClearance,
    compactionClearance,
    accessoryHeightAnimating,
  ]);
  const popupMaxHeight = Math.max(
    POPUP_MIN_HEIGHT,
    windowHeight - keyboardHeight - dockHeight - compactionClearance - topInset - POPUP_HEADER_GAP
  );
  // The compact dock's second line holds the two choices that define a new
  // turn and nothing else; Home has no running turn, queue or diff to show.
  const [segmentMode, segmentModel] = (['mode', 'model'] as const).map(
    (id) => compact && chipIds.has(id)
  );
  const [focused, setFocused] = useState(false);
  const keyboardOpen = keyboardHeight > 0;
  const reportFocus = useEffectEvent((next: boolean) => onFieldFocus?.(next));
  useEffect(() => {
    reportFocus(focused);
  }, [focused]);
  // A dock that goes while focused has lost its focus too.
  useEffect(() => () => reportFocus(false), []);
  useEffect(() => {
    autoHide?.setPinned(focused || keyboardOpen || sending);
  }, [autoHide, focused, keyboardOpen, sending]);
  const segmentRowLead = useSegmentRowLead();
  const segmentHitSlop = useSegmentHitSlop();
  const toggleMode = () => {
    setAttachmentMenuOpen(false);
    if (onOpenModeSheet) {
      setModeMenuOpen(false);
      onOpenModeSheet();
    } else {
      // A second press closes the menu it opened.
      setModeMenuOpen((prev) => !prev);
    }
  };
  /** What sits under the field inside the glass. */
  // Session docks carry the safe area inside their material. Home's single
  // field keeps it outside, so the safe area cannot reintroduce a white rim.
  const innerBottomPadding = flushField
    ? 0
    : bar
      ? Math.max(theme.spacing.sm, keyboardHeight > 0 ? 0 : bottomInset)
      : Math.max(10, bottomInset + 6);
  /** From the dock's foot to the field's, which the anchored menu has to clear too. */
  const dockBottomPadding = innerBottomPadding + dockFoot;

  return (
    <Animated.View
      pointerEvents={revealed ? 'auto' : 'none'}
      accessibilityElementsHidden={!revealed}
      importantForAccessibility={revealed ? 'auto' : 'no-hide-descendants'}
      style={[
        styles.dockOuter,
        composerKeyboardStyle,
        outerInsets && { left: outerInsets.horizontal, right: outerInsets.horizontal },
        { paddingBottom: dockFoot },
      ]}>
      {bar ? null : (
        <EdgeFade edge="bottom" color={theme.colors.background} style={styles.composerFade} />
      )}

      {/*
        Dismiss backdrop for popups.

        It used to be `absoluteFill` inside the dock, which is a strip at the
        bottom of the screen -- so a tap anywhere above the composer went
        straight through to the transcript and the menu stayed open. It reaches
        the top of the window now, and while the attachment menu is up it
        carries a scrim, because that menu is a decision and everything behind
        it is not.
      */}
      {attachmentMenuOpen || modeMenuOpen || inboxOpen ? (
        <Pressable
          testID="agent-composer-popup-scrim"
          style={[
            styles.backdrop,
            { top: -windowHeight },
            attachmentMenuOpen ? { backgroundColor: withAlpha('#000000', 0.28) } : null,
          ]}
          onPress={() => {
            setAttachmentMenuOpen(false);
            setModeMenuOpen(false);
            setInboxOpen(false);
            setInboxMenuId(null);
          }}
        />
      ) : null}

      {/*
        Attachment source popup, over the paperclip that opened it.

        It used to sit above the whole dock -- session strip, chips row, input
        -- which on a busy composer put it some five hundred points north of
        the control it belongs to, pointing at nothing. It is anchored to the
        input row's left edge instead, one gap above it.
      */}
      {attachmentMenuOpen ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.attachmentAnchor,
            { bottom: inputRowHeight + dockBottomPadding + ATTACHMENT_MENU_GAP },
          ]}>
          <AttachmentMenu onSelect={chooseAttachmentSource} textColor={chromeText} />
        </View>
      ) : null}

      {/* What is queued behind the current turn, and a way to take it back */}
      {inboxOpen && inbox.length > 0 ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={styles.popupWrapper}>
          <GlassChrome
            surface="composer"
            artworkEnabled={false}
            shape="popover"
            style={styles.inboxCard}>
            {/* The strip said nothing about itself: three lines of text over
                the transcript, in the same ink as a sent message, floating
                across the thinking pill. It says what it is. */}
            <View style={styles.inboxHeading}>
              <Text variant="caption" weight="bold" color={theme.colors.textMuted}>
                {t`Waiting to send`}
              </Text>
            </View>
            {inbox.map((item) => {
              const steering = item.delivery === 'steer';
              const files = inboxItemAttachments(item).map((file, index) => ({
                ...file,
                key: `${index}:${file.uri.slice(0, 256)}`,
              }));
              const text = inboxItemText(item);
              const summary =
                text ||
                (files.length
                  ? t`${plural(files.length, { one: '# attachment', other: '# attachments' })}`
                  : item.type);
              return (
                <Animated.View
                  key={item.id}
                  entering={riseIn()}
                  exiting={fadeOut('micro')}
                  layout={listLayout('short')}>
                  {/* The row is the control: tapping a queued prompt is how its
                      actions are reached, which is the same gesture a session
                      row answers in the sessions sheet. */}
                  <PressableScale
                    testID={`agent-composer-inbox-row-${item.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: inboxMenuId === item.id }}
                    accessibilityLabel={
                      steering ? t`Sending next: ${summary}` : t`Queued: ${summary}`
                    }
                    onPress={() =>
                      setInboxMenuId((current) => (current === item.id ? null : item.id))
                    }
                    style={[
                      styles.inboxRow,
                      {
                        borderRadius: profile.chrome.control,
                        backgroundColor: surfaceBackground(withAlpha(theme.colors.text, 0.05)),
                      },
                    ]}>
                    <InboxIcon size={13} color={theme.colors.primary} />
                    <View style={styles.inboxBody}>
                      {text || files.length === 0 ? (
                        <Text
                          variant="caption"
                          numberOfLines={2}
                          color={theme.colors.textMuted}
                          style={styles.inboxText}>
                          {text || item.type}
                        </Text>
                      ) : null}
                      <AttachmentThumbnailRow entries={files} />
                    </View>
                    {/* Queued is not sent, and the two used to look identical.
                        Nor is queued the same as steering, which the chip said
                        it was: this is the item's own `delivery`. */}
                    <View
                      style={[
                        styles.queuedChip,
                        { borderRadius: profile.chrome.control },
                        {
                          backgroundColor: withAlpha(
                            steering ? theme.colors.warning : theme.colors.primary,
                            0.16
                          ),
                        },
                      ]}>
                      <Text
                        variant="caption"
                        weight="bold"
                        color={steering ? theme.colors.warning : theme.colors.primary}>
                        {steering ? t`Next` : t`Queued`}
                      </Text>
                    </View>
                    {onCancelInboxItem ? (
                      <PressableScale
                        testID={`agent-composer-inbox-cancel-${item.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={t`Cancel this queued message`}
                        hitSlop={8}
                        onPress={() => onCancelInboxItem(item.id)}
                        style={styles.inboxCancel}>
                        <Text variant="caption" weight="bold" color={theme.colors.danger}>
                          ×
                        </Text>
                      </PressableScale>
                    ) : null}
                  </PressableScale>
                  {inboxMenuId === item.id ? (
                    <AgentActionMenu
                      testID={`agent-composer-inbox-menu-${item.id}`}
                      surface="ground"
                      items={inboxActions(item)}
                    />
                  ) : null}
                </Animated.View>
              );
            })}
          </GlassChrome>
        </Animated.View>
      ) : null}

      {/* Agent mode popup */}
      {modeMenuOpen ? (
        <View style={styles.popupWrapper}>
          <AgentModeMenu
            agents={availableAgents}
            selectedAgent={selectedAgent}
            onSelectAgent={(agId) => {
              setModeMenuOpen(false);
              onSelectAgentMode?.(agId);
            }}
            textColor={chromeText}
          />
        </View>
      ) : null}

      {/* File mention (@) floating list */}
      {mentionTrigger &&
      (offeredComputers.length > 0 || (canMentionFiles && mentionHits.length > 0)) ? (
        <View style={styles.composerFloatingContent}>
          <FileMentionPanel
            hits={canMentionFiles ? mentionHits : []}
            computers={offeredComputers}
            onSelectComputer={chooseComputer}
            query={mentionTrigger.query}
            onSelect={chooseMention}
            scope="project"
          />
        </View>
      ) : null}

      {/* Slash command and skills (/) floating list */}
      {slashPopup.open ? (
        <View style={styles.composerPopup}>
          <ComposerPopup
            rows={slashPopup.rows}
            onPick={slashPopup.pick}
            maxHeight={popupMaxHeight}
            testIDPrefix="slash-command"
            scope="project"
          />
        </View>
      ) : null}

      {/* Skills ($) floating list. `#` can take this same slot later. */}
      {skillPopup.open ? (
        <View style={styles.composerPopup}>
          <ComposerPopup
            rows={skillPopup.rows}
            onPick={skillPopup.pick}
            maxHeight={popupMaxHeight}
            testIDPrefix="skill"
            scope="project"
          />
        </View>
      ) : null}

      {/* What a staged rollback would take, and the two words that decide it.
          Above the dock, where the reader's hands already are. */}
      {revert && onCommitRevert && onKeepRevert ? (
        <AgentRevertPlate
          messages={revert.messages}
          files={revert.files}
          onCommit={onCommitRevert}
          onKeep={onKeepRevert}
          busy={revertBusy}
        />
      ) : null}

      {/* Real streamed details stay accessible until the completed summary
          lands in the timeline, or the reader dismisses the terminal notice. */}
      <View
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          setCompactionRowHeight(height);
        }}>
        {compaction ? (
          <CompactionPill
            key={compaction.startedSeq}
            activity={compaction}
            {...(onDismissCompaction ? { onDismiss: onDismissCompaction } : {})}
          />
        ) : null}
      </View>

      {/* The wrapper is here to be measured: `GlassChrome` is a material and
          takes no `onLayout` of its own. */}
      <View
        onLayout={(event) => {
          const { height } = event.nativeEvent.layout;
          latestSurfaceHeight.current = height;
          if (!accessoryHeightAnimating) setSurfaceHeight(height);
        }}
        // Enclosing bars cast their shadow outside the clipped material.
        // Home's field owns its plate; leave the ornament above it transparent.
        style={
          bar &&
          !flushField && {
            borderTopLeftRadius: profile.chrome.surface,
            borderTopRightRadius: profile.chrome.surface,
            boxShadow: appChrome.shadow.composerDock,
          }
        }>
        <ComposerSurface
          flushField={flushField}
          surface="composer"
          artworkEnabled={false}
          borderless
          shape={flushField ? 'composerField' : bar ? 'none' : 'sheet'}
          style={[
            styles.composerDock,
            bar &&
              !flushField && {
                borderTopLeftRadius: profile.chrome.surface,
                borderTopRightRadius: profile.chrome.surface,
              },
          ]}>
          <View
            style={[
              styles.composerInner,
              { paddingBottom: innerBottomPadding },
              // Above row 1, the same step as under the field.
              compact && { paddingTop: theme.spacing.sm },
              bar && { paddingHorizontal: bar.inset },
              flushField && { paddingHorizontal: 0, paddingTop: 0 },
            ]}>
            {accessory}
            {/* Row 1: roots only. Tapping the current root opens its tree. */}
            {sessionStrip.length > 0 ? (
              <ScrollView
                ref={sessionStripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sessionStripContent}
                style={styles.sessionStripViewport}>
                {/* Keep the direct way back out of the selected subagent. */}
                {parentSession ? (
                  <PressableScale
                    testID="agent-composer-session-back"
                    onPress={() => onSelectSession?.(parentSession.asid)}
                    accessibilityRole="button"
                    accessibilityLabel={t`Back to the parent session`}
                    style={[
                      styles.backChip,
                      { borderRadius: profile.chrome.navigationPill },
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      },
                    ]}>
                    <BackIcon size={13} color={theme.colors.primary} />
                  </PressableScale>
                ) : null}
                {sessionStrip.map((node) => (
                  <SessionChip
                    key={node.session.asid}
                    node={node}
                    active={node.session.asid === selectedRootAsid}
                    current={node.session.asid === activeAsid}
                    lead={
                      sessionLead
                        ? sessionLead(node.session)
                        : nameOfAgent(node.session.mode || selectedAgent || 'build')
                    }
                    onPress={handleSelectSession}
                    onOpenTree={onOpenSessionTree}
                    onMeasure={measureChip}
                    subtaskActivity={
                      node.session.asid === selectedRootAsid ? rootSubtaskActivity : undefined
                    }
                  />
                ))}
              </ScrollView>
            ) : null}

            {/* Row 2: Function Keyboard / Toolbar (功能键盘) */}
            {/*
            The row scrolls and always did; nothing said so. The last chip ran
            off the right-hand edge mid-glyph -- `$0.0` for a cost of $0.00 --
            which reads as a clipped layout rather than as more to come. The
            fade says there is more, and the content's own right padding keeps
            the last chip whole under it.
          */}
            {hideParameterRow ? null : compact ? (
              // The quiet line: caption type in the subtle tone, under row 1's
              // body-size primary line, then the compact gap to the field.
              // One step more to the field than between the two text rows:
              // the field is a different thing.
              <View style={[styles.segmentRow, segmentRowLead, { marginBottom: theme.spacing.sm }]}>
                {segmentMode ? (
                  <TextSegment
                    testID="agent-composer-mode-btn"
                    hitSlop={segmentHitSlop.next}
                    onPress={toggleMode}
                    accessibilityRole="button"
                    accessibilityLabel={t`Select agent mode`}>
                    <Text
                      variant="caption"
                      numberOfLines={1}
                      color={modeMenuOpen ? theme.colors.primary : theme.colors.textSubtle}>
                      {modeLabel(selectedAgent ?? 'build')}
                    </Text>
                    <DisclosureDownIcon size={QUIET_CHEVRON} color={theme.colors.textSubtle} />
                  </TextSegment>
                ) : null}
                {segmentModel ? (
                  <TextSegment
                    testID="agent-composer-model-btn"
                    hitSlop={segmentHitSlop.next}
                    onPress={onOpenModelSheet}
                    accessibilityRole="button"
                    accessibilityLabel={t`Select model: ${modelDisplayName}`}>
                    <Text variant="caption" numberOfLines={1} color={theme.colors.textSubtle}>
                      {segmentMode ? `· ${modelDisplayName}` : modelDisplayName}
                    </Text>
                    <DisclosureDownIcon size={QUIET_CHEVRON} color={theme.colors.textSubtle} />
                  </TextSegment>
                ) : null}
              </View>
            ) : (
              <View style={styles.actionRowViewport}>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.actionRowContent}
                  style={styles.actionRowScroll}>
                  {/* All-sessions button (icon only) */}
                  {chipIds.has('sessions') ? (
                    <PressableScale
                      testID="agent-composer-sessions-btn"
                      onPress={onOpenSessionsSheet}
                      accessibilityRole="button"
                      accessibilityLabel={t`All sessions`}
                      style={[
                        styles.actionBtn,
                        { borderRadius: profile.chrome.roundControl },
                        { backgroundColor: surfaceBackground(chromeGlass) },
                      ]}>
                      <StackIcon size={16} color={chromeText} />
                    </PressableScale>
                  ) : null}

                  {/* Quick Agent Mode Popover Button */}
                  {chipIds.has('mode') ? (
                    <PressableScale
                      testID="agent-composer-mode-btn"
                      onPress={toggleMode}
                      accessibilityRole="button"
                      accessibilityLabel={t`Select agent mode`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        // Always one point of border, coloured only while open, so
                        // opening the menu never widens the chip and moves the next.
                        {
                          borderWidth: 1,
                          borderColor: modeMenuOpen ? theme.colors.primary : 'transparent',
                        },
                        { backgroundColor: surfaceBackground(chromeGlass) },
                      ]}>
                      <Text
                        variant="caption"
                        color={theme.colors.text}
                        style={styles.actionBtnLabel}>
                        {modeLabel(selectedAgent ?? 'build')}
                      </Text>
                      <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
                    </PressableScale>
                  ) : null}

                  {/* Quick Model Selector Button */}
                  {chipIds.has('model') ? (
                    <PressableScale
                      testID="agent-composer-model-btn"
                      onPress={onOpenModelSheet}
                      accessibilityRole="button"
                      accessibilityLabel={t`Select model: ${modelDisplayName}`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        { backgroundColor: surfaceBackground(chromeGlass) },
                      ]}>
                      <Text
                        variant="caption"
                        color={theme.colors.text}
                        style={styles.actionBtnLabel}>
                        {modelDisplayName}
                      </Text>
                      <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
                    </PressableScale>
                  ) : null}

                  {/* The queue, as the gateway last stated it */}
                  {chipIds.has('inbox') ? (
                    <PressableScale
                      testID="agent-composer-inbox-pill"
                      onPress={() => setInboxOpen((open) => !open)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: inboxOpen }}
                      accessibilityLabel={t`${inbox.length} queued`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        {
                          backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.18)),
                        },
                      ]}>
                      <InboxIcon size={13} color={theme.colors.primary} />
                      <Text
                        variant="caption"
                        weight="bold"
                        color={theme.colors.primary}
                        style={styles.actionBtnLabel}>
                        {inbox.length}
                      </Text>
                    </PressableScale>
                  ) : null}

                  {/* What is still running after the agent moved on */}
                  {chipIds.has('background') ? (
                    <PressableScale
                      testID="agent-composer-background-pill"
                      onPress={onOpenBackgroundTray}
                      accessibilityRole="button"
                      accessibilityLabel={t`${backgroundCount} running in the background`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        {
                          backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.18)),
                        },
                      ]}>
                      <TerminalIcon size={13} color={theme.colors.warning} />
                      <Text
                        variant="caption"
                        weight="bold"
                        color={theme.colors.warning}
                        style={styles.actionBtnLabel}>
                        {backgroundCount}
                      </Text>
                    </PressableScale>
                  ) : null}

                  {/* OpenCode Tasks Button */}
                  {chipIds.has('tasks') ? (
                    <PressableScale
                      testID="agent-composer-tasks-btn"
                      onPress={onOpenTasksSheet}
                      accessibilityRole="button"
                      accessibilityLabel={t`Tasks progress`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        { backgroundColor: surfaceBackground(chromeGlass) },
                      ]}>
                      <TaskIcon
                        size={14}
                        color={
                          tasks && tasks.length > 0 && tasks.every((t) => t.done)
                            ? theme.colors.success
                            : theme.colors.primary
                        }
                      />
                      <Text
                        variant="caption"
                        color={theme.colors.text}
                        style={styles.actionBtnLabel}>
                        {tasks && tasks.length > 0
                          ? t`Tasks (${tasks.filter((t) => t.done).length}/${tasks.length})`
                          : t`Tasks`}
                      </Text>
                      <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
                    </PressableScale>
                  ) : null}

                  {chipIds.has('delivery') ? (
                    <PressableScale
                      testID="agent-composer-delivery-btn"
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDeliveryMode((prev) => (prev === 'steer' ? 'queue' : 'steer'));
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        deliveryMode === 'steer'
                          ? t`Delivery mode: Steer (real-time). Tap to switch to Queue.`
                          : t`Delivery mode: Queue. Tap to switch to Steer.`
                      }
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        {
                          backgroundColor:
                            deliveryMode === 'steer'
                              ? withAlpha(theme.colors.warning, 0.2)
                              : withAlpha(theme.colors.primary, 0.2),
                          borderColor:
                            deliveryMode === 'steer'
                              ? withAlpha(theme.colors.warning, 0.5)
                              : withAlpha(theme.colors.primary, 0.5),
                          borderWidth: 1,
                        },
                      ]}>
                      {deliveryMode === 'steer' ? (
                        <>
                          <QuickActionIcon size={13} color={theme.colors.warning} />
                          <Text
                            variant="caption"
                            weight="bold"
                            color={theme.colors.warning}
                            style={styles.actionBtnLabel}>
                            <Trans>Steer</Trans>
                          </Text>
                        </>
                      ) : (
                        <>
                          <InboxIcon size={13} color={theme.colors.primary} />
                          <Text
                            variant="caption"
                            weight="bold"
                            color={theme.colors.primary}
                            style={styles.actionBtnLabel}>
                            <Trans>Queue</Trans>
                          </Text>
                        </>
                      )}
                    </PressableScale>
                  ) : null}

                  {/* Context window, token spend and cost, in one pill */}
                  {chipIds.has('context') && contextPill ? (
                    <PressableScale
                      testID="agent-composer-tokens-pill"
                      onPress={() => {
                        if (onPressTokens) {
                          onPressTokens();
                        } else if (tokens) {
                          showToast({
                            variant: 'info',
                            title: t`Session Tokens`,
                            message: `Input: ${tokens.input.toLocaleString()} • Output: ${tokens.output.toLocaleString()}${tokens.reasoning ? ` • Reasoning: ${tokens.reasoning.toLocaleString()}` : ''}`,
                          });
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={
                        contextPill.ratio === null
                          ? t`Tokens usage and cost`
                          : t`Context ${Math.round(contextPill.ratio * 100)}% full`
                      }
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        { backgroundColor: surfaceBackground(chromeGlass) },
                      ]}>
                      <ProcessorIcon size={13} color={chromeText} />
                      <Text
                        variant="caption"
                        color={theme.colors.textMuted}
                        style={styles.actionBtnLabel}>
                        {contextPill.label}
                      </Text>
                      {/* A gauge only when the engine stated a window to measure. */}
                      {contextPill.ratio !== null ? (
                        <View
                          style={[
                            styles.contextTrack,
                            { backgroundColor: withAlpha(theme.colors.text, 0.12) },
                          ]}>
                          <View
                            style={[
                              styles.contextFill,
                              {
                                width: `${Math.max(3, Math.round(contextPill.ratio * 100))}%`,
                                backgroundColor:
                                  contextPill.ratio > 0.9
                                    ? theme.colors.danger
                                    : contextPill.ratio > 0.7
                                      ? theme.colors.warning
                                      : theme.colors.primary,
                              },
                            ]}
                          />
                        </View>
                      ) : null}
                      <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
                    </PressableScale>
                  ) : null}

                  {/* Changes stay independent of the context pill. */}
                  {chipIds.has('diff') ? (
                    <PressableScale
                      onPress={onOpenDiffSheet}
                      accessibilityRole="button"
                      accessibilityLabel={t`View file changes`}
                      style={[
                        styles.actionBtn,
                        { borderRadius: profile.chrome.roundControl },
                        {
                          backgroundColor: withAlpha(theme.colors.primary, 0.18),
                        },
                      ]}>
                      <CompareIcon size={15} color={theme.colors.primary} />
                      <View
                        style={[styles.diffIndicator, { backgroundColor: theme.colors.primary }]}
                      />
                    </PressableScale>
                  ) : null}

                  {chipIds.has('stop') ? (
                    <PressableScale
                      onPress={onAbort}
                      accessibilityRole="button"
                      accessibilityLabel={t`Stop agent execution`}
                      style={[
                        styles.actionBtnWithLabel,
                        { borderRadius: profile.chrome.roundControl },
                        styles.stopActionBtn,
                        { backgroundColor: theme.colors.danger },
                      ]}>
                      <StopIcon size={12} color={theme.colors.onPrimary} />
                      <Text
                        variant="caption"
                        color={theme.colors.onPrimary}
                        style={styles.actionBtnLabel}>
                        <Trans>Stop</Trans>
                      </Text>
                    </PressableScale>
                  ) : null}
                </ScrollView>
              </View>
            )}

            {/* Attachment staged preview strip */}
            {visibleAttachments.length > 0 ? (
              <Animated.View
                entering={fadeIn('micro')}
                // Home restores field artwork on removal; do not leave a native
                // exit view painting across that field's newly raised position.
                exiting={flushField ? undefined : fadeOutDown('short')}
                style={[
                  styles.stripWrapper,
                  flushField && {
                    backgroundColor: surfaceBackground(theme.colors.surface),
                    borderRadius: profile.chrome.noticeBanner,
                  },
                ]}>
                <AttachmentStrip
                  attachments={visibleAttachments}
                  onRemove={removeStagedAttachment}
                  onRetry={retryStagedAttachment}
                  onPreview={setPreviewAttachmentId}
                  textColor={chromeText}
                  readOnly={submittingAttachments}
                />
              </Animated.View>
            ) : null}

            {/* Submission feedback stays outside the canonical transcript. */}
            {(sending && attachmentUploads.uploading) || submittingAttachments ? (
              <Animated.View
                testID="agent-composer-attachment-submission"
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                style={[
                  styles.uploadWait,
                  flushField && {
                    backgroundColor: surfaceBackground(theme.colors.surface),
                    borderRadius: profile.chrome.noticeBanner,
                  },
                ]}>
                <Spinner size="sm" color={theme.colors.textMuted} />
                <Text variant="caption" color={theme.colors.textMuted} style={styles.noticeText}>
                  {attachmentUploads.uploading ? (
                    <Trans>Waiting for uploads to finish…</Trans>
                  ) : pendingAttachmentSend?.delivery === 'queue' ? (
                    <Trans>Requesting queued delivery…</Trans>
                  ) : pendingAttachmentSend?.delivery === 'steer' ? (
                    <Trans>Submitting follow-up…</Trans>
                  ) : (
                    <Trans>Sending attachment message…</Trans>
                  )}
                </Text>
              </Animated.View>
            ) : null}

            {/* A direct send's receipt: what went, with its files. It leaves on
                its own; a tap only hides it sooner, and nothing here looks like
                a way to take the message back. A queued send has none: its
                inbox row is the receipt. */}
            {pendingAttachmentSend?.submittedAttachments ? (
              <Animated.View
                key={pendingAttachmentSend.submittedAttachments.map((item) => item.id).join(',')}
                entering={fadeIn('short')}
                exiting={fadeOut('short')}>
                <PressableScale
                  testID="agent-composer-attachment-acknowledged"
                  accessibilityRole="button"
                  accessibilityLiveRegion="polite"
                  accessibilityLabel={t`Submitted`}
                  accessibilityHint={t`Hides this notice`}
                  onPress={() => setPendingAttachmentSend(null)}
                  style={[
                    styles.uploadWait,
                    flushField && {
                      backgroundColor: surfaceBackground(theme.colors.surface),
                      borderRadius: profile.chrome.noticeBanner,
                    },
                  ]}>
                  <DoneIcon size={16} color={theme.colors.textMuted} />
                  <View style={styles.noticeText}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Submitted</Trans>
                    </Text>
                  </View>
                  <AttachmentThumbnailRow
                    entries={pendingAttachmentSend.submittedAttachments.map((item) => ({
                      key: item.id,
                      name: item.name,
                      uri: item.localUri,
                      image: isImageAttachment(item.mime),
                    }))}
                  />
                </PressableScale>
              </Animated.View>
            ) : null}

            {!promptAllowed ? (
              <Text variant="caption" color={theme.colors.textMuted}>
                {interactionBlockedReason ?? (
                  <Trans>
                    This agent accepts messages after its turn ends. Your draft stays here.
                  </Trans>
                )}
              </Text>
            ) : null}

            {/* TerminalComposer reused for agent prompt */}
            <View onLayout={(event) => setInputRowHeight(event.nativeEvent.layout.height)}>
              <TerminalComposer
                fieldBackground={fieldBackground}
                fieldBackgroundColor={fieldBackgroundColor}
                fieldBackgroundOutset={fieldBackgroundOutset}
                fieldDecoration={decorationHidden ? undefined : fieldDecoration}
                fieldTextTopInset={fieldTextTopInset}
                fieldShadow={fieldShadow}
                onVoiceActiveChange={setVoiceActive}
                spans={spans}
                compact={compact}
                minLines={fieldLines}
                voiceContext={voiceContext ?? `${sessionId}:${activeAsid ?? 'new'}`}
                inputRef={inputRef}
                leading={
                  canAttach || toolbarLeading ? (
                    <>
                      {canAttach ? (
                        <ComposerAttachmentButton
                          testID="agent-composer-attach"
                          label={
                            attachmentMenuOpen ? t`Close the attachment menu` : t`Attach a file`
                          }
                          expanded={attachmentMenuOpen}
                          disabled={
                            sending ||
                            disabled ||
                            (attachmentTargetId !== undefined &&
                              record?.serverId !== attachmentTargetId)
                          }
                          onPress={() => setAttachmentMenuOpen((open) => !open)}
                          size={16}
                          color={attachmentMenuOpen ? theme.colors.primary : chromeText}
                        />
                      ) : null}
                      {toolbarLeading}
                    </>
                  ) : undefined
                }
                inputProps={{
                  value: text,
                  onChangeText: changeText,
                  placeholder: disabled
                    ? agentName
                      ? t`${agentName} is offline`
                      : t`The agent is offline`
                    : (placeholder ??
                      t`Send a message, type / for commands, $ for skills, @ for files…`),
                  shortPlaceholder: t`Send a message…`,
                  editable: !sending && !disabled,
                  testID: inputTestID,
                  selection,
                  onSelectionChange: handleSelectionChange,
                  onKeyPress: (event) => {
                    slashPopup.inputProps.onKeyPress(event);
                    skillPopup.inputProps.onKeyPress(event);
                  },
                  onSubmitEditing: handleSend,
                  onFocus: () => setFocused(true),
                  onBlur: () => setFocused(false),
                  style: { fontFamily: interfaceFontFamily },
                }}
                send={{
                  accessibilityLabel: !promptAllowed
                    ? (interactionBlockedReason ?? t`Waiting for the current turn to end`)
                    : running
                      ? deliveryMode === 'steer'
                        ? t`Steer running agent`
                        : t`Queue message for agent`
                      : t`Send message`,
                  armed:
                    (Boolean(text.trim()) || attachmentUploads.attachments.length > 0) &&
                    !sending &&
                    !disabled &&
                    promptAllowed,
                  sending,
                  disabled:
                    sending ||
                    disabled ||
                    !promptAllowed ||
                    (!text.trim() && attachmentUploads.attachments.length === 0),
                  onPress: handleSend,
                  ...(sendTestID ? { testID: sendTestID } : {}),
                }}
              />
            </View>
          </View>
        </ComposerSurface>
      </View>
      {previewPdf ? (
        <AssetViewer asset={previewPdf} onClose={() => setPreviewAttachmentId(null)} />
      ) : null}
      {previewIndex >= 0 ? (
        <ImagePreviewModal
          images={previewImages}
          initialIndex={previewIndex}
          onClose={() => setPreviewAttachmentId(null)}
        />
      ) : null}
    </Animated.View>
  );
});

/** Home owns one painted field; session docks retain their enclosing glass material. */
function ComposerSurface({
  flushField,
  children,
  style,
  ...props
}: React.ComponentProps<typeof GlassChrome> & { flushField: boolean }) {
  if (!flushField)
    return (
      <GlassChrome {...props} style={style}>
        {children}
      </GlassChrome>
    );
  return <View style={[style, styles.flushSurface]}>{children}</View>;
}

/** The least room a popup is given, even on a short window with the keyboard up. */
const POPUP_MIN_HEIGHT = 120;

/** The clearance a popup keeps below the header it must not reach. */
const POPUP_HEADER_GAP = 16;

/** Between the paperclip's row and the menu it opens. */
const ATTACHMENT_MENU_GAP = 8;

/** How wide the chips row's right-hand fade is, and its content's right padding. */

/** How much of the strip stays visible to the left of the chip brought into view. */
const SESSION_CHIP_REVEAL_MARGIN = 24;

/** How long after a programmatic edit the native field has applied it. */
const CARET_SETTLE_MS = 50;

/** A chevron at the caption line's size: about its cap height, as 12 is to body text. */
const QUIET_CHEVRON = AGENT_TYPE.meta.size - 2;

const EMPTY_STRIP: readonly SessionNode[] = Object.freeze([]);
const EMPTY_COMMANDS: readonly CommandInfo[] = Object.freeze([]);
const EMPTY_INBOX: readonly InboxItem[] = Object.freeze([]);
const NO_HIDDEN_COMMANDS: readonly AgentClientCommandId[] = Object.freeze([]);

const styles = StyleSheet.create({
  flushSurface: {
    overflow: 'visible',
  },
  dockOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  composerFade: {
    position: 'absolute',
    top: -36,
    left: 0,
    right: 0,
    height: 48,
    pointerEvents: 'none',
  },
  composerDock: {
    // The dock is a sheet-shaped edge over the timeline, so it takes the
    // sheet's profile corner rather than a number of its own.
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  segmentRow: { minWidth: 0, flexDirection: 'row', alignItems: 'center' },
  composerInner: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  // `left: 0` because the menu carries the dock's own 12pt gutter itself.
  attachmentAnchor: {
    position: 'absolute',
    left: 0,
    zIndex: 2,
  },
  popupWrapper: {
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  composerFloatingContent: {
    width: '100%',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  composerPopup: {
    width: '100%',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  stripWrapper: {
    marginBottom: 6,
  },
  uploadWait: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 4,
  },
  noticeText: {
    flex: 1,
    minWidth: 0,
  },
  sessionStripViewport: {
    marginBottom: 6,
  },
  sessionStripContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  sessionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    /**
     * No width cap, by the owner's call: a chip is as wide as its title.
     *
     * The strip is a horizontal `ScrollView`, so a long title costs a swipe.
     * An ellipsis cost the reader the end of the title, which is usually the
     * part that tells two sessions apart.
     */
    /**
     * `minHeight`, not `height`.
     *
     * The text inside is vertically centred, so a fixed 32 clips the
     * ascenders of a face whose ascent is taller than the one this was
     * measured against. Every other chip in the app already says `minHeight`
     * -- the assignment bar's, the attachment strip's, the terminal notice's
     * -- and this was the odd one out.
     */
    minHeight: 32,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backChip: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderCurve: 'continuous',
  },
  // No `fontWeight` here: the badge asks for its weight through the kit's prop,
  // which the app's font registry caps at semibold. `expo-font` files a reader's
  // face under Typeface.NORMAL alone, so Android rounds 700 and over up to BOLD,
  // finds nothing filed there, and falls back to a system lookup that does not
  // know the family -- the badge would be the one run on the chip set in the
  // platform's face. A style `fontWeight` is applied after the kit's resolved
  // font style, so putting the 700 back here would defeat the cap.
  sessionChipAgentBadge: {
    fontSize: AGENT_TYPE.meta.size,
    // Never shrinks: see `sessionChipTitleSlot`.
    flexShrink: 0,
  },
  sessionChipDot: {
    fontSize: AGENT_TYPE.micro.size,
    opacity: 0.7,
  },
  /**
   * The title, at its own width, always.
   *
   * The owner's rule for a session strip is no ellipsis: the end of a title is
   * usually what tells two sessions of one agent apart, and the strip scrolls,
   * so a long chip costs a swipe and nothing else. Every level from the chip
   * down therefore refuses to shrink. It used to be the opposite -- an unbroken
   * shrink path, so that a width cap could ellipsise the title -- and with the
   * cap gone that path still ellipsised whenever the strip itself was narrower
   * than one chip.
   */
  sessionChipTitleSlot: {
    flexShrink: 0,
  },
  sessionChipTitle: {
    fontSize: AGENT_TYPE.meta.size,
    fontWeight: '500',
    flexShrink: 0,
  },
  actionRowViewport: {
    marginBottom: 8,
  },
  actionRowScroll: {
    overflow: 'visible',
  },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingRight: 8,
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderCurve: 'continuous',
    position: 'relative',
  },
  actionBtnWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    // `minHeight` for the reason the session chip above gives: a fixed height
    // around centred text clips a taller face's ascenders.
    minHeight: 36,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
  },
  actionBtnLabel: {
    fontSize: AGENT_TYPE.meta.size,
    fontWeight: '600',
  },
  stopActionBtn: {
    paddingHorizontal: 10,
  },
  inboxCard: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 4,
  },
  inboxHeading: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 8,
    marginVertical: 3,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderCurve: 'continuous',
  },
  queuedChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderCurve: 'continuous',
  },
  inboxBody: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  inboxText: {
    fontSize: AGENT_TYPE.meta.size,
  },
  inboxCancel: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextTrack: {
    width: 26,
    height: 4,
    borderRadius: 2,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  contextFill: {
    height: '100%',
    borderRadius: 2,
  },
  diffIndicator: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
