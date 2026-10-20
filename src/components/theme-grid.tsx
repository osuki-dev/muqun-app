import { LegendList } from '@legendapp/list/react-native';
import { useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SheetSceneFooter, SHEET_LADDER } from '@/components/sheet-scene';
import { THEME_GRID_GAP, themeGridLayout, type ThemeGridLayout } from '@/components/theme-card';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';

/**
 * The card grid every tab of the themes sheet scrolls: two columns on a phone,
 * three or four on a tablet, virtualized, with every cell the same known
 * height so nothing is measured on the way in.
 *
 * The column count comes from the width the grid actually has -- a Pad shows
 * the sheet as a panel or full-screen, and the window's width says neither --
 * so it measures its own frame and starts from the window until it has.
 *
 * `nestedScrollEnabled` for the reason every sheet scroller sets it: Android's
 * sheet behaviour only hands a downward drag to a list that says it scrolls.
 */
export function ThemeGrid<T>({
  testID,
  data,
  keyOf,
  renderCard,
  extraData,
  empty,
  footer,
  onEndReached,
}: {
  testID?: string;
  data: readonly T[];
  keyOf: (item: T) => string;
  renderCard: (item: T, index: number, layout: ThemeGridLayout) => ReactNode;
  /** Everything a card draws that is not its own item, as a value that compares cheaply. */
  extraData?: string;
  empty?: ReactElement | null;
  footer?: ReactNode;
  onEndReached?: () => void;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [measured, setMeasured] = useState<number | null>(null);
  const width =
    measured ?? Math.min(window.width, THEME_PICKER_MAX_CONTENT_WIDTH) - SHEET_LADDER.gutter * 2;
  const layout = themeGridLayout(width, window.fontScale);

  return (
    <View
      style={styles.frame}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width - SHEET_LADDER.gutter * 2;
        if (next > 0 && next !== measured) setMeasured(next);
      }}>
      <LegendList
        testID={testID}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        data={data}
        // A change of column count is a different arrangement of the same
        // cards, and the list is told so rather than left to reuse positions.
        dataKey={`columns-${layout.columns}`}
        numColumns={layout.columns}
        columnWrapperStyle={{ columnGap: THEME_GRID_GAP }}
        keyExtractor={keyOf}
        extraData={`${extraData ?? ''}|${layout.itemHeight}`}
        // Never: a card owns a picture, and recycling would hand one theme's
        // picture to another for a frame.
        recycleItems={false}
        getFixedItemSize={() => layout.itemHeight}
        estimatedItemSize={layout.itemHeight}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        renderItem={({ item, index }: { item: T; index: number }) => (
          // The gap under a card is part of its cell, so the fixed size the
          // list is told is the whole of what the cell occupies.
          <View style={{ height: layout.itemHeight, paddingBottom: THEME_GRID_GAP }}>
            {renderCard(item, index, layout)}
          </View>
        )}
        ListEmptyComponent={empty}
        ListFooterComponent={
          <>
            {footer}
            <SheetSceneFooter bottomInset={insets.bottom} />
          </>
        }
        style={styles.list}
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // The gutter is the frame's, not the content's, so the width the columns
  // divide is exactly the width that was measured.
  frame: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: SHEET_LADDER.gutter,
  },
  list: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: { flexGrow: 1, paddingTop: SHEET_LADDER.gap },
});
