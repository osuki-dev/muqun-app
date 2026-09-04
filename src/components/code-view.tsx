import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { Text as UIText, useThemeTokens } from '@osuki-dev/ui';
import type { Colors } from '@osuki-dev/ui';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  InteractionManager,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';

import {
  highlightFile,
  plainFile,
  type CodeLine,
  type HighlightResult,
  type TokenRole,
} from '@/lib/code-highlight';

/**
 * A source file or a diff, coloured, read-only.
 *
 * This used to render the whole file in one go: a `<Text>` per line, with the
 * coloured runs nested inside it, all under a single `<Text selectable>` in a
 * plain `ScrollView`. The reasoning was that nested `<Text>` folds into ranges
 * on one native attributed string rather than into views, so the spans are
 * cheap -- which is true, and beside the point. The *lines* are not cheap. A
 * 200 KB file is eight to ten thousand of them, and every one was an element to
 * create, a shadow node to lay out and a range to measure, synchronously, on
 * the frame the sheet opened. Card #661: opening a 200 KB artifact on a phone
 * locked the whole app up for seconds -- not the download, not the decryption,
 * not the tokenizer. The tree.
 *
 * So the file is virtualized by line. Only the rows in the viewport exist, the
 * work per frame is bounded by the screen rather than by the file, and the
 * sheet can be scrolled and closed from the first frame at any size the reader
 * is allowed to open.
 *
 * Three things follow from that, and each costs something here:
 *
 * **Colour arrives a frame late.** Splitting on newlines is a couple of
 * milliseconds at 200 KB; tokenizing is hundreds, uninterruptible, on the JS
 * thread (see `HIGHLIGHT_MAX_BYTES` for what that measured out to). So the
 * first paint is plain and `highlightFile` runs after the interaction settles,
 * then swaps in.
 *
 * **The scrollable width has to be decided up front.** A virtualized list only
 * knows the rows it has mounted, so letting the content size itself would make
 * the horizontal extent jump as the reader scrolled. The longest line is
 * measured once, off screen, and every row is cut to that width.
 *
 * **Selection is per line.** One `<Text>` spanning the document is exactly the
 * thing that cannot be virtualized, so a drag no longer runs past the end of a
 * line. The viewer's header carries a copy action for the whole file instead,
 * which is what a selection across ten thousand lines was being used for
 * anyway.
 *
 * Neither path wraps, and both scroll horizontally. A re-wrapped line loses the
 * column alignment that is the entire reason for reading a log or a diff in a
 * monospaced face.
 */
