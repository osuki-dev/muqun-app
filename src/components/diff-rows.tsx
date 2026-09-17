import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { type LegendListRef, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { AnimatedLegendList } from '@legendapp/list/reanimated';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Text } from '@osuki-dev/ui';
import { ChevronDown, ChevronRight } from 'lucide-react-native';

import { PressableScale } from '@/components/pressable-scale';
// A type-only import, so this module never holds a runtime reference back to
// `pane-chat-blocks` -- which imports `InlineDiffRows` from here.
import type { PaneChatColors } from '@/components/pane-chat-blocks';
import { gitFileStatusWord } from '@/i18n/labels';
import { sideOfFile, type GitDiffRow, type GitDiffRowType } from '@/lib/git-diff';
import { capDiffRows } from '@/lib/agent-diff-rows';

/**
 * A diff, as rows.
 *
 * Both diff surfaces in this app draw from here: the terminal's changes sheet,
 * which pages a repository's patches out of the gateway, and the agent's, which
 * is handed whole patches by `…/vcs/diff` and by an `edit` tool call. They used
 * to be two designs -- a recycled list with a gutter and sticky file headers on
 * one side, a plain `ScrollView` of marker-coloured `<Text>` on the other, in a
 * third set of greens and reds. A diff is the one thing in this app that must
 * look identical wherever it appears, because the reader is comparing columns.
 *
 * Three things here are deliberate and easy to undo by accident.
 *
 * **`recycleItems` is on in `DiffRowList`, and every other list in this app
 * turns it off.** Their performance story is stable row objects plus
 * `React.memo`, which recycling would undo. A diff row is the opposite case: a
 * fixed-height strip of monospace text with two numbers and a background
 * colour, thousands of them, nothing expensive surviving a recycle.
 *
 * **One horizontal scroller wraps the whole list, not one per row.** A
 * `ScrollView` per row is a native scroll view with its own gesture recogniser
 * each, created and destroyed by the hundred under recycling, and on Android
 * nested scrollables steal the vertical pan often enough to be felt. One outer
 * scroller is also the *correct* behaviour: columns stay aligned across rows
 * while panning, which per-row scrollers cannot do.
 *
 * **The gutter and every header stay put while the code pans.** They are
 * counter-translated by the scroller's own offset on the UI thread, so the line
 * numbers, the file being read and the hunk header stay readable at any
 * horizontal position. A diff whose file name has panned off the screen is one
 * you cannot tell apart from the next file's.
 *
 * Wrapping is out: a re-wrapped diff line no longer lines up with the one above
 * it, which is the only thing a diff is read for.
 */

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Fifty `M`s in the row's own style: the one string measured to learn how wide
 * a character is. `M` rather than a space, because a face that turned out not
 * to be monospaced would give a subtly wrong answer for a space and an
 * obviously wrong one for an `M`.
 */
const RULER = 'M'.repeat(50);

export const LINE_FONT_SIZE = 11.5;
export const LINE_ROW_HEIGHT = 18;
// `monospace` is a real family on Android and not on iOS, where it falls back
// to the proportional system font -- and then no two columns line up, which is
// the one thing a diff exists to do. Menlo is what the rest of the app uses
// there (`server-terminal-workspace.tsx`, `ssh-host-form.tsx`).
export const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const HUNK_ROW_HEIGHT = 26;
const FILE_ROW_HEIGHT = 52;
const MORE_ROW_HEIGHT = 44;
/** Two five-digit columns and a marker, with room to breathe. */
const GUTTER_WIDTH = 78;
const LINE_PADDING = 10;

const ROW_HEIGHT: Record<GitDiffRowType, number> = {
  file: FILE_ROW_HEIGHT,
  hunk: HUNK_ROW_HEIGHT,
  line: LINE_ROW_HEIGHT,
  more: MORE_ROW_HEIGHT,
};

/** Matching `pane-chat-view`: the reader's place across a change of data. */
const MAINTAIN_POSITION = { data: true, size: true } as const;

