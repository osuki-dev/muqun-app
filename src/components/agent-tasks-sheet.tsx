import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useThemeTokens, Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { CompletedIcon, PendingIcon, TimeIcon } from '@/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import type { TodoItem } from '@/lib/agent-session';

const STAGGERED_ROWS = 8;

/**
 * The agent's task list, as a native form sheet route.
 *
 * An inspector: the same heading and ground as every picker, then rows. State
 * is the leading glyph and nothing else -- done, in progress, waiting -- so the
 * column reads top to bottom without a legend.
 */
export const AgentTasksSheet = memo(function AgentTasksSheet({
  items,
  onClose: _onClose,
}: {
  items: readonly TodoItem[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();

  const done = items.filter((item) => item.done).length;
  const firstPending = items.findIndex((item) => !item.done);

  const contentSized = items.length <= 4;

  const content = (
    <>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text variant="caption" color={theme.colors.textMuted}>
            {t`No tasks in this session yet.`}
          </Text>
        </View>
      ) : (
        items.map((item, index) => {
          const running = !item.done && index === firstPending;
          return (
            <Animated.View
              key={item.text}
              entering={index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')}
              layout={listLayout('short')}>
              <SheetSceneRow
                title={item.text}
                selected={running}
                leading={
                  item.done ? (
                    <CompletedIcon size={16} color={theme.colors.success} />
                  ) : running ? (
                    <TimeIcon size={16} color={theme.colors.primary} />
                  ) : (
                    <PendingIcon size={15} color={theme.colors.textSubtle} />
                  )
                }
              />
            </Animated.View>
          );
        })
      )}
      <SheetSceneFooter bottomInset={insets.bottom} />
    </>
  );

  return (
    <SheetScene
      testID="agent-tasks-modal"
      title={t`Tasks`}
      caption={t`${done} of ${items.length} done`}
      contentSized={contentSized}>
      {contentSized ? (
        <View style={sheetSceneStyles.scrollerContent}>{content}</View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          {content}
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
});
