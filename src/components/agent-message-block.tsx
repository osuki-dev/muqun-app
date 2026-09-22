import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { goalContinuationSummary } from '@/lib/agent-goal-message';
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Trans, useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import {
  Bot,
  Check,
  ChevronDown,
  Clock,
  Copy,
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
  Undo2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { type MarkdownStyle } from 'react-native-enriched-markdown';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { EngineFailureText } from '@/components/engine-failure-text';
import { AgentReasoningBlock } from '@/components/agent-reasoning-block';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import { AgentToolCard } from '@/components/agent-tool-card';
import { AgentPermissionCard } from '@/components/agent-permission-card';
import { usePaneChatColors, usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { InlineDiffRows } from '@/components/diff-rows';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { useCompactMarkdownStyle } from '@/hooks/use-markdown-style';
import { buildTimelineEntries, type ReasoningRun, type TimelineEntry } from '@/lib/agent-reasoning';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import {
  readUploadImageSource,
  uploadImageSource,
  uploadNameFromPath,
  type AssetImageSource,
} from '@/lib/gateway-client';
import { fadeIn, timing } from '@/lib/motion';
import { plainFromMarkdown } from '@/lib/markdown-text';
import { countMarked, diffRowsForFence } from '@/lib/agent-diff-rows';
import {
  formatModelName,
  type AgentPart,
  type AgentRunStatus,
  type PermissionDecision,
  type TimelineItem,
  type ToolPart,
} from '@/lib/agent-session';
import { usePermissionDecider, usePermissionForToolCall } from '@/stores/agent-permissions';
import type { TimelineRenderGroup } from '@/lib/agent-timeline-groups';
import { groupRoutineToolEntries, type RoutineToolEntry } from '@/lib/agent-tool-groups';
import { AGENT_TYPE } from '@/constants/agent-type';

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
/**
 * One attached image. A data URI or a URL is shown as it is; a host path under
 * the gateway's upload folder is fetched back from the gateway with the
 * device's credentials (streamed by expo-image on a plain transport, decoded
 * from authenticated bytes on an encrypted one). Anything that cannot load
 * stays a quiet placeholder rather than an empty box.
 */
const AttachmentImage = memo(function AttachmentImage({
  uri,
  label,
  onPreviewImage,
}: {
  uri: string;
  label: string;
  onPreviewImage: (uri: string) => void;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const uploadName =
    uri.startsWith('data:') || /^https?:/.test(uri) ? null : uploadNameFromPath(uri);
  const [source, setSource] = useState<AssetImageSource | null>(() =>
    uploadName ? uploadImageSource(uploadName) : { uri, cacheKey: uri }
  );
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!uploadName || source) return;
    const controller = new AbortController();
    readUploadImageSource(uploadName, { signal: controller.signal })
      .then((resolved) => setSource(resolved))
      .catch(() => setFailed(true));
    return () => controller.abort();
  }, [uploadName, source]);

  if (failed || !source) {
    return (
      <View style={[styles.attachmentThumbnail, styles.attachmentPlaceholder]}>
        <FileText size={16} color={theme.colors.textSubtle} />
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      onPress={() => onPreviewImage(source.uri)}
      style={[styles.attachmentImageWrapper, { borderRadius: profile.chrome.surface }]}>
      <Image
        source={source}
        style={styles.attachmentThumbnail}
        contentFit="cover"
        onError={() => setFailed(true)}
      />
    </PressableScale>
  );
});

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
            <AttachmentImage
              key={`${att}-${attIdx}`}
              uri={att}
              label={t`Open attachment`}
              onPreviewImage={onPreviewImage}
            />
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
  const plate = useTranscriptPlate();
  const markdownStyle = useCompactMarkdownStyle('muted');

  const [expanded, setExpanded] = useState(false);
  const notice = useMemo((): { Icon: typeof Cpu; text: string; label?: string } | null => {
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
        return { Icon: FolderGit2, text: t`Project · ${part.directory}` };
      case 'skill':
        // "Skill · report" reads as a label on a thing; what the row is
        // announcing is that the agent has just picked the skill up.
        return { Icon: Sparkles, text: t`Skill loaded · ${part.name ?? part.skill}` };
      case 'synthetic':
      case 'system': {
        const text = part.text ?? part.description ?? '';
        if (!text) return null;
        // An engine-injected note often arrives wrapped in a tag,
        // `<system-reminder>…</system-reminder>`; the tag is the label, not
        // the content, so it becomes a title and the angle brackets go.
        const tagged = untagNotice(text);
        return tagged
          ? { Icon: Info, text: tagged.body, label: humaniseTag(tagged.tag) }
          : { Icon: Info, text };
      }
      case 'unsupported':
        return { Icon: CircleHelp, text: t`Unsupported item (${part.raw_type})` };
      default:
        return null;
    }
  }, [part, t]);

  const preview = useMemo(() => plainFromMarkdown(notice?.text ?? ''), [notice?.text]);

  if (!notice) return null;
  const { Icon, text, label } = notice;
  // A long note is never cut short for good: two lines closed, everything
  // when tapped, and the same tap folds it back.
  const foldable = label !== undefined || text.length > 120 || text.includes('\n');

  return (
    // The plate holds two things now, so the fold is a row rather than the
    // whole block: an opened note is a native markdown view, and a tap that
    // lands in it belongs to the selection, not to the fold.
    <View style={[styles.noticeBlock, plate, expanded ? styles.noticeOpen : null]}>
      <Pressable
        accessibilityRole={foldable ? 'button' : undefined}
        accessibilityState={foldable ? { expanded } : undefined}
        onPress={foldable ? () => setExpanded((v) => !v) : undefined}
        style={styles.noticeRow}>
        <Icon size={11} color={theme.colors.textMuted} style={styles.noticeIcon} />
        <View style={styles.noticeCopy}>
          {label ? (
            <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
              {label}
            </Text>
          ) : null}
          {/* The closed note, and the line an opened one is folded back by.
              The engine writes these in markdown -- "## Search", a bullet per
              tool -- and a preview is not rendering it, so the syntax comes
              off rather than being read as punctuation. A tagged note keeps
              its tag as the title and needs no second line when open. */}
          {label && expanded ? null : (
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={expanded ? 1 : 2}
              style={styles.noticeText}>
              {preview}
            </Text>
          )}
        </View>
        {foldable ? (
          <ChevronDown
            size={12}
            color={theme.colors.textSubtle}
            style={expanded ? styles.chevronOpen : undefined}
          />
        ) : null}
      </Pressable>

      {/* Opened, it is the note itself: the same markdown the answer reads,
          in the muted ink a notice is set in. */}
      {expanded ? (
        <Animated.View entering={fadeIn('micro')} style={styles.noticeBody}>
          <BoundedMarkdown
            markdown={text}
            markdownStyle={markdownStyle}
            containerStyle={styles.markdownContainer}
            openLinks={false}
            latexMath
          />
        </Animated.View>
      ) : null}
    </View>
  );
});