export function keyOfDiffRow(row: GitDiffRow): string {
  return row.key;
}

export function typeOfDiffRow(row: GitDiffRow): GitDiffRowType {
  return row.type;
}

export function sizeOfDiffRow(row: GitDiffRow): number {
  return ROW_HEIGHT[row.type];
}

/**
 * How wide the content is, in character cells: the longest line in hand.
 *
 * Counted over rows rather than measured per row, because the answer is one
 * number for the whole list and it only ever grows as pages arrive.
 */
function widestRow(rows: readonly GitDiffRow[], floor = 0): number {
  let widest = floor;
  for (const row of rows) {
    if (row.type === 'line') {
      if (row.text.length > widest) widest = row.text.length;
    } else if (row.type === 'hunk') {
      if (row.header.length > widest) widest = row.header.length;
    }
  }
  return widest;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * The counter-translation that holds a row's fixed part at the viewport's left
 * edge while the code under it pans.
 *
 * A hook of its own so its exact return type can be named: an animated style
 * handle is generic in the style it produces, and `Animated.View` only accepts
 * the one it was actually given.
 */
function usePinnedStyle(scrollX: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ translateX: scrollX.value }] }));
}

type PinnedStyle = ReturnType<typeof usePinnedStyle>;

export const DiffListRow = memo(function DiffListRow({
  row,
  width,
  pinnedWidth,
  colors,
  gutterFill,
  headerFill,
  scrollX,
  onToggle,
  onShowMore,
  showSide,
}: {
  row: GitDiffRow;
  /** The laid-out width of every row: the panning content. */
  width: number;
  /** The visible width: how much of a row its pinned part may occupy. */
  pinnedWidth: number;
  colors: PaneChatColors;
  gutterFill: string;
  headerFill: string;
  scrollX: SharedValue<number>;
  onToggle: (path: string) => void;
  onShowMore: (path: string) => void;
  /** In the `all` view a file says which side it is on; in a half it need not. */
  showSide: boolean;
}) {
  // One per mounted row rather than one object shared by all of them: a
  // recycled list mounts about forty rows and keeps them, so the hook is paid
  // for once and torn down by React rather than by hand.
  const pinned = usePinnedStyle(scrollX);

  if (row.type === 'file') {
    return (
      <FileRow
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        fill={headerFill}
        pinned={pinned}
        onToggle={onToggle}
        showSide={showSide}
      />
    );
  }
  if (row.type === 'hunk') {
    return (
      <View style={[styles.hunkRow, { width, backgroundColor: gutterFill }]}>
        <Animated.View style={[styles.pinned, pinned, { width: pinnedWidth }]}>
          <Text variant="caption" color={colors.subtle} numberOfLines={1} style={styles.hunkText}>
            {row.header}
          </Text>
        </Animated.View>
      </View>
    );
  }
  if (row.type === 'more') {
    return (
      <ShowMoreRow
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        pinned={pinned}
        onPress={onShowMore}
      />
    );
  }
  return (
    <LineRow row={row} width={width} colors={colors} gutterFill={gutterFill} pinned={pinned} />
  );
});

const LineRow = memo(function LineRow({
  row,
  width,
  colors,
  gutterFill,
  pinned,
}: {
  row: Extract<GitDiffRow, { type: 'line' }>;
  width: number;
  colors: PaneChatColors;
  gutterFill: string;
  pinned: PinnedStyle;
}) {
  const added = row.kind === 'added';
  const removed = row.kind === 'removed';
  const tint = added ? colors.addedBackground : removed ? colors.removedBackground : 'transparent';
  return (
    <View style={[styles.lineRow, { width, backgroundColor: tint }]}>
      {/* The code first and the gutter over it, so panned text slides *under*
          an opaque column rather than out beside it. */}
      <Text
        selectable
        numberOfLines={1}
        style={[
          styles.lineText,
          styles.lineBody,
          { color: added ? colors.added : removed ? colors.removed : colors.muted },
        ]}>
        {row.text || ' '}
      </Text>
      <Animated.View style={[styles.gutter, pinned, { backgroundColor: gutterFill }]}>
        <Text color={colors.subtle} style={styles.gutterNumber}>
          {row.oldLine ?? ''}
        </Text>
        <Text color={colors.subtle} style={styles.gutterNumber}>
          {row.newLine ?? ''}
        </Text>
        <Text
          color={added ? colors.added : removed ? colors.removed : colors.subtle}
          style={styles.gutterMarker}>
          {added ? '+' : removed ? '−' : ' '}
        </Text>
      </Animated.View>
    </View>
  );
});

