/**
 * The New Task sheet's route.
 *
 * Thin, like the two Appearance pickers: the frame and every decision live in
 * the component, and what is left here is the two things only a route knows --
 * which server this is about, and where the phone goes when the agent is up.
 *
 * The connection is the reason this file is not a one-liner. The sheet can be
 * opened from the home screen, about a server the app is not currently talking
 * to, and every call it makes goes through one module-global base URL. So the
 * record is selected and *awaited* here before the sheet is allowed to render.
 * Firing the picker off against whichever server was selected last would ask
 * the wrong machine what it can run -- and then start an agent on it.
 */
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { NewTaskSheet } from '@/components/new-task-sheet';
import { loadSessions, type SpawnedAgent } from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';

export default function NewTaskScreen() {
  const router = useRouter();
  const theme = useThemeTokens();
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  const { t } = useLingui();
  const params = useLocalSearchParams<{
    serverId: string;
    /** Known when the sheet was opened from a pane; resolved here when not. */
    sessionId?: string;
    tabId?: string;
    cwd?: string;
    /**
     * Whether the server screen is behind this sheet. The quick actions sheet
     * replaced itself with this one, so going back lands on the pane; the home
     * screen did not, so the phone has to be sent there.
     */
    origin?: string;
  }>();
  const fromHome = params.origin === 'home';

  const connectedServerId = useGatewayConnectionStore((state) => state.record?.serverId);
  const selectRecord = useGatewayConnectionStore((state) => state.selectRecord);
  const choosePanel = usePanelPickerStore((state) => state.choosePanel);

  const [sessionId, setSessionId] = useState(params.sessionId ?? '');
  const [error, setError] = useState<string | null>(null);

  const serverId = params.serverId;
  const needsSelect = Boolean(serverId) && connectedServerId !== serverId;

  useEffect(() => {
    if (!serverId) return;
    let cancelled = false;

    async function connect() {
      try {
        if (needsSelect && !(await selectRecord(serverId))) {
          if (!cancelled) setError(t`This server is no longer paired.`);
          return;
        }
        if (cancelled || sessionId) return;
        const sessions = await loadSessions();
        // One session per gateway today, and the first is the one every other
        // screen uses. Named here rather than assumed, so a gateway that starts
        // reporting several does not silently pick a different one.
        const first = sessions.sessions?.[0]?.id;
        if (cancelled) return;
        if (!first) {
          setError(t`This server has no session to start an agent in.`);
          return;
        }
        setSessionId(first);
      } catch (failure) {
        if (!cancelled) {
          setError(describeGatewayFailure(failure, t`Could not reach this server.`).message);
        }
      }
    }

    void connect();
    return () => {
      cancelled = true;
    };
  }, [needsSelect, selectRecord, serverId, sessionId, t]);

  /**
   * Straight into the pane the agent came up in -- the promise the whole flow
   * makes. From a pane that is the picker store the panels sheet already writes
   * to, plus a dismissal; from the home screen it is the same deep link an
   * approval notification uses, replacing the sheet rather than stacking on it
   * so Back still means "the server list".
   */
  function landOn(spawned: SpawnedAgent) {
    if (fromHome) {
      router.replace({
        pathname: '/servers/[serverId]',
        params: { serverId, paneId: spawned.paneId },
      } as Href);
      return;
    }
    choosePanel({ serverId, paneId: spawned.paneId });
    router.back();
  }

  if (error || !serverId) {
    return (
      <View style={[styles.notice, { backgroundColor: theme.colors.surface }]}>
        <Text selectable variant="bodySmall" color={theme.colors.danger}>
          {error ?? t`No server to start a task on.`}
        </Text>
      </View>
    );
  }

  if (!sessionId || needsSelect) {
    return (
      <View style={[styles.notice, { backgroundColor: theme.colors.surface }]}>
        <Spinner size="sm" color={theme.colors.primary} />
        <Text variant="caption" color={theme.colors.textMuted}>
          {/* The same word the connection banner uses, not a second one with
              an ellipsis on it: two spellings of one state is how a glossary
              starts drifting. */}
          {t`Connecting`}
        </Text>
      </View>
    );
  }

  return (
    <NewTaskSheet
      sessionId={sessionId}
      tabId={params.tabId}
      initialCwd={params.cwd}
      onClose={() => router.back()}
      onStarted={landOn}
    />
  );
}

const styles = StyleSheet.create({
  // Tall enough that `fitToContents` does not draw a sheet the height of one
  // line while the server is being reached, which reads as a glitch rather than
  // as waiting.
  notice: {
    minHeight: 132,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
});
