import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, Text } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { SheetSceneNotice, SHEET_LADDER } from '@/components/sheet-scene';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { GitWorktree, GitWorktreeInventory } from '@/lib/git-worktrees';
import { fadeIn, fadeOut } from '@/lib/motion';

/**
 * Git's verified linked checkouts as one row of chips under the heading.
 *
 * Nothing at all while the repository has only the checkout the pane is in:
 * a switcher with one option is a question with one answer. With several, a
 * chip per checkout named by its branch -- the thing a reader supervising an
 * agent tells them apart by -- and the one being read drawn solid. Selecting
 * one changes only this reader; the Git TUI follows it, the terminal does not.
 *
 * An inventory that did not arrive is a quiet line with a Retry, not a red
 * sentence: nothing about the changes themselves is wrong.
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
  const selectedPath = selected ?? inventory?.current;
  const several = (inventory?.worktrees.length ?? 0) > 1;
  const missing =
    selected !== undefined &&
    inventory !== null &&
    !inventory.worktrees.some((item) => item.path === selected);
  const failed = error && !inventory;
  if (!several && !failed && !missing && selected === undefined) return null;
  return (
    <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')} style={styles.block}>
      {several && inventory ? (
        <ScrollView
          horizontal
          bounces={false}
          testID="changes-worktree-list"
          showsHorizontalScrollIndicator={false}
          style={styles.viewport}
          contentContainerStyle={styles.row}>
          {inventory.worktrees.map((item) => (
            <WorktreeChip
              key={item.path}
              item={item}
              current={item.path === inventory.current}
              selected={item.path === selectedPath}
              onPress={() => onSelect(item.path === inventory.current ? undefined : item.path)}
            />
          ))}
        </ScrollView>
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
  onPress,
}: {
  item: GitWorktree;
  current: boolean;
  selected: boolean;
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
      accessibilityLabel={`${current ? t`Current checkout` : t`Worktree ${name}`}, ${branch}, ${item.path}`}
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
        numberOfLines={1}
        ellipsizeMode="middle">
        {branch}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  block: { gap: SHEET_LADDER.gap },
  viewport: { flexGrow: 0, minWidth: 0, width: '100%' },
  row: { gap: SHEET_LADDER.gap },
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    maxWidth: 220,
  },
  note: { gap: SHEET_LADDER.tight },
});
