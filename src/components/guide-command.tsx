import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { useRouter, type Href } from 'expo-router';
import { Check, Copy, Play } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { SHEET_LADDER } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { feedback } from '@/lib/feedback';
import { createWorkspace, loadRecordSessions, sendBoundPaneText } from '@/lib/gateway-client';
import { guideCommandAction, guideCommandLines } from '@/lib/guide-command';
import { describeGatewayFailure } from '@/lib/network-error';
import { reachabilityOfStatus, resolveConnectionStatus } from '@/lib/server-reachability';
import { resolveSessionId, sessionChoices } from '@/lib/session-switcher';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useServerChannels } from '@/stores/server-channels';
import { useServerReachability } from '@/stores/server-reachability';
import { useServerSession } from '@/stores/server-session';

const COPIED_HOLD_MS = 2000;
/** The guide's primary button height, as `agent-guide-sheet.tsx` draws its own. */
export const GUIDE_ACTION_HEIGHT = 48;

/**
 * Whether a guide's command can be run for the reader on `serverId` right now:
 * the computer answers (Home's own evidence) and its gateway has a terminal
 * plane to open a pane on. A sheet reads this to decide which action leads.
 */
export function useGuideCommandRuns(serverId: string | undefined): boolean {
  const probe = useServerReachability((state) => (serverId ? state.probes[serverId] : undefined));
  const socket = useServerChannels((state) => (serverId ? state.sockets[serverId] : undefined));
  const stream = useServerChannels((state) => (serverId ? state.streams[serverId] : undefined));
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const terminalPlane = useAgents((state) =>
    serverId ? state.index.servers[serverId]?.terminal : undefined
  );
  if (!serverId) return false;
  const reachable =
    reachabilityOfStatus(
      resolveConnectionStatus({
        serverId,
        probe,
        channels: { socket, stream },
        selected: serverId === selectedId,
      })
    ) === 'live';
  // The New terminal tile's rule: a gateway that says its terminal plane is
  // unsupported has none; one that did not say keeps it.
  const terminal = !terminalPlane || terminalPlane.supported;
  return guideCommandAction({ reachable, terminal }) === 'run';
}

/**
 * A setup guide's shell command, in every guide that shows one (design §8).
 *
 * The command line stays as it was -- tap to copy, selectable to read off --
 * and on a computer that answers and can open a terminal, "Run on <computer>"
 * leads: it opens a new terminal pane there (a new workspace in the computer's
 * terminal session, at its default directory), types each line of the command
 * with Enter, and shows the pane, so the output is visible and can be
 * interrupted. Nothing is ever typed for the reader beyond the command: a
 * `sudo` line asks for its password in the pane. The guide is not closed; back
 * from the pane returns to it and its "Check again".
 */
export function GuideCommand({
  serverId,
  command,
  testID = 'guide-command',
  copyLabel,
}: {
  /** The computer the guide is about; the command runs there and nowhere else. */
  serverId: string | undefined;
  command: string;
  testID?: string;
  /** The copy row's spoken label, when the guide has its own words for it. */
  copyLabel?: string;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const mono = useMonoFontFamily();
  const router = useRouter();
  const { records, selectRecord } = useGatewayRecord();
  const chooseSession = useServerSession((state) => state.chooseSession);
  const choosePanel = usePanelPickerStore((state) => state.choosePanel);
  const runs = useGuideCommandRuns(serverId);
  const computer = records.find((record) => record.serverId === serverId);
  const computerLabel = computer?.label ?? '';

  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    []
  );

  const copy = async () => {
    await Clipboard.setStringAsync(command);
    void feedback('success');
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  };

  const run = () => {
    if (running || !computer || !serverId) return;
    setRunning(true);
    setError(null);
    void settleAfter(
      () =>
        recoverWith(
          async () => {
            // The new-terminal path: the computer selected, its terminal
            // session (the one last used there, else the first), a new pane.
            if (useGatewayConnectionStore.getState().record?.serverId !== serverId) {
              if (!(await selectRecord(serverId))) throw new Error('Computer unavailable');
            }
            const choices = sessionChoices((await loadRecordSessions(computer)).sessions);
            if (choices.length === 0) throw new Error('No terminal session');
            const sessionId = resolveSessionId(
              choices,
              useServerSession.getState().byServer[serverId]
            );
            const created = await createWorkspace(sessionId, { focus: false });
            if (!created.paneId) throw new Error('No pane');
            for (const line of guideCommandLines(command)) {
              await sendBoundPaneText(computer, sessionId, created.paneId, line, true, () => true);
            }
            void feedback('success');
            chooseSession({ serverId, sessionId });
            choosePanel({ serverId, paneId: created.paneId });
            router.push({
              pathname: '/servers/[serverId]',
              params: { serverId, sessionId, paneId: created.paneId },
            } as Href);
          },
          (failure) => {
            void feedback('warning');
            setError(
              describeGatewayFailure(failure, t`Could not open a terminal on this computer.`)
                .message
            );
          }
        ),
      () => setRunning(false)
    );
  };

  return (
    <View style={styles.column}>
      {runs ? (
        <PressableScale
          testID={`${testID}-run`}
          accessibilityRole="button"
          accessibilityLabel={t`Run on ${computerLabel}`}
          accessibilityState={{ busy: running, disabled: running }}
          disabled={running}
          onPress={run}
          style={[
            styles.run,
            { backgroundColor: theme.colors.primary, borderRadius: profile.chrome.control },
          ]}>
          {running ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <Play size={15} color={theme.colors.onPrimary} strokeWidth={2.2} />
          )}
          <Text variant="bodySmall" weight="bold" color={theme.colors.onPrimary}>
            {t`Run on ${computerLabel}`}
          </Text>
        </PressableScale>
      ) : null}
      <PressableScale
        testID={`${testID}-copy`}
        accessibilityRole="button"
        accessibilityLabel={copied ? t`Copied` : (copyLabel ?? t`Copy the command`)}
        onPress={() => void copy()}
        style={[
          styles.command,
          {
            borderColor: theme.colors.border,
            borderRadius: profile.chrome.control,
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          },
        ]}>
        <Text variant="caption" color={theme.colors.primary} weight="bold">
          $
        </Text>
        <Text
          selectable
          variant="bodySmall"
          color={theme.colors.text}
          style={{ ...styles.commandText, fontFamily: mono }}>
          {command}
        </Text>
        {copied ? (
          <Check size={14} color={theme.colors.success} strokeWidth={2.5} />
        ) : (
          <Copy size={14} color={theme.colors.textSubtle} strokeWidth={2} />
        )}
      </PressableScale>
      {error ? (
        <Text
          variant="caption"
          color={theme.colors.danger}
          accessibilityLiveRegion="polite"
          testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** The guide sheet's own rhythm, so the row reads as part of whichever guide holds it. */
const styles = StyleSheet.create({
  column: { gap: SHEET_LADDER.gap },
  run: {
    minHeight: GUIDE_ACTION_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
    borderCurve: 'continuous',
  },
  command: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.snug,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { flex: 1, letterSpacing: 0.2 },
});
