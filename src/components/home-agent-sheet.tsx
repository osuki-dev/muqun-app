import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentActionMenu } from '@/components/agent-action-menu';
import { AgentMark } from '@/components/agent-mark';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietAction,
  SheetSceneRow,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { agentLaunchCaption } from '@/i18n/labels';
import { useTerminalAgentCatalog } from '@/hooks/use-terminal-agent-catalog';
import { DisclosureDownIcon, DisclosureUpIcon, RemoveIcon } from '@/icons';
import { AGENT_VISIBILITY_CAPABILITY } from '@/lib/agent-discovery';
import type { AgentVisibility } from '@/lib/agent-protocol';
import { setAgentVisibility } from '@/lib/agent-visibility-client';
import {
  homeAgentNeedsTerminalLabel,
  homeAgentOptions,
  resolveHomeAgent,
  type HomeAgentOption,
} from '@/lib/home-agent-choice';
import { useAgents } from '@/stores/agents';
import { useHomeAgentChoice } from '@/stores/home-agent-choice';
import { useServerCapabilities } from '@/stores/server-capabilities';

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
  // Hide and Show exist only where the computer keeps the choice.
  const canSetVisibility = useServerCapabilities(
    (state) => state.byServer[serverId]?.includes(AGENT_VISIBILITY_CAPABILITY) === true
  );
  const listed = homeAgentOptions(discovery, terminal);
  const current = resolveHomeAgent(listed, chosenKey, terminal !== undefined);
  // A stored terminal agent the catalog has not confirmed yet is still listed,
  // as the selected row, rather than vanishing until the catalog answers.
  const options =
    current && !listed.some((option) => option.key === current.key) ? [current, ...listed] : listed;
  const isMore = (option: HomeAgentOption) => option.kind === 'session' && option.more === true;
  const primary = options.filter((option) => !isMore(option));
  const more = options.filter(isMore);
  // Opened already when the chosen agent is one of the folded ones.
  const [moreOpen, setMoreOpen] = useState(() => (current ? isMore(current) : false));
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  async function changeVisibility(option: HomeAgentOption, visibility: AgentVisibility) {
    setBusyKey(option.key);
    setFailedKey(null);
    try {
      await setAgentVisibility(serverId, option.agentKind, visibility);
      setMenuKey(null);
    } catch {
      setFailedKey(option.key);
    }
    setBusyKey(null);
  }

  function row(option: HomeAgentOption) {
    const name = option.name;
    const title = homeAgentNeedsTerminalLabel(option, options) ? t`${name} (terminal)` : name;
    const caption =
      option.kind === 'terminal'
        ? option.ready
          ? t`Starts in a terminal`
          : t`Not available on this computer`
        : _(agentLaunchCaption[option.caption]);
    const session = option.kind === 'session' ? option : null;
    // Switched off on the host is a state to read, not a destination.
    const off = session?.caption === 'off';
    const hideable = Boolean(canSetVisibility && session?.agentId && !session.more);
    const showable = Boolean(canSetVisibility && session?.hidden);
    const failed = failedKey === option.key;
    return (
      <View key={option.key}>
        <SheetSceneRow
          testID={`home-agent-option-${option.key.replace(':', '-')}`}
          title={title}
          caption={caption}
          selected={option.key === current?.key}
          disabled={off}
          busy={busyKey === option.key}
          accessibilityLabel={`${title}, ${caption}`}
          leading={
            <AgentMark
              kind={option.agentKind}
              size={20}
              color={option.ready ? theme.colors.primary : theme.colors.textMuted}
            />
          }
          trailing={
            showable ? (
              <SheetSceneQuietAction
                testID={`home-agent-show-${option.key.replace(':', '-')}`}
                label={failed ? t`Try again` : t`Show`}
                disabled={busyKey !== null}
                onPress={() => void changeVisibility(option, 'auto')}
              />
            ) : undefined
          }
          {...(off
            ? {}
            : {
                onPress: () => {
                  choose(serverId, option.key);
                  router.back();
                },
              })}
          {...(hideable
            ? {
                onLongPress: () => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setFailedKey(null);
                  setMenuKey((open) => (open === option.key ? null : option.key));
                },
              }
            : {})}
        />
        {hideable && menuKey === option.key ? (
          <AgentActionMenu
            testID={`home-agent-menu-${option.key.replace(':', '-')}`}
            surface="ground"
            error={failed ? t`Could not change this setting` : null}
            items={[
              {
                id: 'hide',
                label: t`Hide on this computer`,
                Icon: RemoveIcon,
                disabled: busyKey !== null,
                onPress: () => void changeVisibility(option, 'hidden'),
                testID: `home-agent-hide-${option.key.replace(':', '-')}`,
              },
            ]}
          />
        ) : null}
      </View>
    );
  }

  // Under More: the hidden ones first, then one group per state.
  const groups: { title: string; options: HomeAgentOption[] }[] = [];
  for (const option of more) {
    const title =
      option.kind === 'session' && option.hidden
        ? t`Hidden`
        : _(agentLaunchCaption[option.kind === 'session' ? option.caption : 'offline']);
    const group = groups.find((entry) => entry.title === title);
    if (group) group.options.push(option);
    else groups.push({ title, options: [option] });
  }
  groups.sort((a, b) => Number(b.title === t`Hidden`) - Number(a.title === t`Hidden`));

  const moreCount = more.length;
  const MoreIcon = moreOpen ? DisclosureUpIcon : DisclosureDownIcon;
  const rows = (
    <>
      {primary.map(row)}
      {moreCount > 0 ? (
        <SheetSceneRow
          testID="home-agent-more"
          title={t`More agents`}
          accessibilityLabel={`${t`More agents`}, ${moreCount}`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {moreCount}
            </Text>
          }
          trailing={<MoreIcon size={16} color={theme.colors.textMuted} />}
          onPress={() => setMoreOpen((open) => !open)}
        />
      ) : null}
      {moreOpen
        ? groups.map((group) => (
            <View key={group.title}>
              <SheetSceneGroupHeading title={group.title} />
              {group.options.map(row)}
            </View>
          ))
        : null}
    </>
  );

  const contentSized = primary.length + (moreCount > 0 ? 1 : 0) <= 5 && !moreOpen;
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
