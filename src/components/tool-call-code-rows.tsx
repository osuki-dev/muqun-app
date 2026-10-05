import { createContext, memo, useCallback, useContext, useMemo, useState } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  View,
  type LayoutChangeEvent,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';

import { GUTTER_NUMBER_FONT_SIZE, LINE_FONT_SIZE, LINE_ROW_HEIGHT } from '@/components/diff-rows';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { Text } from '@/components/text';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { tokenizeLine, type CodeTokenKind } from '@/lib/code-tokens';
import { gutterNumbersOf, gutterWidthOf } from '@/lib/diff-geometry';
import { clampLine } from '@/lib/text-preview';
import type { ToolCallDetail, ToolCallRow } from '@/lib/tool-call-detail';

/**
 * A tool call's input and output, as one list of numbered, coloured lines.
 *
 * The geometry is the diff viewer's, on purpose (`diff-rows.tsx` argues each
 * point): one horizontal scroller around one virtualised list, so both
 * sections pan together and their columns agree; fixed-height rows; no wrap;
 * the gutter and the section headings counter-translated on the UI thread so
 * they stay at the left edge at any pan; the scroll indicator shown only when
 * there is something to pan to; the gutter as wide as the largest number.
 *
 * A mono surface (`interface-font-reach.test.ts`): each coloured run is a
 * nested React Native `Text`. The app's `Text` is the kit's, a component with
 * its own state, theme reads and marquee machinery -- one per token, a few
 * thousand on screen in a fling, for a span that only needs a colour.
 */

const RULER = 'M'.repeat(50);
const NUMBER_RULER = '0'.repeat(20);
const LINE_PADDING = 10;
const GUTTER_INSET = 6;
const GUTTER_GAP = 8;

const ROW_HEIGHT: Record<ToolCallRow['type'], number | undefined> = {
  heading: 34,
  edge: 6,
  line: LINE_ROW_HEIGHT,
  empty: 30,
  gap: 18,
  // A sentence that wraps, so it is measured.
  error: undefined,
};

interface Geometry {
  contentWidth: number;
  pinnedWidth: number;
  gutterWidth: number;
  numberWidth: number;
  fill: string;
  mono: string;
  palette: Readonly<Partial<Record<CodeTokenKind, string>>>;
  text: string;
  subtle: string;
  muted: string;
  danger: string;
  detail: ToolCallDetail;
}

const GeometryContext = createContext<Geometry | null>(null);

function usePinnedStyle(scrollX: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
}

