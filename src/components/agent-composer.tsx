import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TextInputSelectionChangeEventData,
  View,
} from 'react-native';
import { Spinner, Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  CheckSquare,
  ChevronDown,
  Cpu,
  GitCompare,
  GitFork,
  Inbox,
  Layers,
  Loader,
  Paperclip,
  Sparkles,
  Terminal,
  Square,
  Zap,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { TerminalComposer, composerStyles } from '@/components/terminal-composer';
import { AttachmentMenu } from '@/components/attachment-menu';
import { AgentModeMenu } from '@/components/agent-mode-menu';
import { AttachmentStrip } from '@/components/attachment-strip';
import { GlassChrome } from '@/components/glass-chrome';
import { EdgeFade } from '@/components/edge-fade';
import { FileMentionPanel } from '@/components/file-mention-panel';
import { ComposerPopup } from '@/components/composer-popup';
import { useComposerPopup } from '@/hooks/use-composer-popup';
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
import { fadeIn, fadeOut, fadeOutDown, timing } from '@/lib/motion';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import type { SessionNode } from '@/lib/agent-session-tree';
import {
  AGENT_CLIENT_COMMANDS,
  readSlashCommand,
  type AgentClientCommandId,
} from '@/lib/agent-commands';
import { agentClientCommandDescription } from '@/i18n/labels';
import {
  contextFillRatio,
  contextTokenTotal,
  formatModelName,
  hasRealSessionTitle,
  isBusyStatus,
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
}: {
  node: SessionNode;
  active: boolean;
  fallbackAgent?: string;
  onPress: (asid: string) => void;
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

  const dotColor =
    session.status === 'failed'
      ? theme.colors.danger
      : isBusyStatus(session.status)
        ? theme.colors.warning
        : theme.colors.success;

  return (
    <View style={styles.chipRow}>
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
        accessibilityLabel={`${agentName}: ${titled ? session.title : t`Untitled session`}`}
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
        <StatusDot size={6} filled pulse={isBusyStatus(session.status)} color={dotColor} />
        {child ? (
          <GitFork size={12} color={active ? theme.colors.onPrimary : theme.colors.primary} />
        ) : (
          <Bot size={13} color={active ? theme.colors.onPrimary : theme.colors.primary} />
        )}
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
  /** One of the app's own commands, dispatched by the screen that owns them. */
  onClientCommand?: (name: AgentClientCommandId) => void;
  /** What is waiting behind the current turn. */
  inbox?: readonly InboxItem[];
  onCancelInboxItem?: (inboxId: string) => void;
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
  onClientCommand,
  inbox = EMPTY_INBOX,
  onCancelInboxItem,
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
      commands.map((command) => ({
        name: command.name.startsWith('/') ? command.name : `/${command.name}`,
        description: command.description ?? command.agent ?? '',
        argsHint: command.template ? '…' : '',
        source: 'workspace' as const,
      })),
    [commands]
  );

  const skillCommands: PaneSlashCommand[] = useMemo(
    () =>
      (skills ?? []).map((s) => ({
        name: `/${s.id}`,
        description: s.description || s.name,
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
      const parsed = readSlashCommand(trimmed, commands);
      if (parsed?.kind === 'server' && onRunCommand) {
        onRunCommand(parsed.name, parsed.args);
        setText('');
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
    onRunCommand,
    onClientCommand,
  ]);

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

  const { height: keyboardOffset } = useReanimatedKeyboardAnimation();
  const composerKeyboardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: keyboardOffset.value }],
  }));

  return (
    <Animated.View style={[styles.dockOuter, composerKeyboardStyle]}>
      <EdgeFade edge="bottom" color={theme.colors.background} style={styles.composerFade} />

      {/* Dismiss backdrop for popups */}
      {attachmentMenuOpen || modeMenuOpen || inboxOpen ? (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            setAttachmentMenuOpen(false);
            setModeMenuOpen(false);
            setInboxOpen(false);
          }}
        />
      ) : null}

      {/* Attachment source popup */}
      {attachmentMenuOpen ? (
        <View style={styles.popupWrapper}>
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
            {inbox.map((item) => (
              <View key={item.id} style={styles.inboxRow}>
                <Inbox size={13} color={theme.colors.primary} />
                <Text
                  variant="caption"
                  numberOfLines={2}
                  color={theme.colors.text}
                  style={styles.inboxText}>
                  {inboxItemText(item) || item.type}
                </Text>
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
              </View>
            ))}
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

      <GlassChrome surface="composer" style={styles.composerDock}>
        <View style={[styles.composerInner, { paddingBottom: Math.max(10, bottomInset + 6) }]}>
          {/* Row 1: the workspace's sessions, and the open one's subagents */}
          {sessionStrip.length > 0 ? (
            <ScrollView
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
                />
              ))}
            </ScrollView>
          ) : null}

          {/* Row 2: Function Keyboard / Toolbar (功能键盘) */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.actionRowContent}
            style={styles.actionRowScroll}>
            {/* All Sessions Button (Icon-only) */}
            {onOpenSessionsSheet ? (
              <PressableScale
                testID="agent-composer-sessions-btn"
                onPress={onOpenSessionsSheet}
                accessibilityLabel={t`All Sessions`}
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
              accessibilityLabel={t`Select agent mode`}
              style={[
                styles.actionBtnWithLabel,
                modeMenuOpen && { borderColor: theme.colors.primary, borderWidth: 1 },
                { backgroundColor: surfaceBackground(chromeGlass) },
              ]}>
              <Sparkles size={14} color={theme.colors.primary} />
              <Text variant="caption" color={theme.colors.text} style={styles.actionBtnLabel}>
                {selectedAgent ?? 'build'}
              </Text>
            </PressableScale>

            {/* Quick Model Selector Button (placed right after agent mode, displayed in full) */}
            {onOpenModelSheet ? (
              <PressableScale
                testID="agent-composer-model-btn"
                onPress={onOpenModelSheet}
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
            {onOpenTasksSheet || (tasks && tasks.length > 0) ? (
              <PressableScale
                testID="agent-composer-tasks-btn"
                onPress={onOpenTasksSheet}
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
              </PressableScale>
            ) : null}

            {/* The queue, as the gateway last stated it */}
            {inbox.length > 0 ? (
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
            {backgroundCount > 0 && onOpenBackgroundTray ? (
              <PressableScale
                testID="agent-composer-background-pill"
                onPress={onOpenBackgroundTray}
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
            {contextPill ? (
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
              </PressableScale>
            ) : null}

            {/* VCS Diff Button: only rendered when hasDiffs is true */}
            {hasDiffs ? (
              <PressableScale
                onPress={onOpenDiffSheet}
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
                <View style={[styles.diffIndicator, { backgroundColor: theme.colors.primary }]} />
              </PressableScale>
            ) : null}

            {running ? (
              <PressableScale
                testID="agent-composer-delivery-btn"
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setDeliveryMode((prev) => (prev === 'steer' ? 'queue' : 'steer'));
                }}
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

            {running ? (
              <PressableScale
                onPress={onAbort}
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
          <TerminalComposer
            inputRef={inputRef}
            leading={
              <PressableScale
                testID="agent-composer-attach"
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
                sending || disabled || (!text.trim() && attachmentUploads.attachments.length === 0),
              onPress: handleSend,
            }}
          />
        </View>
      </GlassChrome>
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
  actionRowScroll: {
    marginBottom: 8,
  },
  actionRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
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
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
