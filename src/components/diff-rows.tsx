import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ActivityIndicator, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Text } from '@/components/text';
import { ChevronDown, ChevronUp } from 'lucide-react-native';

import { PressableScale } from '@/components/pressable-scale';
// A type-only import, so this module never holds a runtime reference back to
// `pane-chat-blocks` -- which imports `InlineDiffRows` from here.
import type { PaneChatColors } from '@/components/pane-chat-blocks';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { gitFileStatusWord } from '@/i18n/labels';
import { sideOfFile, type GitDiffRow } from '@/lib/git-diff';
import {
  listKeyOfDiffRow,
  stickyDiffRowsOf,
  type DiffListItem,
  type StickyDiffRows,
} from '@/lib/change-tree';
import {
  ChangeTreeActionsRowView,
  ChangeTreeContextRowView,
  ChangeTreeDirRowView,
  ChangeTreeFileRowView,
  type ChangeTreeHandlers,
} from '@/components/change-tree-rows';
import {
  capDiffRows,
  INLINE_DIFF_HARD_CAP,
  INLINE_DIFF_MAX_ROWS,
  stepDiffLimit,
} from '@/lib/agent-diff-rows';
import { cellsOf, gutterNumbersOf, gutterWidthOf } from '@/lib/diff-geometry';

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
 * while panning, which per-row scrollers cannot do. Its scroll indicator shows
 * whenever the content is wider than the viewport, so a line running off the
 * right edge reads as one that pans rather than one that was cut off.
 *
 * **The gutter and every header stay put while the code pans.** They are
 * counter-translated by the scroller's own offset on the UI thread, so the line
 * numbers, the file being read and the hunk header stay readable at any
 * horizontal position. A diff whose file name has panned off the screen is one
 * you cannot tell apart from the next file's.
 *
 * Wrapping is out: a re-wrapped diff line no longer lines up with the one above
 * it, which is the only thing a diff is read for. It was tried once anyway,
 * because nothing on screen said the list panned and long lines read as cut
 * off, and it was taken back out: the owner wants every code line intact on one
 * line, and a diff is read in columns, which wrapping breaks on every long line.
 *
 * The gutter is as wide as the numbers it holds: one number column for a
 * one-sided file (untracked, deleted), two once both sides appear, each as many
 * digits as the largest number needs. The code starts right after it.
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
/** Twenty `0`s in the gutter's number style: how wide a digit of a line number is. */
const NUMBER_RULER = '0'.repeat(20);

export const LINE_FONT_SIZE = 11.5;
export const LINE_ROW_HEIGHT = 18;
const HUNK_ROW_HEIGHT = 26;
const FILE_ROW_HEIGHT = 52;
const MORE_ROW_HEIGHT = 44;
const LINE_PADDING = 10;
const GUTTER_NUMBER_FONT_SIZE = 9.5;
const GUTTER_INSET = 6;
const GUTTER_GAP = 2;
const MARKER_WIDTH = 8;

const ROW_HEIGHT: Record<DiffListItem['type'], number> = {
  file: FILE_ROW_HEIGHT,
  hunk: HUNK_ROW_HEIGHT,
  line: LINE_ROW_HEIGHT,
  more: MORE_ROW_HEIGHT,
  // The agent Changes sheet's tree rows: estimates only, all but one measured.
  dir: 40,
  treeFile: 48,
  context: MORE_ROW_HEIGHT,
  actions: 50,
};

/** Matching `pane-chat-view`: the reader's place across a change of data. */
const MAINTAIN_POSITION = { data: true, size: true } as const;

/**
 * How wide the rows are and where the code starts: one value for a whole list.
 *
 * Handed to the rows by context rather than by props, because the recycled
 * list re-renders a mounted row only when that row's own data changes -- a new
 * `renderItem` alone does not reach it. A context change does.
 */
export interface DiffLayout {
  /** The laid-out width of every row: the panning content. */
  contentWidth: number;
  /** The visible width: how much of a row its pinned part may occupy. */
  pinnedWidth: number;
  gutterWidth: number;
  /** The width of one number column. */
  numberWidth: number;
  numberColumns: 1 | 2;
}

const DiffLayoutContext = createContext<DiffLayout>({
  contentWidth: 1,
  pinnedWidth: 1,
  gutterWidth: 44,
  numberWidth: 12,
  numberColumns: 2,
});

