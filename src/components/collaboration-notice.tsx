import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { PressableScale } from '@/components/pressable-scale';
import { TerminalTranscript } from '@/components/terminal-transcript';
import { appChrome } from '@/constants/appearance';
import { useCollaborationOutput } from '@/hooks/use-collaboration-output';
import {
  partitionCollaborationTasks,
  taskAgent,
  tasksForSession,
  type CollaborationContext,
  type CollaborationTask,
} from '@/lib/agent-collaboration';
import {
  createCollaborationRequestGuard,
  selectedCollaborationTask,
} from '@/lib/collaboration-presentation';
import { loadAgents, type HerdrEntity } from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { useAgentCollaboration } from '@/stores/agent-collaboration';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';

type NoticeProps = {
  context: CollaborationContext;
  agents: HerdrEntity[];
  connected: boolean;
  active: boolean;
};

/** Scope reading state to a server/session, never a reusable pane identity. */
export function CollaborationNotice(props: NoticeProps) {
  return (
    <ScopedCollaborationNotice
      key={JSON.stringify([props.context.serverId, props.context.sessionId])}
      {...props}
    />
  );
}

function ScopedCollaborationNotice({ context, agents, connected, active }: NoticeProps) {
  const { t } = useLingui();
  const stored = useAgentCollaboration((state) => state.tasks);
  const tasks = tasksForSession(stored, context.serverId, context.sessionId);
  const { current, history } = partitionCollaborationTasks(tasks, agents);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => current[0]?.id ?? history[0]?.id ?? null
  );
  // Choose the first dispatch once; later arrivals and removals never retarget the reader.
  if (selectedId === null && tasks[0]) setSelectedId(tasks[0].id);
  const selected = selectedCollaborationTask(tasks, selectedId);
  if (!tasks.length) return null;
  return (
    <View style={{ gap: 4 }}>
      {tasks.length > 1 || history.length > 0 || !selected ? (
        <ScrollView style={{ maxHeight: 180, marginHorizontal: 12 }} nestedScrollEnabled>
          {[
            { title: t`Current assignments`, items: current },
            { title: t`Assignment history`, items: history },
          ].map((group) =>
            group.items.length ? (
              <View key={group.title} style={{ gap: 4 }}>
                <Text variant="caption" colorKey="textMuted">
                  {group.title}
                </Text>
                {group.items.map((item) => (
                  <PressableScale
                    key={item.id}
                    testID={`collaboration-select-${item.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.id === selectedId }}
                    accessibilityLabel={`${item.agentName}: ${item.prompt}`}
                    onPress={() => setSelectedId(item.id)}
                    style={{ minHeight: 48, paddingVertical: 8, gap: 2 }}>
                    <Text variant="bodySmall">
                      {item.id === selectedId ? '✓ ' : ''}
                      {item.agentName}
                    </Text>
                    <Text variant="caption" colorKey="textMuted" numberOfLines={2}>
                      {item.prompt}
                    </Text>
                    {item.reviewed ? (
                      <Text variant="caption" colorKey="textMuted">{t`Reviewed`}</Text>
                    ) : item.superseded ? (
                      <Text variant="caption" colorKey="textMuted">{t`Earlier assignment`}</Text>
                    ) : null}
                  </PressableScale>
                ))}
              </View>
            ) : null
          )}
        </ScrollView>
      ) : null}
      <CollaborationSelection
        task={selected}
        retainedTaskIds={tasks.map((item) => item.id)}
        agents={agents}
        connected={connected}
        active={active}
      />
    </View>
  );
}

function CollaborationSelection({
  task,
  retainedTaskIds,
  agents,
  connected,
  active,
}: {
  task: CollaborationTask | undefined;
  retainedTaskIds: string[];
  agents: HerdrEntity[];
  connected: boolean;
  active: boolean;
}) {
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [removing, setRemoving] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const navigationGuard = useRef(createCollaborationRequestGuard());
  useLayoutEffect(() => {
    navigationGuard.current.invalidate();
    setOpening(false);
    const guard = navigationGuard.current;
    return () => guard.invalidate();
  }, [task?.id, connected, active]);
  const expanded = Boolean(task && expandedId === task.id);
  const agent = task ? taskAgent(task, agents) : undefined;
  const canReadOutput = connected && Boolean(agent) && !task?.superseded && !task?.reviewed;
  const output = useCollaborationOutput(task, expanded && active && canReadOutput, retainedTaskIds);
  if (!task) return null;
  const status = !connected
    ? t`Status unavailable`
    : !agent
      ? t`Agent no longer present`
      : task.reviewed
        ? t`Reviewed`
        : task.superseded
          ? t`Earlier assignment`
          : agent.status === 'working'
            ? t`Working`
            : agent?.status === 'blocked'
              ? t`Needs your attention`
              : agent?.status === 'idle' || agent?.status === 'done'
                ? t`Ready for input`
                : t`Status unknown`;
  const openTerminal = async () => {
    if (opening || !connected || !active || !agent) return;
    const isCurrent = navigationGuard.current.capture();
    setOpening(true);
    setError(null);
    try {
      const assertConnection = () => {
        if (useGatewayConnectionStore.getState().record?.serverId !== task.serverId)
          throw new Error(t`Return to this server to continue.`);
      };
      assertConnection();
      const fresh = await loadAgents(task.sessionId);
      if (!isCurrent()) return;
      assertConnection();
      if (!taskAgent(task, fresh)) throw new Error(t`Agent no longer present`);
      usePanelPickerStore.getState().choosePanel({ serverId: task.serverId, paneId: task.paneId });
      setExpandedId(null);
    } catch (failure) {
      if (isCurrent())
        setError(describeGatewayFailure(failure, t`Agent no longer present`).message);
    } finally {
      if (isCurrent()) setOpening(false);
    }
  };
  return (
    <View
      testID="collaboration-notice"
      style={{
        marginHorizontal: 12,
        padding: 12,
        gap: 8,
        borderRadius: appChrome.radius.control,
        backgroundColor: surfaceBackground(theme.colors.surface),
        boxShadow: appChrome.shadow.ambientCard,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="caption" colorKey="textMuted" style={{ flex: 1 }}>
          {t`Agent collaboration`}
        </Text>
      </View>
      <PressableScale
        testID="collaboration-notice-expand"
        accessibilityRole="button"
        accessibilityLabel={expanded ? t`Hide output` : t`Recent output`}
        accessibilityState={{ expanded }}
        onPress={() => {
          setExpandedId(expanded ? null : task.id);
          setError(null);
        }}
        style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1 }}>
            {task.agentName}
          </Text>
          <Text
            variant="caption"
            color={
              agent?.status === 'blocked' && connected
                ? theme.colors.warning
                : theme.colors.textMuted
            }>
            {status}
          </Text>
          {expanded ? (
            <ChevronUp size={16} color={theme.colors.textMuted} />
          ) : (
            <ChevronDown size={16} color={theme.colors.textMuted} />
          )}
        </View>
        <Text variant="caption" numberOfLines={1} colorKey="textMuted">
          {task.prompt}
        </Text>
      </PressableScale>
      {expanded ? (
        <>
          <Button
            testID="collaboration-notice-refresh"
            variant="ghost"
            disabled={!canReadOutput || output.outputLoading}
            onPress={output.refreshOutput}>
            {output.hasNewOutput ? t`New output available · refresh` : t`Refresh output`}
          </Button>
          {output.outputLoading ? <Spinner size="sm" /> : null}
          {output.output ? (
            <ScrollView
              style={{ maxHeight: 140 }}
              nestedScrollEnabled
              horizontal={false}
              showsVerticalScrollIndicator={false}>
              {/* The agent's answer is a pane snapshot: monospaced, column
                  aligned, and carrying SGR escapes. Drawn as an ordinary
                  caption it lost all three, so a table or a diff the agent drew
                  arrived as ragged prose. See `TerminalTranscript` for why this
                  reuses the parser rather than standing up a second canvas. */}
              <TerminalTranscript testID="collaboration-notice-output" output={output.output} />
            </ScrollView>
          ) : null}
          {output.outputError || error ? (
            <Text selectable variant="caption" colorKey="danger">
              {error ?? output.outputError}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            <Button
              testID="collaboration-notice-terminal"
              variant="ghost"
              loading={opening}
              disabled={!connected || !agent}
              onPress={() => void openTerminal()}>{t`Open terminal`}</Button>
            <Button
              testID="collaboration-notice-review"
              variant="ghost"
              disabled={task.reviewed}
              onPress={() =>
                useAgentCollaboration.getState().review(task.id)
              }>{t`Mark reviewed`}</Button>
            {/* Arm-to-confirm in place, the pattern the theme library and the
                row menu already use. This was a native `Alert` for a while --
                the only one in the app outside a permission failure -- put
                there when the screen its `...` used to open was deleted. A
                system dialog in the middle of the app's own chrome is not a
                confirmation, it is a different application briefly. */}
            <Button
              testID="collaboration-notice-remove"
              variant="ghost"
              onPress={() => {
                if (removing !== task.id) {
                  setRemoving(task.id);
                  return;
                }
                // Local history only: this forgets the card, and never reaches
                // the assistant (AGENTS.md).
                useAgentCollaboration.getState().remove(task.id);
                setRemoving(null);
              }}>
              {removing === task.id ? t`Remove from history?` : t`Remove`}
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}
