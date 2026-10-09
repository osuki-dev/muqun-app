import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { configuredGatewayServerId, loadAgentProfiles } from '@/lib/gateway-client';
import { homeAgentOptions, resolveHomeAgent } from '@/lib/home-agent-choice';
import { useAgents } from '@/stores/agents';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';

/**
 * The terminal agents a computer has installed, asked once per launch of the
 * picker or the dock, and only of the selected computer: the catalog is read
 * through the shared client.
 */
export function useTerminalAgentCatalog(serverId: string | undefined, enabled = true) {
  const known = useHomeAgentChoice((state) =>
    serverId ? state.terminalByServer[serverId] : undefined
  );
  const record = useHomeAgentChoice((state) => state.recordTerminal);
  useEffect(() => {
    if (!enabled || !serverId || known || configuredGatewayServerId() !== serverId) return;
    let current = true;
    void loadAgentProfiles()
      .then((profiles) => {
        if (current) record(serverId, profiles);
      })
      .catch(() => {
        // An older gateway, or none answering: session agents only.
      });
    return () => {
      current = false;
    };
  }, [enabled, serverId, known, record]);
  return known;
}

/** Settings → Computers' "Home agent" row and the dock's bar open this. */
export function HomeAgentSheet() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { serverId = '' } = useLocalSearchParams<{ serverId?: string }>();
  const discovery = useAgents((state) => (serverId ? state.index.servers[serverId] : undefined));
  const terminal = useTerminalAgentCatalog(serverId);
  const chosenKey = useHomeAgentChoice((state) => state.byServer[serverId]);
  const choose = useHomeAgentChoice((state) => state.choose);
  const options = homeAgentOptions(discovery, terminal);
  const current = resolveHomeAgent(options, chosenKey);

  const rows = options.map((option) => {
    const caption =
      option.kind === 'terminal' ? t`Starts in a terminal` : _(agentLaunchCaption[option.caption]);
    return (
      <SheetSceneRow
        key={option.key}
        testID={`home-agent-option-${option.key.replace(':', '-')}`}
        title={option.name}
        caption={caption}
        selected={option.key === current?.key}
        accessibilityLabel={`${option.name}, ${caption}`}
        leading={
          <AgentMark
            kind={option.agentKind}
            size={20}
            color={option.ready ? theme.colors.primary : theme.colors.textMuted}
          />
        }
        onPress={() => {
          choose(serverId, option.key);
          router.back();
        }}
      />
    );
  });

  const contentSized = options.length <= 5;
  return (
    <SheetScene
      testID="home-agent-sheet"
      title={t`Home agent`}
      caption={t`What Home starts when you send from here`}
      contentSized={contentSized}>
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