export function typeOfDiffRow(row: DiffListItem): DiffListItem['type'] {
  return row.type;
}

export function sizeOfDiffRow(row: DiffListItem): number {
  return ROW_HEIGHT[row.type];
}

function fixedBodySizeOfDiffRow(row: DiffListItem): number | undefined {
  // Measure file headers so a collapsed prefix does not force LegendList's
  // initial pool to use 52px rows. The 18px hint reserves room for an expansion.
  // Tree rows are measured too: a file name wraps rather than being cut.
  return row.type === 'file' ||
    row.type === 'treeFile' ||
    row.type === 'dir' ||
    row.type === 'actions'
    ? undefined
    : sizeOfDiffRow(row);
}

/**
 * How wide the content is, in character cells: the longest line in hand.
 *
 * Counted over rows rather than measured per row, because the answer is one
 * number for the whole list and it only ever grows as pages arrive. A tab
 * counts as four cells and a wide glyph as two, so a line of either is never
 * laid out short of its ink.
 */
function widestRow(rows: readonly DiffListItem[], floor = 0): number {
  let widest = floor;
  for (const row of rows) {
    if (row.type === 'line') {
      widest = Math.max(widest, cellsOf(row.text));
    } else if (row.type === 'hunk') {
      widest = Math.max(widest, cellsOf(row.header));
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
  colors,
  gutterFill,
  headerFill,
  scrollX,
  onToggle,
  onShowMore,
  showSide,
  hasSeparator,
  tree,
}: {
  row: DiffListItem;
  colors: PaneChatColors;
  gutterFill: string;
  headerFill: string;
  scrollX: SharedValue<number>;
  onToggle: (path: string) => void;
  onShowMore: (path: string) => void;
  /** In the `all` view a file says which side it is on; in a half it need not. */
  showSide: boolean;
  /** Draw a list rule only when another rendered row follows this one. */
  hasSeparator: boolean;
  /** The agent Changes sheet's tree; absent everywhere else. */
  tree?: ChangeTreeHandlers;
}) {
  // One per mounted row rather than one object shared by all of them: a
  // recycled list mounts about forty rows and keeps them, so the hook is paid
  // for once and torn down by React rather than by hand.
  const pinned = usePinnedStyle(scrollX);
  const mono = useMonoFontFamily();
  const { contentWidth: width, pinnedWidth } = useContext(DiffLayoutContext);

  if (row.type === 'dir') {
    return tree ? (
      <ChangeTreeDirRowView
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        pinned={pinned}
        onToggle={tree.onToggleDir}
      />
    ) : null;
  }
  if (row.type === 'treeFile') {
    return (
      <ChangeTreeFileRowView
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        fill={headerFill}
        pinned={pinned}
        hasSeparator={hasSeparator}
        onToggle={onToggle}
        onActions={tree?.onFileActions}
      />
    );
  }
  if (row.type === 'context') {
    return tree ? (
      <ChangeTreeContextRowView
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        colors={colors}
        pinned={pinned}
        onPress={tree.onMoreContext}
      />
    ) : null;
  }
  if (row.type === 'actions') {
    return tree ? (
      <ChangeTreeActionsRowView
        row={row}
        width={width}
        pinnedWidth={pinnedWidth}
        pinned={pinned}
        onDiscard={tree.onDiscard}
      />
    ) : null;
  }
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
        hasSeparator={hasSeparator}
      />
    );
  }
  if (row.type === 'hunk') {
    return (
      <View style={[styles.hunkRow, { width, backgroundColor: gutterFill }]}>
        <Animated.View style={[styles.pinned, pinned, { width: pinnedWidth }]}>
          <Text
            variant="caption"
            color={colors.subtle}
            numberOfLines={1}
            style={[styles.hunkText, { fontFamily: mono }]}>
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
  const mono = useMonoFontFamily();
  const { gutterWidth, numberWidth, numberColumns } = useContext(DiffLayoutContext);
  const added = row.kind === 'added';
  const removed = row.kind === 'removed';
  const tint = added ? colors.addedBackground : removed ? colors.removedBackground : 'transparent';
  const numberStyle = [styles.gutterNumber, { width: numberWidth }];
  return (
    <View style={[styles.lineRow, { width, backgroundColor: tint }]}>
      {/* The code first and the gutter over it, so panned text slides *under*
          an opaque column rather than out beside it. */}
      <Text
        selectable
        numberOfLines={1}
        style={[
          styles.lineText,
          {
            paddingLeft: gutterWidth + LINE_PADDING,
            paddingRight: LINE_PADDING,
            color: added ? colors.added : removed ? colors.removed : colors.muted,
            fontFamily: mono,
          },
        ]}>
        {row.text || ' '}
      </Text>
      <Animated.View
        style={[styles.gutter, pinned, { width: gutterWidth, backgroundColor: gutterFill }]}>
        {numberColumns === 2 ? (
          <>
            <Text hugSlack={false} color={colors.subtle} style={numberStyle}>
              {row.oldLine ?? ''}
            </Text>
            <Text hugSlack={false} color={colors.subtle} style={numberStyle}>
              {row.newLine ?? ''}
            </Text>
          </>
        ) : (
          <Text hugSlack={false} color={colors.subtle} style={numberStyle}>
            {row.newLine ?? row.oldLine ?? ''}
          </Text>
        )}
        <Text
          color={added ? colors.added : removed ? colors.removed : colors.subtle}
          style={[styles.gutterMarker, { fontFamily: mono }]}>
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
  hasSeparator,
}: {
  row: Extract<GitDiffRow, { type: 'file' }>;
  width: number;
  pinnedWidth: number;
  colors: PaneChatColors;
  fill: string;
  pinned: PinnedStyle;
  onToggle: (path: string) => void;
  showSide: boolean;
  hasSeparator: boolean;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const mono = useMonoFontFamily();
  // Closed points down, open points up: the same chevron rule as the rest of
  // the transcript.
  const Chevron = row.expanded ? ChevronUp : ChevronDown;
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
          borderBottomWidth: hasSeparator ? StyleSheet.hairlineWidth : 0,
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
                style={[styles.sideMark, { fontFamily: mono }]}>
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
  const profile = useAppearanceProfile();
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
        <View
          style={[
            styles.moreChip,
            { borderRadius: profile.chrome.control, borderColor: colors.border },
          ]}>
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

/**
 * The hidden rulers: one layout pass each, no space at all. See
 * `useDiffMetrics`.
 *
 * Each sits in a wide, off-screen box so its width is its natural width rather
 * than whatever a narrow transcript cell leaves it -- a ruler cut short by its
 * parent would under-measure the advance.
 */
const DiffRulers = memo(function DiffRulers({
  onCodeLayout,
  onNumberLayout,
}: {
  onCodeLayout: (e: LayoutChangeEvent) => void;
  onNumberLayout: (e: LayoutChangeEvent) => void;
}) {
  // The same family the rows are drawn in, or the measurement is of a face
  // nothing uses: the advance this produces is what every column position in
  // the diff is computed from.
  const mono = useMonoFontFamily();
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.rulerBox}>
      <Text
        hugSlack={false}
        numberOfLines={1}
        onLayout={onCodeLayout}
        style={[styles.lineText, { fontFamily: mono }]}>
        {RULER}
      </Text>
      <Text
        hugSlack={false}
        numberOfLines={1}
        onLayout={onNumberLayout}
        style={styles.gutterNumber}>
        {NUMBER_RULER}
      </Text>
    </View>
  );
});

/**
 * How wide one character and one line-number digit are, in points, and the
 * layout that follows from them.
 *
 * Measured rather than assumed: a hidden `<Text>` of a known length is laid
 * out once in exactly the style it stands for, and its width over that length
 * is the advance. That is what makes this right for whatever the platform
 * resolves `monospace` to, on either OS, at whatever text size the reader has
 * chosen. The constants are only what the frame or two before that layout uses;
 * 0.6 em is the ratio every common monospace face is within a few percent of,
 * so the first paint is never wildly wrong and the correction is never visible.
 */
function useDiffMetrics(rows: readonly DiffListItem[]) {
  const [advance, setAdvance] = useState(LINE_FONT_SIZE * 0.6);
  const onCodeRulerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setAdvance(width / RULER.length);
  }, []);
  const [numberAdvance, setNumberAdvance] = useState(GUTTER_NUMBER_FONT_SIZE * 0.6);
  const onNumberRulerLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setNumberAdvance(width / NUMBER_RULER.length);
  }, []);

  const [viewportWidth, setViewportWidth] = useState(0);
  const onViewportLayout = useCallback((event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  }, []);

  // Counted over the rows rather than per row: the gutter is one width for the
  // whole list, or the code would start at a different x on every line.
  const { digits, numberColumns } = useMemo(() => gutterNumbersOf(rows), [rows]);
  const widest = useMemo(() => widestRow(rows), [rows]);

  const layout = useMemo((): DiffLayout => {
    const gutter = gutterWidthOf({
      digits,
      numberColumns,
      numberAdvance,
      markerWidth: MARKER_WIDTH,
      inset: GUTTER_INSET,
      gap: GUTTER_GAP,
    });
    return {
      contentWidth: Math.max(
        viewportWidth,
        // Two cells of slack. The advance is measured rather than exact, and a
        // content width a hair under the true one puts an ellipsis on the
        // single longest line in the file -- which is reliably the line the
        // reader scrolled right to see.
        gutter.width + (widest + 2) * advance + LINE_PADDING * 2
      ),
      pinnedWidth: Math.max(viewportWidth, 1),
      gutterWidth: gutter.width,
      numberWidth: gutter.numberWidth,
      numberColumns,
    };
  }, [advance, digits, numberAdvance, numberColumns, viewportWidth, widest]);

  return {
    onCodeRulerLayout,
    onNumberRulerLayout,
    onViewportLayout,
    layout,
    // The one sign that the list pans: its scroll indicator, shown only when
    // there is something to pan to.
    pans: viewportWidth > 0 && layout.contentWidth > viewportWidth,
  };
}

