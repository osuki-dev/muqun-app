import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
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
import {
  codeColumns,
  gutterNumbersOf,
  gutterWidthOf,
  visualLines,
  wrapForColumns,
} from '@/lib/diff-wrap';

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
 * strip of monospace text with two numbers and a background colour, thousands
 * of them, nothing expensive surviving a recycle.
 *
 * **A long line wraps at the viewport; nothing pans.** This used to be one
 * horizontal scroller around the whole list, with the gutter and the headers
 * counter-translated so they stayed put while the code slid under them.
 * Nothing on screen said the list panned, so a line running off the right edge
 * read as a line cut off -- and on a phone that is most lines of a real file.
 * Now a line longer than the code column continues on the next visual line,
 * indented to the code column, with the line number and marker on its first
 * visual line only, so a wrapped line still reads as one line of the file. The
 * break is at the character cell, not at a space: this is code, and the reader
 * is looking for the character.
 *
 * **Row heights are computed, not measured.** The list recycles with exact
 * geometry (`getFixedItemSize`), which is what lets it jump straight to a file,
 * keep the reader's place across an insertion and never reflow a row under a
 * scroll; a measured row gives all of that up. So the code column's width in
 * character cells is worked out once per list from the measured monospace
 * advance (the hidden ruler below), each line's visual line count follows from
 * its length, and the text is drawn pre-split into chunks of exactly that many
 * cells joined by newlines -- the platform's own word-wrapping breaks earlier,
 * at spaces, and would disagree with the computed height. The arithmetic is in
 * `@/lib/diff-wrap`. The one side effect a reader can notice: copying a
 * wrapped line copies its breaks too.
 *
 * The gutter is as wide as the numbers it holds: one number column for a
 * one-sided file (untracked, deleted), two once both sides appear, each as many
 * digits as the largest number needs.
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
 * Where the code starts and how much of it fits on a visual line: one value
 * for a whole list.
 *
 * Handed to the rows by context rather than by props, because the recycled
 * list re-renders a mounted row only when that row's own data changes -- a new
 * `renderItem` alone does not reach it. A context change does.
 */
export interface DiffLayout {
  /** Character cells of code per visual line. */
  columns: number;
  gutterWidth: number;
  /** The width of one number column. */
  numberWidth: number;
  numberColumns: 1 | 2;
}

const DiffLayoutContext = createContext<DiffLayout>({
  columns: 40,
  gutterWidth: 44,
  numberWidth: 12,
  numberColumns: 2,
});

export function typeOfDiffRow(row: DiffListItem): DiffListItem['type'] {
  return row.type;
}

/** A row's exact height at `layout`: a wrapped line is one strip per visual line. */
export function sizeOfDiffRow(row: DiffListItem, layout: DiffLayout): number {
  if (row.type === 'line') return visualLines(row.text, layout.columns) * LINE_ROW_HEIGHT;
  if (row.type === 'hunk') {
    // The first line keeps the hunk band's height; a continuation is a code line.
    return HUNK_ROW_HEIGHT + (visualLines(row.header, layout.columns) - 1) * LINE_ROW_HEIGHT;
  }
  return ROW_HEIGHT[row.type];
}

