import { Card, useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { Text } from '@/components/text';
import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { memo, useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import type { ComposerPopupRow } from '@/lib/composer-popup';
import { fadeInDown, fadeOutDown } from '@/lib/motion';

/**
 * The list the composer raises when a trigger character opens one: slash
 * commands and skills share this panel.
 *
 * Two details are load-bearing rather than cosmetic:
 *
 *  * `keyboardShouldPersistTaps="always"`. A pick happens mid-sentence with the
 *    keyboard up; without this the first tap only dismisses the keyboard, the
 *    panel closes under it because the draft never changed, and the command is
 *    never inserted.
 *  * A fixed viewport. The panel floats over the conversation. LegendList
 *    scrolls the rows that do not fit; a plain stack gets clipped by the dock
 *    and the last row is cut in half.
 */

/** Rows drawn before the list starts scrolling. */
export const COMPOSER_POPUP_VISIBLE_ROWS = 6;
/**
 * A name line, a description line, and the row's vertical padding.
 */
const ROW_HEIGHT = 52;
/** The card's own padding above and below the scroller (`padding="xs"`). */
const CARD_PADDING = 8;

export interface ComposerPopupProps {
  /**
   * Whose commands a `workspace` badge names: the terminal's come from its
   * Herdr workspace, OpenCode's from its project. One badge, each screen's word.
   */
  scope?: 'workspace' | 'project';
  rows: readonly ComposerPopupRow[];
  onPick: (row: ComposerPopupRow) => void;
  /**
   * The most room the panel has above the dock, when the screen it is on knows.
   *
   * Without one the panel took its rows wherever they landed, which with the
   * keyboard up meant growing through the header and off the top of the
   * screen -- and the row that ran out of screen was cut in half.
   */
  maxHeight?: number;
  /** Prefix for row test IDs, so two triggers can be told apart in a flow. */
  testIDPrefix?: string;
}

export function ComposerPopup({
  rows,
  onPick,
  maxHeight,
  testIDPrefix = 'composer-popup',
}: ComposerPopupProps) {
  /**
   * A row's real height, measured rather than assumed.
   *
   * `ROW_HEIGHT` is the estimate the viewport was built from. The first row
   * that lays out says what a row costs, and the viewport is a whole number
   * of those so the last visible row is not sliced by the card.
   */
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  const onMeasured = useCallback((height: number) => {
    setRowHeight((current) => (height > current ? height : current));
  }, []);
  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<ComposerPopupRow>) => (
      <PopupRow item={item} onPick={onPick} testIDPrefix={testIDPrefix} onMeasured={onMeasured} />
    ),
    [onMeasured, onPick, testIDPrefix]
  );
  if (rows.length === 0) return null;

  const wanted = Math.min(rows.length, COMPOSER_POPUP_VISIBLE_ROWS) * rowHeight;
  const room =
    maxHeight === undefined
      ? wanted
      : Math.max(rowHeight, Math.floor((maxHeight - CARD_PADDING) / rowHeight) * rowHeight);
  const listHeight = Math.min(wanted, room);

  return (
    <Animated.View
      entering={fadeInDown('dropdown')}
      exiting={fadeOutDown('micro')}
      testID={testIDPrefix}>
      <Card variant="raised" radius="md" padding="xs">
        <LegendList
          data={rows}
          dataKey={testIDPrefix}
          keyExtractor={rowKey}
          renderItem={renderItem}
          recycleItems
          estimatedItemSize={ROW_HEIGHT}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          nestedScrollEnabled
          style={{ height: listHeight }}
        />
      </Card>
    </Animated.View>
  );
}

function rowKey(row: ComposerPopupRow): string {
  return row.id;
}

const PopupRow = memo(function PopupRow({
  item,
  onPick,
  testIDPrefix,
  onMeasured,
}: {
  item: ComposerPopupRow;
  onPick: (row: ComposerPopupRow) => void;
  testIDPrefix: string;
  onMeasured: (height: number) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  return (
    <PressableScale
      onPress={() => onPick(item)}
      accessibilityRole="button"
      accessibilityLabel={
        item.hint ? t`Insert ${item.label} ${item.hint}` : t`Insert ${item.label}`
      }
      testID={`${testIDPrefix}-${item.id}`}
      onLayout={(event) => {
        const height = event.nativeEvent.layout.height;
        if (height > 0) onMeasured(height);
      }}
      style={styles.row}>
      <Text variant="bodySmall" weight="bold" colorKey="text" numberOfLines={1}>
        {item.label}
        {item.hint ? (
          <Text variant="caption" color={theme.colors.textMuted}>
            {`  ${item.hint}`}
          </Text>
        ) : null}
      </Text>
      {item.description ? (
        <Text variant="caption" colorKey="textMuted" numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 1,
  },
});
