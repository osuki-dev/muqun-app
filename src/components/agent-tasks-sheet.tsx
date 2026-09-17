import { memo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentTodoBlock } from '@/components/agent-todo-block';
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER } from '@/components/settings-chrome';
import type { TodoItem } from '@/lib/agent-session';

/**
 * The agent's task list, as a native form sheet route.
 *
 * It used to be a transparent react-native modal written inline in
 * `agent-workbench`, with a hand-drawn grabber and a corner radius four points
 * off every other sheet's. There is nothing here the shared frame does not
 * already do.
 */
export const AgentTasksSheet = memo(function AgentTasksSheet({
  items,
  onClose,
}: {
  items: readonly TodoItem[];
  onClose: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();

  return (
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-tasks-modal" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                <Trans>Tasks Progress</Trans>
              </Text>
              <Text variant="caption" color={theme.colors.textMuted}>
                {`${items.filter((item) => item.done).length}/${items.length}`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-tasks-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>

        <ScrollView
          style={styles.scrollViewport}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: LADDER.section + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}>
          <AgentTodoBlock items={items} defaultExpanded />
        </ScrollView>
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  sheetLayout: {
    flex: 1,
  },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap * 1.5,
    paddingBottom: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  headerButtonHit: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
  },
});
