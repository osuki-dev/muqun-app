import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { AGENT_TYPE } from '@/constants/agent-type';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { clampLine, gutterDigits, lineContentWidth } from '@/lib/text-preview';

/**
 * A file, one row per line, virtualized.
 *
 * This is the other half of the answer to "why will Files not open a 170 KB
 * file". The markdown renderer measures a whole document in one native pass and
 * gets quadratic about it on iOS, so a big source file cannot be one view --
 * but it does not have to be. A source file is a list of fixed-height rows of
 * one monospaced line each, which is the cheapest thing a virtualized list can
 * draw, and its cost is the screenful on screen rather than the file.
 *
 * The geometry is `diff-rows`', and deliberately so: one outer horizontal
 * scroller wrapping the whole list rather than one per row, so columns stay
 * aligned while panning and the platform is not asked to build a gesture
 * recogniser per line; a fixed row height so the list never re-measures and
 * never jumps; and a gutter counter-translated by the scroller's own offset on
 * the UI thread, so the line numbers stay readable at any horizontal position.
 * Wrapping is out for the same reason it is out of a diff -- a re-wrapped line
 * no longer agrees with the number beside it.
 *
 * What it does not do is colour anything. There is one highlighter in this app,
 * it lives inside the native markdown renderer's fenced block, and there is no
 * way to ask it for tokens without handing it the document that is too big to
 * hand it. Highlighting a window at a time was tried on paper and fights the
 * list at every point: a fence is its own horizontal scroller, so columns stop
 * agreeing across windows; its height cannot be predicted, so the row geometry
 * that makes this smooth goes; and a fling would re-parse natively several times
 * a second. So the viewer is tiered instead -- `asset-viewer` keeps the
 * highlighted renderer for files inside the size it was measured safe at, and
 * hands anything larger to this, with a line saying why the colour went. A
 * plain, instant, complete file beats a coloured one that is refused.
 */

/** Fifty `M`s in the row's own style: the one string measured to learn the advance. See `diff-rows`. */
const RULER = 'M'.repeat(50);

/** The row's left and right breathing room, past the gutter. */
const LINE_PADDING = 10;
/** The gutter's own inset, so a line number is not against the edge. */
const GUTTER_PADDING = 8;

function usePinnedStyle(scrollX: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
}

type PinnedStyle = ReturnType<typeof usePinnedStyle>;

interface RowStyles {
  row: { width: number; height: number };
  text: { fontFamily: string; fontSize: number; lineHeight: number; paddingLeft: number };
  gutter: { width: number; backgroundColor: string };
  number: { fontSize: number; lineHeight: number; width: number };
}

const CodeLineRow = memo(function CodeLineRow({
  line,
  number,
  styles: row,
  color,
  numberColor,
  scrollX,
}: {
  line: string;
  number: number;
  styles: RowStyles;
  color: string;
  numberColor: string;
  scrollX: SharedValue<number>;
}) {
  // One per mounted row rather than one object shared by all of them: the list
  // recycles, so about a screenful of these is paid for once.
  const pinned: PinnedStyle = usePinnedStyle(scrollX);
  return (
    <View style={[baseStyles.row, row.row]}>
      {/* The code first and the gutter over it, so a panned line slides *under*
          an opaque column rather than out beside it. */}
      <Text selectable numberOfLines={1} color={color} style={[baseStyles.text, row.text]}>
        {clampLine(line) || ' '}
      </Text>
      <Animated.View style={[baseStyles.gutter, pinned, row.gutter]}>
        <Text color={numberColor} style={[baseStyles.number, row.number]}>
          {number}
        </Text>
      </Animated.View>
    </View>
  );
});

export interface CodeLinesViewProps {
  lines: readonly string[];
  /** Characters in the longest line, from `indexTextLines`. */
  longest: number;
  /** The reader's mono face, size and code fill, as the markdown theme resolved them. */
  markdownStyle: MarkdownStyle;
  /** Said once above the rows, quietly: why this file has no colour in it. */
  note?: string;
  testID?: string;
}