/**
 * The scroller's offset, on the UI thread, and the handler that keeps it.
 *
 * Everything that must stay put -- the gutter, the file header, the hunk
 * header, the "show more" row -- is translated by exactly this, so it lands
 * back at the viewport's left edge on the same frame the code moves under it.
 * A `useState` here would do the same thing one frame late and at sixty
 * re-renders a second.
 */
function useHorizontalOffset() {
  const scrollX = useSharedValue(0);
  const onHorizontalScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  return { scrollX, onHorizontalScroll };
}

/**
 * The sticky rows to hand LegendList: `next`, one frame after the rows it was
 * computed from have been committed.
 *
 * LegendList (3.6) drives its sticky headers from a native-driver
 * `Animated.event` on the scroll view, rebuilt whenever `stickyHeaderIndices`
 * changes. Collapsing a long patch shrinks the content and the scroll view
 * clamps its offset in the same commit, and that one scroll event lands while
 * the old native binding is detached and the new one not yet attached: the
 * JS listener sees offset 0, the animated scroll value keeps the old offset,
 * and a pinned header is left translated to where that offset put it. Letting
 * the rows commit first means the clamp goes through the binding that is
 * already there; the binding is swapped a frame later, when nothing scrolls.
 */
function useStickyRowsAfterCommit(next: StickyDiffRows): AppliedStickyRows {
  const [applied, setApplied] = useState<AppliedStickyRows>(() => ({ ...next, version: 0 }));
  useEffect(() => {
    if (sameStickyRows(applied, next)) return;
    const frame = requestAnimationFrame(() =>
      setApplied((current) => ({ ...next, version: current.version + 1 }))
    );
    return () => cancelAnimationFrame(frame);
  }, [applied, next]);
  return applied;
}

