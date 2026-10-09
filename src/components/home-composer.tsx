import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { ArrowRight } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import type { HomeLaunchController } from '@/components/home-launch-actions';
import { PressableScale } from '@/components/pressable-scale';
import { StatusDot } from '@/components/status-dot';
import { TerminalComposer } from '@/components/terminal-composer';
import { Text } from '@/components/text';
import { ThemeIcon } from '@/components/theme-icon';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { reachabilityDescription } from '@/i18n/labels';
import type { HomeCommandResult } from '@/lib/home-commands';
import { findFileMentionTrigger } from '@/lib/file-mentions';
import {
  homeComposerAgent,
  homeComposerMentionCandidates,
  removeHomeComposerMention,
  resolveHomeComposerTarget,
} from '@/lib/home-composer';
import { buildLaunchModel } from '@/lib/home-launch-model';
import type { GatewayRecord } from '@/lib/gateway-storage';
import type { ServerReachability } from '@/lib/server-reachability';
import { useAgents } from '@/stores/agents';

const MENTION_ROW_HEIGHT = 48;
const MENTION_VISIBLE_ROWS = 4;

/**
 * Home's own composer: a goal, a computer to give it to, and Send.
 *
 * The field is the terminal's `TerminalComposer`, as the agent screen's is.
 * Above it, the assignment bar says where Send goes -- the computer Home has
 * chosen and the agent its launch row leads with -- and opens the same target
 * picker the launch tiles use. An `@` at a word start offers the computers
 * that are answering; choosing one moves the assignment and takes the `@word`
 * out of the draft, so the agent is sent the goal and nothing else.
 *
 * Send is the `new-agent` command with the goal attached: the new session's
 * workbench sends it as its first prompt. The draft is cleared only when the
 * command was accepted, so a computer that needs setup keeps the goal here.
 */
