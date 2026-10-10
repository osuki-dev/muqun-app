import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import {
  ArrowRight,
  Check,
  CircleCheck,
  ExternalLink,
  SquareTerminal,
  XCircle,
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
import { TaskStateGlyph } from '@/components/icons/task-state-glyphs';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useTaskAction } from '@/hooks/use-server-tasks';
import { useRowMarkdownStyle } from '@/hooks/use-markdown-style';
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
  type TaskRowVisual,
} from '@/lib/home-computer-cards';
import { fadeIn, fadeOut, listLayout, pulseOnce, travelTiming, zoomIn } from '@/lib/motion';
import { isDemoRecord } from '@/lib/demo-gateway';
import { peerServerIdOf } from '@/lib/fleet-peers';
import { describeGatewayFailure } from '@/lib/network-error';
import { canMarkTaskDone, type TaskView } from '@/lib/task-ledger';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { dismissTaskNotices } from '@/stores/in-app-notifications';
import { useHomeTaskCards } from '@/stores/home-task-cards';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { plural } from '@lingui/core/macro';

/** Inline markup worth the markdown renderer: code, emphasis, links, escapes, html. */
const MARKDOWN_SYNTAX = /[`*_[\\<]/;

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
    // Unmounting does not stop an endless `withRepeat`; a row that leaves
    // while spinning must not leave its loop running on the UI thread.
    return () => cancelAnimation(turn);
  }, [spins, turn]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }));
  // The rotation lives on an inner view that exists only while spinning, so a
  // check or cross never arrives at the spinner's last angle.
  const glyph = (
    <TaskStateGlyph
      state={visual.icon}
      size={size}
      color={theme.colors[visual.tone]}
      strokeWidth={2.2}
    />
  );
  return (
    <Animated.View
      key={visual.icon}
      entering={
        visual.icon === 'done' || visual.icon === 'failed' ? zoomIn('short') : fadeIn('micro')
      }>
      {visual.spins ? <Animated.View style={spinStyle}>{glyph}</Animated.View> : glyph}
    </Animated.View>
  );
}

/**
 * The server id of the computer a mirror runs on, as this phone knows it:
 * the mirror's own word, else what a linked computer lists for that link.
 */
function usePeerServerId() {
  const byServer = useFleetPeers((state) => state.byServer);
  return (binding: { peerId: string; peerServerId?: string }): string =>
    peerServerIdOf(byServer, binding);
}

/** What the reader calls a mirror's computer: its label on this phone, else the name the mirror carries (§10.13). */
export function usePeerName() {
  const { t } = useLingui();
  const records = useGatewayConnectionStore((state) => state.records);
  const serverOf = usePeerServerId();
  return (binding: { peerId: string; peerServerId?: string; peerName?: string }): string => {
    const serverId = serverOf(binding);
    return (
      records.find((record) => record.serverId === serverId)?.label ||
      binding.peerName ||
      t`another computer`
    );
  };
}

/** Whether a mirror's computer is paired on this phone, so its row can open there. */
export function useIsPairedHere() {
  const records = useGatewayConnectionStore((state) => state.records);
  const serverOf = usePeerServerId();
  return (binding: { peerId: string; peerServerId?: string }): boolean => {
    const serverId = serverOf(binding);
    return records.some((record) => record.serverId === serverId && !isDemoRecord(record));
  };
}

/** The name a task runs under: the session's agent, the terminal agent, `Terminal`, or `→ <computer>`. */
export function useTaskWhereName(discovery: MirroredServerDiscovery | undefined) {
  const { t } = useLingui();
  const peerName = usePeerName();
  return (task: TaskView): string => {
    const binding = task.binding;
    if (binding.kind === 'peer') {
      const name = peerName(binding);
      return t`→ ${name}`;
    }
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
  if (binding.kind === 'peer') {
    return <ArrowRight size={12} color={theme.colors.primary} strokeWidth={2.2} />;
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
  const age = useTaskAge();
  return (
    task: TaskView | null,
    visual: TaskRowVisual,
    computer = '',
    nowMs?: number
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
      case 'unreachable': {
        const ago =
          line.lastSeenMs !== undefined && nowMs !== undefined ? age(line.lastSeenMs, nowMs) : '';
        return {
          text: ago ? t`Unreachable · last seen ${ago}` : t`Unreachable`,
          color: theme.colors.warning,
        };
      }
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
  const peerName = usePeerName();
  const pairedHere = useIsPairedHere();
  const [menuOpen, setMenuOpen] = useState(false);
  const visual = taskRowVisual(task, {
    canComplete: canMarkTaskDone(task, capabilities),
    acknowledged,
  });
  // A mirror of work on another computer: named after the title, and opened
  // there -- or, when this phone is not paired there, said so and not opened.
  const mirror = task.binding.kind === 'peer' ? task.binding : null;
  const mirrorName = mirror ? peerName(mirror) : '';
  const unpaired = mirror !== null && !pairedHere(mirror);
  const line = unpaired
    ? { text: t`Open ${mirrorName} on this phone first`, color: theme.colors.textMuted }
    : rowLine(task, visual, '', nowMs);
  const requester = task.requestedBy?.kind === 'gateway' ? task.requestedBy.name : '';
  const fromText = requester ? t`from ${requester}` : '';
  const ownTitle = taskRowTitle(task);
  const title = ownTitle || whereName(task) || line.text;
  const open = () => {
    if (!unpaired) onOpen(task);
  };
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
        return { id: 'open', label: t`Open`, Icon: ExternalLink, onPress: run(open) };
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
      style={nested ? styles.nested : undefined}>
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
        accessibilityLabel={[
          title,
          mirror && ownTitle ? whereName(task) : '',
          fromText,
          line.text,
          trailingAge,
          rollupText,
        ]
          .filter(Boolean)
          .join(', ')}
        accessibilityActions={
          menuItems.length > 0 ? [{ name: 'longpress', label: t`Actions` }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'longpress') setMenuOpen((open) => !open);
        }}
        onPress={open}
        onLongPress={menuItems.length > 0 ? () => setMenuOpen((open) => !open) : undefined}
        style={styles.row}>
        <View style={styles.titleLine}>
          <View style={styles.icon}>
            <TaskStateIcon visual={visual} />
          </View>
          <RowMarkdown text={title} ink={theme.colors.text} kind="title" />
          {mirror && ownTitle ? (
            <Text
              testID={`task-row-peer-${task.taskId}`}
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}>
              {whereName(task)}
            </Text>
          ) : null}
          {trailingAge ? (
            <Text variant="caption" color={theme.colors.textSubtle}>
              {trailingAge}
            </Text>
          ) : null}
        </View>
        <Animated.View key={visual.line.kind} entering={fadeIn('micro')} style={styles.line}>
          {fromText ? (
            <Text
              testID={`task-row-from-${task.taskId}`}
              variant="caption"
              color={theme.colors.textSubtle}
              numberOfLines={1}>
              {`${fromText} · `}
            </Text>
          ) : null}
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
          nowMs={nowMs}
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
  nowMs,
  onOpen,
}: {
  task: TaskView;
  discovery: MirroredServerDiscovery | undefined;
  whereName: string;
  nowMs: number;
  onOpen: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const rowLine = useTaskRowLine(discovery);
  const peerName = usePeerName();
  const pairedHere = useIsPairedHere();
  const visual = taskRowVisual(task, { canComplete: false, acknowledged: true });
  const mirror = task.binding.kind === 'peer' ? task.binding : null;
  const mirrorName = mirror ? peerName(mirror) : '';
  const unpaired = mirror !== null && !pairedHere(mirror);
  const line = unpaired
    ? { text: t`Open ${mirrorName} on this phone first`, color: theme.colors.textMuted }
    : rowLine(task, visual, '', nowMs);
  return (
    <PressableScale
      testID={`task-row-${task.taskId}`}
      accessibilityRole="button"
      accessibilityLabel={`${whereName}, ${taskRowTitle(task)}, ${line.text}`}
      onPress={() => {
        if (!unpaired) onOpen(task);
      }}
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