export function CodeView({ name, content }: { name: string; content: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();

  // What the first frame draws. `plainFile` is one `split('\n')`.
  const plain = useMemo(() => plainFile(content), [content]);
  const [coloured, setColoured] = useState<HighlightResult | null>(null);

  useEffect(() => {
    setColoured(null);
    // `runAfterInteractions`, not a bare timeout: the sheet is opening with a
    // fade as this mounts, and the tokenizer is the one thing here long enough
    // to be seen dropping frames out of it.
    const task = InteractionManager.runAfterInteractions(() => {
      setColoured(highlightFile(name, content));
    });
    return () => task.cancel();
  }, [content, name]);

  const result = coloured ?? plain;
  const roleColors = useMemo(() => roleColorMap(theme.colors), [theme.colors]);
  const isDiff = result.language === 'diff';

  // Measured from the plain split rather than from `result`, so the scrollable
  // width is settled before colour lands and does not move when it does.
  const longestLine = useMemo(() => longestLineOf(plain.lines), [plain]);
  const [longestWidth, setLongestWidth] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  const contentWidth = Math.max(viewport.width, longestWidth + CONTENT_PADDING * 2);

  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<CodeLine>) => (
      <CodeRow
        line={item}
        isDiff={isDiff}
        colors={theme.colors}
        roleColors={roleColors}
        width={contentWidth}
      />
    ),
    [contentWidth, isDiff, roleColors, theme.colors]
  );

  const onArea = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setViewport((previous) =>
      previous.width === width && previous.height === height ? previous : { width, height }
    );
  }, []);

  return (
    <View style={styles.body}>
      {result.skipped ? (
        <UIText variant="caption" color={theme.colors.textMuted} style={styles.notice}>
          {result.skipped === 'size'
            ? t`Too large to colour. Shown as plain text.`
            : t`Too many lines to colour. Shown as plain text.`}
        </UIText>
      ) : null}

      {/* The width probe. It sits in a container far wider than any screen so
          the text lays out at its natural width instead of being wrapped or
          clipped to the viewport, which is the only way to learn how wide the
          file actually is without mounting all of it. One text node, one
          layout pass, and it never draws. */}
      <View style={styles.probe} pointerEvents="none">
        <Text
          style={[styles.code, styles.probeLine]}
          numberOfLines={1}
          onLayout={(event) => setLongestWidth(event.nativeEvent.layout.width)}>
          {longestLine}
        </Text>
      </View>

      <View style={styles.area} onLayout={onArea}>
        {viewport.height > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {/* A vertical list inside a horizontal scroller: different axes, so
                this is not the nesting React Native warns about. The height is
                the measured one rather than `flex: 1` -- a child of a
                horizontal `ScrollView` is sized by its content on the cross
                axis too, and a list that sizes itself to its content is a list
                that is not virtualizing. */}
            <LegendList
              data={result.lines}
              renderItem={renderItem}
              keyExtractor={keyOfLine}
              estimatedItemSize={LINE_HEIGHT}
              recycleItems
              showsVerticalScrollIndicator={false}
              style={{ width: contentWidth, height: viewport.height }}
              contentContainerStyle={styles.listContent}
            />
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

/**
 * One line.
 *
 * Fixed height, and `numberOfLines={1}` under it: a row that can grow to two
 * lines makes every offset the list has already computed wrong, and the whole
 * point of not wrapping is that it never should.
 */
const CodeRow = memo(function CodeRow({
  line,
  isDiff,
  colors,
  roleColors,
  width,
}: {
  line: CodeLine;
  isDiff: boolean;
  colors: Colors;
  roleColors: Record<TokenRole, string>;
  width: number;
}) {
  if (isDiff) {
    // The tint is the line's verdict, so it runs the whole row rather than
    // stopping where the text does -- which is why a diff is a `View` per line
    // and not a background on a text span.
    return (
      <View style={[styles.row, { width, backgroundColor: diffBackground(line, colors) }]}>
        <Text
          selectable
          numberOfLines={1}
          style={[styles.code, { color: diffColor(line, colors, roleColors) }]}>
          {textOf(line)}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, { width }]}>
      <Text selectable numberOfLines={1} style={[styles.code, { color: colors.text }]}>
        {line.spans.map((span, index) => (
          <Text
            key={index}
            style={[
              { color: roleColors[span.role] },
              span.role === 'comment' ? styles.comment : null,
            ]}>
            {span.text}
          </Text>
        ))}
      </Text>
    </View>
  );
});

/** Lines have no identity of their own; position is what they are. */
function keyOfLine(_line: CodeLine, index: number): string {
  return String(index);
}

function textOf(line: CodeLine): string {
  return line.spans.map((span) => span.text).join('');
}

/**
 * The line the scrollable width is measured from.
 *
 * By character count, which is not the same as by rendered width for a face
 * that has any double-width glyph in it -- but the result is only ever used as
 * `Math.max` against the viewport, and being a few points short on a file of
 * CJK is a line that ends at the edge rather than a broken viewer. Counting
 * columns properly means walking every character of the file, which is the kind
 * of whole-input pass this change exists to remove.
 */
function longestLineOf(lines: CodeLine[]): string {
  let longest = '';
  for (const line of lines) {
    const text = line.spans.length > 0 ? line.spans[0].text : '';
    if (text.length > longest.length) longest = text;
  }
  return longest;
}

/**
 * Roles to theme tokens.
 *
 * Six roles because six is what the palette can say. Every colour is a token,
 * so the whole code theme re-tints with the app rather than drifting away from
 * it the way a vendored highlight theme would.
 */
function roleColorMap(colors: Colors): Record<TokenRole, string> {
  return {
    plain: colors.text,
    keyword: colors.primary,
    string: colors.success,
    number: colors.warning,
    comment: colors.textSubtle,
    name: colors.info,
    punctuation: colors.textMuted,
  };
}

/**
 * The row tint.
 *
 * Both halves come from the same alpha applied to their own token. There is a
 * `dangerSubtle` token but no `successSubtle`, and a diff whose red and green
 * are tinted at different strengths looks broken -- so neither uses the ready
 * made one.
 */
const DIFF_TINT_ALPHA = 0.14;

function diffBackground(line: CodeLine, colors: Colors): string | undefined {
  if (line.diff === 'added') return withAlpha(colors.success, DIFF_TINT_ALPHA);
  if (line.diff === 'removed') return withAlpha(colors.danger, DIFF_TINT_ALPHA);
  if (line.diff === 'hunk') return withAlpha(colors.primary, DIFF_TINT_ALPHA);
  return undefined;
}

function diffColor(line: CodeLine, colors: Colors, roleColors: Record<TokenRole, string>): string {
  if (line.diff === 'added') return colors.success;
  if (line.diff === 'removed') return colors.danger;
  if (line.diff === 'hunk') return colors.primary;
  if (line.diff === 'meta') return colors.textMuted;
  return roleColors.plain;
}

/**
 * Alpha over a token colour.
 *
 * Handles the `#rgb`/`#rrggbb` the theme uses and passes anything else through
 * untouched, so a palette that starts emitting `rgb()` degrades to an opaque
 * tint rather than to an invalid colour the native side would reject.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((part) => part + part)
          .join('')
      : hex;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** One row, exactly. The list's item size is this and never has to be measured. */
const LINE_HEIGHT = 18;
const CONTENT_PADDING = 16;

/**
 * The width the off-screen probe lays out on. Wide enough that no real line of
 * code reaches the end of it, so the measurement is the line's own width and
 * not this number.
 */
const PROBE_CANVAS_WIDTH = 100_000;

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  area: {
    flex: 1,
  },
  notice: {
    paddingHorizontal: CONTENT_PADDING,
    paddingTop: 12,
    paddingBottom: 6,
  },
  // Off screen and unclipped: `left` puts it beyond any viewport and the width
  // is a canvas the longest line can lay out on without being wrapped.
  probe: {
    position: 'absolute',
    left: -PROBE_CANVAS_WIDTH,
    top: 0,
    width: PROBE_CANVAS_WIDTH,
    opacity: 0,
  },
  // Without this the probe stretches to its container the way a `Text` in a
  // `View` always does, and the measurement comes back as the canvas width
  // rather than the line's.
  probeLine: {
    alignSelf: 'flex-start',
  },
  listContent: {
    paddingVertical: CONTENT_PADDING,
  },
  row: {
    height: LINE_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: CONTENT_PADDING,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: LINE_HEIGHT,
  },
  comment: {
    fontStyle: 'italic',
  },
});