export function CodeLinesView({ lines, longest, markdownStyle, note, testID }: CodeLinesViewProps) {
  const theme = useThemeTokens();

  // The floor under the markdown theme's own answer.
  //
  // This file used to keep its own `const MONO_FONT = Platform.OS === 'ios' ?
  // 'Menlo' : 'monospace'`, which was the pair a dozen surfaces had each
  // written out for themselves, and which by construction could never be the
  // face the reader had installed. `useMonoFontFamily` is that same pair when
  // the reader has chosen nothing and their own family when they have, so the
  // fallback path below no longer disagrees with the theme it is standing in
  // for.
  const mono = useMonoFontFamily();

  const code = markdownStyle.codeBlock;
  // The reader's mono font travels through the markdown theme, which is where
  // they set it. `'monospace'` is that theme's floor rather than a choice, and
  // it is the one value a text node cannot use on iOS.
  const fontFamily = code?.fontFamily && code.fontFamily !== 'monospace' ? code.fontFamily : mono;
  const fontSize = code?.fontSize ?? AGENT_TYPE.mono.size;
  const lineHeight = Math.round(code?.lineHeight ?? AGENT_TYPE.mono.lineHeight);
  const codeFill = code?.backgroundColor ?? theme.colors.surfaceRaised;

  /**
   * How wide one character is, in points.
   *
   * Measured rather than assumed, exactly as `diff-rows` does it: a hidden text
   * node of a known length is laid out once in the row's own style, and its
   * width over that length is the advance. That is what makes this right for
   * whatever the platform resolves the family to, at whatever size the reader
   * chose. 0.6 em is only what the frame before that layout uses.
   */
  const [advance, setAdvance] = useState(fontSize * 0.6);
  const onRulerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setAdvance(width / RULER.length);
  }, []);

  const [viewportWidth, setViewportWidth] = useState(0);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  const digits = gutterDigits(lines.length);
  const numberWidth = Math.ceil(digits * advance);
  const gutterWidth = numberWidth + GUTTER_PADDING * 2;
  const contentWidth = lineContentWidth({
    longest,
    advance,
    gutter: gutterWidth,
    padding: LINE_PADDING,
    viewport: viewportWidth,
  });

  /**
   * The pane's own ground, and why it has one.
   *
   * A theme pack paints the sheet with artwork, and a row of monospaced text
   * over a picture is unreadable -- the wallpaper runs straight between the
   * glyphs. The markdown renderer never has this problem because a fenced block
   * draws its own fill, so this draws the same one: `markdownStyle.codeBlock`'s
   * background, which is the theme's own code fill.
   *
   * Opaque, and not through `useSurfaceBackground`. That hook applies the
   * reader's artwork-opacity slider, which is right for a surface sitting on a
   * wallpaper and wrong for the one surface whose whole job is to be read
   * through: the fence does not go through it either. Measured on the device
   * against the One Piece pack, where the slider left code legible for about
   * twenty lines and then it became sea.
   */
  const paneFill = codeFill;
  const gutterFill = paneFill;

  /**
   * Every style a row wears, in one object that changes only when the geometry
   * does.
   *
   * The rule from card #611's list work: a memoized row must be handed props it
   * can compare. An array literal built inside `renderItem` is a new object per
   * render, which turns `memo` off for the whole list.
   */
  const rowStyles = useMemo<RowStyles>(
    () => ({
      row: { width: contentWidth, height: lineHeight },
      text: {
        fontFamily,
        fontSize,
        lineHeight,
        paddingLeft: gutterWidth + LINE_PADDING,
      },
      gutter: { width: gutterWidth, backgroundColor: gutterFill },
      number: { fontSize: Math.max(fontSize - 2, 9), lineHeight, width: numberWidth },
    }),
    [contentWidth, fontFamily, fontSize, gutterFill, gutterWidth, lineHeight, numberWidth]
  );

  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const renderRow = useCallback(
    ({ item, index }: LegendListRenderItemProps<string>) => (
      <CodeLineRow
        line={item}
        number={index + 1}
        styles={rowStyles}
        color={theme.colors.text}
        numberColor={theme.colors.textSubtle}
        scrollX={scrollX}
      />
    ),
    [rowStyles, scrollX, theme.colors.text, theme.colors.textSubtle]
  );

  const rowSize = useCallback(() => lineHeight, [lineHeight]);
  // Lines repeat -- a file is full of `}` and of blank lines -- so the line's
  // own text is never its identity. Its place in the file is.
  const keyOfLine = useCallback((_line: string, index: number) => String(index), []);

  const rulerStyle = useMemo(
    () => [baseStyles.text, baseStyles.ruler, { fontFamily, fontSize, lineHeight }],
    [fontFamily, fontSize, lineHeight]
  );

  return (
    <View style={[baseStyles.body, { backgroundColor: paneFill }]} testID={testID}>
      {note ? (
        <View style={baseStyles.note}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {note}
          </Text>
        </View>
      ) : null}
      {/* The hidden ruler: one layout pass, no space at all. */}
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        numberOfLines={1}
        onLayout={onRulerLayout}
        style={rulerStyle}>
        {RULER}
      </Text>
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator
        onScroll={onHorizontalScroll}
        scrollEventThrottle={16}
        onLayout={onViewportLayout}
        style={baseStyles.scroller}
        contentContainerStyle={baseStyles.scrollerContent}>
        <LegendList
          data={lines as string[]}
          keyExtractor={keyOfLine}
          renderItem={renderRow}
          // One monospaced line, one exact height: the list never re-measures,
          // so a hundred thousand rows cost the same as a hundred.
          getFixedItemSize={rowSize}
          estimatedItemSize={lineHeight}
          // A row is a fixed-height strip of text with a number beside it and
          // nothing expensive surviving a recycle -- the one shape that wants
          // recycling, for the reason `diff-rows` gives.
          recycleItems
          showsVerticalScrollIndicator={false}
          style={{ width: contentWidth }}
          contentContainerStyle={baseStyles.listContent}
        />
      </Animated.ScrollView>
    </View>
  );
}

const baseStyles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
  note: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  scroller: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  scrollerContent: {
    flexGrow: 1,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  row: {
    justifyContent: 'center',
  },
  text: {
    includeFontPadding: false,
    paddingRight: LINE_PADDING,
  },
  // Every row is laid out at the full content width so its fill spans the
  // panned area; only the gutter is held at the viewport's left edge.
  // The gutter wears the pane's own fill, so a panned line slides under it
  // rather than out beside it. It reads as a column by the hairline and by the
  // number's colour, not by a second background the artwork would fight.
  gutter: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    paddingLeft: GUTTER_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
  },
  number: {
    textAlign: 'right',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  ruler: {
    position: 'absolute',
    top: -1000,
    left: 0,
    opacity: 0,
  },
});