function fixedBodySizeOfDiffRow(row: DiffListItem, layout: DiffLayout): number | undefined {
  // Measure file headers so a collapsed prefix does not force LegendList's
  // initial pool to use 52px rows. The 18px hint reserves room for an expansion.
  // Tree rows are measured too: a file name wraps rather than being cut.
  return row.type === 'file' ||
    row.type === 'treeFile' ||
    row.type === 'dir' ||
    row.type === 'actions'
    ? undefined
    : sizeOfDiffRow(row, layout);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export const DiffListRow = memo(function DiffListRow({
  row,
  colors,
  gutterFill,
  headerFill,
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
  onToggle: (path: string) => void;
  onShowMore: (path: string) => void;
  /** In the `all` view a file says which side it is on; in a half it need not. */
  showSide: boolean;
  /** Draw a list rule only when another rendered row follows this one. */
  hasSeparator: boolean;
  /** The agent Changes sheet's tree; absent everywhere else. */
  tree?: ChangeTreeHandlers;
}) {
  if (row.type === 'dir') {
    return tree ? (
      <ChangeTreeDirRowView row={row} colors={colors} onToggle={tree.onToggleDir} />
    ) : null;
  }
  if (row.type === 'treeFile') {
    return (
      <ChangeTreeFileRowView
        row={row}
        colors={colors}
        fill={headerFill}
        hasSeparator={hasSeparator}
        onToggle={onToggle}
        onActions={tree?.onFileActions}
      />
    );
  }
  if (row.type === 'context') {
    return tree ? (
      <ChangeTreeContextRowView row={row} colors={colors} onPress={tree.onMoreContext} />
    ) : null;
  }
  if (row.type === 'actions') {
    return tree ? <ChangeTreeActionsRowView row={row} onDiscard={tree.onDiscard} /> : null;
  }
  if (row.type === 'file') {
    return (
      <FileRow
        row={row}
        colors={colors}
        fill={headerFill}
        onToggle={onToggle}
        showSide={showSide}
        hasSeparator={hasSeparator}
      />
    );
  }
  if (row.type === 'hunk') {
    return <HunkRow row={row} colors={colors} gutterFill={gutterFill} />;
  }
  if (row.type === 'more') {
    return <ShowMoreRow row={row} colors={colors} onPress={onShowMore} />;
  }
  return <LineRow row={row} colors={colors} gutterFill={gutterFill} />;
});

const HunkRow = memo(function HunkRow({
  row,
  colors,
  gutterFill,
}: {
  row: Extract<GitDiffRow, { type: 'hunk' }>;
  colors: PaneChatColors;
  gutterFill: string;
}) {
  const mono = useMonoFontFamily();
  const { columns } = useContext(DiffLayoutContext);
  const lines = visualLines(row.header, columns);
  const wrapped = wrapForColumns(row.header, columns);
  const breakAt = wrapped.indexOf('\n');
  const first = breakAt < 0 ? wrapped : wrapped.slice(0, breakAt);
  const rest = breakAt < 0 ? '' : wrapped.slice(breakAt + 1);
  return (
    <View
      style={[
        styles.hunkRow,
        {
          height: HUNK_ROW_HEIGHT + (lines - 1) * LINE_ROW_HEIGHT,
          backgroundColor: gutterFill,
        },
      ]}>
      {/* The first line keeps the hunk band's own height; what wraps continues
          under it at the code's line height. */}
      <View style={styles.hunkHead}>
        <Text
          variant="caption"
          color={colors.subtle}
          numberOfLines={1}
          style={[styles.hunkText, { fontFamily: mono }]}>
          {first}
        </Text>
      </View>
      {rest ? (
        <Text
          variant="caption"
          color={colors.subtle}
          numberOfLines={lines - 1}
          style={[styles.hunkText, styles.hunkMore, { fontFamily: mono }]}>
          {rest}
        </Text>
      ) : null}
    </View>
  );
});

const LineRow = memo(function LineRow({
  row,
  colors,
  gutterFill,
}: {
  row: Extract<GitDiffRow, { type: 'line' }>;
  colors: PaneChatColors;
  gutterFill: string;
}) {
  const mono = useMonoFontFamily();
  const { columns, gutterWidth, numberWidth, numberColumns } = useContext(DiffLayoutContext);
  const added = row.kind === 'added';
  const removed = row.kind === 'removed';
  const tint = added ? colors.addedBackground : removed ? colors.removedBackground : 'transparent';
  const lines = visualLines(row.text, columns);
  const numberStyle = [styles.gutterNumber, { width: numberWidth }];
  return (
    <View style={[styles.lineRow, { height: lines * LINE_ROW_HEIGHT, backgroundColor: tint }]}>
      {/* Exactly `lines` lines: every chunk fits the column by construction, and
          the cap only guards a face whose glyphs outrun the measured advance. */}
      <Text
        selectable
        numberOfLines={lines}
        style={[
          styles.lineText,
          {
            paddingLeft: gutterWidth + LINE_PADDING,
            paddingRight: LINE_PADDING,
            color: added ? colors.added : removed ? colors.removed : colors.muted,
            fontFamily: mono,
          },
        ]}>
        {row.text ? wrapForColumns(row.text, columns) : ' '}
      </Text>
      {/* Full height, so a wrapped line's continuation has an empty gutter
          beside it in the same fill; the numbers sit on the first line. */}
      <View style={[styles.gutter, { width: gutterWidth, backgroundColor: gutterFill }]}>
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
      </View>
    </View>
  );
});

const FileRow = memo(function FileRow({
  row,
  colors,
  fill,
  onToggle,
  showSide,
  hasSeparator,
}: {
  row: Extract<GitDiffRow, { type: 'file' }>;
  colors: PaneChatColors;
  fill: string;
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
          backgroundColor: row.expanded ? fill : 'transparent',
          borderBottomColor: colors.border,
          borderBottomWidth: hasSeparator ? StyleSheet.hairlineWidth : 0,
        },
      ]}>
      <View style={[styles.rowFill, styles.fileBody]}>
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
      </View>
    </PressableScale>
  );
});

