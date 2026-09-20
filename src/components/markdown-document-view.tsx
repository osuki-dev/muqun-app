import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { BoundedMarkdown } from '@/components/bounded-markdown';
import { MARKDOWN_BLOCK_CHUNK_CHARS, splitMarkdownBlocks } from '@/lib/markdown-blocks';

/**
 * A document, as many small markdown views instead of one enormous one.
 *
 * `BoundedMarkdown` is the rule that no native markdown view is ever handed an
 * unbounded string, and it stays: a view that measures its whole document in
 * one shadow node took the process down with it once already
 * (`markdown-cap.ts`). What it cannot do on its own is show a 300 KB README --
 * under that rule alone the reader taps "Show more" twenty-five times.
 *
 * So the document is cut on block boundaries and each chunk becomes a cell.
 * Only the cells near the viewport are mounted, each is a few thousand
 * characters, and every one of them is inside the bound rather than around it.
 * The reader scrolls one document; the app draws a screenful.
 *
 * `splitMarkdownBlocks` is what makes the cut safe -- never inside a fence, a
 * table or a list -- and its chunks rejoin to the original, so nothing here has
 * to say "approximately".
 */
export interface MarkdownDocumentViewProps {
  markdown: string;
  markdownStyle: MarkdownStyle;
  selectionColor?: string;
  /** Padding the list's content wears, so the cells sit where prose sat before. */
  contentInsets?: { top?: number; bottom?: number; horizontal?: number };
  testID?: string;
}

/**
 * A cell's size class.
 *
 * A single average across a page-long chunk and a two-line one is what makes a
 * virtualized list jump when a cell above the viewport measures. The chunker
 * packs to a target, so length is a good predictor of height and three buckets
 * are enough for the list to learn a size for each.
 */
function sizeClassOf(chunk: string): 'small' | 'medium' | 'large' {
  if (chunk.length < MARKDOWN_BLOCK_CHUNK_CHARS / 4) return 'small';
  if (chunk.length <= MARKDOWN_BLOCK_CHUNK_CHARS) return 'medium';
  return 'large';
}

/** A chunk of the target size is roughly this tall on a phone; the list measures from there. */
const ESTIMATED_CELL_HEIGHT = 420;

export function MarkdownDocumentView({
  markdown,
  markdownStyle,
  selectionColor,
  contentInsets,
  testID,
}: MarkdownDocumentViewProps) {
  const chunks = useMemo(() => splitMarkdownBlocks(markdown), [markdown]);

  const renderChunk = useCallback(
    ({ item }: LegendListRenderItemProps<string>) => (
      <BoundedMarkdown
        markdown={item}
        markdownStyle={markdownStyle}
        flavor="github"
        latexMath
        selectionColor={selectionColor}
      />
    ),
    [markdownStyle, selectionColor]
  );

  // A chunk is not its own identity: a document repeats itself, and two
  // identical paragraphs are two cells. Its place in the document is.
  const keyOfChunk = useCallback((_chunk: string, index: number) => String(index), []);
  const typeOfChunk = useCallback((chunk: string) => sizeClassOf(chunk), []);

  const contentStyle = useMemo(
    () => ({
      paddingTop: contentInsets?.top ?? 12,
      paddingBottom: contentInsets?.bottom ?? 40,
      paddingHorizontal: contentInsets?.horizontal ?? 16,
    }),
    [contentInsets?.bottom, contentInsets?.horizontal, contentInsets?.top]
  );

  return (
    <View style={styles.body} testID={testID}>
      <LegendList
        data={chunks}
        keyExtractor={keyOfChunk}
        renderItem={renderChunk}
        getItemType={typeOfChunk}
        estimatedItemSize={ESTIMATED_CELL_HEIGHT}
        // Never. Each cell is a native markdown view with its own parse behind
        // it and its own "Show more" state in front of it; recycling one into
        // another cell's content is the one thing that would undo both.
        recycleItems={false}
        // A cell that measures taller than its estimate must not move what the
        // reader is looking at, which is the whole reason a long document
        // scrolls here instead of being refused.
        maintainVisibleContentPosition={MAINTAIN_POSITION}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={contentStyle}
      />
    </View>
  );
}

/** Matching `pane-chat-view`: the reader's place across a change of data. */
const MAINTAIN_POSITION = { data: true, size: true } as const;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
  },
});