const HeadingRow = memo(function HeadingRow({
  section,
  scrollX,
}: {
  section: 'input' | 'output';
  scrollX: SharedValue<number>;
}) {
  const { t } = useLingui();
  const geometry = useContext(GeometryContext);
  const pinned = usePinnedStyle(scrollX);
  if (!geometry) return null;
  const { detail } = geometry;
  const meta: string[] = [];
  if (section === 'input' && detail.inputStreaming) meta.push(t`Still arriving`);
  if (section === 'output') {
    if (detail.exitCode !== undefined) meta.push(`exit ${detail.exitCode}`);
    if (detail.timedOut) meta.push(t`timed out`);
    if (detail.truncated) meta.push(t`Truncated`);
  }
  return (
    <View style={[styles.heading, { width: geometry.contentWidth }]}>
      <Animated.View style={[styles.pinned, pinned, { width: geometry.pinnedWidth }]}>
        <Text variant="caption" weight="semibold" color={geometry.muted}>
          {section === 'input' ? t`Input` : t`Output`}
        </Text>
        {meta.length > 0 ? (
          <Text
            variant="caption"
            color={detail.status === 'failed' ? geometry.danger : geometry.subtle}
            numberOfLines={1}
            style={styles.headingMeta}>
            {meta.join(' · ')}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
});

const LineRow = memo(function LineRow({
  row,
  scrollX,
}: {
  row: Extract<ToolCallRow, { type: 'line' }>;
  scrollX: SharedValue<number>;
}) {
  const geometry = useContext(GeometryContext);
  const pinned = usePinnedStyle(scrollX);
  const tokens = useMemo(
    () => tokenizeLine(clampLine(row.text), row.language),
    [row.text, row.language]
  );
  if (!geometry) return null;
  const base = row.failed ? geometry.danger : geometry.text;
  const textStyle: TextStyle = {
    fontFamily: geometry.mono,
    color: base,
    paddingLeft: geometry.gutterWidth + LINE_PADDING,
  };
  return (
    <View style={[styles.line, { width: geometry.contentWidth, backgroundColor: geometry.fill }]}>
      {/* The code first and the gutter over it, so panned text slides under
          an opaque column rather than out beside it. */}
      <NativeText selectable numberOfLines={1} style={[styles.lineText, textStyle]}>
        {tokens.length === 0
          ? ' '
          : tokens.map((token, index) =>
              token.kind === 'plain' ? (
                token.text
              ) : (
                <NativeText key={index} style={{ color: geometry.palette[token.kind] ?? base }}>
                  {token.text}
                </NativeText>
              )
            )}
      </NativeText>
      <Animated.View
        style={[
          styles.gutter,
          pinned,
          { width: geometry.gutterWidth, backgroundColor: geometry.fill },
        ]}>
        <NativeText
          style={[styles.number, { width: geometry.numberWidth, color: geometry.subtle }]}>
          {row.newLine}
        </NativeText>
      </Animated.View>
    </View>
  );
});

const ErrorRow = memo(function ErrorRow({
  row,
  scrollX,
}: {
  row: Extract<ToolCallRow, { type: 'error' }>;
  scrollX: SharedValue<number>;
}) {
  const { t } = useLingui();
  const geometry = useContext(GeometryContext);
  const pinned = usePinnedStyle(scrollX);
  if (!geometry) return null;
  // Red for a failure; a call that was stopped says so in the quiet colour.
  const color = geometry.detail.status === 'cancelled' ? geometry.muted : geometry.danger;
  return (
    <View style={{ width: geometry.contentWidth, backgroundColor: geometry.fill }}>
      <Animated.View style={[styles.error, pinned, { width: geometry.pinnedWidth }]}>
        <Text
          testID="agent-tool-detail-error"
          variant="caption"
          selectable
          color={color}
          style={{ fontFamily: geometry.mono }}>
          {row.declined ? t`Denied by you` : row.text}
        </Text>
      </Animated.View>
    </View>
  );
});

const EmptyRow = memo(function EmptyRow({
  section,
  scrollX,
}: {
  section: 'input' | 'output';
  scrollX: SharedValue<number>;
}) {
  const { t } = useLingui();
  const geometry = useContext(GeometryContext);
  const pinned = usePinnedStyle(scrollX);
  if (!geometry) return null;
  return (
    <View style={[styles.empty, { width: geometry.contentWidth }]}>
      <Animated.View style={[styles.pinned, pinned, { width: geometry.pinnedWidth }]}>
        <Text variant="caption" color={geometry.subtle}>
          {section === 'input' ? t`No input` : t`No output`}
        </Text>
      </Animated.View>
    </View>
  );
});

const ToolCallListRow = memo(function ToolCallListRow({
  row,
  scrollX,
}: {
  row: ToolCallRow;
  scrollX: SharedValue<number>;
}) {
  const geometry = useContext(GeometryContext);
  switch (row.type) {
    case 'heading':
      return <HeadingRow section={row.section} scrollX={scrollX} />;
    case 'line':
      return <LineRow row={row} scrollX={scrollX} />;
    case 'error':
      return <ErrorRow row={row} scrollX={scrollX} />;
    case 'empty':
      return <EmptyRow section={row.section} scrollX={scrollX} />;
    case 'edge':
      return (
        <View
          style={{
            height: ROW_HEIGHT.edge,
            width: geometry?.contentWidth,
            backgroundColor: geometry?.fill,
          }}
        />
      );
    default:
      return <View style={{ height: ROW_HEIGHT.gap }} />;
  }
});

const keyOfRow = (row: ToolCallRow) => row.key;
const typeOfRow = (row: ToolCallRow) => row.type;
const sizeOfRow = (row: ToolCallRow) => ROW_HEIGHT[row.type];

export function ToolCallCodeRows({
  detail,
  rows,
  bottomInset,
}: {
  detail: ToolCallDetail;
  rows: readonly ToolCallRow[];
  /** Room under the last row, for the footer and the home indicator. */
  bottomInset: number;
}) {
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  const markdownStyle = usePaneChatMarkdownStyle();
  const code = markdownStyle.codeBlock;

  // Measured, as `diff-rows` measures: a hidden run of a known length in the
  // row's own style, and its width over that length is the advance.
  const [advance, setAdvance] = useState(LINE_FONT_SIZE * 0.6);
  const onCodeRuler = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setAdvance(width / RULER.length);
  }, []);
  const [numberAdvance, setNumberAdvance] = useState(GUTTER_NUMBER_FONT_SIZE * 0.6);
  const onNumberRuler = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setNumberAdvance(width / NUMBER_RULER.length);
  }, []);
  const [viewportWidth, setViewportWidth] = useState(0);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  const digits = useMemo(() => gutterNumbersOf(rows).digits, [rows]);
  const widest = Math.max(detail.input?.widest ?? 0, detail.output?.widest ?? 0);

  const geometry = useMemo<Geometry>(() => {
    const gutter = gutterWidthOf({
      digits,
      numberColumns: 1,
      numberAdvance,
      markerWidth: 0,
      inset: GUTTER_INSET,
      gap: GUTTER_GAP,
    });
    const palette = code?.syntaxColors ?? {};
    return {
      // Two cells of slack, for the reason `diff-rows` gives: a measured
      // advance a hair short would put an ellipsis on the longest line.
      contentWidth: Math.max(
        viewportWidth,
        gutter.width + (widest + 2) * advance + LINE_PADDING * 2
      ),
      pinnedWidth: Math.max(viewportWidth, 1),
      gutterWidth: gutter.width,
      numberWidth: gutter.numberWidth,
      // The theme's code fill, opaque, as `code-lines-view` explains: the one
      // surface whose job is to be read through artwork.
      fill: code?.backgroundColor ?? theme.colors.surfaceRaised,
      mono,
      palette: {
        keyword: palette.keyword,
        string: palette.string,
        number: palette.number,
        constant: palette.constant,
        comment: palette.comment,
        function: palette.function,
        property: palette.property,
        punctuation: palette.punctuation,
        variable: palette.variable,
        attribute: palette.attribute,
      },
      text: theme.colors.text,
      subtle: theme.colors.textSubtle,
      muted: theme.colors.textMuted,
      danger: theme.colors.danger,
      detail,
    };
  }, [
    advance,
    code?.backgroundColor,
    code?.syntaxColors,
    detail,
    digits,
    mono,
    numberAdvance,
    theme.colors,
    viewportWidth,
    widest,
  ]);

  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<ToolCallRow>) => (
      <ToolCallListRow row={item} scrollX={scrollX} />
    ),
    [scrollX]
  );
  const pans = viewportWidth > 0 && geometry.contentWidth > viewportWidth;

  return (
    <GeometryContext.Provider value={geometry}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.rulerBox}>
        <NativeText
          numberOfLines={1}
          onLayout={onCodeRuler}
          style={[styles.lineText, { fontFamily: mono }]}>
          {RULER}
        </NativeText>
        <NativeText numberOfLines={1} onLayout={onNumberRuler} style={styles.number}>
          {NUMBER_RULER}
        </NativeText>
      </View>
      <Animated.ScrollView
        testID="agent-tool-detail-body"
        horizontal
        showsHorizontalScrollIndicator={pans}
        onScroll={onHorizontalScroll}
        scrollEventThrottle={16}
        onLayout={onViewportLayout}
        style={styles.scroller}
        contentContainerStyle={styles.scrollerContent}>
        <LegendList
          nestedScrollEnabled
          data={rows as ToolCallRow[]}
          keyExtractor={keyOfRow}
          renderItem={renderRow}
          getItemType={typeOfRow}
          getFixedItemSize={sizeOfRow}
          estimatedItemSize={LINE_ROW_HEIGHT}
          // A numbered line is the diff row's shape: cheap, fixed, thousands
          // of them. See `diff-rows.tsx` for why this one list recycles.
          recycleItems
          showsVerticalScrollIndicator={false}
          style={{ width: geometry.contentWidth }}
          contentContainerStyle={{ paddingBottom: bottomInset }}
        />
      </Animated.ScrollView>
    </GeometryContext.Provider>
  );
}

const styles = StyleSheet.create({
  scroller: { flex: 1, minHeight: 0, overflow: 'hidden' },
  scrollerContent: { flexGrow: 1 },
  pinned: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heading: { height: ROW_HEIGHT.heading, justifyContent: 'flex-end' },
  headingMeta: { flexShrink: 1, marginLeft: 'auto' },
  line: { height: LINE_ROW_HEIGHT, justifyContent: 'center' },
  lineText: {
    fontSize: LINE_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    includeFontPadding: false,
    paddingRight: LINE_PADDING,
  },
  gutter: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    paddingLeft: GUTTER_INSET,
    flexDirection: 'row',
    alignItems: 'center',
  },
  number: {
    fontSize: GUTTER_NUMBER_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'right',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  error: { paddingHorizontal: LINE_PADDING, paddingVertical: 8 },
  empty: { height: ROW_HEIGHT.empty },
  rulerBox: {
    position: 'absolute',
    top: -1000,
    left: 0,
    width: 4000,
    alignItems: 'flex-start',
    opacity: 0,
  },
});
