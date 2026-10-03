import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentMark } from '@/components/agent-mark';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { agentLaunchCaption } from '@/i18n/labels';
import { selectedAgentFor } from '@/lib/agent-discovery';
import { launchAgentCaption, projectLaunchAgents } from '@/lib/home-launch-model';
import { useAgents } from '@/stores/agents';
import { useHomeAgentPicker } from '@/stores/home-agent-picker';

/**
 * Native route for choosing which agent a Home launch starts, when the
 * gateway drives more than the row has room for. Choosing a row only answers
 * the request; the launch row runs the command.
 */
export function HomeAgentsSheet() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ requestId?: string }>();
  const requestId = Number(params.requestId);
  const openRequestId = useHomeAgentPicker((state) => state.openRequestId);
  const serverId = useHomeAgentPicker((state) => state.serverId);
  const complete = useHomeAgentPicker((state) => state.complete);
  const requestIsActive = Number.isSafeInteger(requestId) && requestId === openRequestId;
  const discovery = useAgents((state) => (serverId ? state.index.servers[serverId] : undefined));
  const lastUsed = useAgents((state) => (serverId ? state.index.lastUsed[serverId] : undefined));
  const selectedId = useAgents((state) =>
    serverId ? selectedAgentFor(state.index, serverId) : ''
  );
  const agents = projectLaunchAgents(discovery, lastUsed);

  // beforeRemove covers swipe, hardware back and programmatic dismissal; a
  // dismissal answers with no agent, and an answered request ignores it.
  useEffect(() => {
    if (!Number.isSafeInteger(requestId)) return;
    return navigation.addListener('beforeRemove', () => complete(requestId, null));
  }, [complete, navigation, requestId]);

  function select(agentId: string) {
    if (!requestIsActive) return;
    complete(requestId, agentId);
    router.back();
  }

  const contentSized = agents.length <= 5;
  const rows = agents.map((agent) => {
    const caption = _(agentLaunchCaption[launchAgentCaption(agent)]);
    return (
      <SheetSceneRow
        key={agent.id}
        testID={`home-agent-${agent.id}`}
        title={agent.name}
        caption={caption}
        selected={agent.id === selectedId}
        accessibilityLabel={`${agent.name}, ${caption}`}
        leading={
          <AgentMark
            kind={agent.kind}
            size={20}
            color={agent.readiness === 'ready' ? theme.colors.primary : theme.colors.textMuted}
          />
        }
        onPress={() => select(agent.id)}
      />
    );
  });

  return (
    <SheetScene testID="home-agents-sheet" title={t`Choose an agent`} contentSized={contentSized}>
      {contentSized ? (
        <View style={sheetSceneStyles.scrollerContent}>
          {rows}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </View>
      ) : (
        <ScrollView
          nestedScrollEnabled
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          showsVerticalScrollIndicator={false}>
          {rows}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
}
