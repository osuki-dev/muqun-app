import { isPdfFile } from '@/lib/session-assets';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { ToolExpansionIntent } from '@/components/embedded-terminal-tool-block';
import { goalContinuationSummary } from '@/lib/agent-goal-message';
import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewInstance } from 'react-native';
import { useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { Trans, useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import {
  AgentIcon,
  DoneIcon,
  DisclosureDownIcon,
  TimeIcon,
  CopyIcon,
  ProcessorIcon,
  EditIcon,
  FileChangesIcon,
  DocumentIcon,
  HelpIcon,
  RepositoryIcon,
  InformationIcon,
  StackIcon,
  SuggestedIcon,
  DeleteIcon,
  RestoreIcon,
  QuickActionIcon,
} from '@/icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Paths } from 'expo-file-system';
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

import { AttachmentImage } from '@/components/attachment-image';
import {
  GatewayImageThumbnail,
  UnmappedImageThumbnail,
} from '@/components/gateway-image-thumbnail';
import { ImagePreviewModal } from '@/components/image-preview-modal';
import {
  gatewayImageBinding,
  configuredGatewayServerId,
  gatewayImageConnectionKey,
  readUploadImageSource,
} from '@/lib/gateway-client';
import { rawAlbumImage } from '@/lib/image-album-source';
import { splitDiagramMarkdown } from '@/lib/diagram-markdown';
import {
  messageImageForSource,
  unavailableMessageImage,
  type PreviewImageDescriptor,
  type PreviewImageSource,
} from '@/lib/gateway-image-previews';
import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { TranscriptBlockImage } from '@/components/transcript-block-image';
import { videoFileMime } from '@/lib/media-file';
import { gatewayUploadName } from '@/lib/uploaded-attachments';
import { InlineVideoFile } from '@/components/video-asset-preview';
import { InlineFileLink } from '@/components/inline-file-link';
import { ThemeFencePreview } from '@/components/theme-fence-preview';
import { InlineAudioFile } from '@/components/audio-asset-preview';
import { splitAudioMarkdown } from '@/lib/audio-markdown';
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
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeIn, riseIn, timing } from '@/lib/motion';
import { plainFromMarkdown } from '@/lib/markdown-text';
import { normalizeAssistantMarkdown } from '@/lib/assistant-markdown';
import {
  escapeMarkdownText,
  groupBlockImages,
  messageImageResolver,
  isHostPathSource,
  rewriteMessageImages,
  splitBlockImages,
  type MessageImageAsset,
} from '@/lib/message-images';
import { useMessageImages } from '@/hooks/use-message-images';
import { countMarked, diffRowsForFence } from '@/lib/agent-diff-rows';
import {
  formatModelName,
  type AgentPart,
  type AgentSessionInfo,
  type PermissionDecision,
  type TimelineItem,
  type ToolPart,
} from '@/lib/agent-session';
import { usePermissionDecider, usePermissionForToolCall } from '@/stores/agent-permissions';
import type { TimelineRenderGroup } from '@/lib/agent-timeline-groups';
import { groupRoutineToolEntries, type RoutineToolEntry } from '@/lib/agent-tool-groups';
import { AGENT_TYPE } from '@/constants/agent-type';
import { TRANSCRIPT_GRID, TRANSCRIPT_HANG } from '@/constants/transcript-grid';

/** How recent a message must be to fade in when its row mounts. */
const FRESH_ROW_MS = 2000;

const IMAGE_DATA_URI_PREFIX = 'data:image/';
function isImageAttachment(uri: string): boolean {
  return uri.startsWith(IMAGE_DATA_URI_PREFIX) || /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(uri);
}

function imagesInAttachments(
  attachments: readonly string[],
  assets: readonly MessageImageAsset[],
  files?: readonly { image: boolean }[]
): number {
  return attachments.filter((uri, index) => {
    const asset = messageImageForSource(assets, uri);
    const file = files?.[index];
    return (
      asset?.mime.startsWith('image/') || (!asset && (file ? file.image : isImageAttachment(uri)))
    );
  }).length;
}

/** Galleries and players need a definite row width; plain prose can hug its text. */
function messageNeedsMediaWidth(item: TimelineItem, audioSessionId?: string): boolean {
  if (item.part.type !== 'text') return false;
  return (
    splitDiagramMarkdown(item.part.text).some((part) => part.source !== undefined) ||
    splitBlockImages(item.part.text).filter((block) => block.kind === 'image').length > 1 ||
    Boolean(
      audioSessionId &&
      splitAudioMarkdown(item.part.text).some(
        (part) => part.kind === 'audio' || part.kind === 'video'
      )
    )
  );
}

const MessageAttachments = memo(function MessageAttachments({
  attachments,
  imageAssets,
  files,
  onPreviewImage,
  asid,
}: {
  attachments: readonly string[];
  imageAssets?: readonly MessageImageAsset[];
  /** A queued row's names and image decisions, index for index; see `inboxItemAttachments`. */
  files?: readonly { name: string; image: boolean; mime?: string }[];
  asid?: string;
  onPreviewImage: (uri: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const raised = useTranscriptPlate('raised');
  const images = attachments.flatMap((uri, index) => {
    const asset = messageImageForSource(imageAssets, uri);
    const file = files?.[index];
    return asset?.mime.startsWith('image/') ||
      (!asset && (file ? file.image : isImageAttachment(uri)))
      ? [{ uri, alt: file?.name || t`Open attachment`, pending: false, asset }]
      : [];
  });
  const firstImageIndex = attachments.findIndex((uri) => images.some((image) => image.uri === uri));

  return (
    <View style={styles.attachmentRow}>
      {attachments.map((att, attIdx) => {
        if (images.length > 1 && images.some((image) => image.uri === att))
          return attIdx === firstImageIndex ? (
            <ImageAlbum key={`album:${attIdx}`} images={images} attachmentSources />
          ) : null;
        const image = messageImageForSource(imageAssets, att);
        if (image)
          return (
            <GatewayImageThumbnail
              key={`${att}-${attIdx}`}
              asset={image}
              label={t`Open attachment`}
            />
          );
        const file = files?.[attIdx];
        const fileName = file?.name || att.split('/').filter(Boolean).pop() || t`Attachment`;
        const videoMime = videoFileMime({
          uri: att,
          name: fileName,
          mime:
            file?.mime ??
            imageAssets?.find((asset) => asset.src === att && !asset.unavailable_reason)?.mime,
        });
        if (asid && videoMime) {
          return (
            <View key={`${att}-${attIdx}`} style={{ width: '100%' }}>
              <InlineVideoFile asid={asid} file={{ uri: att, name: fileName, mime: videoMime }} />
            </View>
          );
        }
        if (file ? file.image : isImageAttachment(att)) {
          return (
            <UnmappedImageThumbnail
              key={`${att}-${attIdx}`}
              uri={att}
              unavailable={unavailableMessageImage(imageAssets, att)}
              label={t`Open attachment`}
              style={{ width: 160, height: 110 }}
              onPreviewImage={onPreviewImage}>
              <AttachmentImage
                key={`${att}-${attIdx}`}
                uri={att}
                label={t`Open attachment`}
                onPreviewImage={onPreviewImage}
              />
            </UnmappedImageThumbnail>
          );
        }
        if (asid && (isPdfFile({ uri: att }) || gatewayUploadName(att))) {
          return (
            <InlineFileLink
              key={`${att}-${attIdx}`}
              asid={asid}
              file={{ uri: att, name: fileName }}
            />
          );
        }
        return (
          <View key={`${att}-${attIdx}`} style={[styles.attachmentChip, raised]}>
            <DocumentIcon size={13} color={theme.colors.primary} />
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
  const notice = useMemo((): {
    Icon: typeof ProcessorIcon;
    text: string;
    label?: string;
  } | null => {
    switch (part.type) {
      case 'model_switched': {
        const next = formatModelName(part.model, t`a default model`);
        return {
          Icon: ProcessorIcon,
          text: part.previous
            ? t`Model · ${formatModelName(part.previous)} → ${next}`
            : t`Model · ${next}`,
        };
      }
      case 'agent_switched':
        return {
          Icon: AgentIcon,
          text: part.previous ? t`Mode · ${part.previous} → ${part.mode}` : t`Mode · ${part.mode}`,
        };
      case 'location_switched':
        return { Icon: RepositoryIcon, text: t`Project · ${part.directory}` };
      case 'skill':
        // "Skill · report" reads as a label on a thing; what the row is
        // announcing is that the agent has just picked the skill up.
        return { Icon: SuggestedIcon, text: t`Skill loaded · ${part.name ?? part.skill}` };
      case 'synthetic':
      case 'system': {
        const text = part.text ?? part.description ?? '';
        if (!text) return null;
        // An engine-injected note often arrives wrapped in a tag,
        // `<system-reminder>…</system-reminder>`; the tag is the label, not
        // the content, so it becomes a title and the angle brackets go.
        const tagged = untagNotice(text);
        return tagged
          ? { Icon: InformationIcon, text: tagged.body, label: humaniseTag(tagged.tag) }
          : { Icon: InformationIcon, text };
      }
      case 'unsupported':
        return { Icon: HelpIcon, text: t`Unsupported item (${part.raw_type})` };
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
        <View style={styles.noticeIcon}>
          <Icon size={11} color={theme.colors.textMuted} />
        </View>
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
          <DisclosureDownIcon
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
  audioSessionId?: string;
  onOpenChildSession?: (asid: string) => void;
  onRunInBackground?: (toolCallId: string) => void;
  onOpenBackgroundTray?: (shellId?: string) => void;
  onPreviewImage?: (uri: string, album?: readonly string[]) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  /** The virtualised changes viewer, for a patch too big to draw in a cell. */
  onOpenFullDiff?: (path?: string) => void;
  /** Live status per child session, from that session's own status events. */
  childSessions?: Readonly<Record<string, AgentSessionInfo>>;
  /** The whole call in the tool detail sheet. */
  onOpenToolDetail?: (part: ToolPart) => void;
  onExpandTool?: (toolId: string, header: ViewInstance) => ToolExpansionIntent | undefined;
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
          <StackIcon size={11} color={tone} />
          <Text variant="caption" color={tone} numberOfLines={1} style={styles.noticeText}>
            {label}
          </Text>
          {hasSummary ? (
            <Animated.View style={chevronStyle}>
              <DisclosureDownIcon size={11} color={theme.colors.textSubtle} />
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
function splitDiffFences(markdown: string): { kind: 'md' | 'diff'; text: string; start: number }[] {
  const segments: { kind: 'md' | 'diff'; text: string; start: number }[] = [];
  const fence = /```diff\s*\n([\s\S]*?)```/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    if (match.index > last) {
      segments.push({ kind: 'md', text: markdown.slice(last, match.index), start: last });
    }
    segments.push({ kind: 'diff', text: match[1], start: match.index });
    last = match.index + match[0].length;
  }
  if (segments.length === 0) return [{ kind: 'md', text: markdown, start: 0 }];
  if (last < markdown.length) {
    segments.push({ kind: 'md', text: markdown.slice(last), start: last });
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
  const surfaceBackground = useSurfaceBackground();
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
      headerFill={surfaceBackground(theme.colors.surface)}
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
  const { t } = useLingui();
  const theme = useThemeTokens();
  const label = file || t`Changes`;
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
        accessibilityLabel={label}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.diffHeader}>
        <FileChangesIcon size={12} color={theme.colors.primary} />
        <Text
          variant="caption"
          weight="medium"
          color={theme.colors.text}
          numberOfLines={1}
          style={styles.diffFile}>
          {label}
        </Text>
        <Text variant="caption" weight="semibold" color={colors.added} style={styles.diffStat}>
          +{stats.added}
        </Text>
        <Text variant="caption" weight="semibold" color={colors.removed} style={styles.diffStat}>
          −{stats.removed}
        </Text>
        <View style={styles.diffChevron}>
          <Animated.View style={chevronStyle}>
            <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
          </Animated.View>
        </View>
      </PressableScale>

      {expanded ? (
        <Animated.View entering={fadeIn('micro')} style={styles.diffBodyWrap}>
          {/* Never wrapped: a re-wrapped diff line no longer lines up with the
              one above it, which is the only thing a diff is read for. */}
          <InlinePatch
            patch={diff}
            targetPath={file || undefined}
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
  text: written,
  role,
  markdownStyle,
  imageAssets,
  audioSessionId,
  onPreviewImage,
  onOpenFile,
  streaming = false,
}: {
  text: string;
  role: TimelineItem['role'];
  markdownStyle: MarkdownStyle;
  /** The gateway's resolution of the images this text embeds by host path. */
  imageAssets?: readonly MessageImageAsset[];
  audioSessionId?: string;
  onPreviewImage?: (uri: string, album?: readonly string[]) => void;
  onOpenFile?: (file: { uri: string; mime?: string; name?: string }) => void;
  streaming?: boolean;
}) {
  const { t } = useLingui();
  const images = useMessageImages(imageAssets);
  const [preview, setPreview] = useState<{
    images: PreviewImageDescriptor[];
    index: number;
  } | null>(null);
  const openGatewayPreview = (
    image: PreviewImageDescriptor,
    assets: readonly MessageImageAsset[]
  ) => {
    const album = [
      ...new Map(
        assets.flatMap((asset) => {
          const bound = gatewayImageBinding(asset);
          return bound ? [[bound.image.id, bound.image] as const] : [];
        })
      ).values(),
    ];
    const index = album.findIndex((entry) => entry.id === image.id);
    setPreview({
      images: index >= 0 ? album.map((entry) => (entry.id === image.id ? image : entry)) : [image],
      index: Math.max(0, index),
    });
  };
  const previewMessageImage = (uri: string, album?: readonly string[]) => {
    const asset = imageAssets?.find(
      (entry) => entry.src === uri || images.uris.get(entry.src) === uri
    );
    const bound = asset ? gatewayImageBinding(asset) : null;
    if (asset && bound) openGatewayPreview(bound.image, [asset]);
    else onPreviewImage?.(uri, album);
  };
  const blockSources = useMemo(
    () =>
      new Set(
        splitBlockImages(written).flatMap((block) => (block.kind === 'image' ? [block.uri] : []))
      ),
    [written]
  );
  // The text as drawn: each image the gateway can serve loads from it, and one
  // that names a host path nothing can serve says so in words rather than
  // leaving an empty box. The agent's own text -- what copy and export use --
  // is never changed.
  const text = useMemo(
    () =>
      rewriteMessageImages(
        role === 'assistant' ? normalizeAssistantMarkdown(written) : written,
        (src) =>
          blockSources.has(src) &&
          (messageImageForSource(imageAssets, src) || (audioSessionId && isHostPathSource(src))) &&
          !images.uris.has(src)
            ? { kind: 'keep' }
            : messageImageResolver(images.uris, images.pending)(src),
        (alt) => {
          const label = alt.trim() ? t`Image unavailable: ${alt.trim()}` : t`Image unavailable`;
          return `*${escapeMarkdownText(label)}*`;
        }
      ),
    [written, role, images, t, blockSources, imageAssets, audioSessionId]
  );
  const segments = useMemo(
    () => splitDiffFences(text).filter((seg) => seg.kind === 'diff' || seg.text.trim().length > 0),
    [text]
  );

  const renderMarkdown = (key: string, markdown: string) => {
    const parts = audioSessionId ? splitAudioMarkdown(markdown) : [];
    const cover =
      parts.filter((part) => part.kind === 'video').length === 1
        ? splitBlockImages(markdown).find(
            (block) => block.kind === 'image' && /cover|poster|封面/i.test(block.alt)
          )
        : undefined;
    const coverMetadata = imageAssets?.find(
      (asset) =>
        asset.src === (cover?.kind === 'image' ? cover.uri : '') ||
        images.uris.get(asset.src) === (cover?.kind === 'image' ? cover.uri : '')
    );
    const coverUri =
      cover?.kind === 'image' &&
      !images.pending.has(cover.uri) &&
      (!coverMetadata || images.uris.has(coverMetadata.src))
        ? cover.uri
        : undefined;
    const renderText = (partKey: string, content: string) => {
      const blocks = groupBlockImages(splitBlockImages(content));
      return blocks.map((block) => {
        if (block.kind === 'images') {
          const shown = block.images.filter((image) => image.uri !== coverUri);
          if (shown.length === 0) return null;
          if (shown.length === 1) {
            const image = shown[0]!;
            const metadata = imageAssets?.find(
              (asset) => asset.src === image.uri || images.uris.get(asset.src) === image.uri
            );
            if (metadata && metadata.mime.startsWith('image/'))
              return (
                <GatewayImageThumbnail
                  key={`${partKey}:${image.start}:${metadata.asset_id}`}
                  asset={metadata}
                  label={image.alt || t`Image`}
                  block
                  sourceOverride={images.sources.get(metadata.src) ?? null}
                  onPreview={(opened) => openGatewayPreview(opened, [metadata])}
                />
              );
            if (audioSessionId && isHostPathSource(image.uri))
              return (
                <InlineFileLink
                  key={`${partKey}:${image.start}`}
                  asid={audioSessionId}
                  file={{ uri: image.uri, name: image.alt || t`Image` }}
                />
              );
            return (
              <TranscriptBlockImage
                key={`${partKey}:${image.start}:${image.uri}`}
                uri={image.uri}
                alt={image.alt}
                headers={metadata ? images.headers : undefined}
                pending={images.pending.has(image.uri)}
                width={metadata?.width}
                height={metadata?.height}
                onPress={
                  onPreviewImage
                    ? (uri) =>
                        onPreviewImage(
                          uri,
                          shown.map((entry) => entry.uri)
                        )
                    : undefined
                }
              />
            );
          }
          return (
            <ImageAlbum
              asid={audioSessionId}
              key={`${partKey}:${shown[0]!.start}`}
              images={shown.map((image) => ({
                uri: image.uri,
                alt: image.alt,
                pending: images.pending.has(image.uri),
                asset: imageAssets?.find(
                  (asset) => asset.src === image.uri || images.uris.get(asset.src) === image.uri
                ),
                source:
                  images.sources.get(
                    imageAssets?.find(
                      (asset) => asset.src === image.uri || images.uris.get(asset.src) === image.uri
                    )?.src ?? ''
                  ) ?? null,
                headers: imageAssets?.some((asset) => images.uris.get(asset.src) === image.uri)
                  ? images.headers
                  : undefined,
              }))}
            />
          );
        }
        if (!block.text.trim()) return null;
        return (
          <BoundedMarkdown
            key={`${partKey}:${block.start}`}
            markdown={block.text}
            markdownStyle={markdownStyle}
            containerStyle={styles.markdownContainer}
            latexMath
            streaming={streaming}
            onImagePress={(uri: string) => previewMessageImage(uri)}
          />
        );
      });
    };
    if (!audioSessionId || !parts.some((part) => part.kind !== 'markdown'))
      return renderText(key, markdown);
    return (
      <View key={key} style={styles.markdownSegments}>
        {parts.map((part) =>
          part.kind === 'video' ? (
            <InlineVideoFile
              key={part.start}
              asid={audioSessionId}
              file={{ uri: part.uri, name: part.name }}
              poster={
                coverUri
                  ? {
                      uri: coverUri,
                      ...(coverMetadata && images.headers ? { headers: images.headers } : {}),
                    }
                  : undefined
              }
            />
          ) : part.kind === 'file' ? (
            <InlineFileLink
              key={part.start}
              asid={audioSessionId}
              file={{ uri: part.uri, name: part.name }}
              imageAsset={messageImageForSource(imageAssets, part.uri)}
              imageSource={images.sources.get(part.uri) ?? null}
            />
          ) : part.kind === 'audio' ? (
            <InlineAudioFile
              key={part.start}
              asid={audioSessionId}
              file={{ uri: part.uri, name: part.name }}
            />
          ) : part.kind === 'theme' ? (
            <ThemeFencePreview key={part.start} source={part.source} />
          ) : (
            renderText(`${key}:${part.start}`, part.text)
          )
        )}
      </View>
    );
  };

  // Keep the same parent and offset keys when a streamed diff fence closes.
  // Reparenting the preceding Markdown would discard its native measurement.
  const files = (imageAssets ?? []).filter(
    (asset) => !asset.unavailable_reason && !asset.mime.startsWith('image/')
  );
  return (
    <View style={styles.markdownSegments}>
      {segments.map((seg) =>
        seg.kind === 'md' ? (
          <Fragment key={seg.start}>{renderMarkdown(`md:${seg.start}`, seg.text)}</Fragment>
        ) : (
          <InlinePatch key={seg.start} patch={seg.text} />
        )
      )}
      {files.map((asset) => (
        <PressableScale
          key={asset.asset_id}
          accessibilityRole="button"
          accessibilityLabel={t`Download ${asset.src.split('/').pop() ?? asset.src}`}
          onPress={() =>
            onOpenFile?.({
              uri: asset.src.startsWith('file://') ? asset.src : `file://${asset.src}`,
              mime: asset.mime,
              name: asset.src.split('/').pop(),
            })
          }
          style={styles.fileRow}>
          <Text variant="bodySmall" numberOfLines={1}>
            {asset.src.split('/').pop() ?? asset.src}
          </Text>
        </PressableScale>
      ))}
      {preview ? (
        <ImagePreviewModal
          images={preview.images}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
});

function ImageAlbum({
  asid,
  images,
  attachmentSources = false,
}: {
  asid?: string;
  images: {
    uri: string;
    alt: string;
    pending: boolean;
    headers?: Record<string, string>;
    asset?: MessageImageAsset;
    source?: PreviewImageSource | null;
  }[];
  attachmentSources?: boolean;
}) {
  const [width, setWidth] = useState(0);
  const [sourceOwner] = useState(() => ({
    serverId: configuredGatewayServerId(),
    connectionKey: gatewayImageConnectionKey(),
  }));
  const [preview, setPreview] = useState<{
    images: PreviewImageDescriptor[];
    index: number;
  } | null>(null);
  const columns = images.length === 2 ? 2 : 3;
  const cellWidth = Math.floor((width - 6 * (columns - 1)) / columns);
  const open = (selected: number, opened?: PreviewImageDescriptor) => {
    if (
      sourceOwner.serverId !== configuredGatewayServerId() ||
      sourceOwner.connectionKey !== gatewayImageConnectionKey()
    )
      return;
    const album = images.flatMap((image, index) => {
      const descriptor = image.asset ? gatewayImageBinding(image.asset)?.image : undefined;
      if (image.asset && !descriptor) return [];
      const raw = descriptor
        ? null
        : rawAlbumImage(image.uri, attachmentSources, [Paths.cache.uri, Paths.document.uri]);
      if (!descriptor && !raw) return [];
      const uploadName = raw?.uploadName;
      return [
        {
          index,
          image:
            index === selected && opened
              ? opened
              : (descriptor ?? {
                  id: image.uri,
                  uri: image.uri,
                  headers: image.headers,
                  ...(uploadName
                    ? {
                        resolveSource: (signal: AbortSignal) =>
                          readUploadImageSource(uploadName, { signal, owner: sourceOwner }),
                      }
                    : {}),
                }),
        },
      ];
    });
    const index = album.findIndex((entry) => entry.index === selected);
    if (index >= 0) setPreview({ images: album.map((entry) => entry.image), index });
  };
  return (
    <View
      testID={`message-image-album-${columns}-columns`}
      style={styles.album}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0
        ? images.map((image, index) => (
            <View key={`${image.uri}:${index}`} style={{ width: cellWidth }}>
              {image.asset ? (
                <GatewayImageThumbnail
                  asset={image.asset}
                  label={image.alt || image.asset.src}
                  block
                  sourceOverride={image.source}
                  onPreview={(opened) => open(index, opened)}
                />
              ) : attachmentSources ? (
                <AttachmentImage
                  uri={image.uri}
                  label={image.alt}
                  onPreviewImage={() => open(index)}
                />
              ) : asid && isHostPathSource(image.uri) ? (
                <InlineFileLink
                  asid={asid}
                  file={{
                    uri: image.uri,
                    name: image.alt || image.uri.split('/').pop() || image.uri,
                  }}
                />
              ) : (
                <TranscriptBlockImage
                  uri={image.uri}
                  alt={image.alt}
                  headers={image.headers}
                  pending={image.pending}
                  onPress={() => open(index)}
                />
              )}
            </View>
          ))
        : null}
      {preview ? (
        <ImagePreviewModal
          images={preview.images}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </View>
  );
}

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
    streaming?: boolean;
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
          role={item.role}
          markdownStyle={options.markdownStyle}
          audioSessionId={options.actions.audioSessionId}
          streaming={options.streaming}
          {...(item.image_assets ? { imageAssets: item.image_assets } : {})}
          {...(options.actions.onPreviewImage
            ? { onPreviewImage: options.actions.onPreviewImage }
            : {})}
          {...(options.actions.onOpenFile ? { onOpenFile: options.actions.onOpenFile } : {})}
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
  const childSession = part.child_session_id
    ? actions.childSessions?.[part.child_session_id]
    : undefined;
  const openToolDetail = actions.onOpenToolDetail;
  const expandTool = actions.onExpandTool;
  const handleExpand = useMemo(
    () => (expandTool ? (header: ViewInstance) => expandTool(part.id, header) : undefined),
    [expandTool, part.id]
  );
  const handleOpenDetail = useMemo(
    () => (openToolDetail ? () => openToolDetail(part) : undefined),
    [openToolDetail, part]
  );

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
        audioSessionId={actions.audioSessionId}
        part={part}
        markdownStyle={markdownStyle}
        {...(childSession ? { childSession } : {})}
        {...(actions.onOpenChildSession ? { onOpenChildSession: actions.onOpenChildSession } : {})}
        {...(handleRunInBackground ? { onRunInBackground: handleRunInBackground } : {})}
        {...(actions.onOpenBackgroundTray
          ? { onOpenBackgroundTray: actions.onOpenBackgroundTray }
          : {})}
        {...(actions.onPreviewImage ? { onPreviewImage: actions.onPreviewImage } : {})}
        {...(actions.onOpenFile ? { onOpenFile: actions.onOpenFile } : {})}
        {...(actions.onOpenFullDiff ? { onOpenFullDiff: actions.onOpenFullDiff } : {})}
        {...(handleOpenDetail ? { onOpenDetail: handleOpenDetail } : {})}
        onExpand={handleExpand}
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
        <View style={styles.marker}>
          <StackIcon size={13} color={theme.colors.textMuted} />
        </View>
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
        <DoneIcon size={12} color={theme.colors.success} />
        <Animated.View style={chevronStyle}>
          <DisclosureDownIcon size={12} color={theme.colors.textMuted} />
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
  onSendQueued,
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
  onSendQueued?: (itemId: string) => void;
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
  // A queued prompt rises in; a message that has only just arrived -- the
  // delivered prompt taking its queued row's place -- fades in. History the
  // list mounts while scrolling is older than that and is simply there.
  const [arrival] = useState(() =>
    readOnly
      ? undefined
      : queued
        ? riseIn()
        : first && Date.now() - first.updated_ms < FRESH_ROW_MS
          ? fadeIn('short')
          : undefined
  );
  const goalSummary = useMemo(
    () =>
      group.items.every((item) => item.part.type === 'text') ? goalContinuationSummary(text) : null,
    [group.items, text]
  );
  const entries = useMemo(() => buildTimelineEntries(group.items), [group.items]);
  const wideMedia =
    imagesInAttachments(
      attachments,
      group.items.flatMap((item) => item.image_assets ?? []),
      queued?.attachment_files
    ) > 1 ||
    group.items.some((item) => messageNeedsMediaWidth(item, actions.audioSessionId)) ||
    attachments.some((uri, index) =>
      videoFileMime({ uri, name: queued?.attachment_files?.[index]?.name })
    );
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
        Icon: CopyIcon,
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
        Icon: RestoreIcon,
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
    <Animated.View entering={arrival}>
      <MessageContainer
        testID={`user-message-${first?.id ?? group.key}`}
        accessibilityLabel={t`Your message`}
        onLongPress={goalSummary ? undefined : openMessageMenu}
        delayLongPress={260}
        style={[
          styles.messageBlock,
          !wideMedia && styles.contentPlate,
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
            <View style={styles.queuedControls}>
              <View style={styles.queuedPill}>
                <TimeIcon size={11} color={theme.colors.warning} />
                <Text
                  variant="caption"
                  weight="semibold"
                  color={theme.colors.warning}
                  style={styles.queuedPillText}>
                  {queued.inbox?.delivery === 'steer' ? <Trans>Next</Trans> : <Trans>Queued</Trans>}
                </Text>
              </View>
              {!readOnly ? (
                <>
                  {onSendQueued && queued.inbox?.delivery !== 'steer' ? (
                    <PressableScale
                      testID={`queued-send-${queued.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={t`Send now`}
                      onPress={() => onSendQueued(queued.id)}
                      style={styles.queuedActionBtn}>
                      <QuickActionIcon size={13} color={theme.colors.primary} />
                    </PressableScale>
                  ) : null}
                  {/* Editing returns the text to the draft; files cannot follow
                    it there, so a prompt that carries them is only cancelled. */}
                  {attachments.length === 0 ? (
                    <PressableScale
                      testID={`queued-edit-${queued.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={t`Edit queued message`}
                      onPress={() => onEditQueued(queued.id, text)}
                      style={styles.queuedActionBtn}>
                      <EditIcon size={13} color={theme.colors.primary} />
                    </PressableScale>
                  ) : null}
                  <PressableScale
                    testID={`queued-cancel-${queued.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t`Cancel queued message`}
                    onPress={() => onCancelQueued(queued.id)}
                    style={styles.queuedActionBtn}>
                    <DeleteIcon size={13} color={theme.colors.danger} />
                  </PressableScale>
                </>
              ) : null}
            </View>
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
              <DisclosureDownIcon
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
          <MessageAttachments
            attachments={attachments}
            imageAssets={group.items.flatMap((item) => item.image_assets ?? [])}
            files={queued?.attachment_files}
            onPreviewImage={onPreviewImage}
            asid={actions.audioSessionId}
          />
        ) : null}

        {menuOpen ? (
          <AgentActionMenu
            testID={`user-message-menu-${first?.id ?? group.key}`}
            surface="ground"
            items={menuItems}
          />
        ) : null}
      </MessageContainer>
    </Animated.View>
  );
});

function AgentGenerationFooter({
  messageId,
  tokensPerSecond,
}: {
  messageId: string;
  tokensPerSecond: number;
}) {
  const theme = useThemeTokens();
  return (
    <View style={styles.generationFooter}>
      <Text
        testID={`agent-generation-speed-${messageId}`}
        variant="caption"
        color={theme.colors.textMuted}>
        {tokensPerSecond.toFixed(1)} tok/s
      </Text>
    </View>
  );
}

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
  streamingItemId,
  actions = NO_TOOL_ACTIONS,
  readOnly = false,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  reasoningLive?: boolean;
  /** Exact live part identity; earlier text in the same message stays settled. */
  streamingItemId?: string;
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
  let runHasOnlyAudio = true;
  let runNeedsMediaWidth = false;
  const flush = () => {
    if (run.length === 0) return;
    rows.push(
      <View
        key={`run:${runKey}`}
        style={
          runHasOnlyAudio
            ? styles.standaloneRow
            : [styles.messageBlock, !runNeedsMediaWidth && styles.contentPlate, plate]
        }>
        {run}
      </View>
    );
    run = [];
    runHasOnlyAudio = true;
    runNeedsMediaWidth = false;
  };
  displayEntries.forEach((displayEntry) => {
    if (displayEntry.kind === 'tool-group') {
      flush();
      rows.push(
        <View key={displayEntry.key} style={styles.toolRow}>
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
      streaming: entry.item.id === streamingItemId,
    });
    if (drawn === null) return;
    if (STANDALONE_PART_TYPES.has(entry.item.part.type)) {
      flush();
      rows.push(
        <View
          key={`row:${entry.item.id}`}
          style={
            entry.item.part.type === 'tool' || entry.item.part.type === 'shell'
              ? styles.toolRow
              : styles.standaloneRow
          }>
          {drawn}
        </View>
      );
      return;
    }
    if (run.length === 0) runKey = entry.item.id;
    runNeedsMediaWidth =
      runNeedsMediaWidth || messageNeedsMediaWidth(entry.item, actions.audioSessionId);
    const audioParts =
      entry.item.part.type === 'text' && actions.audioSessionId
        ? splitAudioMarkdown(entry.item.part.text)
        : [];
    runHasOnlyAudio =
      runHasOnlyAudio &&
      audioParts.some((part) => part.kind === 'audio') &&
      audioParts.every((part) =>
        part.kind === 'markdown' ? !part.text.trim() : part.kind === 'audio'
      );
    run.push(<Fragment key={entry.item.id}>{drawn}</Fragment>);
  });
  flush();

  if (rows.length === 0) return null;
  const generationItem =
    group.role === 'assistant' && !streamingItemId && !reasoningLive
      ? group.items.findLast((item) => item.generation !== undefined)
      : undefined;
  return (
    <>
      {rows}
      {generationItem?.generation ? (
        <AgentGenerationFooter
          messageId={generationItem.message_id}
          tokensPerSecond={generationItem.generation.tokens_per_second}
        />
      ) : null}
    </>
  );
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
 * The general gap for prose, thoughts and notices, whether they belong to the
 * same message or not. Tool rows already reserve a 44dp transparent touch
 * boundary and omit this additional margin; expanded tool bodies keep their
 * own trailing separation.
 *
 * Each ordinary row carries half above and half below -- it used to have ten points above and twenty
 * below, because the list put its own gap between messages on top of the
 * rows' own margins. The list's gap is zero now; this is the only spacing.
 */
export const TRANSCRIPT_ROW_GAP = TRANSCRIPT_GRID.rowGap;

const styles = StyleSheet.create({
  /** Base plate spacing; ordinary message prose overrides the full width below. */
  messageBlock: {
    alignSelf: 'stretch',
    width: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
    paddingVertical: TRANSCRIPT_GRID.plateInsetY,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    gap: 6,
  },
  // Native Markdown measures its intrinsic width under this maximum. Keep the
  // full-width row styles for tools, thoughts and compaction disclosures.
  contentPlate: {
    alignSelf: 'flex-start',
    width: 'auto',
    maxWidth: '100%',
  },
  generationFooter: {
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    paddingBottom: TRANSCRIPT_ROW_GAP / 2,
  },
  userBlock: {
    borderLeftWidth: 2,
    // Keep the text aligned with assistant prose despite the role marker.
    paddingLeft: TRANSCRIPT_GRID.inset - 2,
  },
  // A thought row spans the message: the pill hugs itself inside it, and the
  // expanded plate takes the full width. A row that hugged its content was
  // only as wide as the pill on iOS, where the markdown under `flex: 1`
  // brings no width of its own, so the reasoning wrapped a word per line.
  thoughtRow: {
    alignSelf: 'stretch',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
  },
  standaloneRow: {
    alignSelf: 'stretch',
    width: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
  },
  toolRow: {
    alignSelf: 'stretch',
    width: '100%',
  },
  toolGroup: { gap: TRANSCRIPT_ROW_GAP },
  toolGroupHeader: {
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    flexDirection: 'row',
    alignItems: 'center',
    gap: TRANSCRIPT_GRID.markerGap,
  },
  /** The grid's marker column: icons of any width share one centre. */
  marker: { width: TRANSCRIPT_GRID.markerWidth, alignItems: 'center' },
  toolGroupCopy: { flex: 1, minWidth: 0, gap: 1 },
  toolGroupNames: { fontSize: AGENT_TYPE.micro.size },
  toolGroupItems: { gap: 0 },
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
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  roleLabel: {
    fontSize: AGENT_TYPE.meta.size,
  },
  roleStamp: {
    fontSize: AGENT_TYPE.micro.size,
    // Never shrinks: "just now" is not allowed to become "just".
    flexShrink: 0,
  },
  queuedControls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
    maxWidth: '100%',
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
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
  // In the marker column, level with the first line (11pt glyph, 14pt line).
  noticeIcon: { width: TRANSCRIPT_GRID.markerWidth, alignItems: 'center', paddingTop: 3 },
  // Shrinks, never grows: inside a plate that hugs its content a `flex: 1`
  // column measures to nothing and the row collapses to its icon.
  noticeCopy: { flexShrink: 1, minWidth: 0, gap: 2 },
  noticeBlock: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    marginVertical: TRANSCRIPT_ROW_GAP / 2,
    paddingVertical: 8,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
  },
  // Closed, the plate hugs its two lines; open, it is a document and takes
  // the row's full width like every other block that holds prose.
  noticeOpen: { alignSelf: 'stretch' },
  // Hangs off the icon like the line that opened it.
  noticeBody: {
    marginTop: TRANSCRIPT_GRID.attachGap,
    marginLeft: TRANSCRIPT_HANG,
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TRANSCRIPT_GRID.markerGap,
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
  album: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignSelf: 'stretch',
    width: '100%',
  },
  fileRow: {
    alignSelf: 'stretch',
    paddingVertical: 8,
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
