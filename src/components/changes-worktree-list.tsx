import { useCallback, useMemo, useRef, type ComponentRef } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Text } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { SheetSceneNotice, SHEET_LADDER } from '@/components/sheet-scene';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  compactWorktreeLabel,
  orderWorktrees,
  type GitWorktree,
  type GitWorktreeInventory,
} from '@/lib/git-worktrees';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * Git's verified linked checkouts as one row of chips under the heading.
 *
 * Nothing at all while the repository has only the checkout the pane is in:
 * a switcher with one option is a question with one answer. With several, a
 * chip per checkout named by its branch -- the thing a reader supervising an
 * agent tells them apart by -- the pane's own checkout first and the one
 * being read drawn solid. A repository with two hundred checkouts is a long
 * row, not a long sheet: the chips are compact, the row scrolls sideways, and
 * it opens on the chip being read. Selecting one changes only this reader;
 * the Git TUI follows it, the terminal does not.
 *
 * An inventory that did not arrive is a quiet line with a Retry, not a red
 * sentence: nothing about the changes themselves is wrong. An inventory the
 * gateway cut says so under the row, with how many there really are.
 */
export function ChangesWorktreeChips({
  inventory,
  selected,
  error,
  onSelect,
  onRetry,
}: {
  inventory: GitWorktreeInventory | null;
  /** The checkout being read, when it is not the pane's own. */
  selected: string | undefined;
  error: boolean;
  onSelect: (path: string | undefined) => void;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  const ordered = useMemo(() => (inventory ? orderWorktrees(inventory) : []), [inventory]);
  const scroller = useRef<ComponentRef<typeof ScrollView> | null>(null);
  /**
   * The chip being read lands in view once, when the row opens: its `onLayout`
   * says where it sits in the row, and the row jumps there without animation.
   * Once only -- after that the row is the reader's to scroll.
   */
  const landed = useRef(false);
  const landOn = useCallback((event: LayoutChangeEvent) => {
    if (landed.current) return;
    landed.current = true;
    const x = event.nativeEvent.layout.x;
    if (x > 0) scroller.current?.scrollTo({ x, animated: false });
  }, []);
  const selectedPath = selected ?? inventory?.current;
  const several = ordered.length > 1;
  const missing =
    selected !== undefined && inventory !== null && !ordered.some((item) => item.path === selected);
  const failed = error && !inventory;
  if (!several && !failed && !missing && selected === undefined) return null;
  const listed = ordered.length;
  const total = inventory?.total;
  return (
    <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')} style={styles.block}>
      {several && inventory ? (
        <ScrollView
          ref={scroller}
          horizontal
          bounces={false}
          testID="changes-worktree-list"
          showsHorizontalScrollIndicator={false}
          style={styles.viewport}
          contentContainerStyle={styles.row}>
          {ordered.map((item) => {
            const current = item.path === inventory.current;
            const chosen = item.path === selectedPath;
            return (
              <WorktreeChip
                key={item.path}
                item={item}
                current={current}
                selected={chosen}
                onLayout={chosen ? landOn : undefined}
                onPress={() => onSelect(current ? undefined : item.path)}
              />
            );
          })}
        </ScrollView>
      ) : null}
      {several && inventory?.truncated && total !== undefined ? (
        <Text testID="changes-worktrees-truncated" variant="caption" color={theme.colors.textMuted}>
          {t`${listed} of ${total} checkouts`}
        </Text>
      ) : null}
      {failed ? (
        <SheetSceneNotice
          testID="changes-worktrees-notice"
          message={t`Could not list worktrees.`}
          actionLabel={t`Retry`}
          onAction={onRetry}
        />
      ) : null}
      {missing ? (
        <View style={styles.note}>
          <Text variant="caption" color={theme.colors.warning}>
            {t`The selected worktree is no longer available. Choose another checkout.`}
          </Text>
          <Text
            variant="caption"
            color={theme.colors.textMuted}
            numberOfLines={1}
            ellipsizeMode="head"
            style={{ fontFamily: mono }}>
            {selected}
          </Text>
        </View>
      ) : selected !== undefined ? (
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Viewing another checkout. Changes are read-only.`}
        </Text>
      ) : null}
    </Animated.View>
  );
}

function WorktreeChip({
  item,
  current,
  selected,
  onLayout,
  onPress,
}: {
  item: GitWorktree;
  current: boolean;
  selected: boolean;
  onLayout?: (event: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const name = item.path.split('/').pop() ?? item.path;
  const head = item.head?.slice(0, 7);
  const branch = item.branch ?? (head ? t`Detached at ${head}` : t`No commits yet`);
  return (
    <PressableScale
      testID={
        current ? 'changes-worktree-current' : `changes-worktree-${encodeURIComponent(item.path)}`
      }
      accessibilityRole="button"
      accessibilityState={{ selected }}
      // The whole name and the whole path: the chip shows a cut branch only.
      accessibilityLabel={`${current ? t`Current checkout` : t`Worktree ${name}`}, ${branch}, ${item.path}`}
      onLayout={onLayout}
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderRadius: profile.chrome.control,
          // The same two fills as Home's recent chips: the chosen checkout is
          // solid primary, the rest are surface.
          backgroundColor: background(selected ? theme.colors.primary : theme.colors.surface),
        },
      ]}>
      <Text
        testID={selected ? 'changes-worktree-selected' : undefined}
        variant="caption"
        weight={selected ? 'semibold' : undefined}
        color={selected ? theme.colors.onPrimary : theme.colors.textMuted}
        numberOfLines={1}>
        {compactWorktreeLabel(branch)}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  block: { gap: SHEET_LADDER.gap },
  viewport: { flexGrow: 0, minWidth: 0, width: '100%' },
  row: { gap: SHEET_LADDER.gap },
  // Compact: a branch name on one line, and nothing around it. Two hundred of
  // these are a row to flick through, not a wall.
  chip: {
    minHeight: 30,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  note: { gap: SHEET_LADDER.tight },
});
