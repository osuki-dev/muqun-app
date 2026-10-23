import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, useToast } from '@osuki-dev/ui';
import { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { TerminalKeyRow } from '@/components/terminal-key-row';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';
import { usePaneShortcuts } from '@/hooks/use-pane-shortcuts';
import { useStableHandler } from '@/hooks/use-render-refs';
import { sendPaneKeys, sendPaneText } from '@/lib/gateway-client';
import type { HomeThreadTarget } from '@/lib/home-thread';
import { paneVocabulary, vocabularyForSession } from '@/lib/key-vocabulary';
import { describeGatewayFailure } from '@/lib/network-error';
import { fadeInDown, fadeOutDown } from '@/lib/motion';
import { recordUsage, usageScope } from '@/lib/shortcut-usage';
import { resolveTerminalKeys, terminalKeyDelivery } from '@/lib/terminal-key-row';
import type { TerminalKey } from '@/lib/terminal-keys';
import { useAgents } from '@/stores/agents';
import { useAppSettings } from '@/stores/app-settings';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerAgents } from '@/stores/server-agents';

/**
 * The terminal keys above Home's field while the reply drawer shows a pane.
 *
 * A conversation needs nothing here, but a terminal pane does: Enter, Esc, an
 * agent's own chords, the arrows -- the toolbar the pane's screen keeps above
 * its input. It is the same row (`TerminalKeyRow`), fed by the same gateway
 * answer (`usePaneShortcuts`) and sending the same way (`terminalKeyDelivery`),
 * so a key does here exactly what it does there. What the screen adds on top
 * -- an editor's insert mode, the on-screen keyboard -- stays its own: the
 * drawer shows the row the gateway resolved for the pane and nothing more.
 *
 * It sits in the dock, above the field, so it never covers the terminal: the
 * drawer stands on the dock's foot and its body ends above whatever the dock
 * is tall. It rises in with the drawer and leaves with it.
 */
export function HomeReplyKeyRow({
  target,
  open,
}: {
  target: Extract<HomeThreadTarget, { kind: 'pane' }>;
  /** The drawer is up: the row is shown only then. */
  open: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { showToast } = useToast();
  const showTerminalKeyRow = useAppSettings((state) => state.showTerminalKeyRow);
  const { serverId, paneId } = target;
  const sessionId =
    useServerAgents((state) => target.sessionId ?? state.byServer[serverId]?.sessionId) ?? '';
  const connected = useGatewayConnectionStore((state) => state.record?.serverId === serverId);
  const shortcuts = usePaneShortcuts({
    sessionId,
    paneId,
    enabled: open && connected && showTerminalKeyRow,
  });
  // What this pane's backend says it can deliver, from the discovery mirror the
  // Stage already keeps for this computer.
  const terminalPlane = useAgents((state) => state.index.servers[serverId]?.terminal ?? null);
  const vocabulary = useMemo(
    () =>
      paneVocabulary(vocabularyForSession(terminalPlane, sessionId), shortcuts?.keyboard?.extended),
    [sessionId, shortcuts?.keyboard?.extended, terminalPlane]
  );
  const keys = useMemo(
    () => resolveTerminalKeys({ serverId, shortcuts, vocabulary }),
    [serverId, shortcuts, vocabulary]
  );
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const press = useStableHandler((item: TerminalKey) => {
    if (sendingKey || !sessionId) return;
    setSendingKey(item.key);
    if (shortcuts) recordUsage(usageScope(serverId, shortcuts.profile, 'keys'), item.key);
    const delivery = terminalKeyDelivery(item);
    void (
      delivery.kind === 'keys'
        ? sendPaneKeys(sessionId, paneId, delivery.keys)
        : sendPaneText(sessionId, paneId, delivery.text).then(() =>
            delivery.submit ? sendPaneKeys(sessionId, paneId, ['enter']) : undefined
          )
    )
      .catch((failure: unknown) => {
        showToast({
          variant: 'danger',
          title: t`Could not send key.`,
          message: describeGatewayFailure(failure, t`Could not send key.`).message,
        });
      })
      .finally(() => setSendingKey(null));
  });
  if (!open || !showTerminalKeyRow || keys.length === 0) return null;
  return (
    <Animated.View
      testID="home-reply-key-row"
      entering={fadeInDown('short')}
      exiting={fadeOutDown('short')}
      style={styles.row}>
      <TerminalKeyRow
        keys={keys}
        sendingKey={sendingKey}
        disabled={!connected || Boolean(sendingKey)}
        onPressKey={press}
        textColor={theme.colors.text}
        background={theme.colors.surface}
        activeBackground={theme.colors.primary}
        activeText={theme.colors.onPrimary}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    height: KEY_ROW_HEIGHT,
    marginBottom: 8,
    justifyContent: 'center',
  },
});
