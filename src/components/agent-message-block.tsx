import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Bot,
  ChevronDown,
  Clock,
  Cpu,
  Edit3,
  FileDiff,
  FileText,
  CircleHelp,
  FolderGit2,
  Info,
  Layers,
  Sparkles,
  Trash2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { AgentReasoningBlock } from '@/components/agent-reasoning-block';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import { AgentToolCard } from '@/components/agent-tool-card';
import { AgentPermissionCard } from '@/components/agent-permission-card';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { InlineDiffRows } from '@/components/diff-rows';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { fadeIn, timing } from '@/lib/motion';
import { isSafeExternalLink } from '@/lib/safe-link';
import { countMarked, diffRowsForFence } from '@/lib/agent-diff-rows';
import {
  formatModelName,
  type AgentPart,
  type AgentRunStatus,
  type PermissionDecision,
  type PermissionRequest,
  type TimelineItem,
  type ToolPart,
} from '@/lib/agent-session';
import type { TimelineRenderGroup } from '@/lib/agent-timeline-groups';

const IMAGE_DATA_URI_PREFIX = 'data:image/';
function isImageAttachment(uri: string): boolean {
  return uri.startsWith(IMAGE_DATA_URI_PREFIX) || /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(uri);
}

/**
 * What the reader attached, under what they said.
 *
 * A row of chips and thumbnails rather than a grid above the text: the text is
 * the message and the files are what came with it, which is the order the
 * composer stages them in and the order the TUI prints them.
 */
