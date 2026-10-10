import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import {
  Ban,
  Check,
  CircleCheck,
  CircleHelp,
  CirclePause,
  CircleX,
  ExternalLink,
  Loader,
  Send,
  SquareTerminal,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { AgentMark } from '@/components/agent-mark';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useTaskAction } from '@/hooks/use-server-tasks';
import { useRowMarkdownStyle } from '@/hooks/use-markdown-style';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useTaskAge, useTaskElapsed } from '@/hooks/use-task-age';
import { taskStateWord } from '@/i18n/labels';
import { findAgent, type MirroredServerDiscovery } from '@/lib/agent-discovery';
import { agentBrandName } from '@/lib/herdr-entity';
import {
  dismissedKey,
  goalTitle,
  taskRollup,
  taskRowVisual,
  taskRowTitle,
  type TaskRowIcon,
  type TaskRowVisual,
} from '@/lib/home-computer-cards';
import { fadeIn, fadeOut, listLayout, pulseOnce, travelTiming, zoomIn } from '@/lib/motion';
import { describeGatewayFailure } from '@/lib/network-error';
import { canMarkTaskDone, type TaskView } from '@/lib/task-ledger';
import { dismissTaskNotices } from '@/stores/in-app-notifications';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { plural } from '@lingui/core/macro';