function sameStickyRows(a: StickyDiffRows, b: StickyDiffRows): boolean {
  return (
    a.indices.length === b.indices.length &&
    a.indices.every((index, at) => index === b.indices[at]) &&
    a.keys.size === b.keys.size &&
    [...a.keys].every((key) => b.keys.has(key))
  );
}

/**
 * Sticky rows as applied, with a version that changes with them: the rows'
 * keys change with stickiness, and LegendList re-reads keys only when told its
 * data changed.
 */
interface AppliedStickyRows extends StickyDiffRows {
  version: number;
}

export interface DiffRowListProps {
  rows: readonly DiffListItem[];
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
  /** Draw `rows` as the agent Changes sheet's directory tree. */
  tree?: ChangeTreeHandlers;
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
  tree,
}: DiffRowListProps) {
  const { onCodeRulerLayout, onNumberRulerLayout, onViewportLayout, layout, pans } =
    useDiffMetrics(rows);
  const { scrollX, onHorizontalScroll } = useHorizontalOffset();

  const sticky = useStickyRowsAfterCommit(useMemo(() => stickyDiffRowsOf(rows), [rows]));
  // See `listKeyOfDiffRow`: a header's key changes as it becomes sticky, so a
  // header already on screen is moved into a sticky container straight away.
  const keyOfListRow = useCallback(
    (row: DiffListItem) => listKeyOfDiffRow(row, sticky.keys),
    [sticky]
  );

  const renderRow = useCallback(
    ({ item, index }: LegendListRenderItemProps<DiffListItem>) => (
      <DiffListRow
        row={item}
        colors={colors}
        gutterFill={gutterFill}
        headerFill={headerFill}
        scrollX={scrollX}
        onToggle={onToggleFile}
        onShowMore={onShowMore}
        showSide={showSide}
        hasSeparator={index < rows.length - 1}
        tree={tree}
      />
    ),
    [colors, gutterFill, headerFill, onShowMore, onToggleFile, rows.length, scrollX, showSide, tree]
  );

  return (
    <DiffLayoutContext.Provider value={layout}>
      <DiffRulers onCodeLayout={onCodeRulerLayout} onNumberLayout={onNumberRulerLayout} />
      <Animated.ScrollView
        horizontal
        showsHorizontalScrollIndicator={pans}
        onScroll={onHorizontalScroll}
        scrollEventThrottle={16}
        onLayout={onViewportLayout}
        style={[styles.scroller, { backgroundColor: surfaceFill }]}
        contentContainerStyle={styles.scrollerContent}>
        {rows.length > 0 ? (
          <LegendList
            nestedScrollEnabled
            ref={listRef}
            data={rows as DiffListItem[]}
            keyExtractor={keyOfListRow}
            dataVersion={sticky.version}
            renderItem={renderRow}
            // Code rows have exact geometry; file headers are measured so the
            // initial container pool uses the short-row allocation hint.
            getFixedItemSize={fixedBodySizeOfDiffRow}
            // So the pool never hands a file card's view to a code line.
            getItemType={typeOfDiffRow}
            estimatedItemSize={LINE_ROW_HEIGHT}
            // See the note at the top of this file: this is the one list in the
            // app that wants recycling.
            recycleItems
            // Expanding a file inserts rows; the reader's viewport must not
            // move because of it.
            showsVerticalScrollIndicator={false}
            maintainVisibleContentPosition={MAINTAIN_POSITION}
            // Use the core list's native Animated scroll view and sticky engine
            // together. The Reanimated adapter passes web-only hook dependencies
            // on native and logs on every recycled header render.
            stickyHeaderIndices={sticky.indices}
            style={{ width: layout.contentWidth }}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <View style={[styles.state, { width: layout.pinnedWidth }]}>{fallback}</View>
        )}
      </Animated.ScrollView>
    </DiffLayoutContext.Provider>
  );
}