const MessageAttachments = memo(function MessageAttachments({
  attachments,
  onPreviewImage,
}: {
  attachments: readonly string[];
  onPreviewImage: (uri: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const raised = useTranscriptPlate('raised');

  return (
    <View style={styles.attachmentRow}>
      {attachments.map((att, attIdx) => {
        if (isImageAttachment(att)) {
          return (
            <PressableScale
              key={`${att}-${attIdx}`}
              accessibilityRole="imagebutton"
              accessibilityLabel={t`Open attachment`}
              onPress={() => onPreviewImage(att)}
              style={styles.attachmentImageWrapper}>
              <Image source={{ uri: att }} style={styles.attachmentThumbnail} contentFit="cover" />
            </PressableScale>
          );
        }
        const fileName = att.split('/').filter(Boolean).pop() || t`Attachment`;
        return (
          <View key={`${att}-${attIdx}`} style={[styles.attachmentChip, raised]}>
            <FileText size={13} color={theme.colors.primary} />
            <Text
              variant="caption"
              color={theme.colors.text}
              numberOfLines={1}
              style={styles.attachmentChipName}>
              {fileName}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

/**
 * A quiet single line: what the session switched to, what skill was loaded,
 * what the engine said about itself.
 *
 * These are not messages and they are not tool calls. OpenCode's own output
 * prints them as one dim line between the turns they separate, and anything
 * louder here reads as content the model produced -- which none of it is.
 */
const AgentNoticeRow = memo(function AgentNoticeRow({ part }: { part: AgentPart }) {
  const { t } = useLingui();
  const theme = useThemeTokens();

  const notice = useMemo((): { Icon: typeof Cpu; text: string } | null => {
    switch (part.type) {
      case 'model_switched': {
        const next = formatModelName(part.model, t`a default model`);
        return {
          Icon: Cpu,
          text: part.previous
            ? t`Model · ${formatModelName(part.previous)} → ${next}`
            : t`Model · ${next}`,
        };
      }
      case 'agent_switched':
        return {
          Icon: Bot,
          text: part.previous
            ? t`Agent · ${part.previous} → ${part.agent}`
            : t`Agent · ${part.agent}`,
        };
      case 'location_switched':
        return { Icon: FolderGit2, text: t`Directory · ${part.directory}` };
      case 'skill':
        return { Icon: Sparkles, text: t`Skill · ${part.name ?? part.skill}` };
      case 'synthetic':
      case 'system': {
        const text = part.text ?? part.description ?? '';
        return text ? { Icon: Info, text } : null;
      }
      case 'unsupported':
        return { Icon: CircleHelp, text: t`Unsupported item (${part.raw_type})` };
      default:
        return null;
    }
  }, [part, t]);

  if (!notice) return null;
  const { Icon, text } = notice;

  return (
    <View style={styles.noticeRow}>
      <Icon size={11} color={theme.colors.textMuted} />
      <Text
        variant="caption"
        color={theme.colors.textMuted}
        numberOfLines={2}
        style={styles.noticeText}>
        {text}
      </Text>
    </View>
  );
});

/**
 * What a tool card can do that a message block cannot decide for itself:
 * detach a running shell, open the session a subagent started, open a file the
 * tool returned.
 *
 * One object rather than six props, because it is passed straight through two
 * components and every one of them is optional -- a transcript with no
 * workbench behind it draws the same cards, minus the buttons.
 */
export interface AgentToolActions {
  onOpenChildSession?: (asid: string) => void;
  onRunInBackground?: (toolCallId: string) => void;
  onOpenBackgroundTray?: () => void;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  /** Live status per child session, from that session's own status events. */
  childStatuses?: Readonly<Record<string, AgentRunStatus>>;
  /**
   * Requests still waiting for an answer.
   *
   * A permission names the call it came from (`source_tool_call_id`), so the
   * card belongs under that card rather than in a footer several screens away
   * from the thing it is about.
   */
  permissions?: readonly PermissionRequest[];
  onPermissionDecision?: (permissionId: string, decision: PermissionDecision) => Promise<void>;
}

const NO_TOOL_ACTIONS: AgentToolActions = Object.freeze({});

/** A detached shell, as the tool call it was before it was detached. */
function shellAsToolPart(part: Extract<AgentPart, { type: 'shell' }>): ToolPart {
  return {
    type: 'tool',
    id: part.shell_id,
    name: 'shell',
    input: { command: part.command },
    output: part.output,
    content: [],
    metadata: part.exit === undefined ? {} : { exit: part.exit },
    state:
      part.status === 'running' ? 'running' : part.status === 'exited' ? 'completed' : 'failed',
    background: true,
    ...(part.truncated ? { truncated: true } : {}),
  };
}

/**
 * The boundary a compaction left behind.
 *
 * Not a message and not a tool call: the history before this point is gone and
 * what the model can still see is the summary. A labelled divider says that in
 * one line, and the summary is behind it rather than in front of it -- it is a
 * few thousand words of the model's own notes, and unfolding it by default
 * would bury the turn that follows.
 */
export const AgentCompactionRow = memo(function AgentCompactionRow({
  part,
}: {
  part: Extract<AgentPart, { type: 'compaction' }>;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const [expanded, setExpanded] = useState(false);

  const running = part.status === 'running';
  const failed = part.status === 'failed';
  const tone = failed ? theme.colors.danger : theme.colors.textMuted;

  // A slow breath while it runs, on the UI thread, honouring reduced motion --
  // the same idea as the thinking mark rather than a second kind of progress.
  const shimmer = useSharedValue(running ? 0 : 1);
  useEffect(() => {
    shimmer.value = running
      ? withRepeat(
          withSequence(withTiming(1, timing('long')), withTiming(0.35, timing('long'))),
          -1
        )
      : withTiming(1, timing('micro'));
  }, [running, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  const label = running
    ? t`Compacting context…`
    : failed
      ? t`Compaction failed`
      : part.reason === 'manual'
        ? t`Context compacted · manual`
        : t`Context compacted · auto`;

  const hasSummary = Boolean(part.summary);

  return (
    <View style={styles.compactionBlock}>
      <PressableScale
        testID="agent-compaction-row"
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        disabled={!hasSummary}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.compactionRow}>
        <View style={[styles.compactionRule, { backgroundColor: colors.border }]} />
        <Animated.View style={[styles.compactionLabel, shimmerStyle]}>
          <Layers size={11} color={tone} />
          <Text variant="caption" color={tone} numberOfLines={1} style={styles.noticeText}>
            {label}
          </Text>
          {hasSummary ? <ChevronDown size={11} color={theme.colors.textSubtle} /> : null}
        </Animated.View>
        <View style={[styles.compactionRule, { backgroundColor: colors.border }]} />
      </PressableScale>

      {failed && part.error?.message ? (
        <Text variant="caption" selectable color={theme.colors.danger} style={styles.noticeText}>
          {part.error.message}
        </Text>
      ) : null}

      {expanded && part.summary ? (
        <Animated.View entering={fadeIn('micro')}>
          <Text variant="caption" selectable color={theme.colors.textMuted} style={styles.summary}>
            {part.summary}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
});

/**
 * Pull ` ```diff … ``` ` fences out of assistant markdown. The enriched
 * markdown renderer's tree-sitter registry has no `diff` grammar, so those
 * fences would otherwise degrade to plain code; here they are rendered by the
 * same red/green patch rows the `diff` timeline part uses.
 */
function splitDiffFences(markdown: string): { kind: 'md' | 'diff'; text: string }[] {
  const segments: { kind: 'md' | 'diff'; text: string }[] = [];
  const fence = /```diff\s*\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'md', text: markdown.slice(last, match.index) });
    }
    segments.push({ kind: 'diff', text: match[1] });
    last = match.index + match[0].length;
  }
  if (segments.length === 0) return [{ kind: 'md', text: markdown }];
  if (last < markdown.length) {
    segments.push({ kind: 'md', text: markdown.slice(last) });
  }
  return segments;
}

/**
 * A patch, as the rows the diff viewer draws.
 *
 * This used to be a `ScrollView` of marker-coloured `<Text>` with no line
 * numbers -- one of four hand-rolled patch painters in this tree, each with its
 * own greens and reds. It is the real rows now: the same parser, the same
 * gutter, the same palette and the same character advance as the changes sheet,
 * capped so a fifty-thousand-line patch cannot land fifty thousand `<Text>`
 * nodes in one timeline cell.
 */
const InlinePatch = memo(function InlinePatch({ patch }: { patch: string }) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const rows = useMemo(() => diffRowsForFence(patch), [patch]);
  return (
    <InlineDiffRows
      rows={rows}
      colors={colors}
      // Opaque on purpose: the gutter is a plane that panned code slides under,
      // and a translucent one would let the code show through the numbers.
      gutterFill={theme.colors.surface}
      headerFill={theme.colors.surfaceRaised}
    />
  );
});

/**
 * A file edit, as OpenCode's own output shows it: the touched file with its
 * gains and losses, and the patch lines in the terminal's own red and green.
 */
const AgentDiffBlock = memo(function AgentDiffBlock({
  file,
  diff,
}: {
  file: string;
  diff: string;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const [expanded, setExpanded] = useState(true);

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));

  const stats = useMemo(
    () => ({ added: countMarked(diff, '+'), removed: countMarked(diff, '-') }),
    [diff]
  );

  return (
    <Animated.View style={styles.diffBlock}>
      <PressableScale
        testID="agent-diff-toggle"
        accessibilityRole="button"
        accessibilityLabel={file}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.diffHeader}>
        <FileDiff size={12} color={theme.colors.primary} />
        <Text
          variant="caption"
          weight="medium"
          color={theme.colors.text}
          numberOfLines={1}
          style={styles.diffFile}>
          {file}
        </Text>
        <Text variant="caption" weight="semibold" color={colors.added} style={styles.diffStat}>
          +{stats.added}
        </Text>
        <Text variant="caption" weight="semibold" color={colors.removed} style={styles.diffStat}>
          −{stats.removed}
        </Text>
        <View style={styles.diffChevron}>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={12} color={theme.colors.textMuted} />
          </Animated.View>
        </View>
      </PressableScale>

      {expanded ? (
        <Animated.View entering={fadeIn('micro')} style={styles.diffBodyWrap}>
          {/* Never wrapped: a re-wrapped diff line no longer lines up with the
              one above it, which is the only thing a diff is read for. */}
          <InlinePatch patch={diff} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/**
 * One assistant text part: its ` ```diff ``` ` fences are lifted into red/green
 * patch rows and the whole parse is memoised on the text, so streaming updates
 * to a neighbouring part do not re-split and re-render it.
 */
const MessageTextPart = memo(function MessageTextPart({
  text,
  prevTool,
  markdownStyle,
}: {
  text: string;
  prevTool?: TimelineItem;
  markdownStyle: MarkdownStyle;
}) {
  const theme = useThemeTokens();

  const segments = useMemo(
    () => splitDiffFences(text).filter((seg) => seg.kind === 'diff' || seg.text.trim().length > 0),
    [text]
  );

  // An assistant text that merely echoes the tool output right before it is
  // chrome, not content; OpenCode's own output does not repeat it.
  if (prevTool && prevTool.part.type === 'tool') {
    const cleanText = text
      .replace(/^```[\w]*\n/, '')
      .replace(/\n```$/, '')
      .replace(/Command exited with code \d+\.?/gi, '')
      .trim();
    const cleanOutput = (typeof prevTool.part.output === 'string' ? prevTool.part.output : '')
      .replace(/Command exited with code \d+\.?/gi, '')
      .trim();
    if (
      !cleanText ||
      cleanText === cleanOutput ||
      (cleanOutput && cleanText.includes(cleanOutput)) ||
      (cleanOutput && cleanOutput.includes(cleanText))
    ) {
      return null;
    }
  }

  const renderMarkdown = (key: string, markdown: string) => (
    <EnrichedMarkdownText
      key={key}
      flavor="commonmark"
      markdown={markdown}
      markdownStyle={markdownStyle}
      containerStyle={styles.markdownContainer}
      selectable
      selectionColor={theme.colors.primary}
      selectionHandleColor={theme.colors.primary}
      streamingAnimation={false}
      textBreakStrategy="simple"
      md4cFlags={{ latexMath: true }}
      onLinkPress={({ url }) => {
        if (isSafeExternalLink(url)) void Linking.openURL(url);
      }}
    />
  );

  if (segments.length === 1 && segments[0].kind === 'md') {
    return renderMarkdown('body', text);
  }
  return (
    <View style={styles.markdownSegments}>
      {segments.map((seg, segIdx) =>
        seg.kind === 'md' ? (
          renderMarkdown(`md-${segIdx}`, seg.text)
        ) : (
          <InlinePatch key={`diff-${segIdx}`} patch={seg.text} />
        )
      )}
    </View>
  );
});

/**
 * One part, whichever side of the conversation it arrived on.
 *
 * Both roles go through this. A user message whose part is not `text` used to
 * render as an empty bordered rectangle -- the bubble drew, the text was `''`
 * because the branch only read `part.text`, and nothing else was tried. There
 * is no reason a `diff` or a `status` on a user row should be less readable
 * than the same part on an assistant row, so neither is any more.
 */
function renderTimelinePart(
  item: TimelineItem,
  options: {
    showReasoning: boolean;
    markdownStyle: MarkdownStyle;
    prevItem?: TimelineItem;
    actions: AgentToolActions;
  }
): ReactNode {
  const part = item.part;
  switch (part.type) {
    case 'reasoning':
      return options.showReasoning ? (
        <AgentReasoningBlock key={item.id} text={part.text} durationMs={part.duration_ms} />
      ) : null;
    case 'tool':
      return <ToolPartCard key={item.id} part={part} options={options} />;
    case 'shell':
      // A detached shell is a tool call that outlived its turn, and it reads
      // best as the card it was before it was detached.
      return <ToolPartCard key={item.id} part={shellAsToolPart(part)} options={options} />;
    case 'diff':
      return <AgentDiffBlock key={item.id} file={part.file} diff={part.diff} />;
    case 'todo':
      return <AgentTodoBlock key={item.id} items={part.items} />;
    case 'status':
      return <StatusPartRow key={item.id} text={part.text} />;
    case 'compaction':
      return <AgentCompactionRow key={item.id} part={part} />;
    case 'model_switched':
    case 'agent_switched':
    case 'location_switched':
    case 'skill':
    case 'synthetic':
    case 'system':
    case 'unsupported':
      return <AgentNoticeRow key={item.id} part={part} />;
    case 'text':
      return (
        <MessageTextPart
          key={item.id}
          text={part.text}
          prevTool={
            options.prevItem && options.prevItem.part.type === 'tool' ? options.prevItem : undefined
          }
          markdownStyle={options.markdownStyle}
        />
      );
    default:
      // `approval` and `form` are drawn by the surfaces that own their state:
      // a permission under the tool row it came from, a form in the footer.
      return null;
  }
}

/**
 * The tool card, with the one callback it needs bound to its own call id.
 *
 * A component rather than an inline arrow so the closure is created per card
 * rather than per render of the whole message -- `AgentToolCard` is memoised
 * and a new function on every stream tick would defeat that.
 */
const ToolPartCard = memo(function ToolPartCard({
  part,
  options,
}: {
  part: ToolPart;
  options: { markdownStyle: MarkdownStyle; actions: AgentToolActions };
}) {
  const { actions } = options;
  const runInBackground = actions.onRunInBackground;
  const handleRunInBackground = useMemo(
    () => (runInBackground ? () => runInBackground(part.id) : undefined),
    [runInBackground, part.id]
  );
  const childStatus = part.child_session_id
    ? actions.childStatuses?.[part.child_session_id]
    : undefined;

  const attachedPermission = actions.permissions?.find(
    (request) => request.source_tool_call_id === part.id
  );
  const decide = actions.onPermissionDecision;
  const handleDecision = useMemo(
    () =>
      decide && attachedPermission
        ? (decision: PermissionDecision) => decide(attachedPermission.id, decision)
        : undefined,
    [decide, attachedPermission]
  );

  return (
    <>
      <AgentToolCard
        part={part}
        markdownStyle={options.markdownStyle}
        {...(childStatus ? { childStatus } : {})}
        {...(actions.onOpenChildSession ? { onOpenChildSession: actions.onOpenChildSession } : {})}
        {...(handleRunInBackground ? { onRunInBackground: handleRunInBackground } : {})}
        {...(actions.onOpenBackgroundTray
          ? { onOpenBackgroundTray: actions.onOpenBackgroundTray }
          : {})}
        {...(actions.onPreviewImage ? { onPreviewImage: actions.onPreviewImage } : {})}
        {...(actions.onOpenFile ? { onOpenFile: actions.onOpenFile } : {})}
      />
      {attachedPermission && handleDecision ? (
        <AgentPermissionCard attached request={attachedPermission} onDecision={handleDecision} />
      ) : null}
    </>
  );
});

const StatusPartRow = memo(function StatusPartRow({ text }: { text: string }) {
  const theme = useThemeTokens();
  return (
    <View style={styles.statusRow}>
      <Text variant="caption" color={theme.colors.textSubtle} style={styles.statusText}>
        • {text}
      </Text>
    </View>
  );
});

/**
 * What the reader said, as a block rather than a bubble.
 *
 * The right-hand bubble is gone. It cost a `maxWidth: 85%` on every message, it
 * re-wrapped anything monospaced the reader pasted, and on a phone it read as a
 * different app from the assistant side directly under it. What is left is the
 * shape the rest of this transcript already uses: a full-width block with a
 * rule down its left edge, a role caption at the weight
 * `EmbeddedTerminalToolBlock` puts its tool name at, and the attachments under
 * the text.
 */
export const AgentUserMessage = memo(function AgentUserMessage({
  group,
  showReasoning,
  markdownStyle,
  onPreviewImage,
  onEditQueued,
  onCancelQueued,
  actions = NO_TOOL_ACTIONS,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  markdownStyle: MarkdownStyle;
  onPreviewImage: (uri: string) => void;
  onEditQueued: (itemId: string, text: string) => void;
  onCancelQueued: (itemId: string) => void;
  actions?: AgentToolActions;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const colors = usePaneChatColors();
  const plate = useTranscriptPlate();
  const relativeTime = useRelativeTime();

  const first = group.items[0];
  const text = useMemo(
    () =>
      group.items
        .map((item) => (item.part.type === 'text' ? item.part.text : ''))
        .filter(Boolean)
        .join('\n'),
    [group.items]
  );
  const attachments = useMemo(
    () => group.items.flatMap((item) => item.attachments ?? []),
    [group.items]
  );
  const queued = group.items.find((item) => item.queued);
  const stamp = first?.updated_ms ? relativeTime(first.updated_ms) : '';

  return (
    <Pressable
      testID={`user-message-${first?.id ?? group.key}`}
      accessibilityLabel={t`Your message`}
      onLongPress={async () => {
        if (!text) return;
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await Clipboard.setStringAsync(text);
        showToast({
          variant: 'info',
          title: t`Copied`,
          message: t`Message copied to clipboard`,
        });
      }}
      delayLongPress={260}
      style={[
        styles.messageBlock,
        plate,
        styles.userBlock,
        { borderLeftColor: colors.accent },
        queued ? { borderLeftColor: theme.colors.warning } : null,
      ]}>
      <View style={styles.roleRow}>
        <Text variant="caption" weight="semibold" color={colors.accent} style={styles.roleLabel}>
          <Trans>You</Trans>
        </Text>
        {stamp ? (
          <Text variant="caption" color={theme.colors.textSubtle} style={styles.roleStamp}>
            {stamp}
          </Text>
        ) : null}
        {queued ? (
          <>
            <View style={styles.roleSpacer} />
            <View style={styles.queuedPill}>
              <Clock size={11} color={theme.colors.warning} />
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.warning}
                style={styles.queuedPillText}>
                <Trans>Queued</Trans>
              </Text>
            </View>
            <PressableScale
              testID={`queued-edit-${queued.id}`}
              accessibilityRole="button"
              accessibilityLabel={t`Edit queued message`}
              onPress={() => onEditQueued(queued.id, text)}
              style={styles.queuedActionBtn}>
              <Edit3 size={13} color={theme.colors.primary} />
            </PressableScale>
            <PressableScale
              testID={`queued-cancel-${queued.id}`}
              accessibilityRole="button"
              accessibilityLabel={t`Cancel queued message`}
              onPress={() => onCancelQueued(queued.id)}
              style={styles.queuedActionBtn}>
              <Trash2 size={13} color={theme.colors.danger} />
            </PressableScale>
          </>
        ) : null}
      </View>

      {group.items.map((item, index) =>
        renderTimelinePart(item, {
          showReasoning,
          markdownStyle,
          prevItem: index > 0 ? group.items[index - 1] : group.prevItem,
          actions,
        })
      )}

      {attachments.length > 0 ? (
        <MessageAttachments attachments={attachments} onPreviewImage={onPreviewImage} />
      ) : null}
    </Pressable>
  );
});

/**
 * One assistant or system message, laid out the way OpenCode's own output is:
 * every part in order inside a single block — the reasoning as short collapsed
 * `Thought · Xs` rows, the tool calls as quiet shells, the file diffs, the one
 * dim line a switch or a skill gets, and finally the text the thinking
 * produced.
 */
export const AgentAssistantMessage = memo(function AgentAssistantMessage({
  group,
  showReasoning,
  markdownStyle,
  actions = NO_TOOL_ACTIONS,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  markdownStyle: MarkdownStyle;
  actions?: AgentToolActions;
}) {
  const plate = useTranscriptPlate();

  // The parts this message actually paints, in order. `showReasoning` hides
  // the model's private reasoning the same way it did for the flat list.
  const visibleItems = useMemo(
    () =>
      group.items.filter((it) => {
        switch (it.part.type) {
          case 'reasoning':
            return showReasoning;
          case 'approval':
          case 'form':
            // Owned by the permission and form surfaces.
            return false;
          default:
            return true;
        }
      }),
    [group.items, showReasoning]
  );

  if (visibleItems.length === 0) return null;

  return (
    <View style={[styles.messageBlock, plate]}>
      {visibleItems.map((it, index) =>
        renderTimelinePart(it, {
          showReasoning,
          markdownStyle,
          prevItem: index > 0 ? visibleItems[index - 1] : group.prevItem,
          actions,
        })
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  /** The one geometry both sides share: full width, padded, on a plate. */
  messageBlock: {
    alignSelf: 'stretch',
    width: '100%',
    marginVertical: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  userBlock: {
    borderLeftWidth: 2,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleLabel: {
    fontSize: 11.5,
  },
  roleStamp: {
    fontSize: 11,
  },
  roleSpacer: {
    flex: 1,
  },
  queuedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  queuedPillText: {
    fontSize: 11,
  },
  queuedActionBtn: {
    padding: 3,
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  attachmentImageWrapper: {
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  attachmentThumbnail: {
    width: 160,
    height: 110,
    borderRadius: 14,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 220,
  },
  attachmentChipName: {
    fontSize: 12,
    flexShrink: 1,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
  },
  noticeText: {
    flexShrink: 1,
    fontSize: 11,
  },
  compactionBlock: {
    alignSelf: 'stretch',
    gap: 4,
    paddingVertical: 2,
  },
  compactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactionRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  compactionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
  },
  summary: {
    fontSize: 11,
    lineHeight: 17,
  },
  markdownContainer: {
    alignSelf: 'stretch',
  },
  markdownSegments: {
    gap: 6,
    alignSelf: 'stretch',
  },
  statusRow: {
    paddingVertical: 2,
  },
  statusText: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  diffBodyWrap: {
    paddingVertical: 2,
  },
  diffBlock: {
    alignSelf: 'stretch',
  },
  diffHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  diffFile: {
    flexShrink: 1,
    fontSize: 11.5,
  },
  diffStat: {
    fontSize: 10.5,
  },
  diffChevron: {
    padding: 2,
  },
});
