import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useTerminalAgentCatalog } from '@/hooks/use-terminal-agent-catalog';
import {
  homeAgentNeedsTerminalLabel,
  homeAgentOptions,
  resolveHomeAgent,
} from '@/lib/home-agent-choice';
import { useAgents } from '@/stores/agents';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';

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
  const listed = homeAgentOptions(discovery, terminal);
  const current = resolveHomeAgent(listed, chosenKey, terminal !== undefined);
  // A stored terminal agent the catalog has not confirmed yet is still listed,
  // as the selected row, rather than vanishing until the catalog answers.
  const options =
    current && !listed.some((option) => option.key === current.key) ? [current, ...listed] : listed;

  const rows = options.map((option) => {
    const name = option.name;
    const title = homeAgentNeedsTerminalLabel(option, options) ? t`${name} (terminal)` : name;
    const caption =
      option.kind === 'terminal'
        ? option.ready
          ? t`Starts in a terminal`
          : t`Not available on this computer`
        : _(agentLaunchCaption[option.caption]);
    return (
      <SheetSceneRow
        key={option.key}
        testID={`home-agent-option-${option.key.replace(':', '-')}`}
        title={title}
        caption={caption}
        selected={option.key === current?.key}
        accessibilityLabel={`${title}, ${caption}`}
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
