import { useLingui } from '@lingui/react/macro';
import { Button, Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { type Href, useRouter } from 'expo-router';
import { ChevronDown, ChevronUp, Ellipsis } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { PressableScale } from '@/components/pressable-scale';
import { appChrome } from '@/constants/appearance';
import { useCollaborationOutput } from '@/hooks/use-collaboration-output';
import {
  partitionCollaborationTasks,
  taskAgent,
  tasksForSession,
  type CollaborationContext,
} from '@/lib/agent-collaboration';
import { loadAgents, type HerdrEntity } from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { useAgentCollaboration } from '@/stores/agent-collaboration';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';

/** A single compact notice in the terminal's existing notification column. */
export function CollaborationNotice({
  context,
  agents,
  connected,
  active,
}: {
  context: CollaborationContext;
  agents: HerdrEntity[];
  connected: boolean;
  active: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const router = useRouter();
  const stored = useAgentCollaboration((state) => state.tasks);
  const { current } = partitionCollaborationTasks(
    tasksForSession(stored, context.serverId, context.sessionId),
    agents
  );
  const task = current[0];
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const expanded = Boolean(task && expandedId === task.id);
  const output = useCollaborationOutput(expanded ? task : undefined, active && connected);
  if (!task) return null;
  const agent = taskAgent(task, agents);
  const status = !connected
    ? t`Status unavailable`
    : agent?.status === 'working'
      ? t`Working`
      : agent?.status === 'blocked'
        ? t`Needs your attention`
        : agent?.status === 'idle' || agent?.status === 'done'
          ? t`Ready for input`
          : t`Status unknown`;
  const openTerminal = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const assertConnection = () => {
        if (useGatewayConnectionStore.getState().record?.serverId !== task.serverId)
          throw new Error(t`Return to this server to continue.`);
      };
      assertConnection();
      const fresh = await loadAgents(task.sessionId);
      assertConnection();
      if (!taskAgent(task, fresh)) throw new Error(t`Agent no longer present`);
      usePanelPickerStore.getState().choosePanel({ serverId: task.serverId, paneId: task.paneId });
      setExpandedId(null);
    } catch (failure) {
      setError(describeGatewayFailure(failure, t`Agent no longer present`).message);
    } finally {
      setOpening(false);
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
        backgroundColor: theme.colors.surface,
        boxShadow: appChrome.shadow.ambientCard,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="caption" colorKey="textMuted" style={{ flex: 1 }}>
          {t`Agent collaboration`}
          {current.length > 1 ? ` · ${current.length}` : ''}
        </Text>
        <PressableScale
          testID="collaboration-notice-manage"
          accessibilityRole="button"
          accessibilityLabel={t`Assignment options`}
          hitSlop={10}
          onPress={() =>
            router.push({ pathname: '/agent-collaboration', params: context } as Href)
          }>
          <Ellipsis size={18} color={theme.colors.textMuted} />
        </PressableScale>
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
            disabled={!connected || output.outputLoading}
            onPress={output.refreshOutput}>
            {output.hasNewOutput ? t`New output available · refresh` : t`Refresh output`}
          </Button>
          {output.outputLoading ? <Spinner size="sm" /> : null}
          {output.output ? (
            <ScrollView style={{ maxHeight: 140 }} nestedScrollEnabled>
              <Text testID="collaboration-notice-output" selectable variant="caption">
                {output.output}
              </Text>
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
              disabled={!connected}
              onPress={() => void openTerminal()}>{t`Open terminal`}</Button>
            <Button
              testID="collaboration-notice-review"
              variant="ghost"
              onPress={() =>
                useAgentCollaboration.getState().review(task.id)
              }>{t`Mark reviewed`}</Button>
          </View>
        </>
      ) : null}
    </View>
  );
}
