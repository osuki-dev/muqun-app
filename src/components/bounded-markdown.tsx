import { memo, useMemo, useState, type ReactNode } from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text, useThemeTokens, useToast } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { plural } from '@lingui/core/macro';
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown';

import { PressableScale } from '@/components/pressable-scale';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { markdownPaletteKey } from '@/lib/markdown-palette';
import { isSafeExternalLink } from '@/lib/safe-link';
import { MARKDOWN_CHUNK_CHARS, MARKDOWN_NATIVE_CEILING, capMarkdown } from '@/lib/markdown-cap';
import { AGENT_TYPE } from '@/constants/agent-type';

/**
 * Markdown, bounded.
 *
 * One native markdown view measures its whole document in one shadow node, and
 * a document long enough to measure tens of thousands of pixels takes the
 * layout -- and then the process -- down with it. Nothing in the transcript
 * hands a native view an unbounded string any more: this draws the first
 * `MARKDOWN_CHUNK_CHARS` and offers the next chunk, and says plainly that it
 * was the app that cut something.
 *
 * Past `MARKDOWN_NATIVE_CEILING` the native view is not used at all. That is
 * the defensive half: a string that long has already defeated whatever
 * produced it, and plain selectable text in a height-capped scroller is a
 * readable answer that cannot abort the app.
 */

/** The one row both caps end in: what was cut, and how to see more of it. */
export const TruncationFooter = memo(function TruncationFooter({
  note,
  onShowMore,
  showMoreLabel,
  extra,
}: {
  note: string;
  onShowMore?: () => void;
  showMoreLabel: string;
  extra?: ReactNode;
}) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const { t } = useLingui();

  return (
    <View style={styles.footerRow}>
      <View style={[styles.badge, { borderColor: theme.colors.warning }]}>
        <Text variant="caption" color={theme.colors.warning} style={styles.badgeText}>
          {t`Truncated`}
        </Text>
      </View>
      <Text variant="caption" color={theme.colors.textSubtle} style={styles.footerNote}>
        {note}
      </Text>
      {onShowMore ? (
        <PressableScale
          testID="bounded-show-more"
          accessibilityRole="button"
          accessibilityLabel={showMoreLabel}
          onPress={onShowMore}
          style={[styles.moreChip, { borderColor: colors.border }]}>
          <Text variant="caption" color={colors.accent} style={styles.moreChipText}>
            {showMoreLabel}
          </Text>
        </PressableScale>
      ) : null}
      {extra}
    </View>
  );
});

export interface BoundedMarkdownProps {
  markdown: string;
  markdownStyle: MarkdownStyle;
  /**
   * GitHub by default: tables, task lists and block math, and a code block
   * that scrolls sideways instead of clipping, with its language named and a
   * copy button. Commonmark draws none of that -- a table under it is dropped
   * on the floor with `RendererFactory: No renderer for: Table`.
   */
  flavor?: 'commonmark' | 'github';
  containerStyle?: StyleProp<ViewStyle>;
  /** Links are opened by the caller's rule, never by this component's guess. */
  openLinks?: boolean;
  latexMath?: boolean;
  testID?: string;
}

export const BoundedMarkdown = memo(function BoundedMarkdown({
  markdown,
  markdownStyle,
  flavor = 'github',
  containerStyle,
  openLinks = true,
  latexMath = false,
  testID,
}: BoundedMarkdownProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const [budget, setBudget] = useState(MARKDOWN_CHUNK_CHARS);

  const capped = useMemo(() => capMarkdown(markdown, budget), [markdown, budget]);
  // The ceiling is measured against what would actually be drawn, not against
  // the whole string: a reader who never taps "Show more" never leaves the
  // first chunk, and the first chunk is always inside the ceiling.
  const plain = capped.text.length > MARKDOWN_NATIVE_CEILING;

  const hiddenKb = Math.round(capped.hidden / 1024);
  const footer =
    capped.hidden > 0 ? (
      <TruncationFooter
        note={
          capped.hidden >= 1024
            ? t`${hiddenKb} KB not shown`
            : t`${plural(capped.hidden, { one: '# character not shown', other: '# characters not shown' })}`
        }
        onShowMore={() => setBudget((prev) => prev + MARKDOWN_CHUNK_CHARS)}
        showMoreLabel={t`Show more`}
      />
    ) : null;

  if (plain) {
    return (
      <View style={[styles.stretch, containerStyle]} testID={testID}>
        <ScrollView style={styles.plainScroll} nestedScrollEnabled showsVerticalScrollIndicator>
          <Text selectable style={[styles.plainText, { color: theme.colors.text }]}>
            {capped.text}
          </Text>
        </ScrollView>
        {footer}
      </View>
    );
  }

  return (
    <View style={[styles.stretch, containerStyle]} testID={testID}>
      <EnrichedMarkdownText
        key={markdownPaletteKey(markdownStyle)}
        flavor={flavor}
        markdown={capped.text}
        markdownStyle={markdownStyle}
        containerStyle={styles.stretch}
        selectable
        selectionColor={theme.colors.primary}
        selectionHandleColor={theme.colors.primary}
        streamingAnimation={false}
        textBreakStrategy="simple"
        // The copy button belongs to the renderer's own code-block header; all
        // this adds is the confirmation the rest of the app gives.
        onCopyPress={({ language }) =>
          showToast({
            variant: 'info',
            title: t`Copied`,
            message: language
              ? t`${language} code copied to clipboard`
              : t`Code copied to clipboard`,
          })
        }
        {...(latexMath ? { md4cFlags: { latexMath: true } } : {})}
        {...(openLinks
          ? {
              onLinkPress: ({ url }: { url: string }) => {
                if (isSafeExternalLink(url)) void Linking.openURL(url);
              },
            }
          : {})}
      />
      {footer}
    </View>
  );
});

const styles = StyleSheet.create({
  stretch: {
    alignSelf: 'stretch',
  },
  plainScroll: {
    maxHeight: 420,
  },
  plainText: {
    fontFamily: 'monospace',
    fontSize: AGENT_TYPE.mono.size,
    lineHeight: AGENT_TYPE.mono.lineHeight,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
  footerNote: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  moreChip: {
    minHeight: 26,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  moreChipText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
});
