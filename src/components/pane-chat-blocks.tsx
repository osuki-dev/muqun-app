import { Trans, useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react-native';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';
import { memo, useMemo } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';

import { createMarkdownStyle } from '@/components/agent-markdown-output';
import { PressableScale } from '@/components/pressable-scale';
import { firstLine, type PaneChatItem, type PaneChatToolBlock } from '@/lib/pane-chat';
import type { PanePart, PanePartStatus } from '@/lib/pane-parts';
import { isSafeExternalLink } from '@/lib/safe-link';
import { useTerminalTheme } from '@/hooks/use-theme-pack';

/**
 * The rows of the chat view.
 *
 * Every export here is memoized and takes only stable props, because that is
 * the other half of the deal `pane-chat.ts` makes: it keeps a row's item object
 * identical when the row's content has not moved, and these components turn
 * that identity into a skipped render. Pass a fresh object or an inline arrow
 * into any of them and a streaming pane re-renders its whole transcript.
 *
 * The last case of `PaneChatPartRow` carries the rule the parts contract is
 * built on: a part this build has no renderer for is shown as its
 * `fallback_text`, so an unknown type costs formatting, never content.
 */
export interface PaneChatColors {
  text: string;
  muted: string;
  subtle: string;
  border: string;
  surface: string;
  surfaceRaised: string;
  accent: string;
  bubble: string;
  added: string;
  addedBackground: string;
  removed: string;
  removedBackground: string;
  status: Record<PanePartStatus, string>;
}

export function usePaneChatColors(): PaneChatColors {
  const theme = useThemeTokens();
  const terminal = useTerminalTheme();
  return useMemo<PaneChatColors>(() => {
    // Diffs borrow the terminal's own red and green so the same change reads
    // the same in either view; the tints are those colours at low alpha.
    const removed = terminal.ansi[1] ?? theme.colors.danger;
    const added = terminal.ansi[2] ?? theme.colors.success;
    return {
      text: theme.colors.text,
      muted: theme.colors.textMuted,
      subtle: theme.colors.textSubtle,
      border: theme.colors.border,
      surface: theme.colors.surface,
      surfaceRaised: theme.colors.surfaceRaised,
      accent: theme.colors.primary,
      // The user's own bubble. Tinted rather than filled: a solid accent block
      // behind a long paste is a wall, and the prompt is read as often as the
      // reply is.
      bubble: withAlpha(theme.colors.primary, 0.16),
      added,
      addedBackground: withAlpha(added, 0.14),
      removed,
      removedBackground: withAlpha(removed, 0.14),
      status: {
        ok: theme.colors.success,
        error: theme.colors.danger,
        running: theme.colors.warning,
      },
    };
  }, [terminal, theme.colors]);
}

/**
 * The transcript's markdown style: the shared one, with the horizontal rule
 * taken out of it.
 *
 * `pane-chat.ts` swallows the rules an agent *drew*, but it only ever sees a
 * part as a whole; a `---` sitting inside a paragraph that is otherwise real
 * prose belongs to commonmark, and commonmark hands it to the renderer as a
 * `thematicBreak`. In a document that is a divider the author meant. In a
 * scraped CLI transcript it is the same chrome by another route -- and an
 * expensive one, since the default rule carries 24 points of margin above it
 * and 12 below, which is what turned a page of them into the screen of
 * hairlines this was reported as. Zero height, zero margin, no colour: the
 * break still parses, it just stops drawing.
 *
 * Scoped to the chat view on purpose. `createMarkdownStyle` is also what the
 * asset viewer reads documents with, and there a rule is content.
 */
export function usePaneChatMarkdownStyle(): MarkdownStyle {
  const theme = useThemeTokens();
  return useMemo(() => {
    const base = createMarkdownStyle(theme.colors);
    return {
      ...base,
      thematicBreak: { color: 'transparent', height: 0, marginTop: 0, marginBottom: 0 },
    };
  }, [theme.colors]);
}

/** What the user said, on the right, as a bubble. */
export const PaneChatPromptRow = memo(function PaneChatPromptRow({
  text,
  colors,
}: {
  text: string;
  colors: PaneChatColors;
}) {
  return (
    <View style={styles.promptAlign}>
      <View style={[styles.promptBubble, { backgroundColor: colors.bubble }]}>
        <Text variant="bodySmall" selectable color={colors.text}>
          {text}
        </Text>
      </View>
    </View>
  );
});

/**
 * A heading the pane drew out of rule characters, with the rule taken off it.
 *
 * Deliberately the quietest row in the list. What the agent drew was a full
 * width line with a few words in the middle of it, and the words are the only
 * part of that worth keeping -- so they are kept at caption size in the subtle
 * colour, closer to a paragraph break than to a title. Anything louder and the
 * transcript's own section headings start competing with what the agent said.
 */
export const PaneChatLabelRow = memo(function PaneChatLabelRow({
  text,
  colors,
}: {
  text: string;
  colors: PaneChatColors;
}) {
  return (
    <View style={[styles.agentAlign, styles.label]}>
      <Text variant="caption" color={colors.subtle} numberOfLines={2} style={styles.labelText}>
        {text}
      </Text>
    </View>
  );
});

/**
 * A run of tool calls, folded into one line. Collapsed it renders nothing but
 * its own summary -- no card, no output, no measuring of text that is not on
 * screen -- which is what makes the simplified view cheap as well as quiet.
 */
export const PaneChatActivityRow = memo(function PaneChatActivityRow({
  item,
  colors,
  expanded,
  onToggle,
}: {
  item: Extract<PaneChatItem, { kind: 'activity' }>;
  colors: PaneChatColors;
  expanded: boolean;
  onToggle: (id: string) => void;
}) {
  const { t } = useLingui();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <View style={styles.agentAlign}>
      <PressableScale
        accessibilityLabel={expanded ? t`Hide ${item.summary}` : t`Show ${item.summary}`}
        feedback="selection"
        pressedScale={0.99}
        onPress={() => onToggle(item.id)}
        style={styles.activityChip}>
        {item.status === 'running' ? (
          <ActivityIndicator size="small" color={colors.status.running} />
        ) : (
          <View style={[styles.statusDot, { backgroundColor: colors.status[item.status] }]} />
        )}
        <Text variant="caption" color={colors.muted} numberOfLines={1} style={styles.flexOne}>
          {item.summary}
        </Text>
        <Chevron size={14} color={colors.subtle} />
      </PressableScale>

      {expanded ? (
        <View style={styles.activityBody}>
          {item.steps.map((step) =>
            step.type === 'tool-block' ? (
              <PaneChatToolCard key={step.id} block={step} colors={colors} open />
            ) : step.type === 'diff' ? (
              <DiffRow key={step.id} part={step} colors={colors} />
            ) : (
              <TodoCard key={step.id} part={step} colors={colors} />
            )
          )}
        </View>
      ) : null}
    </View>
  );
});

