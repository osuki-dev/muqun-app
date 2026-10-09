import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { TaskStatusGlyph } from '@/components/task-status-glyph';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useServerTasks } from '@/hooks/use-server-tasks';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge } from '@/hooks/use-task-age';
import { taskKindWord, taskStateWord } from '@/i18n/labels';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  homeContinueComputerLabel,
  homeContinueMetaParts,
  META_SEPARATOR,
} from '@/lib/home-continue-row';
import { homeInProgressTasks, type HomeTaskRow } from '@/lib/home-in-progress';
import type { ServerTasksIndex } from '@/lib/server-tasks-state';
import { hasTaskLedger } from '@/lib/task-ledger';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useServerTasksStore } from '@/stores/server-tasks';

/**
 * Keeps the selected computer's task ledger current while Home is up: the
 * fetch on mount and on return to the foreground, and the socket's
 * `task.updated` frames. Draws nothing; In progress, Needs you and the
 * Continue rows read what it leaves in the store.
 */
export function HomeServerTasksSync({ serverId }: { serverId: string | null }) {
  const ledger = useServerCapabilities((state) =>
    serverId ? hasTaskLedger(state.byServer[serverId]) : false
  );
  useServerTasks(ledger ? serverId : null);
  return null;
}

/**
 * The task ledger of just these computers, so a frame for another computer
 * does not re-render the rows that read it.
 */
export function useTaskIndexFor(serverIds: readonly string[]): ServerTasksIndex {
  const entries = useServerTasksStore(
    useShallow((state) => serverIds.map((serverId) => state.index[serverId]))
  );
  const index: ServerTasksIndex = {};
  serverIds.forEach((serverId, position) => {
    const entry = entries[position];
    if (entry) index[serverId] = entry;
  });
  return index;
}

/** How many tasks are in progress on these computers; Home omits the group at zero. */
export function useHomeInProgressCount(serverIds: readonly string[]): number {
  return useServerTasksStore((state) => homeInProgressTasks(state.index, serverIds).total);
}

/**
 * The work running on the computers, newest change first: up to five rows,
 * then "View all" to the Tasks sheet. Each row opens that task there.
 */
export function HomeInProgress({
  servers,
  serverIds,
  onOpenTask,
  onViewAll,
}: {
  servers: readonly GatewayRecord[];
  serverIds: readonly string[];
  onOpenTask: (task: HomeTaskRow) => void;
  onViewAll: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const index = useTaskIndexFor(serverIds);
  const { rows, total } = homeInProgressTasks(index, serverIds);
  // Ages are relative to now; a tick keeps "just now" from going stale.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (rows.length === 0) return null;
  return (
    <View testID="home-in-progress" style={styles.root}>
      <View
        style={[
          styles.list,
          {
            backgroundColor: background(theme.colors.surface),
            borderRadius: profile.chrome.surface,
          },
        ]}>
        {rows.map((row, position) => (
          <InProgressRow
            key={`${row.serverId}:${row.task.taskId}`}
            row={row}
            servers={servers}
            nowMs={nowMs}
            hasSeparator={position < rows.length - 1}
            onOpen={() => onOpenTask(row)}
          />
        ))}
      </View>
      {total > rows.length ? (
        <PressableScale
          testID="home-in-progress-all"
          accessibilityRole="button"
          onPress={onViewAll}
          style={styles.more}>
          <Text variant="bodySmall" color={theme.colors.primary}>
            {t`View all (${total})`}
          </Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function InProgressRow({
  row,
  servers,
  nowMs,
  hasSeparator,
  onOpen,
}: {
  row: HomeTaskRow;
  servers: readonly GatewayRecord[];
  nowMs: number;
  hasSeparator: boolean;
  onOpen: () => void;
}) {
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const age = useTaskAge();
  const { task } = row;
  const meta = homeContinueMetaParts({
    kind: _(taskKindWord[task.kind]),
    computer: homeContinueComputerLabel(servers, row.serverId),
    status: _(taskStateWord[task.state]),
    seen: age(task.updatedMs, nowMs),
  })
    .map((part) => part.text)
    .join(META_SEPARATOR);
  const title = task.goal || task.taskId;
  return (
    <PressableScale
      testID={`home-in-progress-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      onPress={onOpen}
      style={[
        styles.row,
        hasSeparator && {
          borderBottomColor: theme.colors.border,
          borderBottomWidth: StyleSheet.hairlineWidth,
        },
        { backgroundColor: background(theme.colors.surface) },
      ]}>
      <View style={styles.glyph}>
        <TaskStatusGlyph state={task.state} />
      </View>
      <View style={styles.copy}>
        <Text variant="bodySmall" weight="semibold" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {meta}
        </Text>
      </View>
      <ThemeIcon name="home.arrow" fallback={ChevronRight} size={16} color={theme.colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { minWidth: 0 },
  list: { minWidth: 0, overflow: 'hidden' },
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  // Centred on the title's first line (bodySmall's 20pt line box).
  glyph: { height: 20, justifyContent: 'center', alignSelf: 'flex-start' },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  more: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
    paddingVertical: 8,
  },
});
