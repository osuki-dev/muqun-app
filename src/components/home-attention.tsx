import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useThemeTokens } from '@osuki-dev/ui';
import { ChevronRight, CircleAlert } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LayoutAnimationConfig } from 'react-native-reanimated';

import { useTaskIndexFor } from '@/components/use-task-index';
import { PressableScale } from '@/components/pressable-scale';
import {
  ArrivalPulse,
  RowMarkdown,
  TaskRowLineText,
  useTaskRowLine,
  useTaskAttentionView,
} from '@/components/task-row';
import { useMinuteNow } from '@/hooks/use-minute-now';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { taskRowVisual, taskRowTitle } from '@/lib/home-computer-cards';
import type { GatewayRecord } from '@/lib/gateway-storage';
import {
  homeContinueComputerLabel,
  homeContinueMetaParts,
  homePathLabel,
  META_SEPARATOR,
} from '@/lib/home-continue-row';
import { agentDisplayName } from '@/lib/home-launch-model';
import { homeTargetAgentId, type HomeTarget } from '@/lib/home-recents';
import type { HomeAttentionSnapshot } from '@/lib/home-attention';
import type { ServerTasksIndex } from '@/lib/server-tasks-state';
import {
  homeWaitingTasks,
  needsYouAcrossComputers,
  type HomeTaskRow,
} from '@/lib/home-in-progress';
import { useAgents } from '@/stores/agents';
import { useHomeAttention } from '@/stores/home-attention';
import { taskOpeningKey, useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerAgents } from '@/stores/server-agents';
import type { ServerAgentsIndex } from '@/lib/server-agents';

const OBSERVATION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

type Observations = Record<string, HomeAttentionSnapshot>;

/** The open requests on these computers, by observation key. */
function pendingObservations(
  observations: Observations,
  servers: readonly GatewayRecord[]
): [string, HomeAttentionSnapshot][] {
  return Object.entries(observations).filter(
    ([, snapshot]) =>
      snapshot.requestIds.length > 0 &&
      servers.some((server) => server.serverId === snapshot.target.serverId)
  );
}

/**
 * What Needs you lists: the open requests on these computers, and the ledger
 * tasks waiting on the reader that no listed request already covers, when
 * those span more than one computer (`needsYouAcrossComputers`).
 */
function attentionRows(
  observations: Observations,
  index: ServerTasksIndex,
  servers: readonly GatewayRecord[],
  taskServerIds: readonly string[],
  panesByServer: ServerAgentsIndex,
  nowMs: number
) {
  const pending = pendingObservations(observations, servers);
  const waiting = needsYouAcrossComputers(
    homeWaitingTasks(
      index,
      taskServerIds,
      pending.map(([, snapshot]) => snapshot.target),
      { panesByServer, requests: observations, nowMs }
    )
  );
  return { pending, waiting };
}

/**
 * Whether Needs you has a row: `HomeAttention` stays mounted while it is
 * empty, so the layout asks this rather than whether the slot is filled.
 * Use exactly the same observations as the list, including native requests
 * whose agent remains working and requests that have since resolved.
 */
export function useHasHomeAttention({
  servers,
  taskServerIds = [],
}: {
  servers: readonly GatewayRecord[];
  taskServerIds?: readonly string[];
}): boolean {
  const observations = useHomeAttention((state) => state.byTarget);
  const index = useTaskIndexFor(taskServerIds);
  const panes = useServerAgents((state) => state.byServer);
  const nowMs = useMinuteNow();
  const { pending, waiting } = attentionRows(
    observations,
    index,
    servers,
    taskServerIds,
    panes,
    nowMs
  );
  return pending.length > 0 || waiting.length > 0;
}

/**
 * An open-only summary. Permission decisions remain in the source workbench.
 * A ledger task waiting on the reader is listed unless its session's own
 * request already is; `onOpenTask` decides where it opens.
 */
export function HomeAttention({
  servers,
  taskServerIds = [],
  onOpen,
  onOpenTask,
}: {
  servers: readonly GatewayRecord[];
  /** The computers whose task ledger Home holds fresh. */
  taskServerIds?: readonly string[];
  onOpen: (target: HomeTarget) => void;
  onOpenTask: (row: HomeTaskRow) => void;
}) {
  const observations = useHomeAttention((state) => state.byTarget);
  const taskIndex = useTaskIndexFor(taskServerIds);
  const panes = useServerAgents((state) => state.byServer);
  const nowMs = useMinuteNow();
  const { pending, waiting } = attentionRows(
    observations,
    taskIndex,
    servers,
    taskServerIds,
    panes,
    nowMs
  );
  // The config stays mounted while the list is empty, so the first row to
  // arrive is an arrival (it enters and pulses), not part of a fresh mount.
  return (
    // A remount (back from a sub-screen) replays no arrival pulse.
    <LayoutAnimationConfig skipEntering>
      {pending.length === 0 && waiting.length === 0 ? null : (
        <View testID="home-attention" style={styles.list}>
          {pending.map(([key, snapshot]) => (
            <AttentionRow key={key} snapshot={snapshot} servers={servers} onOpen={onOpen} />
          ))}
          {waiting.map((row) => (
            <WaitingTaskRow
              key={`${row.serverId}:${row.task.taskId}`}
              row={row}
              servers={servers}
              onOpen={() => onOpenTask(row)}
            />
          ))}
        </View>
      )}
    </LayoutAnimationConfig>
  );
}