/** Inline markup worth the markdown renderer: code, emphasis, links, escapes, html. */
const MARKDOWN_SYNTAX = /[`*_[\\<]/;

const ICONS: Record<TaskRowIcon, LucideIcon> = {
  send: Send,
  loader: Loader,
  help: CircleHelp,
  pause: CirclePause,
  check: CircleCheck,
  x: CircleX,
  ban: Ban,
};

/**
 * A row's state icon from the one table (`taskRowVisual`). Only the working
 * icon turns -- one turn per `TRAVEL_PERIOD`, linear, the app's loop for a
 * wait with no length -- and it holds still when the reader asks for less
 * motion. A check or a cross arrives once (`zoomIn` on `short`); any other new
 * state fades in on `micro`. Every transition honours reduce-motion.
 */
export function TaskStateIcon({ visual, size = 16 }: { visual: TaskRowVisual; size?: number }) {
  const theme = useThemeTokens();
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(0);
  const spins = visual.spins && !reduceMotion;
  useEffect(() => {
    cancelAnimation(turn);
    turn.set(0);
    if (!spins) return;
    turn.set(withRepeat(withTiming(1, travelTiming()), -1));
  }, [spins, turn]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  const Icon = ICONS[visual.icon];
  // The rotation lives on an inner view that exists only while spinning, so a
  // check or cross never arrives at the spinner's last angle.
  const glyph = <Icon size={size} color={theme.colors[visual.tone]} strokeWidth={2.2} />;
  return (
    <Animated.View
      key={visual.icon}
      entering={visual.icon === 'check' || visual.icon === 'x' ? zoomIn('short') : fadeIn('micro')}>
      {visual.spins ? <Animated.View style={spinStyle}>{glyph}</Animated.View> : glyph}
    </Animated.View>
  );
}

/** The name a task runs under: the session's agent, the terminal agent, or `Terminal`. */
export function useTaskWhereName(discovery: MirroredServerDiscovery | undefined) {
  const { t } = useLingui();
  return (task: TaskView): string => {
    const binding = task.binding;
    if (binding.kind === 'agent_session') {
      return (
        findAgent(discovery?.agents?.agents, binding.agentId)?.name ??
        agentBrandName(binding.agentId)
      );
    }
    if (binding.kind === 'pane') {
      return binding.agentId ? agentBrandName(binding.agentId) : t`Terminal`;
    }
    return '';
  };
}

/** Where a sub-task runs, as the Recent rows mark it: the agent's mark, or the terminal glyph. */
function WhereMark({
  task,
  discovery,
}: {
  task: TaskView;
  discovery: MirroredServerDiscovery | undefined;
}) {
  const theme = useThemeTokens();
  const binding = task.binding;
  if (binding.kind === 'agent_session') {
    const kind = findAgent(discovery?.agents?.agents, binding.agentId)?.kind ?? binding.agentId;
    return <AgentMark kind={kind} size={12} color={theme.colors.primary} />;
  }
  return <SquareTerminal size={12} color={theme.colors.textMuted} strokeWidth={2} />;
}

/**
 * A row's second line in words and a theme tone, from the one table: what the
 * computer is doing with the goal now. `computer` names it for a goal just
 * sent. Shared by Home's cards, the Tasks list and Needs you.
 */
export function useTaskRowLine(discovery: MirroredServerDiscovery | undefined) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const whereName = useTaskWhereName(discovery);
  return (
    task: TaskView | null,
    visual: TaskRowVisual,
    computer = ''
  ): { text: string; color: string } => {
    const muted = theme.colors.textMuted;
    const line = visual.line;
    const agent = task ? whereName(task) : '';
    const stateWord = task ? _(taskStateWord[task.state]) : '';
    switch (line.kind) {
      case 'sent':
        return { text: t`Sent · waiting for ${computer}`, color: muted };
      case 'starting':
        return { text: agent ? t`Starting ${agent}…` : stateWord, color: muted };
      case 'progress':
        return { text: line.text, color: muted };
      case 'agent':
        return { text: agent || stateWord, color: muted };
      case 'waiting':
        return {
          text: [_(taskStateWord.waiting), line.text].filter(Boolean).join(' · '),
          color: theme.colors.warning,
        };
      case 'paused':
        return {
          text: [_(taskStateWord.idle_unconfirmed), line.text].filter(Boolean).join(' · '),
          color: muted,
        };
      case 'result':
        return { text: line.text, color: muted };
      case 'exit': {
        const code = line.code;
        return {
          text: t`exit ${code}`,
          color: visual.tone === 'danger' ? theme.colors.danger : muted,
        };
      }
      case 'error':
        return { text: line.text, color: theme.colors.danger };
      case 'state':
        return { text: stateWord, color: visual.tone === 'danger' ? theme.colors.danger : muted };
    }
  };
}

/**
 * Agent-written text in a row -- a goal, a summary, a progress or failure
 * line -- through the app's markdown renderer in its clamped inline variant:
 * inline code and emphasis drawn, links shown as their text, the row's tap
 * left to the row.
 */
export function RowMarkdown({
  text,
  ink,
  kind,
  testID,
}: {
  text: string;
  ink: string;
  kind: 'title' | 'line';
  testID?: string;
}) {
  const markdownStyle = useRowMarkdownStyle(ink, kind);
  // Most lines are the app's own copy ("Starting Codex…", "Cancelled"): plain
  // text, and no native markdown view, unless the string carries markup.
  if (!MARKDOWN_SYNTAX.test(text)) {
    return (
      <Text
        testID={testID}
        variant={kind === 'title' ? 'bodySmall' : 'caption'}
        weight={kind === 'title' ? 'semibold' : undefined}
        color={ink}
        numberOfLines={1}
        style={styles.grow}>
        {text}
      </Text>
    );
  }
  return (
    <BoundedMarkdown
      markdown={text}
      markdownStyle={markdownStyle}
      clampLines={1}
      containerStyle={styles.grow}
      {...(testID ? { testID } : {})}
    />
  );
}

/** A root's roll-up, `2 sub-tasks (1 waiting)`, said with each locale's plurals. */
export function useRollupText() {
  const { t } = useLingui();
  return (task: TaskView): string => {
    const rollup = taskRollup(task);
    if (!rollup) return '';
    const total = rollup.total;
    const waiting = rollup.waiting;
    return waiting > 0
      ? t`${plural(total, { one: '# sub-task', other: '# sub-tasks' })} (${plural(waiting, { one: '# waiting', other: '# waiting' })})`
      : t`${plural(total, { one: '# sub-task', other: '# sub-tasks' })}`;
  };
}

/**
 * One task: its state icon, the goal as typed, its age, and the line saying
 * what became of it, all from `taskRowVisual`. Tapping opens the session or
 * pane it runs in; a long press lists what the reader can do with it (Open,
 * Cancel, Mark done, Acknowledge); the sub-task count opens the work under
 * it. The same row on Home's cards and in the Tasks list.
 */
export function TaskRow({
  task,
  serverId,
  discovery,
  nowMs,
  subTasks,
  nested = false,
  onOpen,
  onOpenTree,
}: {
  task: TaskView;
  serverId: string;
  discovery: MirroredServerDiscovery | undefined;
  nowMs: number;
  /** Its open sub-tasks, one level under it. */
  subTasks?: readonly TaskView[];
  nested?: boolean;
  onOpen: (task: TaskView) => void;
  /** The Tasks list on this task's tree; absent where that list is already shown. */
  onOpenTree?: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { showToast } = useToast();
  const age = useTaskAge();
  const elapsed = useTaskElapsed();
  const rowLine = useTaskRowLine(discovery);
  const whereName = useTaskWhereName(discovery);
  const rollupText = useRollupText()(task);
  const capabilities = useServerCapabilities((state) => state.byServer[serverId]);
  const acknowledged = useHomeTaskCards((cards) =>
    cards.dismissed.includes(dismissedKey(serverId, task.taskId))
  );
  const acknowledge = useHomeTaskCards((cards) => cards.acknowledge);
  const act = useTaskAction(serverId);
  const [menuOpen, setMenuOpen] = useState(false);
  const visual = taskRowVisual(task, {
    canComplete: canMarkTaskDone(task, capabilities),
    acknowledged,
  });
  const line = rowLine(task, visual);
  const title = taskRowTitle(task) || whereName(task) || line.text;
  // Open work says how long it has run (`14m`), finished work how long ago.
  const trailingAge =
    visual.clock === 'elapsed'
      ? elapsed(task.updatedMs, nowMs)
      : visual.clock === 'ago'
        ? age(task.updatedMs, nowMs)
        : '';
  // The reader is told what failed in words, never the gateway's raw answer.
  const fail = (title: string) => (failure: unknown) =>
    showToast({
      variant: 'danger',
      title,
      message: describeGatewayFailure(failure, title).message,
    });
  const run = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  const menuItems: AgentActionMenuItem[] = visual.actions.map((action): AgentActionMenuItem => {
    switch (action) {
      case 'open':
        return { id: 'open', label: t`Open`, Icon: ExternalLink, onPress: run(() => onOpen(task)) };
      case 'cancel':
        return {
          id: 'cancel',
          label: t`Cancel task`,
          Icon: XCircle,
          tone: 'danger',
          confirm: { label: t`Confirm cancel` },
          testID: `task-row-cancel-${task.taskId}`,
          onPress: run(() => {
            void act(task, 'cancel').catch(fail(t`Could not cancel the task`));
          }),
        };
      case 'markDone':
        return {
          id: 'mark-done',
          label: t`Mark done`,
          Icon: CircleCheck,
          testID: `task-row-mark-done-${task.taskId}`,
          onPress: run(() => {
            void act(task, 'complete').catch(fail(t`Could not mark the task done`));
          }),
        };
      case 'acknowledge':
        return {
          id: 'acknowledge',
          label: t`Acknowledge`,
          Icon: Check,
          testID: `task-row-acknowledge-${task.taskId}`,
          onPress: run(() => {
            acknowledge(serverId, task.taskId);
            dismissTaskNotices(task);
          }),
        };
    }
  });
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout()}
      style={[
        nested ? styles.nested : undefined,
        visual.plate
          ? {
              backgroundColor: background(theme.colors[visual.plate]),
              borderRadius: profile.chrome.control,
            }
          : undefined,
      ]}>
      {visual.edge ? (
        // Arriving at needs-you pulses the edge once (skipped on a remount).
        <Animated.View
          pointerEvents="none"
          entering={pulseOnce()}
          style={[styles.edge, { backgroundColor: theme.colors[visual.edge] }]}
        />
      ) : null}
      <PressableScale
        testID={`task-row-${task.taskId}`}
        accessibilityRole="button"
        accessibilityLabel={[title, line.text, trailingAge, rollupText].filter(Boolean).join(', ')}
        accessibilityActions={
          menuItems.length > 0 ? [{ name: 'longpress', label: t`Actions` }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') setMenuOpen((open) => !open);
        }}
        onPress={() => onOpen(task)}
        onLongPress={menuItems.length > 0 ? () => setMenuOpen((open) => !open) : undefined}
        style={styles.row}>
        <View style={styles.titleLine}>
          <View style={styles.icon}>
            <TaskStateIcon visual={visual} />
          </View>
          <RowMarkdown text={title} ink={theme.colors.text} kind="title" />
          {trailingAge ? (
            <Text variant="caption" color={theme.colors.textSubtle}>
              {trailingAge}
            </Text>
          ) : null}
        </View>
        <Animated.View key={visual.line.kind} entering={fadeIn('micro')} style={styles.line}>
          <RowMarkdown
            testID={`task-row-line-${task.taskId}`}
            text={line.text}
            ink={line.color}
            kind="line"
          />
          {rollupText ? (
            <Text variant="caption" numberOfLines={1}>
              {onOpenTree ? (
                <Text
                  testID={`task-row-subtasks-${task.taskId}`}
                  variant="caption"
                  color={theme.colors.primary}
                  accessibilityRole="link"
                  onPress={() => onOpenTree(task)}>
                  {` · ${rollupText}`}
                </Text>
              ) : (
                <Text variant="caption" color={theme.colors.textMuted}>
                  {` · ${rollupText}`}
                </Text>
              )}
            </Text>
          ) : null}
        </Animated.View>
      </PressableScale>
      {menuOpen && menuItems.length > 0 ? (
        <AgentActionMenu
          testID={`task-row-menu-${task.taskId}`}
          surface="ground"
          items={menuItems}
        />
      ) : null}
      {(subTasks ?? []).map((child) => (
        <SubTaskRow
          key={child.taskId}
          task={child}
          discovery={discovery}
          whereName={whereName(child)}
          onOpen={onOpen}
        />
      ))}
    </Animated.View>
  );
}

/** A sub-task under its root: where it runs (its agent's mark and name), its goal, its line. */
function SubTaskRow({
  task,
  discovery,
  whereName,
  onOpen,
}: {
  task: TaskView;
  discovery: MirroredServerDiscovery | undefined;
  whereName: string;
  onOpen: (task: TaskView) => void;
}) {
  const theme = useThemeTokens();
  const rowLine = useTaskRowLine(discovery);
  const visual = taskRowVisual(task, { canComplete: false, acknowledged: true });
  const line = rowLine(task, visual);
  return (
    <PressableScale
      testID={`task-row-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`${whereName}, ${taskRowTitle(task)}, ${line.text}`}
      onPress={() => onOpen(task)}
      style={styles.child}>
      <TaskStateIcon visual={visual} size={12} />
      <WhereMark task={task} discovery={discovery} />
      <RowMarkdown text={taskRowTitle(task)} ink={theme.colors.textMuted} kind="line" />
      <RowMarkdown text={line.text} ink={line.color} kind="line" />
    </PressableScale>
  );
}

/** A goal the dock sent, before the computer has said it has it. */
export function SentTaskRow({ goal, computer }: { goal: string; computer: string }) {
  const theme = useThemeTokens();
  const rowLine = useTaskRowLine(undefined);
  const visual = taskRowVisual({ state: 'sent' }, { canComplete: false, acknowledged: true });
  const line = rowLine(null, visual, computer);
  return (
    <Animated.View
      testID="home-card-pending"
      accessibilityLiveRegion="polite"
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout()}
      style={styles.row}>
      <View style={styles.titleLine}>
        <View style={styles.icon}>
          <TaskStateIcon visual={visual} />
        </View>
        <RowMarkdown text={goalTitle(goal)} ink={theme.colors.text} kind="title" />
      </View>
      <View style={styles.line}>
        <RowMarkdown text={line.text} ink={line.color} kind="line" />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 4, gap: 2 },
  titleLine: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 16, alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  line: { paddingLeft: 24, flexDirection: 'row', alignItems: 'center' },
  nested: { paddingLeft: 24 },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  child: {
    minHeight: 28,
    paddingLeft: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