const ShowMoreRow = memo(function ShowMoreRow({
  row,
  colors,
  onPress,
}: {
  row: Extract<GitDiffRow, { type: 'more' }>;
  colors: PaneChatColors;
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
      style={styles.moreRow}>
      <View style={[styles.rowFill, styles.moreBody]}>
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
      </View>
    </PressableScale>
  );
});

// ---------------------------------------------------------------------------
// The two bodies
// ---------------------------------------------------------------------------

/**
 * The hidden rulers: one layout pass each, no space at all. See
 * `useDiffLayout`.
 *
 * Each sits in a wide, off-screen box so its width is its natural width rather
 * than whatever a narrow transcript cell leaves it -- a ruler cut short by its
 * parent would under-measure the advance and over-fill every line.
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
 * Where the code starts and how many cells of it fit, for `rows` in a viewport
 * whose width is reported to `onViewportLayout`.
 *
 * Both advances are measured rather than assumed: a hidden `<Text>` of a known
 * length is laid out once in exactly the style it stands for, and its width
 * over that length is the advance. That is what makes this right for whatever
 * the platform resolves `monospace` to, on either OS, at whatever text size the
 * reader has chosen. The constants are only what the frame or two before that
 * layout uses; 0.6 em is the ratio every common monospace face is within a few
 * percent of, so the first paint is never wildly wrong. The window's width
 * stands in for the viewport's the same way until the viewport has one.
 */
function useDiffLayout(rows: readonly DiffListItem[]) {
  const window = useWindowDimensions();
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
  const numbers = useMemo(() => gutterNumbersOf(rows), [rows]);
  const { digits, numberColumns } = numbers;
  const width = viewportWidth > 0 ? viewportWidth : window.width;

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
      columns: codeColumns({
        viewportWidth: width,
        gutterWidth: gutter.width,
        padding: LINE_PADDING,
        advance,
      }),
      gutterWidth: gutter.width,
      numberWidth: gutter.numberWidth,
      numberColumns,
    };
  }, [advance, digits, numberAdvance, numberColumns, width]);

  return { onCodeRulerLayout, onNumberRulerLayout, onViewportLayout, layout };
}

/**
 * Drops the list's cached row sizes when the wrap width changes.
 *
 * The list keeps every size it has learned by key, and a row's computed height
 * is a function of `columns`: after a rotation, a corrected advance or a gutter
 * that grew a digit, every cached height is a height at the old width.
 */