/** One part of the transcript that is not the user speaking. */
export const PaneChatPartRow = memo(function PaneChatPartRow({
  part,
  colors,
  markdownStyle,
  expanded,
  onToggle,
  onOpenAsset,
}: {
  part: PanePart;
  colors: PaneChatColors;
  markdownStyle: MarkdownStyle;
  expanded: boolean;
  onToggle: (id: string) => void;
  onOpenAsset?: (assetId: string) => void;
}) {
  const { t } = useLingui();
  switch (part.type) {
    case 'text':
      return (
        <View style={styles.agentAlign}>
          <EnrichedMarkdownText
            flavor="commonmark"
            markdown={part.markdown}
            markdownStyle={markdownStyle}
            containerStyle={styles.markdown}
            selectable
            selectionColor={colors.accent}
            selectionHandleColor={colors.accent}
            streamingAnimation={false}
            textBreakStrategy="simple"
            md4cFlags={{ latexMath: true }}
            onLinkPress={({ url }) => {
              if (isSafeExternalLink(url)) void Linking.openURL(url);
            }}
          />
        </View>
      );

    case 'tool-block':
      return (
        <View style={styles.agentAlign}>
          <PaneChatToolCard block={part} colors={colors} open={expanded} onToggle={onToggle} />
        </View>
      );

    case 'todo':
      return <TodoCard part={part} colors={colors} />;

    case 'diff':
      return <DiffRow part={part} colors={colors} />;

    case 'table':
      return <TableRow part={part} colors={colors} />;

    case 'status':
      return (
        <View style={[styles.statusRow, styles.agentAlign]}>
          {part.spinner ? <ActivityIndicator size="small" color={colors.muted} /> : null}
          <Text variant="caption" color={colors.muted} style={styles.flexOne} numberOfLines={2}>
            {part.text}
          </Text>
        </View>
      );

    case 'prompt':
      // Reachable only in the unusual case of a prompt part arriving where the
      // model did not group it; drawn as the user bubble it is either way.
      return <PaneChatPromptRow text={part.text} colors={colors} />;

    case 'asset-ref':
      return (
        <PressableScale
          accessibilityLabel={t`Open ${part.fallback_text || part.asset_id}`}
          disabled={!onOpenAsset}
          onPress={() => onOpenAsset?.(part.asset_id)}
          style={[styles.assetCard, styles.agentAlign, { backgroundColor: colors.surfaceRaised }]}>
          <FileText size={17} color={colors.accent} />
          <Text variant="bodySmall" color={colors.text} numberOfLines={2} style={styles.flexOne}>
            {part.fallback_text || part.asset_id}
          </Text>
        </PressableScale>
      );

    default:
      // The contract's one guarantee, and the reason this view can be shipped
      // ahead of the gateway: a part type this build has never heard of still
      // has text to show.
      return (
        <View style={styles.agentAlign}>
          <Text selectable style={[styles.mono, { color: colors.muted }]}>
            {part.fallback_text}
          </Text>
        </View>
      );
  }
});