/** `<system-reminder>body</system-reminder>` → the tag and the body inside it. */
function untagNotice(text: string): { tag: string; body: string } | null {
  const match = /^\s*<([a-z][\w-]*)>\s*([\s\S]*?)\s*<\/\1>\s*$/i.exec(text);
  if (!match) return null;
  return { tag: match[1] ?? '', body: match[2] ?? '' };
}

/** `system-reminder` → `System reminder`. */
function humaniseTag(tag: string): string {
  const words = tag.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
  onOpenBackgroundTray?: (shellId?: string) => void;
  onPreviewImage?: (uri: string) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  /** The virtualised changes viewer, for a patch too big to draw in a cell. */
  onOpenFullDiff?: (path?: string) => void;
  /** Live status per child session, from that session's own status events. */
  childStatuses?: Readonly<Record<string, AgentRunStatus>>;
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
  const plate = useTranscriptPlate();
  const markdownStyle = usePaneChatMarkdownStyle();
  const [expanded, setExpanded] = useState(false);

  const running = part.status === 'running';
  const failed = part.status === 'failed';
  const tone = failed ? theme.colors.danger : theme.colors.textMuted;

  // A slow breath while it runs, on the UI thread -- the same idea as the
  // thinking mark rather than a second kind of progress, and stopped the same
  // way: an endless `withRepeat` outlives the view it drives, and every frame
  // it runs after that is a `synchronouslyUpdateUIProps failed` in the log.
  const reduceMotion = useReducedMotion();
  const shimmer = useSharedValue(running ? 0 : 1);
  useEffect(() => {
    if (!running || reduceMotion) {
      cancelAnimation(shimmer);
      shimmer.value = withTiming(1, timing('micro'));
      return;
    }
    shimmer.value = withRepeat(
      withSequence(withTiming(1, timing('long')), withTiming(0.35, timing('long'))),
      -1
    );
    return () => cancelAnimation(shimmer);
  }, [reduceMotion, running, shimmer]);
  const shimmerStyle = useAnimatedStyle(() => ({ opacity: shimmer.value }));

  // Closed points down, open points up -- the same as every other foldable row
  // in the transcript. This one never moved at all.
  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

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
          {hasSummary ? (
            <Animated.View style={chevronStyle}>
              <ChevronDown size={11} color={theme.colors.textSubtle} />
            </Animated.View>
          ) : null}
        </Animated.View>
        <View style={[styles.compactionRule, { backgroundColor: colors.border }]} />
      </PressableScale>

      {failed && part.error?.message ? (
        // The engine's reason sits on a plate like every other paragraph; red
        // ink straight on the wallpaper was the one line without one. A reason
        // that arrives as a small document is read as one.
        <View style={[styles.messageBlock, plate]}>
          <EngineFailureText message={part.error.message} />
        </View>
      ) : null}

      {expanded && part.summary ? (
        <Animated.View entering={fadeIn('micro')} style={[styles.messageBlock, plate]}>
          <BoundedMarkdown
            markdown={part.summary}
            markdownStyle={markdownStyle}
            containerStyle={styles.markdownContainer}
            openLinks={false}
          />
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
const InlinePatch = memo(function InlinePatch({
  patch,
  targetPath,
  onOpenFullDiff,
}: {
  patch: string;
  targetPath?: string;
  onOpenFullDiff?: (path?: string) => void;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const rows = useMemo(() => diffRowsForFence(patch), [patch]);
  return (
    <InlineDiffRows
      rows={rows}
      targetPath={targetPath}
      colors={colors}
      {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
      // The same fill as the plate the diff sits on, so the gutter and the hunk
      // header are not two lighter boxes inside the card.
      gutterFill={theme.colors.surface}
      headerFill={theme.colors.surface}
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
  onOpenFullDiff,
}: {
  file: string;
  diff: string;
  onOpenFullDiff?: (path?: string) => void;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const [expanded, setExpanded] = useState(true);

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
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
          <InlinePatch
            patch={diff}
            targetPath={file}
            {...(onOpenFullDiff ? { onOpenFullDiff } : {})}
          />
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
    <BoundedMarkdown
      key={key}
      markdown={markdown}
      markdownStyle={markdownStyle}
      containerStyle={styles.markdownContainer}
      latexMath
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
 * The drawn item before this one, skipping merged thinking.
 *
 * `prevItem` feeds the "this text merely echoes the tool above it" check, and
 * a Thought block between them is not what that check is about.
 */
function previousItemAt(
  entries: readonly TimelineEntry[],
  index: number
): TimelineItem | undefined {
  for (let at = index - 1; at >= 0; at -= 1) {
    const entry = entries[at];
    if (entry.kind === 'item') return entry.item;
  }
  return undefined;
}

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
    readOnly: boolean;
  }
): ReactNode {
  const part = item.part;
  switch (part.type) {
    case 'reasoning':
      // Never drawn from here: consecutive reasoning parts are merged into one
      // run by `buildTimelineEntries` and drawn as a single block.
      return null;
    case 'tool':
      return (
        <ToolPartCard
          key={item.id}
          part={part}
          markdownStyle={options.markdownStyle}
          actions={options.actions}
          readOnly={options.readOnly}
        />
      );
    case 'shell':
      // A detached shell is a tool call that outlived its turn, and it reads
      // best as the card it was before it was detached.
      return (
        <ToolPartCard
          key={item.id}
          part={shellAsToolPart(part)}
          markdownStyle={options.markdownStyle}
          actions={options.actions}
          readOnly={options.readOnly}
        />
      );
    case 'diff':
      return (
        <AgentDiffBlock
          key={item.id}
          file={part.file}
          diff={part.diff}
          {...(options.actions.onOpenFullDiff
            ? { onOpenFullDiff: options.actions.onOpenFullDiff }
            : {})}
        />
      );
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
  markdownStyle,
  actions,
  readOnly,
}: {
  part: ToolPart;
  markdownStyle: MarkdownStyle;
  actions: AgentToolActions;
  readOnly: boolean;
}) {
  const runInBackground = actions.onRunInBackground;
  const handleRunInBackground = useMemo(
    () => (runInBackground ? () => runInBackground(part.id) : undefined),
    [runInBackground, part.id]
  );
  const childStatus = part.child_session_id
    ? actions.childStatuses?.[part.child_session_id]
    : undefined;

  // Subscribed by call id rather than searched out of a list handed to every
  // card: one pending permission used to change the object every memoised tool
  // card compared against, so a single prompt re-rendered the whole transcript.
  const attachedPermission = usePermissionForToolCall(part.id, !readOnly);
  const decide = usePermissionDecider(!readOnly);
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
        markdownStyle={markdownStyle}
        {...(childStatus ? { childStatus } : {})}
        {...(actions.onOpenChildSession ? { onOpenChildSession: actions.onOpenChildSession } : {})}
        {...(handleRunInBackground ? { onRunInBackground: handleRunInBackground } : {})}
        {...(actions.onOpenBackgroundTray
          ? { onOpenBackgroundTray: actions.onOpenBackgroundTray }
          : {})}
        {...(actions.onPreviewImage ? { onPreviewImage: actions.onPreviewImage } : {})}
        {...(actions.onOpenFile ? { onOpenFile: actions.onOpenFile } : {})}
        {...(actions.onOpenFullDiff ? { onOpenFullDiff: actions.onOpenFullDiff } : {})}
      />
      {attachedPermission && handleDecision ? (
        <AgentPermissionCard attached request={attachedPermission} onDecision={handleDecision} />
      ) : null}
    </>
  );
});

/** Several quiet, completed calls behind one disclosure row. */
const AgentToolGroup = memo(function AgentToolGroup({
  entries,
  markdownStyle,
  actions,
  readOnly,
}: {
  entries: readonly RoutineToolEntry[];
  markdownStyle: MarkdownStyle;
  actions: AgentToolActions;
  readOnly: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useTranscriptPlate();
  const [expanded, setExpanded] = useState(false);
  const toolNames = useMemo(
    () => [...new Set(entries.map((entry) => entry.item.part.name))].join(' · '),
    [entries]
  );
  const title = t`${plural(entries.length, { one: '# operation', other: '# operations' })}`;
  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

  return (
    <View style={styles.toolGroup}>
      <PressableScale
        testID={`agent-tool-group-${entries[0].item.id}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[title, toolNames].filter(Boolean).join(', ')}
        onPress={() => setExpanded((previous) => !previous)}
        style={[styles.toolGroupHeader, plate]}>
        <Layers size={13} color={theme.colors.textMuted} />
        <View style={styles.toolGroupCopy}>
          <Text variant="caption" weight="semibold" color={theme.colors.text}>
            {title}
          </Text>
          <Text
            variant="caption"
            color={theme.colors.textSubtle}
            numberOfLines={1}
            style={styles.toolGroupNames}>
            {toolNames}
          </Text>
        </View>
        <Check size={12} color={theme.colors.success} />
        <Animated.View style={chevronStyle}>
          <ChevronDown size={12} color={theme.colors.textMuted} />
        </Animated.View>
      </PressableScale>
      {expanded ? (
        <Animated.View entering={fadeIn('micro')} style={styles.toolGroupItems}>
          {entries.map((entry) => (
            <ToolPartCard
              key={entry.item.id}
              part={entry.item.part}
              markdownStyle={markdownStyle}
              actions={actions}
              readOnly={readOnly}
            />
          ))}
        </Animated.View>
      ) : null}
    </View>
  );
});

/**
 * One message's thinking, as one block.
 *
 * `buildTimelineEntries` has already merged the consecutive `reasoning` parts
 * a step-by-step engine emits, so this draws at most one Thought per run
 * rather than one pill per step -- and a run that is still arriving counts up
 * instead of sitting there as an empty pill.
 */
const ReasoningRunBlock = memo(function ReasoningRunBlock({ run }: { run: ReasoningRun }) {
  return (
    <AgentReasoningBlock
      text={run.text}
      {...(run.durationMs === undefined ? {} : { durationMs: run.durationMs })}
      pending={run.pending}
    />
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
  onPreviewImage,
  onEditQueued,
  onCancelQueued,
  onUndoToHere,
  actions = NO_TOOL_ACTIONS,
  readOnly = false,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  markdownStyle: MarkdownStyle;
  onPreviewImage: (uri: string) => void;
  onEditQueued: (itemId: string, text: string) => void;
  onCancelQueued: (itemId: string) => void;
  /**
   * Stage a rollback to this message: everything from here on would go.
   *
   * It stages and previews; it never applies. The plate above the composer is
   * where it is confirmed.
   */
  onUndoToHere?: (messageId: string) => void;
  actions?: AgentToolActions;
  /** Historical/peek surfaces show content without session mutation controls. */
  readOnly?: boolean;
}) {
  const { t } = useLingui();
  // Live theme style, see AgentToolCard: a memoised cell must still repaint
  // its markdown when the palette changes.
  const markdownStyle = usePaneChatMarkdownStyle();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const colors = usePaneChatColors();
  const plate = useTranscriptPlate();
  const relativeTime = useRelativeTime();
  const profile = useAppearanceProfile();
  const [goalExpanded, setGoalExpanded] = useState(false);

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
  const goalSummary = useMemo(
    () =>
      group.items.every((item) => item.part.type === 'text') ? goalContinuationSummary(text) : null,
    [group.items, text]
  );
  const entries = useMemo(() => buildTimelineEntries(group.items), [group.items]);
  const stamp = first?.updated_ms ? relativeTime(first.updated_ms) : '';

  /**
   * The message's own actions.
   *
   * A long press used to copy, silently and immediately. It opens the actions
   * instead, and copy is the first of them -- because there is now a second
   * thing a message can do, and a gesture that performs one of two possible
   * actions without asking is a gesture that will perform the wrong one.
   */
  const [menuOpen, setMenuOpen] = useState(false);
  const messageId = first?.message_id;
  const menuItems = useMemo<AgentActionMenuItem[]>(() => {
    const items: AgentActionMenuItem[] = [];
    if (text) {
      items.push({
        id: 'copy',
        label: t`Copy message`,
        Icon: Copy,
        onPress: () => {
          setMenuOpen(false);
          void Clipboard.setStringAsync(text).then(() =>
            showToast({
              variant: 'info',
              title: t`Copied`,
              message: t`Message copied to clipboard`,
            })
          );
        },
        testID: `user-message-copy-${first?.id ?? group.key}`,
      });
    }
    if (onUndoToHere && messageId) {
      items.push({
        id: 'undo',
        label: t`Undo to here`,
        Icon: Undo2,
        onPress: () => {
          setMenuOpen(false);
          onUndoToHere(messageId);
        },
        testID: `user-message-undo-${first?.id ?? group.key}`,
      });
    }
    return items;
  }, [text, onUndoToHere, messageId, first?.id, group.key, showToast, t]);

  // A disclosure owns its touch responder. A second Pressable around a large
  // selectable native markdown body can retain the row's responder after it grows.
  const MessageContainer = goalSummary ? View : Pressable;
  const openMessageMenu = () => {
    if (menuItems.length === 0) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMenuOpen((open) => !open);
  };

  return (
    <MessageContainer
      testID={`user-message-${first?.id ?? group.key}`}
      accessibilityLabel={t`Your message`}
      onLongPress={goalSummary ? undefined : openMessageMenu}
      delayLongPress={260}
      style={[
        styles.messageBlock,
        plate,
        styles.userBlock,
        goalSummary ? styles.goalMessage : null,
        { borderLeftColor: colors.accent },
        queued ? { borderLeftColor: theme.colors.warning } : null,
      ]}>
      <View style={styles.roleRow}>
        <Text variant="caption" weight="semibold" color={colors.accent} style={styles.roleLabel}>
          <Trans>You</Trans>
        </Text>
        {stamp ? (
          <Text
            variant="caption"
            color={theme.colors.textSubtle}
            numberOfLines={1}
            textBreakStrategy="simple"
            style={styles.roleStamp}>
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
            {!readOnly ? (
              <>
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
          </>
        ) : null}
      </View>

      {goalSummary ? (
        <Pressable
          testID={`goal-message-toggle-${first?.id ?? group.key}`}
          accessibilityRole="button"
          accessibilityLabel={
            goalExpanded ? t`Collapse goal continuation` : t`Expand goal continuation`
          }
          accessibilityState={{ expanded: goalExpanded }}
          onPress={() => setGoalExpanded((open) => !open)}
          onLongPress={openMessageMenu}
          delayLongPress={260}
          style={[styles.goalDisclosure, { borderRadius: profile.chrome.control }]}>
          <View pointerEvents="none" style={styles.goalSummary}>
            <Text
              variant="caption"
              weight="semibold"
              color={colors.accent}>{t`Goal continuation`}</Text>
            <Text variant="bodySmall" color={theme.colors.text} numberOfLines={2}>
              {goalSummary}
            </Text>
          </View>
          <View pointerEvents="none" style={styles.goalChevron}>
            <ChevronDown
              size={14}
              color={colors.accent}
              style={{ transform: [{ rotate: goalExpanded ? '180deg' : '0deg' }] }}
            />
          </View>
        </Pressable>
      ) : null}
      {goalSummary && goalExpanded ? (
        <Text selectable variant="body" color={theme.colors.text} style={styles.goalFullText}>
          {text}
        </Text>
      ) : null}
      {!goalSummary &&
        entries.map((entry, index) =>
          entry.kind === 'reasoning' ? (
            showReasoning ? (
              <ReasoningRunBlock key={entry.key} run={entry.run} />
            ) : null
          ) : (
            renderTimelinePart(entry.item, {
              showReasoning,
              markdownStyle,
              prevItem: previousItemAt(entries, index) ?? group.prevItem,
              actions,
              readOnly,
            })
          )
        )}

      {attachments.length > 0 ? (
        <MessageAttachments attachments={attachments} onPreviewImage={onPreviewImage} />
      ) : null}

      {menuOpen ? (
        <AgentActionMenu
          testID={`user-message-menu-${first?.id ?? group.key}`}
          surface="ground"
          items={menuItems}
        />
      ) : null}
    </MessageContainer>
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
  reasoningLive = false,
  actions = NO_TOOL_ACTIONS,
  readOnly = false,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  reasoningLive?: boolean;
  markdownStyle: MarkdownStyle;
  actions?: AgentToolActions;
  /** Historical/peek surfaces show content without permission controls. */
  readOnly?: boolean;
}) {
  const plate = useTranscriptPlate();
  const markdownStyle = usePaneChatMarkdownStyle();

  // The parts this message actually paints, in order. `showReasoning` hides
  // the model's private reasoning the same way it did for the flat list.
  /**
   * The parts this message paints, in order, with the thinking merged.
   *
   * `approval` and `form` are owned by the permission and form surfaces;
   * `reasoning` is folded into runs by `buildTimelineEntries`, and
   * `showReasoning` hides those runs the same way it hid the pills.
   */
  const entries = useMemo(() => {
    const drawn = group.items.filter(
      (it) => it.part.type !== 'approval' && it.part.type !== 'form'
    );
    const built = buildTimelineEntries(drawn, reasoningLive);
    return showReasoning ? built : built.filter((entry) => entry.kind !== 'reasoning');
  }, [group.items, showReasoning, reasoningLive]);
  const displayEntries = useMemo(() => groupRoutineToolEntries(entries), [entries]);

  if (entries.length === 0) return null;

  // One plate per row, never a plate inside a plate. A thought block is a
  // row of its own with no plate under it: its pill is already a surface, and
  // its body brings one when it opens; the prose it led to starts a fresh
  // plate. A tool card, a diff, a shell or a todo list carries its own surface
  // and is laid out as a row of its own between them.
  const rows: ReactNode[] = [];
  let run: ReactNode[] = [];
  let runKey = '';
  const flush = () => {
    if (run.length === 0) return;
    rows.push(
      <View key={`run:${runKey}`} style={[styles.messageBlock, plate]}>
        {run}
      </View>
    );
    run = [];
  };
  displayEntries.forEach((displayEntry) => {
    if (displayEntry.kind === 'tool-group') {
      flush();
      rows.push(
        <View key={displayEntry.key} style={styles.standaloneRow}>
          <AgentToolGroup
            entries={displayEntry.entries}
            markdownStyle={markdownStyle}
            actions={actions}
            readOnly={readOnly}
          />
        </View>
      );
      return;
    }
    const { entry, sourceIndex } = displayEntry;
    if (entry.kind === 'reasoning') {
      flush();
      rows.push(
        <View key={`thought:${entry.key}`} style={styles.thoughtRow}>
          <ReasoningRunBlock key={entry.key} run={entry.run} />
        </View>
      );
      return;
    }
    const drawn = renderTimelinePart(entry.item, {
      showReasoning,
      markdownStyle,
      prevItem: previousItemAt(entries, sourceIndex) ?? group.prevItem,
      actions,
      readOnly,
    });
    if (drawn === null) return;
    if (STANDALONE_PART_TYPES.has(entry.item.part.type)) {
      flush();
      rows.push(
        <View key={`row:${entry.item.id}`} style={styles.standaloneRow}>
          {drawn}
        </View>
      );
      return;
    }
    if (run.length === 0) runKey = entry.item.id;
    run.push(<Fragment key={entry.item.id}>{drawn}</Fragment>);
  });
  flush();

  if (rows.length === 0) return null;
  return <>{rows}</>;
});

/** Parts that paint their own surface and therefore stand as their own row. */
const STANDALONE_PART_TYPES: ReadonlySet<string> = new Set([
  'tool',
  'diff',
  'shell',
  'todo',
  'compaction',
  // Notices draw their own compact plate.
  'model_switched',
  'agent_switched',
  'location_switched',
  'skill',
  'synthetic',
  'system',
  'unsupported',
  'status',
]);

/**
 * The one gap between two rows of the transcript, whether they belong to the
 * same message or not.
 *
 * Each row carries half of it above and half below, so a tool card has the
 * same air over it as under it -- it used to have ten points above and twenty
 * below, because the list put its own gap between messages on top of the
 * rows' own margins. The list's gap is zero now; this is the only spacing.
 */
export const TRANSCRIPT_ROW_GAP = 10;

const styles = StyleSheet.create({
  /** The one geometry both sides share: full width, padded, on a plate. */
  messageBlock: {
    // Hugs its content: "OK" is a short plate, a paragraph a wide one.
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  userBlock: {
    borderLeftWidth: 2,
  },
  // A thought row hugs its pill; the surfaces are the pill's and the body's own.
  thoughtRow: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
  },
  standaloneRow: {
    alignSelf: 'stretch',
    width: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
  },
  toolGroup: { gap: TRANSCRIPT_ROW_GAP },
  toolGroupHeader: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  toolGroupCopy: { flex: 1, minWidth: 0, gap: 1 },
  toolGroupNames: { fontSize: AGENT_TYPE.micro.size },
  toolGroupItems: { gap: TRANSCRIPT_ROW_GAP },
  goalMessage: { alignSelf: 'stretch', width: '100%' },
  goalDisclosure: {
    alignSelf: 'stretch',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    zIndex: 1,
  },
  goalSummary: { flex: 1, minWidth: 0, gap: 4 },
  goalChevron: { width: 20, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  goalFullText: { alignSelf: 'stretch', flexShrink: 1 },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  roleLabel: {
    fontSize: AGENT_TYPE.meta.size,
  },
  attachmentPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleStamp: {
    fontSize: AGENT_TYPE.micro.size,
    // Never shrinks: "just now" is not allowed to become "just".
    flexShrink: 0,
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
    fontSize: AGENT_TYPE.micro.size,
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
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  attachmentThumbnail: {
    width: 160,
    height: 110,
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
    fontSize: AGENT_TYPE.meta.size,
    flexShrink: 1,
  },
  noticeIcon: { marginTop: 3 },
  // Shrinks, never grows: inside a plate that hugs its content a `flex: 1`
  // column measures to nothing and the row collapses to its icon.
  noticeCopy: { flexShrink: 1, minWidth: 0, gap: 2 },
  noticeBlock: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  // Closed, the plate hugs its two lines; open, it is a document and takes
  // the row's full width like every other block that holds prose.
  noticeOpen: { alignSelf: 'stretch' },
  noticeBody: { marginTop: 4 },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 2,
  },
  noticeText: {
    flexShrink: 1,
    fontSize: AGENT_TYPE.micro.size,
  },
  compactionBlock: {
    alignSelf: 'stretch',
    gap: 4,
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
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
    fontSize: AGENT_TYPE.micro.size,
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
    fontSize: AGENT_TYPE.meta.size,
  },
  diffStat: {
    fontSize: AGENT_TYPE.micro.size,
  },
  diffChevron: {
    padding: 2,
  },
});
