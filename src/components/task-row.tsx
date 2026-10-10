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
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
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
import {
  fadeIn,
  fadeOut,
  listLayout,
  PULSE_ONCE_MS,
  pulseOnce,
  travelTiming,
  zoomIn,
} from '@/lib/motion';
import { isDemoRecord } from '@/lib/demo-gateway';
import { peerServerIdOf } from '@/lib/fleet-peers';
import { META_SEPARATOR } from '@/lib/home-continue-row';
import { describeGatewayFailure } from '@/lib/network-error';
import { canMarkTaskDone, type TaskView } from '@/lib/task-ledger';
import { useFleetPeers } from '@/stores/fleet-peers';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { dismissTaskNotices } from '@/stores/in-app-notifications';
import { taskOpeningKey, useHomeTaskCards } from '@/stores/home-task-cards';
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

/** A failed mirror's reason code in the reader's words; an unknown code is the general line. */
function useMirrorFailureLine() {
  const { t } = useLingui();
  return (reason: string, computer: string): string => {
    switch (reason) {
      case 'peer_unlinked':
        return t`No longer linked with ${computer}`;
      case 'peer_lost_task':
        return t`${computer} no longer has this task`;
      case 'peer_not_confirmed':
        return t`${computer} never confirmed this task`;
      case 'peer_unreachable':
        return t`Could not reach ${computer}`;
      default:
        return t`Could not follow this task on ${computer}`;
    }
  };
}

/**
 * A row's second line: the state word in the state's tone, then the detail
 * after the separator, always muted (§10). `text` is the two joined, for
 * labels and a title that has nothing better.
 */
export type TaskRowLineView = {
  word: string;
  /** The state word's tone. */
  color: string;
  detail: string;
  text: string;
};

function lineView(word: string, color: string, detail: string): TaskRowLineView {
  return { word, color, detail, text: [word, detail].filter(Boolean).join(META_SEPARATOR) };
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
  const peerName = usePeerName();
  const mirrorFailureLine = useMirrorFailureLine();
  return (
    task: TaskView | null,
    visual: TaskRowVisual,
    computer = '',
    nowMs?: number
  ): TaskRowLineView => {
    const muted = theme.colors.textMuted;
    const tone = theme.colors[visual.tone];
    const line = visual.line;
    // A mirror names its computer beside its title; its line says the state.
    const agent = task && task.binding.kind !== 'peer' ? whereName(task) : '';
    const stateWord = task ? _(taskStateWord[task.state]) : '';
    switch (line.kind) {
      case 'sent':
        return lineView('', muted, t`Sent · waiting for ${computer}`);
      case 'starting':
        return lineView('', muted, agent ? t`Starting ${agent}…` : stateWord);
      case 'progress':
        return lineView('', muted, line.text);
      case 'agent':
        return lineView('', muted, agent || stateWord);
      case 'waiting':
        return lineView(_(taskStateWord.waiting), tone, line.text ?? '');
      case 'paused':
        return lineView(_(taskStateWord.idle_unconfirmed), tone, line.text ?? '');
      case 'result':
      case 'error':
        return lineView(stateWord, tone, line.text);
      case 'exit': {
        const code = line.code;
        return lineView(stateWord, tone, t`exit ${code}`);
      }
      case 'state':
        return lineView(stateWord, tone, '');
      case 'unreachable': {
        const ago =
          line.lastSeenMs !== undefined && nowMs !== undefined ? age(line.lastSeenMs, nowMs) : '';
        return lineView(t`Unreachable`, theme.colors.warning, ago ? t`last seen ${ago}` : '');
      }
      case 'mirrorFailed': {
        const there = task?.binding.kind === 'peer' ? peerName(task.binding) : '';
        return lineView(stateWord, tone, mirrorFailureLine(line.reason, there));
      }
    }
  };
}

/**
 * The one-shot wash over a row that has just come to need the reader: it
 * fades in and out once, then unmounts. Nothing marks the row afterwards; the
 * glyph and the state word carry the state (§10).
 */