/**
 * A single tool call. `onToggle` absent means the card is not collapsible --
 * it is already inside an opened activity row, and a second layer of folding
 * there would only be a second thing to tap.
 */
const PaneChatToolCard = memo(function PaneChatToolCard({
  block,
  colors,
  open,
  onToggle,
}: {
  block: PaneChatToolBlock;
  colors: PaneChatColors;
  open: boolean;
  onToggle?: (id: string) => void;
}) {
  const { t } = useLingui();
  const summary = firstLine(block.input);
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceRaised }]}>
      <PressableScale
        accessibilityLabel={open ? t`Collapse ${block.tool}` : t`Expand ${block.tool}`}
        feedback="selection"
        pressedScale={0.99}
        disabled={!onToggle}
        onPress={() => onToggle?.(block.id)}
        style={styles.toolHeader}>
        <View style={[styles.statusDot, { backgroundColor: colors.status[block.status] }]} />
        <Text variant="bodySmall" color={colors.text} style={styles.toolName}>
          {block.tool}
        </Text>
        {summary ? (
          <Text variant="caption" color={colors.muted} numberOfLines={1} style={styles.flexOne}>
            {summary}
          </Text>
        ) : (
          <View style={styles.flexOne} />
        )}
        {onToggle ? <Chevron size={16} color={colors.subtle} /> : null}
      </PressableScale>

      {open ? (
        <View style={[styles.toolBody, { borderTopColor: colors.border }]}>
          {block.input && block.input !== summary ? (
            <Text selectable style={[styles.mono, { color: colors.muted }]}>
              {block.input}
            </Text>
          ) : null}
          {block.result.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <Text selectable style={[styles.mono, { color: colors.text }]}>
                {block.result.join('\n')}
              </Text>
            </ScrollView>
          ) : (
            <Text variant="caption" color={colors.subtle}>
              {block.status === 'running' ? (
                <Trans>Still running…</Trans>
              ) : (
                <Trans>No output.</Trans>
              )}
            </Text>
          )}
          {block.truncated ? (
            // The gateway cut this result short; saying so is the difference
            // between "that is all of it" and "that is the start of it".
            <Text variant="caption" color={colors.subtle}>
              <Trans>… truncated</Trans>
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/**
 * The agent's own checklist, read-only: the boxes report what it wrote down and
 * nothing here can write back to them. Its own component because it is drawn in
 * two places -- on its own in the detailed view, and inside the activity chip
 * that owns it in the simplified one.
 */
const TodoCard = memo(function TodoCard({
  part,
  colors,
}: {
  part: Extract<PanePart, { type: 'todo' }>;
  colors: PaneChatColors;
}) {
  return (
    <View style={[styles.card, styles.agentAlign, { backgroundColor: colors.surfaceRaised }]}>
      {part.items.map((item, index) => (
        <View key={`${index}-${item.text}`} style={styles.todoItem}>
          <View
            style={[
              styles.todoBox,
              {
                borderColor: item.done ? colors.accent : colors.border,
                backgroundColor: item.done ? colors.accent : 'transparent',
              },
            ]}>
            {item.done ? <View style={styles.todoTick} /> : null}
          </View>
          <Text
            variant="bodySmall"
            selectable
            color={item.done ? colors.muted : colors.text}
            style={styles.todoText}>
            {item.text}
          </Text>
        </View>
      ))}
    </View>
  );
});

const DiffRow = memo(function DiffRow({
  part,
  colors,
}: {
  part: Extract<PanePart, { type: 'diff' }>;
  colors: PaneChatColors;
}) {
  const lines = useMemo(() => part.hunks.flatMap((hunk) => hunk.split('\n')), [part.hunks]);

  return (
    <View
      style={[
        styles.diffCard,
        styles.agentAlign,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}>
      {part.file ? (
        <Text variant="caption" color={colors.muted} numberOfLines={1} style={styles.diffFile}>
          {part.file}
        </Text>
      ) : null}
      {/* Never wrapped: a re-wrapped diff line no longer lines up with the one
          above it, which is the only thing a diff is read for. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((line, index) => {
            const marker = line.charAt(0);
            const added = marker === '+';
            const removed = marker === '-';
            return (
              <Text
                key={`${index}-${line}`}
                selectable
                style={[
                  styles.diffLine,
                  {
                    color: added ? colors.added : removed ? colors.removed : colors.muted,
                    backgroundColor: added
                      ? colors.addedBackground
                      : removed
                        ? colors.removedBackground
                        : 'transparent',
                  },
                ]}>
                {line || ' '}
              </Text>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
});

const TableRow = memo(function TableRow({
  part,
  colors,
}: {
  part: Extract<PanePart, { type: 'table' }>;
  colors: PaneChatColors;
}) {
  return (
    <View style={[styles.tableCard, styles.agentAlign, { borderColor: colors.border }]}>
      {part.rows.map((row, rowIndex) => (
        <View
          key={`${rowIndex}-${row.join('|')}`}
          style={[
            styles.tableRow,
            {
              // Best-effort, like the cells themselves: the model has no header
              // flag, and a leading header row is what agents actually print.
              backgroundColor: rowIndex === 0 ? colors.surfaceRaised : 'transparent',
              borderTopColor: colors.border,
              borderTopWidth: rowIndex === 0 ? 0 : StyleSheet.hairlineWidth,
            },
          ]}>
          {row.map((cell, cellIndex) => (
            <Text
              key={`${cellIndex}-${cell}`}
              variant="caption"
              selectable
              color={rowIndex === 0 ? colors.text : colors.muted}
              style={styles.tableCell}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
});

/**
 * The bubble and diff tints are theme colours, faded. A colour that is not a
 * plain hex (a theme may hand back `rgb()` or `rgba()`) is left alone and used
 * at full strength on the text only, so a tint can never swallow a line.
 */
function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return 'transparent';
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => part + part)
          .join('')
      : hex;
  const value = Number.parseInt(full, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 17,
  },
  markdown: {
    width: '100%',
  },
  agentAlign: {
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  promptAlign: {
    alignItems: 'flex-end',
    paddingLeft: 32,
  },
  label: {
    paddingTop: 2,
  },
  labelText: {
    // The one flourish it gets. Tracking is what reads as "section" without
    // needing a rule, a weight, or a colour that competes with the prose.
    letterSpacing: 0.6,
  },
  promptBubble: {
    borderRadius: 16,
    borderBottomRightRadius: 5,
    borderCurve: 'continuous',
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  activityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    gap: 8,
    borderRadius: 999,
    borderCurve: 'continuous',
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  activityBody: {
    gap: 8,
    paddingTop: 8,
  },
  card: {
    borderRadius: 14,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  toolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toolName: {
    fontWeight: '600',
  },
  toolBody: {
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  todoItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  todoBox: {
    width: 16,
    height: 16,
    marginTop: 2,
    borderRadius: 5,
    borderCurve: 'continuous',
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todoTick: {
    width: 6,
    height: 6,
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  todoText: {
    flex: 1,
    minWidth: 0,
  },
  diffCard: {
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: 6,
  },
  diffFile: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  diffLine: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 17,
    paddingHorizontal: 12,
  },
  tableCard: {
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderCurve: 'continuous',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});