export interface InlineDiffRowsProps {
  rows: readonly GitDiffRow[];
  /** File named by the source card when its patch text does not carry a header. */
  targetPath?: string;
  colors: PaneChatColors;
  gutterFill: string;
  headerFill: string;
  /** How many rows to draw before offering more; the default is 60. */
  limit?: number;
  onToggleFile?: (path: string) => void;
  /**
   * Open the virtualised viewer, for a patch too big to draw in a cell.
   *
   * Without it the block simply stops at the hard cap, which is still better
   * than mounting a thousand animated rows -- but the reader is then told
   * there is more and given no way to it.
   */
  onOpenFullDiff?: (path?: string) => void;
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
  targetPath: targetPathProp,
  colors,
  gutterFill,
  headerFill,
  limit,
  onToggleFile,
  onOpenFullDiff,
}: InlineDiffRowsProps) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const [shownLimit, setShownLimit] = useState(limit ?? INLINE_DIFF_MAX_ROWS);
  const { onCodeRulerLayout, onNumberRulerLayout, onViewportLayout, layout, pans } =
    useDiffMetrics(rows);
  const { scrollX, onHorizontalScroll } = useHorizontalOffset();

  const capped = useMemo(() => capDiffRows(rows, shownLimit), [rows, shownLimit]);
  const targetPath =
    targetPathProp ?? rows.find((row) => row.type === 'file')?.path ?? rows[0]?.path;
  const atHardCap = shownLimit >= INLINE_DIFF_HARD_CAP;
  const showMore = useCallback(() => {
    setShownLimit((current) => stepDiffLimit(current).limit);
  }, []);

  const noop = useCallback(() => {}, []);

  if (rows.length === 0) return null;

  return (
    <View style={styles.inlineWrap}>
      <DiffRulers onCodeLayout={onCodeRulerLayout} onNumberLayout={onNumberRulerLayout} />
      <DiffLayoutContext.Provider value={layout}>
        <Animated.ScrollView
          horizontal
          showsHorizontalScrollIndicator={pans}
          onScroll={onHorizontalScroll}
          scrollEventThrottle={16}
          onLayout={onViewportLayout}
          contentContainerStyle={styles.scrollerContent}>
          <View style={{ width: layout.contentWidth }}>
            {capped.rows.map((row, index) => (
              <DiffListRow
                key={row.key}
                row={row}
                colors={colors}
                gutterFill={gutterFill}
                headerFill={headerFill}
                scrollX={scrollX}
                onToggle={onToggleFile ?? noop}
                onShowMore={noop}
                showSide={false}
                hasSeparator={index < capped.rows.length - 1}
              />
            ))}
          </View>
        </Animated.ScrollView>
      </DiffLayoutContext.Provider>
      {capped.hidden > 0 ? (
        <View style={styles.inlineMoreRow}>
          {/* A step, not "the rest": every row here is a mounted component
              with its own animated style, and this cell is inside a list. */}
          {atHardCap ? null : (
            <PressableScale
              testID="inline-diff-expand"
              accessibilityRole="button"
              accessibilityLabel={t`Show more of this diff`}
              onPress={showMore}
              style={[
                styles.inlineMore,
                { borderRadius: profile.chrome.control, borderColor: colors.border },
              ]}>
              <Text variant="caption" color={colors.accent}>
                <Plural value={capped.hidden} one="# more line" other="# more lines" />
              </Text>
            </PressableScale>
          )}
          {onOpenFullDiff ? (
            <PressableScale
              testID="inline-diff-open-full"
              accessibilityRole="button"
              accessibilityLabel={t`Open this diff in the changes viewer`}
              onPress={() => onOpenFullDiff(targetPath)}
              style={[
                styles.inlineMore,
                { borderRadius: profile.chrome.control, borderColor: colors.border },
              ]}>
              <Text variant="caption" color={colors.accent}>
                <Trans>Open in changes</Trans>
              </Text>
            </PressableScale>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The diff's own metrics, with the family left out on purpose.
 *
 * Until now every mono style here named an exported
 * `MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace'`, and that
 * constant was a statement about the *platform*, not about the reader: a
 * reader who installed their own mono face in Settings > Font saw the markdown
 * fences and the file viewer change over and every diff in the app -- the one
 * surface whose entire argument is that columns line up -- stay on Menlo. The
 * family now comes from `useMonoFontFamily()` at each render site, including
 * the hidden rulers, so the measured advance and the rows it positions are the
 * same face.
 */
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
  inlineMoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  inlineMore: {
    alignSelf: 'flex-start',
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 10,
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
  },
  fileBody: {
    gap: 10,
    paddingHorizontal: LINE_PADDING + 4,
  },
  fileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    // Six, not eight: at eight the status word and the count read as one
    // string with a double space in it -- "Modified  +1".
    gap: 6,
    overflow: 'hidden',
  },
  sideMark: {
    letterSpacing: 1,
  },
  hunkRow: {
    height: HUNK_ROW_HEIGHT,
    justifyContent: 'center',
  },
  hunkText: {
    paddingHorizontal: LINE_PADDING,
    fontSize: 10.5,
  },
  lineRow: {
    height: LINE_ROW_HEIGHT,
    justifyContent: 'center',
  },
  lineText: {
    fontSize: LINE_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    includeFontPadding: false,
  },
  gutter: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: GUTTER_INSET,
    gap: GUTTER_GAP,
  },
  gutterNumber: {
    fontSize: GUTTER_NUMBER_FONT_SIZE,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'right',
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  gutterMarker: {
    width: MARKER_WIDTH,
    fontSize: 10,
    lineHeight: LINE_ROW_HEIGHT,
    textAlign: 'center',
    includeFontPadding: false,
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
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  rulerBox: {
    position: 'absolute',
    top: -1000,
    left: 0,
    width: 4000,
    alignItems: 'flex-start',
    opacity: 0,
  },
});
