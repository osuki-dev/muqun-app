import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { GitBranch } from 'lucide-react-native';

import { SheetSceneRow, SHEET_LADDER } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import type { GitWorktreeInventory } from '@/lib/git-worktrees';

/** Git's verified linked checkouts; selecting one changes only this reader. */
export function ChangesWorktreeList({
  inventory,
  selected,
  loading,
  error,
  onSelect,
}: {
  inventory: GitWorktreeInventory | null;
  selected: string | undefined;
  loading: boolean;
  error: boolean;
  onSelect: (path: string | undefined) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const selectedPath = selected ?? inventory?.current;
  return (
    <ScrollView
      testID="changes-worktree-list"
      nestedScrollEnabled
      style={styles.list}
      contentContainerStyle={styles.content}>
      {error ? (
        <Text variant="caption" color={theme.colors.danger}>
          {t`Could not list worktrees. Refresh to try again.`}
        </Text>
      ) : null}
      {loading && !inventory ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : null}
      {inventory?.worktrees.map((item) => {
        const current = item.path === inventory.current;
        const name = item.path.split('/').pop() ?? item.path;
        const head = item.head?.slice(0, 7);
        const branch = item.branch ?? (head ? t`Detached at ${head}` : t`No commits yet`);
        return (
          <SheetSceneRow
            key={item.path}
            testID={
              current
                ? 'changes-worktree-current'
                : `changes-worktree-${encodeURIComponent(item.path)}`
            }
            selectedTestID="changes-worktree-selected"
            title={branch}
            caption={item.path}
            captionKind="path"
            leading={<GitBranch size={16} color={theme.colors.textMuted} />}
            selected={item.path === selectedPath}
            accessibilityLabel={`${current ? t`Current checkout` : t`Worktree ${name}`}, ${branch}, ${item.path}`}
            meta={
              current ? (
                <Text variant="caption" color={theme.colors.textMuted}>{t`Current checkout`}</Text>
              ) : undefined
            }
            onPress={() => onSelect(current ? undefined : item.path)}
          />
        );
      })}
      {inventory && !inventory.worktrees.length && !error ? (
        <Text variant="bodySmall" color={theme.colors.textMuted}>{t`Not a git repository`}</Text>
      ) : null}
      {selected && inventory && !inventory.worktrees.some((item) => item.path === selected) ? (
        <View style={styles.note}>
          <Text
            variant="caption"
            color={
              theme.colors.warning
            }>{t`The selected worktree is no longer available. Choose another checkout.`}</Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {selected}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  content: { paddingHorizontal: SHEET_LADDER.gutter, paddingBottom: SHEET_LADDER.section },
  note: { gap: SHEET_LADDER.tight, paddingVertical: SHEET_LADDER.gap },
});