function useResetSizesOnWrapChange(
  listRef: React.RefObject<LegendListRef | null>,
  columns: number
) {
  const seen = useRef(columns);
  useLayoutEffect(() => {
    if (seen.current === columns) return;
    seen.current = columns;
    listRef.current?.clearCaches();
  }, [columns, listRef]);
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
 * contents instead. So the list is always mounted, and the fallback is its
 * empty component.
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
  const { onCodeRulerLayout, onNumberRulerLayout, onViewportLayout, layout } = useDiffLayout(rows);
  const ownRef = useRef<LegendListRef>(null);
  const ref = listRef ?? ownRef;
  useResetSizesOnWrapChange(ref, layout.columns);

  const getFixedItemSize = useCallback(
    (row: DiffListItem) => fixedBodySizeOfDiffRow(row, layout),
    [layout]
  );

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
        onToggle={onToggleFile}
        onShowMore={onShowMore}
        showSide={showSide}
        hasSeparator={index < rows.length - 1}
        tree={tree}
      />
    ),
    [colors, gutterFill, headerFill, onShowMore, onToggleFile, rows.length, showSide, tree]
  );

  return (
    <DiffLayoutContext.Provider value={layout}>
      <DiffRulers onCodeLayout={onCodeRulerLayout} onNumberLayout={onNumberRulerLayout} />
      <LegendList
        nestedScrollEnabled
        ref={ref}
        data={rows as DiffListItem[]}
        keyExtractor={keyOfListRow}
        dataVersion={sticky.version}
        renderItem={renderRow}
        // Code rows have exact, computed geometry; file headers are measured so
        // the initial container pool uses the short-row allocation hint.
        getFixedItemSize={getFixedItemSize}
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
        onLayout={onViewportLayout}
        ListEmptyComponent={<View style={styles.state}>{fallback}</View>}
        style={[styles.scroller, { backgroundColor: surfaceFill }]}
        contentContainerStyle={rows.length > 0 ? styles.listContent : styles.emptyContent}
      />
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
   * than mounting a thousand rows -- but the reader is then told there is more
   * and given no way to it.
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
 * The wrapping and the gutter are the same arithmetic as the full-height body,
 * so a patch read in the transcript and the same patch read in the sheet break
 * at the same character whenever the two are the same width.
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
  const { onCodeRulerLayout, onNumberRulerLayout, onViewportLayout, layout } = useDiffLayout(rows);

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
        <View onLayout={onViewportLayout}>
          {capped.rows.map((row, index) => (
            <DiffListRow
              key={row.key}
              row={row}
              colors={colors}
              gutterFill={gutterFill}
              headerFill={headerFill}
              onToggle={onToggleFile ?? noop}
              onShowMore={noop}
              showSide={false}
              hasSeparator={index < capped.rows.length - 1}
            />
          ))}
        </View>
      </DiffLayoutContext.Provider>
      {capped.hidden > 0 ? (
        <View style={styles.inlineMoreRow}>
          {/* A step, not "the rest": every row here is a mounted component,
              and this cell is inside a list. */}
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
 * the hidden ruler, so the measured advance and the rows it positions are the
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
  emptyContent: {
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
  // A fixed-height row's content, filling it and centred on its cross axis.
  rowFill: {
    position: 'absolute',
    left: 0,
    right: 0,
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
    justifyContent: 'flex-start',
  },
  hunkHead: {
    height: HUNK_ROW_HEIGHT,
    justifyContent: 'center',
  },
  hunkText: {
    paddingHorizontal: LINE_PADDING,
    fontSize: 10.5,
  },
  hunkMore: {
    lineHeight: LINE_ROW_HEIGHT,
    includeFontPadding: false,
  },
  lineRow: {
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
    alignItems: 'flex-start',
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
