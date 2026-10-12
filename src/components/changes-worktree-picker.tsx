import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Check, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native';

import { AgentActionMenu } from '@/components/agent-action-menu';
import { PressableScale } from '@/components/pressable-scale';
import { SheetSceneQuietControl } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import type { GitWorktreeInventory } from '@/lib/git-worktrees';

export function ChangesWorktreePicker({
  inventory,
  selected,
  loading,
  error,
  onRefresh,
  onSelect,
}: {
  inventory: GitWorktreeInventory | null;
  selected: string | undefined;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
  onSelect: (path: string | undefined) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [open, setOpen] = useState(false);
  const path = selected ?? inventory?.current;
  const name = path?.split('/').pop() ?? '';
  const label = name ? t`Worktree ${name}` : t`Current checkout`;
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View>
      <View style={styles.row}>
        <PressableScale
          testID="changes-worktree-picker"
          accessibilityRole="button"
          accessibilityLabel={t`Choose worktree`}
          accessibilityState={{ expanded: open, disabled: !inventory?.worktrees.length }}
          disabled={!inventory?.worktrees.length}
          onPress={() => {
            setOpen((previous) => !previous);
            if (!open) onRefresh();
          }}
          style={styles.picker}>
          <Text variant="caption" numberOfLines={1} color={theme.colors.text}>
            {label}
          </Text>
          <Chevron size={14} color={theme.colors.textMuted} />
        </PressableScale>
        <SheetSceneQuietControl
          testID="changes-worktrees-refresh"
          accessibilityLabel={t`Refresh worktrees`}
          busy={loading}
          onPress={onRefresh}>
          <RefreshCw size={14} color={theme.colors.textMuted} />
        </SheetSceneQuietControl>
      </View>
      {path ? (
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          ellipsizeMode="middle">
          {path}
        </Text>
      ) : null}
      {selected ? (
        <Text
          variant="caption"
          color={
            theme.colors.textMuted
          }>{t`Viewing another checkout. Changes are read-only.`}</Text>
      ) : null}
      {error ? (
        <Text
          variant="caption"
          color={theme.colors.danger}>{t`Could not list worktrees. Refresh to try again.`}</Text>
      ) : null}
      {open && inventory ? (
        <ScrollView nestedScrollEnabled style={styles.menu}>
          <AgentActionMenu
            testID="changes-worktree-menu"
            surface="ground"
            items={[
              {
                id: 'current',
                label: t`Current checkout`,
                Icon: !selected ? Check : undefined,
                onPress: () => {
                  setOpen(false);
                  onSelect(undefined);
                },
                testID: 'changes-worktree-current',
              },
              ...inventory.worktrees
                .filter((item) => item.path !== inventory.current)
                .map((item) => ({
                  id: item.path,
                  label: `${item.path.split('/').pop()} · ${item.branch ?? item.head?.slice(0, 7) ?? ''}\n${item.path}`,
                  Icon: selected === item.path ? Check : undefined,
                  onPress: () => {
                    setOpen(false);
                    onSelect(item.path);
                  },
                })),
            ]}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  menu: { maxHeight: 180 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  picker: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
});
