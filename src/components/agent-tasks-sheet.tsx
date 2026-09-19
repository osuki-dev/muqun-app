import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { CheckCircle2, Circle, Clock } from 'lucide-react-native';
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

  return (
    <SheetScene
      testID="agent-tasks-modal"
      title={t`Tasks`}
      caption={t`${done} of ${items.length} done`}>
      <ScrollView
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        showsVerticalScrollIndicator={false}>
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
                      <CheckCircle2 size={16} color={theme.colors.success} strokeWidth={2.2} />
                    ) : running ? (
                      <Clock size={16} color={theme.colors.primary} strokeWidth={2.2} />
                    ) : (
                      <Circle size={15} color={theme.colors.textSubtle} strokeWidth={1.8} />
                    )
                  }
                />
              </Animated.View>
            );
          })
        )}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  empty: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
});