export function HomeComposer({
  controller,
  reachabilityByServer,
  currentServerId,
  onNewAgent,
}: {
  controller: HomeLaunchController;
  reachabilityByServer: Readonly<Record<string, ServerReachability | undefined>>;
  /** The computer this app is connected to now (the demo workspace in demo mode). */
  currentServerId?: string | null;
  onNewAgent: (
    serverId: string,
    directory?: string,
    agentId?: string,
    prompt?: string
  ) => Promise<HomeCommandResult>;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const background = useSurfaceBackground();
  const { servers, chosen, opening, openTargetPicker, run, choose } = controller;
  const [text, setText] = useState('');
  const [caret, setCaret] = useState<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const target = resolveHomeComposerTarget({ servers, chosen, reachabilityByServer });
  const targetServer = target.kind === 'none' ? undefined : target.server;
  const targetId = targetServer?.serverId;
  const discovery = useAgents((state) => (targetId ? state.index.servers[targetId] : undefined));
  const lastUsedAgentId = useAgents((state) =>
    targetId ? state.index.lastUsed[targetId] : undefined
  );
  const agent = homeComposerAgent(buildLaunchModel({ discovery, lastUsedAgentId }).entries);

  const mention = findFileMentionTrigger(text, caret ?? text.length);
  const candidates = mention
    ? homeComposerMentionCandidates({
        servers,
        reachabilityByServer,
        currentServerId,
        query: mention.query,
      })
    : [];

  if (servers.length === 0) return null;

  const goal = text.trim();
  const computerLabel = targetServer?.label ?? '';
  const agentName = agent?.name ?? '';
  const ready = target.kind === 'ready';

  function chooseComputer(server: GatewayRecord) {
    if (!mention) return;
    choose(server.serverId);
    const next = removeHomeComposerMention(text, mention);
    setText(next.text);
    setCaret(next.caret);
  }

  function send() {
    if (!goal || opening) return;
    if (target.kind === 'offline') {
      openTargetPicker();
      return;
    }
    if (target.kind !== 'ready') return;
    const serverId = target.server.serverId;
    const agentId = agent?.agentId;
    void run(async () => {
      const result = await onNewAgent(serverId, undefined, agentId, goal);
      if (result.status === 'dispatched' && mountedRef.current) {
        setText('');
        setCaret(null);
      }
    });
  }

  return (
    <View testID="home-composer" style={styles.root}>
      <PressableScale
        testID="home-composer-target"
        accessibilityRole="button"
        accessibilityLabel={
          targetServer
            ? agentName
              ? t`Assigned to ${computerLabel}, ${agentName}`
              : t`Send to ${computerLabel}`
            : t`No computer online`
        }
        accessibilityHint={t`Choose another computer`}
        accessibilityState={{ disabled: opening }}
        disabled={opening}
        hitSlop={{ top: 6, bottom: 6 }}
        onPress={openTargetPicker}
        style={styles.bar}>
        {targetServer ? (
          <>
            <ThemeIcon
              name="home.arrow"
              direction="right"
              fallback={ArrowRight}
              size={14}
              color={ready ? theme.colors.primary : theme.colors.textMuted}
            />
            <Text
              variant="bodySmall"
              weight="semibold"
              numberOfLines={1}
              color={ready ? theme.colors.text : theme.colors.textMuted}
              style={styles.barLabel}>
              {agentName ? `${computerLabel} · ${agentName}` : computerLabel}
            </Text>
            {target.kind === 'offline' ? (
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {_(reachabilityDescription.offline)}
              </Text>
            ) : null}
          </>
        ) : (
          <Text variant="bodySmall" color={theme.colors.textMuted} numberOfLines={1}>
            {t`No computer online`}
          </Text>
        )}
      </PressableScale>
      {candidates.length > 0 ? (
        <View
          testID="home-composer-mentions"
          accessibilityLabel={t`Computers`}
          style={[
            styles.panel,
            {
              borderRadius: profile.chrome.popover,
              backgroundColor: background(theme.colors.surface),
            },
          ]}>
          <Text variant="caption" color={theme.colors.textMuted} style={styles.heading}>
            <Trans>Computers</Trans>
          </Text>
          <ScrollView
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: MENTION_ROW_HEIGHT * MENTION_VISIBLE_ROWS }}>
            {candidates.map((server) => {
              const reachability = reachabilityByServer[server.serverId] ?? 'unknown';
              const live = reachability === 'live';
              return (
                <PressableScale
                  key={server.serverId}
                  testID={`home-composer-mention-${server.serverId}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${server.label}, ${_(reachabilityDescription[reachability])}`}
                  onPress={() => chooseComputer(server)}
                  style={styles.row}>
                  <StatusDot
                    color={live ? theme.colors.success : theme.colors.textSubtle}
                    filled={reachability !== 'unknown'}
                  />
                  <Text
                    variant="bodySmall"
                    color={theme.colors.text}
                    numberOfLines={1}
                    style={styles.rowLabel}>
                    {server.label}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
      <TerminalComposer
        voiceContext="home-composer"
        inputProps={{
          value: text,
          onChangeText: setText,
          onSelectionChange: (event) => setCaret(event.nativeEvent.selection.start),
          placeholder: t`Tell a computer what to do`,
          testID: 'home-composer-input',
        }}
        send={{
          accessibilityLabel: targetServer ? t`Send to ${computerLabel}` : t`No computer online`,
          armed: Boolean(goal) && ready && !opening,
          sending: opening && Boolean(goal),
          disabled: !goal || target.kind === 'none' || opening,
          onPress: send,
          // Not `composer-send`: on a Pad the hidden Home stays mounted beside
          // the terminal's composer, and flows press that one by id.
          testID: 'home-composer-send',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8, minWidth: 0 },
  bar: {
    minHeight: 36,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  barLabel: { minWidth: 0, flexShrink: 1 },
  panel: {
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingVertical: 4,
    boxShadow: appChrome.shadow.popover,
  },
  heading: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  row: {
    minHeight: MENTION_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
  rowLabel: { flex: 1, minWidth: 0 },
});
