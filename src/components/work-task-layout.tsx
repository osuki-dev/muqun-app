import { type ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { X } from 'lucide-react-native';
import { SheetFrame, useSheetGroundPlate } from './sheet-ground';
import { GlassChrome } from './glass-chrome';
import { PressableScale } from './pressable-scale';
import { workTaskPaneMetrics } from '@/lib/work-task-layout';
import { WorkTaskScroll, type WorkScrollBinding } from './work-task-scroll';

/** One stable pane tree and one keyboard source. Resizing never invokes controller actions. */
export function WorkTaskLayout({
  title,
  caption,
  closeLabel,
  onClose,
  view,
  list,
  children,
  creation,
  composer,
  creationComposer,
  listBinding,
  detailBinding,
  detailKey,
  notice,
}: {
  title: string;
  caption: string;
  closeLabel: string;
  onClose: () => void;
  view: 'list' | 'detail' | 'create';
  list: ReactNode;
  children: ReactNode;
  creation: ReactNode;
  composer: ReactNode;
  creationComposer: ReactNode;
  listBinding?: WorkScrollBinding;
  detailBinding?: WorkScrollBinding;
  detailKey: string;
  notice?: ReactNode;
}) {
  const theme = useThemeTokens();
  const plate = useSheetGroundPlate('surface');
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { height } = useReanimatedKeyboardAnimation();
  const [width, setWidth] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [dockHeight, setDockHeight] = useState(0);
  const metrics = workTaskPaneMetrics(width, fontScale);
  const listVisible = metrics.split || view === 'list';
  const detailVisible = metrics.split || view !== 'list';
  // The safe viewport already spends the bottom inset. Only the uncovered
  // keyboard portion shrinks this region; no sticky view or second translation.
  const keyboardStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -height.value - insets.bottom),
  }));
  const dockStyle = useAnimatedStyle(() => ({
    maxHeight: Math.max(0, (viewport - Math.max(0, -height.value - insets.bottom)) * 0.6),
  }));
  return (
    <SafeAreaView
      edges={['top', 'bottom', 'left', 'right']}
      style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <SheetFrame testID="settings-sheet-scene">
        <View style={styles.header}>
          <View style={[styles.headerCopy, plate]}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={title}
              numberOfLines={2}
              variant="heading">
              {title}
            </Text>
            <Text accessibilityLabel={caption} numberOfLines={2} variant="caption">
              {caption}
            </Text>
          </View>
          <GlassChrome face="sheet" style={styles.close}>
            <PressableScale accessibilityLabel={closeLabel} onPress={onClose} style={styles.close}>
              <X size={18} color={theme.colors.text} />
            </PressableScale>
          </GlassChrome>
        </View>
        <Animated.View
          testID="managed-workspace"
          style={[styles.root, keyboardStyle]}
          onLayout={(event) => setViewport(event.nativeEvent.layout.height)}>
          <View
            testID={metrics.split ? 'task-layout-split' : 'task-layout-compact'}
            style={styles.panes}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <View
              accessibilityElementsHidden={!listVisible}
              importantForAccessibility={listVisible ? 'auto' : 'no-hide-descendants'}
              style={[
                styles.pane,
                { display: listVisible ? 'flex' : 'none' },
                metrics.split && { flex: 0, width: metrics.list, marginRight: metrics.gap },
              ]}>
              <WorkTaskScroll
                testID="task-list-scroll"
                binding={listBinding}
                geometry={`${width}:${fontScale}`}
                visible={listVisible}>
                {list}
              </WorkTaskScroll>
            </View>
            <View
              accessibilityElementsHidden={!detailVisible}
              importantForAccessibility={detailVisible ? 'auto' : 'no-hide-descendants'}
              style={[styles.pane, { display: detailVisible ? 'flex' : 'none' }]}>
              <WorkTaskScroll
                testID="task-detail-scroll"
                binding={detailBinding}
                geometry={`${detailKey}:${width}:${fontScale}`}
                visible={detailVisible && view !== 'create'}
                style={{ display: view === 'create' ? 'none' : 'flex' }}>
                {children}
              </WorkTaskScroll>
              <ScrollView
                testID="task-creation-scroll"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.content}
                style={{ display: view === 'create' ? 'flex' : 'none' }}>
                {creation}
              </ScrollView>
              <Animated.View
                testID="task-composer-dock"
                style={[
                  dockStyle,
                  {
                    backgroundColor: theme.colors.background,
                    display: view === 'list' ? 'none' : 'flex',
                  },
                ]}
                onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)}>
                {/* A measured flex sibling reserves exactly its height, rather than
                  covering the reading scroll with an estimated bottom inset. */}
                <ScrollView
                  style={{ flexGrow: 0 }}
                  keyboardShouldPersistTaps="handled"
                  nestedScrollEnabled
                  contentContainerStyle={styles.dock}
                  accessibilityElementsHidden={!dockHeight}>
                  <View style={{ display: view === 'detail' ? 'flex' : 'none' }}>{composer}</View>
                  <View style={{ display: view === 'create' ? 'flex' : 'none' }}>
                    {creationComposer}
                  </View>
                </ScrollView>
              </Animated.View>
            </View>
          </View>
          {notice ? (
            <View testID="task-action-notice" style={styles.notice}>
              {notice}
            </View>
          ) : null}
        </Animated.View>
      </SheetFrame>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  header: { padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panes: { flex: 1, minHeight: 0, flexDirection: 'row', marginHorizontal: 16 },
  pane: { flex: 1, minWidth: 0, minHeight: 0 },
  content: { paddingVertical: 8, paddingBottom: 24, gap: 24 },
  dock: { paddingVertical: 8, gap: 8 },
  notice: { marginHorizontal: 16, paddingVertical: 8, gap: 8 },
});
