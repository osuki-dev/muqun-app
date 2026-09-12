import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useState } from 'react';
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
  const surfaceBackground = useSurfaceBackground();
  const { t } = useLingui();
  const theme = useThemeTokens();
  const stored = useAgentCollaboration((state) => state.tasks);
  const { current } = partitionCollaborationTasks(
    tasksForSession(stored, context.serverId, context.sessionId),
    agents
  );
  const task = current[0];
  const [removing, setRemoving] = useState<string | null>(null);
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
        backgroundColor: surfaceBackground(theme.colors.surface),
        boxShadow: appChrome.shadow.ambientCard,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text variant="caption" colorKey="textMuted" style={{ flex: 1 }}>
          {t`Agent collaboration`}
          {current.length > 1 ? ` · ${current.length}` : ''}
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
            disabled={!connected || output.outputLoading}
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
              disabled={!connected}
              onPress={() => void openTerminal()}>{t`Open terminal`}</Button>
            <Button
              testID="collaboration-notice-review"
              variant="ghost"
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
