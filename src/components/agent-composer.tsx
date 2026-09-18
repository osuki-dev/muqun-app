import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TextInputSelectionChangeEventData,
  useWindowDimensions,
  View,
} from 'react-native';
import { Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  AlertCircle,
  ArrowLeft,
  CheckSquare,
  ChevronDown,
  Cpu,
  GitCompare,
  Inbox,
  Layers,
  Loader,
  Paperclip,
  Terminal,
  Square,
  Trash2,
  Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  cancelAnimation,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useKeyboardState, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { PressableScale } from '@/components/pressable-scale';
import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { AgentUnreadDot } from '@/components/agent-unread-dot';
import { TerminalComposer, composerStyles } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AgentModeMenu } from '@/components/agent-mode-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { GlassChrome } from '@/components/glass-chrome';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { ComposerPopup } from '@/components/composer-popup';
import { useComposerPopup } from '@/hooks/use-composer-popup';
import { composerChipIds } from '@/lib/agent-composer-chips';
import { slashCommandTrigger, type PaneSlashCommand } from '@/lib/pane-composer';
import {
  findFileMentionTrigger,
  insertFileMention,
  FILE_MENTION_LIMIT,
  type FileMentionHit,
  type FileMentionTrigger,
} from '@/lib/file-mentions';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useAttachmentUploads } from '@/hooks/use-attachment-uploads';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { pickAttachments, describePickerFailure, type AttachmentSource } from '@/lib/attachments';
import { DURATION, fadeIn, fadeOut, fadeOutDown, listLayout, timing } from '@/lib/motion';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import type { SessionNode } from '@/lib/agent-session-tree';
import {
  AGENT_CLIENT_COMMANDS,
  readSlashCommand,
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
  inboxItemText,
  type AgentContextUsage,
  type AgentInfo,
  type CommandInfo,
  type InboxItem,
  type AgentProject,
  type AgentSessionInfo,
  type CompactionReason,
  type ModelRef,
  type SkillInfo,
  type TodoItem,
  type TokensUsage,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';

/**
 * One chip in Row 1: a root, or a subagent under the open one.
 *
 * The strip used to be a flat `FlatList` of roots with, under whichever root
 * happened to be active, its immediate children as sibling chips -- no indent,
 * no connector, and nothing that said a chip was a child rather than a
 * sibling. It also returned a bare `<Fragment>` as the list item's root, so
 * React had no key to keep chip identity stable across a reorder.
 *
 * An untitled session shows "Untitled session" and its relative time, never
 * the raw `ses_…` the engine bookkeeps with, and cross-fades to the real title
 * when the auto-title lands on the first turn.
 */
const SessionChip = memo(function SessionChip({
  node,
  active,
  fallbackAgent,
  onPress,
  onMeasure,
}: {
  node: SessionNode;
  active: boolean;
  fallbackAgent?: string;
  onPress: (asid: string) => void;
  /** Where this chip sits in the strip, so the strip can bring it into view. */
  onMeasure?: (asid: string, x: number, width: number) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  const session = node.session;
  const child = node.depth > 0;
  const agentName = session.agent || (child ? t`subagent` : (fallbackAgent ?? 'build'));
  const titled = hasRealSessionTitle(session);
  // Untitled reads as untitled; the time is the caption a listing shows, not
  // the name a chip stands under.
  const title = titled ? session.title : t`Untitled session`;
  // The gateway's two numbers, and nothing else: a chip never says "unread"
  // because this app thought something had happened over there.
  const unread = isSessionUnread(session);

  return (
    <View
      style={styles.chipRow}
      onLayout={(event) => {
        const { x, width } = event.nativeEvent.layout;
        onMeasure?.(session.asid, x, width);
      }}>
      {/* The connector: one segment per level in, so a child reads as hanging
          off the chip before it rather than sitting beside it. */}
      {child ? (
        <View
          style={[
            styles.chipConnector,
            { backgroundColor: theme.colors.border, width: node.depth * 10 + 6 },
          ]}
        />
      ) : null}
      <PressableScale
        testID={`agent-composer-session-chip-${session.asid}`}
        onPress={() => onPress(session.asid)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={
          unread
            ? t`${agentName}: ${title} — finished while you were away`
            : `${agentName}: ${title}`
        }
        style={[
          styles.sessionChip,
          active
            ? { backgroundColor: theme.colors.primary }
            : {
                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                borderColor: surfaceBackground(theme.colors.border),
                borderWidth: StyleSheet.hairlineWidth,
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
        <Text
          variant="caption"
          weight="bold"
          color={active ? theme.colors.onPrimary : theme.colors.primary}
          style={styles.sessionChipAgentBadge}>
          {agentName}
        </Text>
        <Text
          variant="caption"
          color={active ? withAlpha(theme.colors.onPrimary, 0.6) : theme.colors.textMuted}
          style={styles.sessionChipDot}>
          •
        </Text>
        {/* Keyed on the title so the arriving auto-title fades in where the
            placeholder was, rather than replacing it between two frames. */}
        <Animated.View key={title} entering={fadeIn('short')}>
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
      </PressableScale>
    </View>
  );
});

export interface AgentComposerProps {
  running: boolean;
  /** Row 1: the workspace's roots, and the open root's subagent tree. */
  sessionStrip?: readonly SessionNode[];
  /** The session above the one on screen, for the way back out of a subagent. */
  parentSession?: AgentSessionInfo;
  availableAgents?: AgentInfo[];
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
  /** A compaction in flight, or one that failed and has not been read yet. */
  compaction?: { status: 'running' | 'failed'; reason: CompactionReason } | null;
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
  onAbort: () => Promise<void>;
  onSelectSession?: (asid: string) => void;
  onSelectAgentMode?: (agent: string) => void;
  onCreateNewSession?: () => void;
  onOpenModelSheet?: () => void;
  onOpenModeSheet?: () => void;
  onOpenDiffSheet: () => void;
  disabled?: boolean;
  onOpenSessionsSheet?: () => void;
  onOpenTasksSheet?: () => void;
  /** How many detached tools and shells are still running. */
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
  injectDraftRef?: React.MutableRefObject<((text: string) => void) | null>;
}

export const AgentComposer = memo(function AgentComposer({
  running,
  sessionStrip = EMPTY_STRIP,
  parentSession,
  availableAgents: availableAgentsProp,
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
  compaction,
  onDismissCompaction,
  cost,
  sessionTitle,
  onSend,
  onAbort,
  onSelectSession,
  onSelectAgentMode,
  onCreateNewSession,
  disabled,
  onOpenModelSheet,
  onOpenModeSheet,
  onOpenDiffSheet,
  onOpenSessionsSheet,
  onOpenTasksSheet,
  backgroundCount = 0,
  onOpenBackgroundTray,
  commands = EMPTY_COMMANDS,
  onRunCommand,
  onInvokeSkill,
  onClientCommand,
  inbox = EMPTY_INBOX,
  onCancelInboxItem,
  onSetInboxDelivery,
  onPressTokens,
  injectDraftRef,
}: AgentComposerProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [deliveryMode, setDeliveryMode] = useState<'steer' | 'queue'>('steer');
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  /** Which queued prompt has its actions open, if any. */
  const [inboxMenuId, setInboxMenuId] = useState<string | null>(null);

  /**
   * How full the model's context is, and how much the session has cost.
   *
   * The number is `GET …/context`, not `info.tokens`: the second is total
   * spend and never comes down, so a gauge drawn from it would sit at 100%
   * forever after one long session. The spend is still the fallback, because a
   * gateway that has not answered the context route yet has nothing else to
   * say, and it is labelled the same either way.
   */
  const contextPill = useMemo(() => {
    const live = contextUsage?.tokens ?? null;
    const total = live ? contextTokenTotal(live) : contextTokenTotal(tokens);
    if (total <= 0) return null;
    const ratio = live ? contextFillRatio(live, contextLimit) : null;
    let tokStr = `${total}`;
    if (total >= 1_000_000) tokStr = `${(total / 1_000_000).toFixed(1)}M`;
    else if (total >= 1_000) tokStr = `${(total / 1_000).toFixed(1)}k`;
    const costStr =
      cost === undefined || cost === null || cost === 0 ? t`Free` : `$${cost.toFixed(2)}`;
    return { label: `${tokStr} • ${costStr}`, ratio };
  }, [contextUsage, contextLimit, tokens, cost, t]);

  const modelDisplayName = useMemo(
    () => modelName || formatModelName(selectedModel),
    [modelName, selectedModel]
  );

  const inputRef = useRef<TextInput>(null);
  const [caret, setCaret] = useState<number | undefined>(undefined);
  const [mentionHits, setMentionHits] = useState<FileMentionHit[]>([]);

  const chromeText = theme.colors.text;
  const chromeGlass = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);

  const record = useGatewayConnectionStore((state) => state.record);
  const attachmentUploads = useAttachmentUploads(record);

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
      AGENT_CLIENT_COMMANDS.map((command) => ({
        name: command.name,
        description: _(agentClientCommandDescription[command.id]),
        argsHint: '',
        source: 'builtin' as const,
      })),
    [_]
  );

  const serverCommands: PaneSlashCommand[] = useMemo(
    () =>
      commands.map((command) => {
        const key = command.name.replace(/^\//, '');
        const known = agentHostCommandDescription[key];
        return {
          name: command.name.startsWith('/') ? command.name : `/${command.name}`,
          description: known ? _(known) : (command.description ?? command.agent ?? ''),
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

  const slashCatalog = useMemo(
    () => [...builtinCommands, ...serverCommands, ...skillCommands],
    [builtinCommands, serverCommands, skillCommands]
  );
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
          canOpenModel: Boolean(onOpenModelSheet),
          taskCount: tasks?.length ?? 0,
          canOpenTasks: Boolean(onOpenTasksSheet),
          inboxCount: inbox.length,
          backgroundCount,
          canOpenBackground: Boolean(onOpenBackgroundTray),
          hasContextPill: Boolean(contextPill),
          hasDiffs: Boolean(hasDiffs),
          running,
        })
      ),
    [
      onOpenSessionsSheet,
      onOpenModelSheet,
      tasks,
      onOpenTasksSheet,
      inbox.length,
      backgroundCount,
      onOpenBackgroundTray,
      contextPill,
      hasDiffs,
      running,
    ]
  );

  const slashPopup = useComposerPopup({
    draft: text,
    onDraftChange: setText,
    trigger: slashTrigger,
  });

  // File mentions (@) trigger
  const effectiveCaret = caret ?? text.length;
  const mentionTrigger = useMemo<FileMentionTrigger | null>(
    () => findFileMentionTrigger(text, effectiveCaret),
    [effectiveCaret, text]
  );
  const mentionQuery = mentionTrigger?.query ?? null;

  useEffect(() => {
    if (mentionQuery === null) {
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
  }, [mentionQuery, sessionId, activeAsid]);

  const chooseMention = useCallback(
    (hit: FileMentionHit) => {
      if (!mentionTrigger) return;
      const next = insertFileMention(text, mentionTrigger, hit.path);
      setText(next.text);
      setCaret(next.caret);
      setMentionHits([]);
    },
    [text, mentionTrigger]
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      const next = event.nativeEvent.selection.start;
      setCaret(next);
      slashPopup.inputProps.onSelectionChange(event);
    },
    [slashPopup.inputProps]
  );

  const chooseAttachmentSource = useCallback(
    (source: AttachmentSource) => {
      setAttachmentMenuOpen(false);
      const picker = attachmentUploads.capturePicker();
      if (!picker.isCurrent()) return;
      void pickAttachments(source)
        .then(picker.addFiles)
        .catch((failure: unknown) => {
          if (!picker.isCurrent()) return;
          showToast({
            variant: 'danger',
            title: t`Could not add a file`,
            message: describePickerFailure(source, failure),
          });
        });
    },
    [attachmentUploads, showToast, t]
  );

  useEffect(() => {
    if (injectDraftRef) {
      injectDraftRef.current = (draftText: string) => {
        setText(draftText);
        setTimeout(() => inputRef.current?.focus(), 50);
      };
    }
  }, [injectDraftRef]);

  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    const hasAttachments = attachmentUploads.attachments.length > 0;
    if ((!trimmed && !hasAttachments) || sending) return;

    // A slash command is a command. It used to be sent as the literal text it
    // was typed as, and whatever the model made of it was the result.
    if (!hasAttachments) {
      const parsed = readSlashCommand(trimmed, commands, skills);
      if (parsed?.kind === 'server' && onRunCommand) {
        onRunCommand(parsed.name, parsed.args);
        setText('');
        return;
      }
      if (parsed?.kind === 'skill' && onInvokeSkill) {
        // The draft stays put until the engine has taken it: a skill the
        // gateway refused with the composer already emptied is a line the
        // reader has to remember and retype.
        setSending(true);
        try {
          const accepted = await onInvokeSkill(parsed.name, parsed.args);
          if (accepted === false) return;
          setText('');
        } finally {
          setSending(false);
        }
        return;
      }
      if (parsed?.kind === 'client' && onClientCommand) {
        onClientCommand(parsed.name);
        setText('');
        return;
      }
    }

    setSending(true);
    try {
      let uploadedFilePaths: string[] = [];
      if (hasAttachments) {
        const paths = await attachmentUploads.awaitUploads();
        if (!paths) {
          showToast({
            variant: 'danger',
            title: t`Upload failed`,
            message: t`Please retry or remove failed attachments.`,
          });
          return;
        }
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
    } finally {
      setSending(false);
    }
  }, [
    text,
    attachmentUploads,
    sending,
    onSend,
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
          Icon: Zap,
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
          Icon: Inbox,
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
          Icon: Trash2,
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
  const sessionStripRef = useRef<ScrollView>(null);
  const chipOffsetsRef = useRef<Record<string, { x: number; width: number }>>({});
  const measureChip = useCallback((asid: string, x: number, width: number) => {
    chipOffsetsRef.current[asid] = { x, width };
  }, []);

  useEffect(() => {
    if (!activeAsid) return;
    // One frame after the chips have laid out: a session opened from a sheet
    // arrives with the strip rebuilding under it, and the chip's offset is not
    // known until it has.
    const timer = setTimeout(() => {
      const offset = chipOffsetsRef.current[activeAsid];
      if (!offset) return;
      sessionStripRef.current?.scrollTo({
        x: Math.max(0, offset.x - SESSION_CHIP_REVEAL_MARGIN),
        animated: true,
      });
    }, DURATION.short);
    return () => clearTimeout(timer);
  }, [activeAsid, sessionStrip]);

  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.value }],
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
  const [dockHeight, setDockHeight] = useState(0);
  const [inputRowHeight, setInputRowHeight] = useState(0);
  const popupMaxHeight = Math.max(
    POPUP_MIN_HEIGHT,
    windowHeight - keyboardHeight - dockHeight - topInset - POPUP_HEADER_GAP
  );
  /** The dock's own bottom padding, which the anchored menu has to clear too. */
  const dockBottomPadding = Math.max(10, bottomInset + 6);

  return (
    <Animated.View style={[styles.dockOuter, composerKeyboardStyle]}>
      <EdgeFade edge="bottom" color={theme.colors.background} style={styles.composerFade} />

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
          <GlassChrome surface="composer" style={styles.inboxCard}>
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
              return (
                <Animated.View key={item.id} layout={listLayout('short')}>
                  {/* The row is the control: tapping a queued prompt is how its
                      actions are reached, which is the same gesture a session
                      row answers in the sessions sheet. */}
                  <PressableScale
                    testID={`agent-composer-inbox-row-${item.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: inboxMenuId === item.id }}
                    accessibilityLabel={
                      steering
                        ? t`Sending next: ${inboxItemText(item) || item.type}`
                        : t`Queued: ${inboxItemText(item) || item.type}`
                    }
                    onPress={() =>
                      setInboxMenuId((current) => (current === item.id ? null : item.id))
                    }
                    style={[
                      styles.inboxRow,
                      { backgroundColor: surfaceBackground(withAlpha(theme.colors.text, 0.05)) },
                    ]}>
                    <Inbox size={13} color={theme.colors.primary} />
                    <Text
                      variant="caption"
                      numberOfLines={2}
                      color={theme.colors.textMuted}
                      style={styles.inboxText}>
                      {inboxItemText(item) || item.type}
                    </Text>
                    {/* Queued is not sent, and the two used to look identical.
                        Nor is queued the same as steering, which the chip said
                        it was: this is the item's own `delivery`. */}
                    <View
                      style={[
                        styles.queuedChip,
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
      {mentionTrigger && mentionHits.length > 0 ? (
        <View style={styles.composerFloatingContent}>
          <FileMentionPanel
            hits={mentionHits}
            query={mentionTrigger.query}
            onSelect={chooseMention}
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
          />
        </View>
      ) : null}

      {/* A compaction in flight. Transient, above the dock, and gone the
          moment the boundary lands in the timeline as a row of its own. */}
      {compaction ? (
        <CompactionPill
          status={compaction.status}
          reason={compaction.reason}
          {...(onDismissCompaction ? { onDismiss: onDismissCompaction } : {})}
        />
      ) : null}

      {/* The wrapper is here to be measured: `GlassChrome` is a material and
          takes no `onLayout` of its own. */}
      <View onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}>
        <GlassChrome surface="composer" style={styles.composerDock}>
          <View style={[styles.composerInner, { paddingBottom: dockBottomPadding }]}>
            {/* Row 1: the workspace's sessions, and the open one's subagents */}
            {sessionStrip.length > 0 ? (
              <ScrollView
                ref={sessionStripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sessionStripContent}
                style={styles.sessionStripViewport}>
                {/* The way back out of a subagent. A child is opened by tapping
                  its chip, and a strip with no way up is a one-way door. */}
                {parentSession ? (
                  <PressableScale
                    testID="agent-composer-session-back"
                    onPress={() => onSelectSession?.(parentSession.asid)}
                    accessibilityRole="button"
                    accessibilityLabel={t`Back to the parent session`}
                    style={[
                      styles.backChip,
                      {
                        backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                        borderColor: surfaceBackground(theme.colors.border),
                      },
                    ]}>
                    <ArrowLeft size={13} color={theme.colors.primary} />
                  </PressableScale>
                ) : null}
                {sessionStrip.map((node) => (
                  <SessionChip
                    key={node.session.asid}
                    node={node}
                    active={node.session.asid === activeAsid}
                    {...(selectedAgent ? { fallbackAgent: selectedAgent } : {})}
                    onPress={handleSelectSession}
                    onMeasure={measureChip}
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
                    style={[styles.actionBtn, { backgroundColor: surfaceBackground(chromeGlass) }]}>
                    <Layers size={16} color={chromeText} />
                  </PressableScale>
                ) : null}

                {/* Quick Agent Mode Popover Button */}
                <PressableScale
                  testID="agent-composer-mode-btn"
                  onPress={() => {
                    setAttachmentMenuOpen(false);
                    setModeMenuOpen(false);
                    if (onOpenModeSheet) {
                      onOpenModeSheet();
                    } else {
                      setModeMenuOpen((prev) => !prev);
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t`Select agent mode`}
                  style={[
                    styles.actionBtnWithLabel,
                    modeMenuOpen && { borderColor: theme.colors.primary, borderWidth: 1 },
                    { backgroundColor: surfaceBackground(chromeGlass) },
                  ]}>
                  <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                    {selectedAgent ?? 'build'}
                  </Text>
                  {/* One affordance for one behaviour: a chip that opens a sheet
                  wears the chevron, and only the model chip used to. */}
                  <ChevronDown size={12} color={theme.colors.textMuted} />
                </PressableScale>

                {/* Quick Model Selector Button (placed right after agent mode, displayed in full) */}
                {chipIds.has('model') ? (
                  <PressableScale
                    testID="agent-composer-model-btn"
                    onPress={onOpenModelSheet}
                    accessibilityRole="button"
                    accessibilityLabel={t`Select model: ${modelDisplayName}`}
                    style={[
                      styles.actionBtnWithLabel,
                      { backgroundColor: surfaceBackground(chromeGlass) },
                    ]}>
                    <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                      {modelDisplayName}
                    </Text>
                    <ChevronDown size={12} color={theme.colors.textMuted} />
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
                      { backgroundColor: surfaceBackground(chromeGlass) },
                    ]}>
                    <CheckSquare
                      size={14}
                      color={
                        tasks && tasks.length > 0 && tasks.every((t) => t.done)
                          ? theme.colors.success
                          : theme.colors.primary
                      }
                    />
                    <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                      {tasks && tasks.length > 0
                        ? t`Tasks (${tasks.filter((t) => t.done).length}/${tasks.length})`
                        : t`Tasks`}
                    </Text>
                    <ChevronDown size={12} color={theme.colors.textMuted} />
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
                      { backgroundColor: surfaceBackground(withAlpha(theme.colors.primary, 0.18)) },
                    ]}>
                    <Inbox size={13} color={theme.colors.primary} />
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
                      {
                        backgroundColor: surfaceBackground(withAlpha(theme.colors.warning, 0.18)),
                      },
                    ]}>
                    <Terminal size={13} color={theme.colors.warning} />
                    <Text
                      variant="caption"
                      weight="bold"
                      color={theme.colors.warning}
                      style={styles.actionBtnLabel}>
                      {backgroundCount}
                    </Text>
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
                      { backgroundColor: surfaceBackground(chromeGlass) },
                    ]}>
                    <Cpu size={13} color={chromeText} />
                    <Text
                      variant="caption"
                      color={theme.colors.textMuted}
                      style={styles.actionBtnLabel}>
                      {contextPill.label}
                    </Text>
                    {/* The gauge, only when the engine stated a window to measure
                    against. A bar with no limit behind it is a decoration. */}
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
                    <ChevronDown size={12} color={theme.colors.textMuted} />
                  </PressableScale>
                ) : null}

                {/* The changes on disk. Independent of every chip before it:
                    it used to be last in a chain of conditions and went
                    missing on the sessions that had actually written
                    something. */}
                {chipIds.has('diff') ? (
                  <PressableScale
                    onPress={onOpenDiffSheet}
                    accessibilityRole="button"
                    accessibilityLabel={t`View file changes`}
                    style={[
                      styles.actionBtn,
                      {
                        backgroundColor: withAlpha(theme.colors.primary, 0.18),
                      },
                    ]}>
                    {/* The same glyph the terminal's own changes button uses
                    (`git-diff-button.tsx`). A commit dot is not a diff, and
                    the two buttons open the same kind of thing. */}
                    <GitCompare size={15} color={theme.colors.primary} />
                    <View
                      style={[styles.diffIndicator, { backgroundColor: theme.colors.primary }]}
                    />
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
                        <Zap size={13} color={theme.colors.warning} />
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
                        <Inbox size={13} color={theme.colors.primary} />
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

                {chipIds.has('stop') ? (
                  <PressableScale
                    onPress={onAbort}
                    accessibilityRole="button"
                    accessibilityLabel={t`Stop agent execution`}
                    style={[
                      styles.actionBtnWithLabel,
                      styles.stopActionBtn,
                      { backgroundColor: theme.colors.danger },
                    ]}>
                    <Square size={12} color={theme.colors.onPrimary} />
                    <Text
                      variant="caption"
                      color={theme.colors.onPrimary}
                      style={styles.actionBtnLabel}>
                      <Trans>Stop</Trans>
                    </Text>
                  </PressableScale>
                ) : null}
              </ScrollView>
              <EdgeFade edge="right" color={theme.colors.surface} style={styles.actionRowFade} />
            </View>

            {/* Attachment staged preview strip */}
            {attachmentUploads.attachments.length > 0 ? (
              <Animated.View
                entering={fadeIn('micro')}
                exiting={fadeOutDown('short')}
                style={styles.stripWrapper}>
                <AttachmentStrip
                  variant="chip"
                  attachments={attachmentUploads.attachments}
                  onRemove={attachmentUploads.removeAttachment}
                  onRetry={attachmentUploads.retryUpload}
                  onPreview={() => {}}
                  textColor={chromeText}
                />
              </Animated.View>
            ) : null}

            {/* Uploading wait banner */}
            {sending && attachmentUploads.uploading ? (
              <Animated.View
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                style={styles.uploadWait}>
                <Spinner size="sm" color={theme.colors.textMuted} />
                <Text variant="caption" color={theme.colors.textMuted}>
                  <Trans>Waiting for uploads to finish…</Trans>
                </Text>
              </Animated.View>
            ) : null}

            {/* TerminalComposer reused for agent prompt */}
            <View onLayout={(event) => setInputRowHeight(event.nativeEvent.layout.height)}>
              <TerminalComposer
                inputRef={inputRef}
                leading={
                  <PressableScale
                    testID="agent-composer-attach"
                    accessibilityRole="button"
                    accessibilityState={{ expanded: attachmentMenuOpen }}
                    accessibilityLabel={
                      attachmentMenuOpen ? t`Close the attachment menu` : t`Attach a file`
                    }
                    disabled={sending || disabled}
                    onPress={() => setAttachmentMenuOpen((open) => !open)}
                    style={[
                      composerStyles.button,
                      { backgroundColor: surfaceBackground(chromeGlass) },
                      attachmentMenuOpen
                        ? { backgroundColor: surfaceBackground(theme.colors.primarySubtle) }
                        : null,
                      disabled ? { opacity: 0.5 } : null,
                    ]}>
                    <Paperclip
                      size={16}
                      color={attachmentMenuOpen ? theme.colors.primary : chromeText}
                    />
                  </PressableScale>
                }
                inputProps={{
                  value: text,
                  onChangeText: setText,
                  placeholder: disabled
                    ? t`OpenCode service offline`
                    : t`Send a message, type / for commands, @ for files…`,
                  editable: !sending && !disabled,
                  testID: 'agent-composer-input',
                  selection: slashPopup.inputProps.selection,
                  onSelectionChange: handleSelectionChange,
                  onKeyPress: slashPopup.inputProps.onKeyPress,
                  onSubmitEditing: handleSend,
                }}
                send={{
                  accessibilityLabel: running
                    ? deliveryMode === 'steer'
                      ? t`Steer running agent`
                      : t`Queue message for agent`
                    : t`Send message`,
                  armed:
                    (Boolean(text.trim()) || attachmentUploads.attachments.length > 0) &&
                    !sending &&
                    !disabled,
                  sending,
                  disabled:
                    sending ||
                    disabled ||
                    (!text.trim() && attachmentUploads.attachments.length === 0),
                  onPress: handleSend,
                }}
              />
            </View>
          </View>
        </GlassChrome>
      </View>
    </Animated.View>
  );
});

/**
 * "Compacting context…", while it is happening.
 *
 * `agent.compaction.changed` is the only thing that knows a compaction is
 * running: the boundary does not reach the timeline until it finishes, so
 * without this the reader watches a quiet agent and wonders what it is doing.
 */
const CompactionPill = memo(function CompactionPill({
  status,
  reason,
  onDismiss,
}: {
  status: 'running' | 'failed';
  reason: CompactionReason;
  onDismiss?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const failed = status === 'failed';

  const pulse = useSharedValue(failed ? 1 : 0.4);
  useEffect(() => {
    pulse.value = failed
      ? withTiming(1, timing('micro'))
      : withRepeat(
          withSequence(withTiming(1, timing('long')), withTiming(0.4, timing('long'))),
          -1
        );
    // An endless repeat must not outlive the pill: a view that is gone while
    // its animation still writes props is the SurfaceMountingManager noise
    // in logcat, not a harmless leftover.
    return () => cancelAnimation(pulse);
  }, [failed, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      style={styles.compactionPillWrap}>
      <PressableScale
        testID="agent-composer-compaction-pill"
        accessibilityRole={failed ? 'button' : 'progressbar'}
        accessibilityLabel={failed ? t`Compaction failed — tap to dismiss` : t`Compacting context…`}
        disabled={!failed || !onDismiss}
        onPress={onDismiss}
        style={[
          styles.compactionPill,
          {
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            borderColor: failed ? theme.colors.danger : theme.colors.border,
          },
        ]}>
        <Animated.View style={pulseStyle}>
          {failed ? (
            <AlertCircle size={12} color={theme.colors.danger} />
          ) : (
            <Loader size={12} color={theme.colors.primary} />
          )}
        </Animated.View>
        <Text
          variant="caption"
          weight="semibold"
          color={failed ? theme.colors.danger : theme.colors.text}>
          {failed
            ? t`Compaction failed`
            : reason === 'manual'
              ? t`Compacting context…`
              : t`Compacting context automatically…`}
        </Text>
      </PressableScale>
    </Animated.View>
  );
});

/** The least room a popup is given, even on a short window with the keyboard up. */
const POPUP_MIN_HEIGHT = 120;

/** The clearance a popup keeps below the header it must not reach. */
const POPUP_HEADER_GAP = 16;

/** Between the paperclip's row and the menu it opens. */
const ATTACHMENT_MENU_GAP = 8;

/** How wide the chips row's right-hand fade is, and its content's right padding. */
const ACTION_ROW_FADE_WIDTH = 28;

/** How much of the strip stays visible to the left of the chip brought into view. */
const SESSION_CHIP_REVEAL_MARGIN = 24;

const EMPTY_STRIP: readonly SessionNode[] = Object.freeze([]);
const EMPTY_COMMANDS: readonly CommandInfo[] = Object.freeze([]);
const EMPTY_INBOX: readonly InboxItem[] = Object.freeze([]);

const styles = StyleSheet.create({
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
    // sheet's corner rather than a number of its own.
    borderTopLeftRadius: appChrome.radius.sheet,
    borderTopRightRadius: appChrome.radius.sheet,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
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
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  /** One segment per level in: a child hangs off the chip before it. */
  chipConnector: {
    height: StyleSheet.hairlineWidth,
  },
  backChip: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  sessionChipAgentBadge: {
    fontSize: AGENT_TYPE.meta.size,
    fontWeight: '700',
  },
  sessionChipDot: {
    fontSize: AGENT_TYPE.micro.size,
    opacity: 0.7,
  },
  sessionChipTitle: {
    fontSize: AGENT_TYPE.meta.size,
    fontWeight: '500',
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
    // Under the fade, so the chip beneath it is still whole.
    paddingRight: ACTION_ROW_FADE_WIDTH,
  },
  actionRowFade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: ACTION_ROW_FADE_WIDTH,
    pointerEvents: 'none',
  },
  actionBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 999,
    borderCurve: 'continuous',
    position: 'relative',
  },
  actionBtnWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
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
    borderRadius: appChrome.radius.popover,
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
    borderRadius: 12,
    borderCurve: 'continuous',
  },
  queuedChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  inboxText: {
    flex: 1,
    minWidth: 0,
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
  compactionPillWrap: {
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  compactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
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
