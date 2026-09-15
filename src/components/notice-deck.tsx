import { Children, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { ChevronRight } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { fadeIn, listLayout } from '@/lib/motion';
import { noticeDeckPage } from '@/lib/notice-deck';

/** Keep condition-driven notices mounted, but expose only one page's text/actions.
 * Empty children measure zero; they must not create a blank notification page.
 */
export function NoticeDeck({ children }: { children: ReactNode }) {
  const { colors } = useThemeTokens();
  const { t } = useLingui();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const pages = Children.toArray(children);
  const keys = pages.map((page, index) =>
    typeof page === 'object' && page !== null && 'key' in page ? String(page.key) : String(index)
  );
  const { visible, front, position, next } = noticeDeckPage(keys, heights, selected);
  return (
    <Animated.View pointerEvents="box-none" layout={listLayout('short')} style={styles.deck}>
      {[2, 1].map((depth) =>
        visible.length > depth ? (
          <Animated.View
            key={depth}
            entering={fadeIn('short')}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.page,
              styles.back,
              {
                width: front ? widths[front] : undefined,
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                transform: [
                  { translateY: depth * 6 },
                  { scaleX: 1 - depth * 0.035 },
                  { rotate: `${depth * 0.5}deg` },
                ],
              },
            ]}
          />
        ) : null
      )}
      {pages.map((page, index) => {
        const key = keys[index]!;
        const active = front === key;
        return (
          <View
            key={key}
            pointerEvents={active ? 'auto' : 'none'}
            accessibilityElementsHidden={!active}
            importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
            style={
              active
                ? [styles.page, styles.front, { backgroundColor: colors.surfaceRaised }]
                : styles.measuring
            }>
            <View
              style={styles.front}
              onLayout={(event) => {
                const { height, width } = event.nativeEvent.layout;
                setWidths((current) =>
                  current[key] === width ? current : { ...current, [key]: width }
                );
                setHeights((current) =>
                  current[key] === height ? current : { ...current, [key]: height }
                );
              }}>
              {page}
            </View>
          </View>
        );
      })}
      {visible.length > 1 ? (
        <PressableScale
          testID="terminal-notice-next"
          accessibilityRole="button"
          accessibilityLabel={t`Next notification`}
          onPress={() => setSelected(next)}
          style={[styles.next, { backgroundColor: colors.surfaceRaised }]}>
          <Text variant="caption" color={colors.textMuted}>
            {position + 1} / {visible.length}
          </Text>
          <ChevronRight size={16} color={colors.text} />
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  deck: { marginHorizontal: 12, width: 'auto' },
  page: {
    borderRadius: appChrome.radius.noticeBanner,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  front: { alignSelf: 'center', maxWidth: '100%' },
  back: { position: 'absolute', top: 0, alignSelf: 'center', bottom: 0, borderWidth: 1 },
  measuring: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  next: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: appChrome.radius.noticeBanner,
    marginTop: 8,
  },
});