/** A confirmed input request opens its original task session directly. */
function WaitingTaskRow({
  row,
  servers,
  onOpen,
}: {
  row: HomeTaskRow;
  servers: readonly GatewayRecord[];
  onOpen: () => void;
}) {
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { task } = row;
  const discovery = useAgents((state) => state.index.servers[row.serverId]);
  // The same icon and line as the row on its computer's card (`taskRowVisual`),
  // with the computer named, since this list spans every computer.
  // The shared minute clock: a quiet mirror's line says when it was last seen.
  const nowMs = useMinuteNow();
  const displayTask = useTaskAttentionView(task, row.serverId, nowMs);
  const visual = taskRowVisual(displayTask, { canComplete: false, acknowledged: true });
  const line = useTaskRowLine(discovery)(displayTask, visual, '', nowMs);
  const title = taskRowTitle(task) || line.text;
  const computer = homeContinueComputerLabel(servers, row.serverId);
  const meta = [computer, line.text].filter(Boolean).join(META_SEPARATOR);
  const opening = useHomeTaskCards(
    (cards) => cards.opening === taskOpeningKey(row.serverId, task.taskId)
  );
  return (
    <View>
      <PressableScale
        testID={`home-attention-task-${task.taskId}`}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${meta}`}
        accessibilityState={{
          busy: opening,
        }}
        onPress={onOpen}
        style={[
          styles.row,
          {
            backgroundColor: background(theme.colors.surface),
            borderColor: theme.colors.borderStrong,
            borderRadius: profile.chrome.noticeCard,
          },
        ]}>
        {/* A row arriving here pulses once (skipped on a remount), and leaves no mark. */}
        <ArrivalPulse />
        <View style={styles.copy}>
          {/* A row, as on the card: the title's `flex: 1` is a width, not a height. */}
          <View style={styles.titleLine}>
            <RowMarkdown text={title} ink={theme.colors.text} kind="title" />
          </View>
          <View style={styles.metaLine}>
            {/* The computer's label is the reader's own text, never markdown. */}
            {computer ? (
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {`${computer}${META_SEPARATOR}`}
              </Text>
            ) : null}
            <TaskRowLineText line={line} spins={visual.spins} />
          </View>
        </View>
        {opening ? (
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
        ) : (
          <ThemeIcon
            name="home.arrow"
            fallback={ChevronRight}
            size={16}
            color={theme.colors.primary}
          />
        )}
      </PressableScale>
    </View>
  );
}

function AttentionRow({
  snapshot,
  servers,
  onOpen,
}: {
  snapshot: HomeAttentionSnapshot;
  servers: readonly GatewayRecord[];
  onOpen: (target: HomeTarget) => void;
}) {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const { i18n } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const { target } = snapshot;
  const agents = useAgents((state) => state.index.servers[target.serverId]?.agents?.agents);
  const count = snapshot.requestIds.length;
  const when = new Date(snapshot.observedAt).toLocaleString(i18n.locale, OBSERVATION_DATE_FORMAT);
  // The same meta line as a Continue row: agent · computer · path.
  const meta = homeContinueMetaParts({
    kind: agentDisplayName(agents, homeTargetAgentId(target)),
    computer: homeContinueComputerLabel(servers, target.serverId),
    path: target.directory ? homePathLabel(target.directory) : undefined,
  })
    .map((part) => part.text)
    .join(META_SEPARATOR);
  return (
    <PressableScale
      testID="home-attention-open"
      accessibilityRole="button"
      onPress={() => onOpen(target)}
      style={[
        styles.row,
        {
          backgroundColor: background(theme.colors.surface),
          borderColor: theme.colors.borderStrong,
          borderRadius: profile.chrome.noticeCard,
        },
      ]}>
      <CircleAlert size={20} color={theme.colors.warning} />
      <View style={styles.copy}>
        <Text weight="semibold" variant="bodySmall">
          {t`${count} requests last observed`}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {meta}
        </Text>
        <Text variant="caption" color={theme.colors.textSubtle}>
          {t`Last checked ${when}`}
        </Text>
        <Text variant="caption" color={theme.colors.textSubtle}>
          {t`Open to check the current state`}
        </Text>
      </View>
      <ThemeIcon name="home.arrow" fallback={ChevronRight} size={16} color={theme.colors.primary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, minWidth: 0, marginTop: 16, marginBottom: 8 },
  row: {
    minHeight: 64,
    padding: 14,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    // The arrival pulse stays inside the rounded row.
    overflow: 'hidden',
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  titleLine: { flexDirection: 'row', minWidth: 0 },
  metaLine: { flexDirection: 'row', alignItems: 'center', minWidth: 0 },
});
