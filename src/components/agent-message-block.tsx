import { memo, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { ChevronDown, Clock, Edit3, FileDiff, FileText, Trash2 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { AgentReasoningBlock } from '@/components/agent-reasoning-block';
import { AgentTodoBlock } from '@/components/agent-todo-block';
import { EmbeddedTerminalToolBlock } from '@/components/embedded-terminal-tool-block';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { fadeIn, timing } from '@/lib/motion';
import { isSafeExternalLink } from '@/lib/safe-link';
import { keyedLines, type KeyedLine } from '@/lib/line-keys';
import type { TimelineItem } from '@/lib/agent-session';
import type { TimelineRenderGroup } from '@/lib/agent-timeline-groups';

const IMAGE_DATA_URI_PREFIX = 'data:image/';
function isImageAttachment(uri: string): boolean {
  return uri.startsWith(IMAGE_DATA_URI_PREFIX) || /\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i.test(uri);
}

export const AgentUserMessage = memo(function AgentUserMessage({
  item,
  onPreviewImage,
  onEditQueued,
  onCancelQueued,
}: {
  item: TimelineItem;
  onPreviewImage: (uri: string) => void;
  onEditQueued: (itemId: string, text: string) => void;
  onCancelQueued: (itemId: string) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const surfaceBackground = useSurfaceBackground();
  const colors = usePaneChatColors();

  const text = item.part.type === 'text' ? item.part.text : '';
  const attachments = item.attachments ?? [];

  return (
    <View style={styles.userBubbleRow}>
      <Pressable
        testID={`user-bubble-${item.id}`}
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
          styles.userBubble,
          {
            backgroundColor: surfaceBackground(colors.bubble),
            borderColor: colors.accent,
          },
          item.queued
            ? {
                borderStyle: 'dashed',
                borderWidth: 1.5,
                borderColor: colors.accent,
              }
            : null,
        ]}>
        {/* Queued indicator and actions: only allowed for queued messages */}
        {item.queued ? (
          <View style={styles.queuedBadgeRow}>
            <View
              style={[styles.queuedPill, { backgroundColor: surfaceBackground(colors.bubble) }]}>
              <Clock size={11} color={theme.colors.primary} />
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
                style={styles.queuedPillText}>
                <Trans>Queued</Trans>
              </Text>
            </View>
            <View style={styles.queuedActions}>
              <PressableScale
                testID={`queued-edit-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t`Edit queued message`}
                onPress={() => onEditQueued(item.id, text)}
                style={styles.queuedActionBtn}>
                <Edit3 size={13} color={theme.colors.primary} />
              </PressableScale>
              <PressableScale
                testID={`queued-cancel-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={t`Cancel queued message`}
                onPress={() => onCancelQueued(item.id)}
                style={styles.queuedActionBtn}>
                <Trash2 size={13} color={theme.colors.danger} />
              </PressableScale>
            </View>
          </View>
        ) : null}

        {/* Attachment Preview Chips / Images */}
        {attachments.length > 0 ? (
          <View style={styles.bubbleAttachmentsGrid}>
            {attachments.map((att, attIdx) => {
              if (isImageAttachment(att)) {
                return (
                  <PressableScale
                    key={`${att}-${attIdx}`}
                    onPress={() => onPreviewImage(att)}
                    style={styles.bubbleImageWrapper}>
                    <Image
                      source={{ uri: att }}
                      style={styles.bubbleImageThumbnail}
                      contentFit="cover"
                    />
                  </PressableScale>
                );
              }
              const fileName = att.split('/').filter(Boolean).pop() || t`Attachment`;
              return (
                <View
                  key={`${att}-${attIdx}`}
                  style={[
                    styles.bubbleFileChip,
                    {
                      backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      borderColor: theme.colors.border,
                    },
                  ]}>
                  <FileText size={13} color={theme.colors.primary} />
                  <Text
                    variant="caption"
                    color={theme.colors.text}
                    numberOfLines={1}
                    style={styles.bubbleFileName}>
                    {fileName}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {text ? (
          <Text selectable variant="bodySmall" color={theme.colors.text}>
            {text}
          </Text>
        ) : null}
      </Pressable>
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
 * Patch lines, never wrapped and coloured by their marker in the terminal's
 * red and green. Shared by the `diff` part and by `diff` fences inside an
 * assistant's markdown.
 */
const DiffPatchLines = memo(function DiffPatchLines({ lines }: { lines: KeyedLine[] }) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.inlineDiffScroll}>
      <View style={styles.inlineDiffBody}>
        {lines.map(({ line, key }) => {
          const marker = line.charAt(0);
          const added = marker === '+';
          const removed = marker === '-';
          const hunk = marker === '@';
          return (
            <Text
              key={key}
              selectable
              style={[
                styles.diffLine,
                {
                  color: added
                    ? colors.added
                    : removed
                      ? colors.removed
                      : hunk
                        ? theme.colors.primary
                        : colors.muted,
                  backgroundColor: added
                    ? colors.addedBackground
                    : removed
                      ? colors.removedBackground
                      : 'transparent',
                  fontStyle: hunk ? 'italic' : undefined,
                },
              ]}>
              {line || ' '}
            </Text>
          );
        })}
      </View>
    </ScrollView>
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

  const keyedDiffLines = useMemo(() => keyedLines(diff), [diff]);
  const lines = useMemo(() => keyedDiffLines.map((l) => l.line), [keyedDiffLines]);
  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
    return { added, removed };
  }, [lines]);

  // Long patches are shown whole — no silent truncation — with the patch rows'
  // own horizontal scroll ready for over-long lines.
  const shown = keyedDiffLines;

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
          <DiffPatchLines lines={shown} />
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
          <DiffPatchLines key={`diff-${segIdx}`} lines={keyedLines(seg.text)} />
        )
      )}
    </View>
  );
});

/**
 * One assistant or system message, laid out the way OpenCode's own output is:
 * every part in order inside a single card — the reasoning as short collapsed
 * `Thought · Xs` rows, the tool calls as quiet single-line shells, the file
 * diffs, and finally the text the thinking produced.
 */
export const AgentAssistantMessage = memo(function AgentAssistantMessage({
  group,
  showReasoning,
  markdownStyle,
}: {
  group: TimelineRenderGroup;
  showReasoning: boolean;
  markdownStyle: MarkdownStyle;
}) {
  const theme = useThemeTokens();

  // The parts this message actually paints, in order. `showReasoning` hides
  // the model's private reasoning the same way it did for the flat list.
  const visibleItems = useMemo(
    () =>
      group.items.filter((it) => {
        switch (it.part.type) {
          case 'reasoning':
            return showReasoning;
          case 'text':
          case 'tool':
          case 'diff':
          case 'todo':
          case 'status':
            return true;
          default:
            return false;
        }
      }),
    [group.items, showReasoning]
  );

  if (visibleItems.length === 0) return null;

  return (
    <View style={styles.messageCard}>
      {visibleItems.map((it, index) => {
        switch (it.part.type) {
          case 'reasoning':
            return (
              <AgentReasoningBlock
                key={it.id}
                text={it.part.text}
                durationMs={it.part.duration_ms}
              />
            );
          case 'tool':
            return (
              <EmbeddedTerminalToolBlock
                key={it.id}
                toolId={it.part.id}
                toolName={it.part.name}
                input={it.part.input}
                output={it.part.output}
                status={it.part.state}
              />
            );
          case 'diff':
            return <AgentDiffBlock key={it.id} file={it.part.file} diff={it.part.diff} />;
          case 'todo':
            return <AgentTodoBlock key={it.id} items={it.part.items} />;
          case 'status':
            return (
              <View key={it.id} style={styles.statusRow}>
                <Text variant="caption" color={theme.colors.textSubtle} style={styles.statusText}>
                  • {it.part.text}
                </Text>
              </View>
            );
          case 'text': {
            const prevItem = index > 0 ? visibleItems[index - 1] : group.prevItem;
            return (
              <MessageTextPart
                key={it.id}
                text={it.part.text}
                prevTool={prevItem && prevItem.part.type === 'tool' ? prevItem : undefined}
                markdownStyle={markdownStyle}
              />
            );
          }
          default:
            return null;
        }
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  userBubbleRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginVertical: 4,
  },
  userBubble: {
    maxWidth: '85%',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleAttachmentsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  bubbleImageWrapper: {
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  bubbleImageThumbnail: {
    width: 160,
    height: 110,
    borderRadius: 14,
  },
  bubbleFileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
  },
  bubbleFileName: {
    fontSize: 12,
    flexShrink: 1,
  },
  queuedBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
    gap: 8,
  },
  queuedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  queuedPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  queuedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  queuedActionBtn: {
    padding: 3,
  },
  messageCard: {
    marginVertical: 4,
    width: '100%',
    alignSelf: 'stretch',
    gap: 6,
  },
  markdownContainer: {
    alignSelf: 'stretch',
  },
  markdownSegments: {
    gap: 6,
    alignSelf: 'stretch',
  },
  inlineDiffScroll: {
    maxWidth: '100%',
  },
  inlineDiffBody: {
    paddingVertical: 2,
  },
  activitySection: {
    marginBottom: 6,
  },
  activityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  activityChevron: {
    opacity: 0.75,
  },
  activityBody: {
    marginTop: 4,
    gap: 2,
  },
  statusRow: {
    paddingVertical: 2,
    paddingHorizontal: 4,
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
    marginVertical: 4,
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
  diffLine: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 17,
  },
});