const FileRow = memo(function FileRow({
  row,
  width,
  pinnedWidth,
  colors,
  fill,
  pinned,
  onToggle,
  showSide,
}: {
  row: Extract<GitDiffRow, { type: 'file' }>;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  fill: string;
  pinned: PinnedStyle;
  onToggle: (path: string) => void;
  showSide: boolean;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const Chevron = row.expanded ? ChevronDown : ChevronRight;
  const fileSide = sideOfFile(row.file);
  // Letters, not words: a phone's file row has room for "+1000 −1000" and one
  // more glyph, and S and U are read the same way in every catalog. The words
  // are on the accessibility label, which is where a screen reader looks.
  const sideMark = fileSide === 'both' ? 'S U' : fileSide === 'staged' ? 'S' : 'U';
  const sideLabel =
    fileSide === 'both' ? t`Staged and unstaged` : fileSide === 'staged' ? t`Staged` : t`Unstaged`;
  const word = _(gitFileStatusWord[row.file.status] ?? gitFileStatusWord.unknown);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ expanded: row.expanded }}
      accessibilityLabel={row.expanded ? t`Hide ${row.path}` : t`Show ${row.path}`}
      feedback="selection"
      pressedScale={0.995}
      onPress={() => onToggle(row.path)}
      // A collapsed file is a line in a list and sits on the sheet's own
      // surface with a hairline under it; the raised fill is for the expanded
      // file only, where the header is also the sticky one and has to read as
      // a band over the code below it. Painting every file row raised turned
      // a six-file list into one beige block that stopped mid-sheet.
      style={[
        styles.fileRow,
        {
          width,
          backgroundColor: row.expanded ? fill : 'transparent',
          borderBottomColor: colors.border,
        },
      ]}>
      <Animated.View style={[styles.pinned, styles.fileBody, pinned, { width: pinnedWidth }]}>
        <Chevron size={15} color={colors.subtle} />
        <View style={styles.flexOne}>
          {/* The tail of a path identifies it on a phone, so the head is what
              gets cut. */}
          <Text variant="bodySmall" numberOfLines={1} ellipsizeMode="head">
            {row.path}
          </Text>
          <View style={styles.fileMeta}>
            <Text variant="caption" color={colors.subtle}>
              {word}
            </Text>
            {row.file.added ? (
              <Text variant="caption" color={colors.added}>
                +{row.file.added}
              </Text>
            ) : null}
            {row.file.removed ? (
              <Text variant="caption" color={colors.removed}>
                −{row.file.removed}
              </Text>
            ) : null}
            {showSide ? (
              <Text
                variant="caption"
                color={colors.subtle}
                accessibilityLabel={sideLabel}
                style={styles.sideMark}>
                {sideMark}
              </Text>
            ) : null}
            {row.note === 'binary' ? (
              <Text variant="caption" color={colors.subtle}>
                <Trans>Binary file</Trans>
              </Text>
            ) : null}
            {row.note === 'empty' ? (
              <Text variant="caption" color={colors.subtle}>
                <Trans>No textual change</Trans>
              </Text>
            ) : null}
            {row.note === 'error' && row.error ? (
              <Text variant="caption" color={colors.status.error} numberOfLines={1}>
                {row.error}
              </Text>
            ) : null}
          </View>
        </View>
        {row.loading ? <ActivityIndicator size="small" color={colors.subtle} /> : null}
      </Animated.View>
    </PressableScale>
  );
});