export function ArrivalPulse() {
  const theme = useThemeTokens();
  const [done, setDone] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDone(true), PULSE_ONCE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (done) return null;
  return (
    <Animated.View pointerEvents="none" entering={pulseOnce()} style={styles.pulse}>
      <View style={[styles.pulseTint, { backgroundColor: theme.colors.warning }]} />
    </Animated.View>
  );
}

/** A row's second line drawn: the state word in its tone, the detail muted. */
export function TaskRowLineText({ line, testID }: { line: TaskRowLineView; testID?: string }) {
  const theme = useThemeTokens();
  return (
    <>
      {line.word ? (
        <Text variant="caption" color={line.color} numberOfLines={1} style={styles.word}>
          {line.detail ? line.word + META_SEPARATOR : line.word}
        </Text>
      ) : null}
      {line.detail ? (
        <RowMarkdown
          {...(testID ? { testID } : {})}
          text={line.detail}
          ink={theme.colors.textMuted}
          kind="line"
        />
      ) : null}
    </>
  );
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
 * Who opened a task from another computer, by this phone's name for that
 * computer when the gateway says which one, else the name it carries.
 */
function useRequesterName() {
  const records = useGatewayConnectionStore((state) => state.records);
  return (requestedBy: TaskView['requestedBy']): string => {
    if (requestedBy?.kind !== 'gateway') return '';
    const serverId = requestedBy.serverId;
    return (
      (serverId ? records.find((record) => record.serverId === serverId)?.label : undefined) ||
      requestedBy.name
    );
  };
}

/**
 * What one task row shows and does, shared by the full row and the child row
 * under its parent: the state visual, the line (or, for a mirror whose
 * computer this phone is not paired with, why it does not open), the clock,
 * the open guard and the long-press menu of the state's actions.
 */
function useTaskRowModel({
  task,
  serverId,
  discovery,
  nowMs,
  onOpen,
}: {
  task: TaskView;
  serverId: string;
  discovery: MirroredServerDiscovery | undefined;
  nowMs: number;
  onOpen: (task: TaskView) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const age = useTaskAge();
  const elapsed = useTaskElapsed();
  const rowLine = useTaskRowLine(discovery);
  const capabilities = useServerCapabilities((state) => state.byServer[serverId]);
  const acknowledged = useHomeTaskCards((cards) =>
    cards.dismissed.includes(dismissedKey(serverId, task.taskId))
  );
  const acknowledge = useHomeTaskCards((cards) => cards.acknowledge);
  const act = useTaskAction(serverId);
  const peerName = usePeerName();
  const pairedHere = useIsPairedHere();
  const requesterName = useRequesterName();
  const [menuOpen, setMenuOpen] = useState(false);
  // What the last action from the menu could not do, said in the menu.
  const [menuError, setMenuError] = useState<string | null>(null);
  const visual = taskRowVisual(task, {
    canComplete: canMarkTaskDone(task, capabilities),
    acknowledged,
  });
  // A mirror of work on another computer is named, and opened there -- or,
  // when this phone is not paired there, says so and does not open.
  const mirror = task.binding.kind === 'peer' ? task.binding : null;
  const mirrorName = mirror ? peerName(mirror) : '';
  const unpaired = mirror !== null && !pairedHere(mirror);
  const line: TaskRowLineView = unpaired
    ? lineView('', theme.colors.textMuted, t`Open ${mirrorName} on this phone first`)
    : rowLine(task, visual, '', nowMs);
  const requester = requesterName(task.requestedBy);
  const fromText = requester ? t`from ${requester}` : '';
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
    setMenuError(null);
    action();
  };
  const menuItems: AgentActionMenuItem[] = visual.actions
    // Nothing to open from here for a computer this phone is not paired with.
    .filter((action) => !(unpaired && action === 'open'))
    .map((action): AgentActionMenuItem => {
      switch (action) {
        case 'open':
          return { id: 'open', label: t`Open`, Icon: ExternalLink, onPress: run(open) };
        case 'cancel':
          return {
            id: 'cancel',
            label: t`Cancel task`,
            Icon: XCircle,
            tone: 'danger',
            // Armed until confirmed or dismissed: a confirm after a pause
            // still cancels, and one that fails says so in the menu.
            confirm: { label: t`Confirm cancel`, persist: true },
            testID: `task-row-cancel-${task.taskId}`,
            onPress: () => {
              setMenuError(null);
              void act(task, 'cancel').then(
                () => setMenuOpen(false),
                (failure: unknown) =>
                  setMenuError(
                    describeGatewayFailure(failure, t`Could not cancel the task`).message
                  )
              );
            },
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
  const toggleMenu = () => {
    setMenuError(null);
    setMenuOpen((shown) => !shown);
  };
  const menuProps = {
    accessibilityActions:
      menuItems.length > 0 ? [{ name: 'longpress', label: t`Actions` }] : undefined,
    onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === 'longpress') toggleMenu();
    },
    onLongPress: menuItems.length > 0 ? toggleMenu : undefined,
  };
  return {
    visual,
    line,
    mirror,
    mirrorName,
    fromText,
    open,
    trailingAge,
    menuItems,
    menuShown: menuOpen && menuItems.length > 0,
    menuError,
    menuProps,
  };
}

/**
 * One task: its state icon, the goal as typed, its age, and the line saying
 * what became of it, all from `taskRowVisual`. Tapping opens the session or
 * pane it runs in -- for a mirror, on the computer that runs it; a long press
 * lists what the reader can do with it (Open, Cancel, Mark done,
 * Acknowledge); the sub-task count opens the work under it. The same row on
 * Home's cards and in the Tasks list.
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
  const theme = useThemeTokens();
  const whereName = useTaskWhereName(discovery);
  const rollupText = useRollupText()(task);
  const row = useTaskRowModel({ task, serverId, discovery, nowMs, onOpen });
  const { visual, line, mirror, fromText, trailingAge } = row;
  const ownTitle = taskRowTitle(task);
  const title = ownTitle || whereName(task) || line.text;
  // Its work is being opened: the tap took, the wait is the computer's.
  const opening = useHomeTaskCards(
    (cards) => cards.opening === taskOpeningKey(serverId, task.taskId)
  );
  return (
    <Animated.View
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout()}
      style={nested ? styles.nested : undefined}>
      {visual.needsYou ? <ArrivalPulse /> : null}
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
        accessibilityState={{ busy: opening }}
        {...row.menuProps}
        onPress={row.open}
        style={styles.row}>
        <View style={styles.titleLine}>
          <View style={styles.icon}>
            {opening ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : (
              <TaskStateIcon visual={visual} />
            )}
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
              {fromText + META_SEPARATOR}
            </Text>
          ) : null}
          <TaskRowLineText testID={`task-row-line-${task.taskId}`} line={line} />
          {rollupText ? (
            <Text variant="caption" numberOfLines={1}>
              {onOpenTree ? (
                <Text
                  testID={`task-row-subtasks-${task.taskId}`}
                  variant="caption"
                  color={theme.colors.primary}
                  accessibilityRole="link"
                  onPress={() => onOpenTree(task)}>
                  {META_SEPARATOR + rollupText}
                </Text>
              ) : (
                <Text variant="caption" color={theme.colors.textMuted}>
                  {META_SEPARATOR + rollupText}
                </Text>
              )}
            </Text>
          ) : null}
        </Animated.View>
      </PressableScale>
      {row.menuShown ? (
        <AgentActionMenu
          testID={`task-row-menu-${task.taskId}`}
          surface="ground"
          items={row.menuItems}
          error={row.menuError}
        />
      ) : null}
      {(subTasks ?? []).map((child) => (
        <SubTaskRow
          key={child.taskId}
          task={child}
          serverId={serverId}
          discovery={discovery}
          nowMs={nowMs}
          onOpen={onOpen}
        />
      ))}
    </Animated.View>
  );
}

/**
 * A sub-task under its root, on one line: its state, where it runs (its
 * agent's mark and name, or the arrow and the computer for work handed to
 * another one), its goal, its line and its clock. It opens and long-presses
 * like a full row, so a mirror's Cancel and Mark done are on the parent's
 * card too.
 */
function SubTaskRow({
  task,
  serverId,
  discovery,
  nowMs,
  onOpen,
}: {
  task: TaskView;
  serverId: string;
  discovery: MirroredServerDiscovery | undefined;
  nowMs: number;
  onOpen: (task: TaskView) => void;
}) {
  const theme = useThemeTokens();
  const whereName = useTaskWhereName(discovery);
  const row = useTaskRowModel({ task, serverId, discovery, nowMs, onOpen });
  const { visual, line, mirror, mirrorName, trailingAge } = row;
  const title = taskRowTitle(task);
  return (
    <View>
      <PressableScale
        testID={`task-row-${task.taskId}`}
        accessibilityRole="button"
        accessibilityLabel={[whereName(task), title, line.text, trailingAge]
          .filter(Boolean)
          .join(', ')}
        {...row.menuProps}
        onPress={row.open}
        style={styles.child}>
        <TaskStateIcon visual={visual} size={12} />
        <WhereMark task={task} discovery={discovery} />
        {mirror ? (
          <Text
            testID={`task-row-peer-${task.taskId}`}
            variant="caption"
            weight="semibold"
            color={theme.colors.textMuted}
            numberOfLines={1}
            style={styles.peerName}>
            {mirrorName}
          </Text>
        ) : null}
        <RowMarkdown text={title} ink={theme.colors.textMuted} kind="line" />
        <TaskRowLineText line={line} />
        {trailingAge ? (
          <Text variant="caption" color={theme.colors.textSubtle}>
            {trailingAge}
          </Text>
        ) : null}
      </PressableScale>
      {row.menuShown ? (
        <AgentActionMenu
          testID={`task-row-menu-${task.taskId}`}
          surface="ground"
          items={row.menuItems}
          error={row.menuError}
        />
      ) : null}
    </View>
  );
}

/** A goal the dock sent, before the computer has said it has it. */
export function SentTaskRow({
  goal,
  computer,
  attachmentFailed = false,
}: {
  goal: string;
  computer: string;
  /** Its attachments could not be sent (the draft is still in the dock). */
  attachmentFailed?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const rowLine = useTaskRowLine(undefined);
  const retry = useHomeTaskCards((state) => state.retryFailedSend);
  const visual = taskRowVisual({ state: 'sent' }, { canComplete: false, acknowledged: true });
  const line = attachmentFailed
    ? lineView(t`Attachment could not be sent`, theme.colors.danger, t`tap to retry`)
    : rowLine(null, visual, computer);
  const retryable = attachmentFailed && retry !== null;
  return (
    <Animated.View
      testID="home-card-pending"
      accessibilityLiveRegion="polite"
      entering={fadeIn('micro')}
      exiting={fadeOut('micro')}
      layout={listLayout()}
      style={styles.row}>
      <Pressable
        disabled={!retryable}
        onPress={() => retry?.()}
        accessibilityRole={retryable ? 'button' : undefined}
        accessibilityLabel={retryable ? t`Attachment could not be sent. Tap to retry.` : undefined}
        style={styles.sentBody}>
        <View style={styles.titleLine}>
          <View style={styles.icon}>
            <TaskStateIcon visual={visual} />
          </View>
          <RowMarkdown text={goalTitle(goal)} ink={theme.colors.text} kind="title" />
        </View>
        <View style={styles.line}>
          <TaskRowLineText line={line} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: 4, gap: 2 },
  sentBody: { gap: 2 },
  titleLine: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 8 },
  icon: { width: 16, alignItems: 'center' },
  grow: { flex: 1, minWidth: 0 },
  line: { paddingLeft: 24, flexDirection: 'row', alignItems: 'center' },
  nested: { paddingLeft: 24 },
  word: { flexShrink: 0, maxWidth: '60%' },
  // The arrival pulse: a wash over the whole row that fades back to nothing.
  pulse: { ...StyleSheet.absoluteFill, opacity: 0 },
  pulseTint: { ...StyleSheet.absoluteFill, opacity: 0.16 },
  // A computer's name is short and says the most; it gives way last.
  peerName: { flexShrink: 0, maxWidth: '40%' },
  child: {
    minHeight: 28,
    paddingLeft: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