const ShowMoreRow = memo(function ShowMoreRow({
  row,
  width,
  pinnedWidth,
  colors,
  pinned,
  onPress,
}: {
  row: Extract<GitDiffRow, { type: 'more' }>;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  pinned: PinnedStyle;
  onPress: (path: string) => void;
}) {
  const { t } = useLingui();
  return (
    // An explicit tap, never `onEndReached`. A diff that grows under the reader
    // is the viewport-moving behaviour the house rules forbid, and the reader
    // asking for the rest of a six-thousand-line file is a decision, not a
    // side effect of having scrolled.
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Show more`}
      accessibilityState={{ busy: row.loading }}
      disabled={row.loading}
      onPress={() => onPress(row.path)}
      style={[styles.moreRow, { width }]}>
      <Animated.View style={[styles.pinned, styles.moreBody, pinned, { width: pinnedWidth }]}>
        <View style={[styles.moreChip, { borderColor: colors.border }]}>
          {row.loading ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <Text variant="caption" color={colors.accent}>
              <Trans>Show more</Trans>
            </Text>
          )}
          <Text variant="caption" color={colors.subtle}>
            <Plural value={row.remaining} one="# more line" other="# more lines" />
          </Text>
        </View>
      </Animated.View>
    </PressableScale>
  );
});

// ---------------------------------------------------------------------------
// The two bodies
// ---------------------------------------------------------------------------

/** The hidden ruler: one layout pass, no space at all. See `advance`. */
const DiffRuler = memo(function DiffRuler({
  onLayout,
}: {
  onLayout: (e: LayoutChangeEvent) => void;
}) {
  return (
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      numberOfLines={1}
      onLayout={onLayout}
      style={[styles.lineText, styles.ruler]}>
      {RULER}
    </Text>
  );
});

/**
 * How wide one character is, in points.
 *
 * Measured rather than assumed: a hidden `<Text>` of a known length is laid
 * out once in exactly the row's style, and its width over that length is the
 * advance. That is what makes this right for whatever the platform resolves
 * `monospace` to, on either OS, at whatever text size the reader has chosen.
 * The constant is only what the frame or two before that layout uses; 0.6 em
 * is the ratio every common monospace face is within a few percent of, so the
 * first paint is never wildly wrong and the correction is never visible.
 */
function useDiffMetrics(rows: readonly GitDiffRow[]) {
  const [advance, setAdvance] = useState(LINE_FONT_SIZE * 0.6);
  const onRulerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setAdvance(width / RULER.length);
  }, []);

  const [viewportWidth, setViewportWidth] = useState(0);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  const contentWidth = useMemo(
    () =>
      Math.max(
        viewportWidth,
        // Two cells of slack. The advance is measured rather than exact, and a
        // content width a hair under the true one puts an ellipsis on the
        // single longest line in the file -- which is reliably the line the
        // reader scrolled right to see.
        GUTTER_WIDTH + (widestRow(rows) + 2) * advance + LINE_PADDING * 2
      ),
    [advance, rows, viewportWidth]
  );

  return {
    onRulerLayout,
    onViewportLayout,
    contentWidth,
    pinnedWidth: Math.max(viewportWidth, 1),
  };
}

export interface DiffRowListProps {
  rows: readonly GitDiffRow[];
  colors: PaneChatColors;
  /** The column the line numbers sit on, and the band an open file takes. */
  gutterFill: string;
  headerFill: string;
  /** The scroller's own fill, already through the artwork-opacity slider. */
  surfaceFill: string;
  showSide: boolean;
  onToggleFile: (path: string) => void;
  onShowMore: (path: string) => void;
  /** Drawn in place of the rows when there are none: loading, error or empty. */
  fallback: ReactNode;
  listRef?: React.RefObject<LegendListRef | null>;
}

/**
 * The full-height body: the file list, and a file's patch inserted under it
 * when the reader opens it.
 *
 * The scroll view has to stay one whatever is on screen -- react-native-screens
 * finds it by class among a form sheet's direct children and gives it the
 * sheet's height less the header's. Swap it for a plain `View` while loading
 * and there is no scroll view to find, and the sheet sizes itself to its
 * contents instead. So the fallback goes *inside* it.
 */
export function DiffRowList({
  rows,
  colors,
  gutterFill,
  headerFill,
  surfaceFill,
  showSide,
  onToggleFile,
  onShowMore,
  fallback,
  listRef,
}: DiffRowListProps) {
  const { onRulerLayout, onViewportLayout, contentWidth, pinnedWidth } = useDiffMetrics(rows);

  /**
   * The scroller's offset, on the UI thread.
   *
   * Everything that must stay put -- the gutter, the file header, the hunk
   * header, the "show more" row -- is translated by exactly this, so it lands
   * back at the viewport's left edge on the same frame the code moves under it.
   * A `useState` here would do the same thing one frame late and at sixty
   * re-renders a second.
   */
  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const stickyIndices = useMemo(() => {
    const indices: number[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].type === 'file') indices.push(index);
    }
    return indices;
  }, [rows]);

  const renderRow = useCallback(
    ({ item }: LegendListRenderItemProps<GitDiffRow>) => (
      <DiffListRow
        row={item}
        width={contentWidth}
        pinnedWidth={pinnedWidth}
        colors={colors}
        gutterFill={gutterFill}
        headerFill={headerFill}
        scrollX={scrollX}
        onToggle={onToggleFile}
        onShowMore={onShowMore}
        showSide={showSide}
      />
    ),
    [
      colors,
      contentWidth,
      gutterFill,
      headerFill,
      onShowMore,
      onToggleFile,
      pinnedWidth,
      scrollX,
      showSide,
    ]
  );

  return (
    <>
      <DiffRuler onLayout={onRulerLayout} />
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={rows.length > 0}
        onScroll={onHorizontalScroll}
        scrollEventThrottle={16}
        onLayout={onViewportLayout}
        style={[styles.scroller, { backgroundColor: surfaceFill }]}
        contentContainerStyle={styles.scrollerContent}>
        {rows.length > 0 ? (
          <AnimatedLegendList
            ref={listRef}
            data={rows as GitDiffRow[]}
            keyExtractor={keyOfDiffRow}
            renderItem={renderRow}
            // The whole point of a monospaced one-line row: an exact height per
            // kind, so the list never re-measures and never jumps.
            getFixedItemSize={sizeOfDiffRow}
            // So the pool never hands a file card's view to a code line.
            getItemType={typeOfDiffRow}
            estimatedItemSize={LINE_ROW_HEIGHT}
            // See the note at the top of this file: this is the one list in the
            // app that wants recycling.
            recycleItems
            // Expanding a file inserts rows; the reader's viewport must not
            // move because of it.
            maintainVisibleContentPosition={MAINTAIN_POSITION}
            // The file being read is always named, however deep into its patch
            // the reader has scrolled. Sticky headers need the list's Reanimated
            // integration: the core list drives its scroll view with React
            // Native's `Animated.event`, an object, and handing that to a
            // Reanimated `ScrollView` through `renderScrollComponent` crashed the
            // first fling with "Object is not a function".
            stickyHeaderIndices={stickyIndices}
            style={{ width: contentWidth }}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <View style={[styles.state, { width: pinnedWidth }]}>{fallback}</View>
        )}
      </Animated.ScrollView>
    </>
  );
}

export interface InlineDiffRowsProps {
  rows: readonly GitDiffRow[];
  colors: PaneChatColors;
  gutterFill: string;
  headerFill: string;
  /** How many rows to draw before offering the rest; the default is 60. */
  limit?: number;
  onToggleFile?: (path: string) => void;
}

/**
 * The same rows, inside a timeline cell.
 *
 * `.map()` rather than a list, because a virtualised list inside a virtualised
 * list is the nested-`VirtualizedList` hazard, and because a tool card is not a
 * scroll container: it grows to its content. What bounds it instead is the cap
 * -- the first 60 rows, then an affordance saying how many are left. Tapping it
 * shows the rest, which is a decision the reader makes rather than something
 * that happens to them as they scroll.
 *
 * The horizontal scroller and the pinned gutter are the same mechanism as the
 * full-height body, so a patch read in the transcript and the same patch read
 * in the sheet line up character for character.
 */
export function InlineDiffRows({
  rows,
  colors,
  gutterFill,
  headerFill,
  limit,
  onToggleFile,
}: InlineDiffRowsProps) {
  const { t } = useLingui();
  const [showAll, setShowAll] = useState(false);
  const { onRulerLayout, onViewportLayout, contentWidth, pinnedWidth } = useDiffMetrics(rows);

  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const capped = useMemo(
    () => (showAll ? { rows, hidden: 0 } : capDiffRows(rows, limit)),
    [rows, limit, showAll]
  );

  const noop = useCallback(() => {}, []);

  if (rows.length === 0) return null;

  return (
    <View style={styles.inlineWrap}>
      <DiffRuler onLayout={onRulerLayout} />
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={onHorizontalScroll}
        scrollEventThrottle={16}
        onLayout={onViewportLayout}
        contentContainerStyle={styles.scrollerContent}>
        <View style={{ width: contentWidth }}>
          {capped.rows.map((row) => (
            <DiffListRow
              key={row.key}
              row={row}
              width={contentWidth}
              pinnedWidth={pinnedWidth}
              colors={colors}
              gutterFill={gutterFill}
              headerFill={headerFill}
              scrollX={scrollX}
              onToggle={onToggleFile ?? noop}
              onShowMore={noop}
              showSide={false}
            />
          ))}
        </View>
      </Animated.ScrollView>
      {capped.hidden > 0 ? (
        <PressableScale
          testID="inline-diff-expand"
          accessibilityRole="button"
          accessibilityLabel={t`Show the rest of this diff`}
          onPress={() => setShowAll(true)}
          style={[styles.inlineMore, { borderColor: colors.border }]}>
          <Text variant="caption" color={colors.accent}>
            <Plural value={capped.hidden} one="# more line" other="# more lines" />
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flexOne: {
    flex: 1,
    minWidth: 0,
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
    paddingBottom: 32,
  },
  state: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    paddingVertical: 48,
  },
  inlineWrap: {
    alignSelf: 'stretch',
    gap: 4,
  },
  inlineMore: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  // Every row is laid out at the full content width so its background spans the
  // panned area; only what sits inside `pinned` is held at the viewport.
  pinned: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fileRow: {
    height: FILE_ROW_HEIGHT,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  fileBody: {
    gap: 10,
    paddingHorizontal: LINE_PADDING + 4,
  },
  fileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  sideMark: {
    fontFamily: MONO_FONT,
    letterSpacing: 1,
  },
  hunkRow: {
    height: HUNK_ROW_HEIGHT,
    justifyContent: 'center',
  },
  hunkText: {
    paddingHorizontal: LINE_PADDING,
    fontFamily: MONO_FONT,
    fontSize: 10.5,
  },
  lineRow: {
    height: LINE_ROW_HEIGHT,
    justifyContent: 'center',
  },
  lineText: {
    fontFamily: MONO_FONT,
    fontSize: LINE_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    includeFontPadding: false,
  },
  lineBody: {
    paddingLeft: GUTTER_WIDTH + LINE_PADDING,
    paddingRight: LINE_PADDING,
  },
  gutter: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: GUTTER_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 6,
    gap: 2,
  },
  gutterNumber: {
    width: 30,
    fontSize: 9.5,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'right',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  gutterMarker: {
    width: 8,
    fontSize: 10,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'center',
    includeFontPadding: false,
    fontFamily: MONO_FONT,
  },
  moreRow: {
    height: MORE_ROW_HEIGHT,
    justifyContent: 'center',
  },
  moreBody: {
    paddingHorizontal: LINE_PADDING,
  },
  moreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  ruler: {
    position: 'absolute',
    top: -1000,
    left: 0,
    opacity: 0,
  },
});
