import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import * as Clipboard from 'expo-clipboard';
import { useRouter, type Href } from 'expo-router';
import { Check, Copy, Play } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { SHEET_LADDER } from '@/components/sheet-scene';
import { Text } from '@/components/text';
import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { feedback } from '@/lib/feedback';
import {
  createWorkspace,
  loadRecordSessions,
  readPaneTail,
  sendBoundPaneText,
} from '@/lib/gateway-client';
import {
  guideCommandAction,
  guideCommandLines,
  SHELL_READY_POLL_MS,
  SHELL_READY_TIMEOUT_MS,
} from '@/lib/guide-command';
import { useConnectionStatuses } from '@/hooks/use-home-reachability';
import { describeGatewayFailure } from '@/lib/network-error';
import { resolveSessionId, sessionChoices } from '@/lib/session-switcher';
import { useActiveConnection } from '@/stores/active-connection';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { usePanelPickerStore } from '@/stores/panel-picker';
import { useServerSession } from '@/stores/server-session';

const COPIED_HOLD_MS = 2000;

/**
 * Until a new pane's shell has drawn its prompt (its output is not blank), or
 * `SHELL_READY_TIMEOUT_MS` has passed: a line typed before the shell reads
 * input is echoed once by the terminal and again by the shell.
 */
async function waitForShell(
  sessionId: string,
  paneId: string,
  isCurrent: () => boolean
): Promise<void> {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  while (Date.now() < deadline && isCurrent()) {
    const tail = await readPaneTail(sessionId, paneId, 'text', 5).catch(() => null);
    if (tail?.output.trim()) return;
    await new Promise((resolve) => setTimeout(resolve, SHELL_READY_POLL_MS));
  }
}
/** The guide's primary button height, as `agent-guide-sheet.tsx` draws its own. */
export const GUIDE_ACTION_HEIGHT = 48;

/**
 * Whether a guide's command can be run for the reader on `serverId` right now
 * (`guideCommandAction`): its status from the one resolver Home and Settings
 * read (`useConnectionStatuses`, with its freshness clock), and its terminal
 * plane. `terminalDown`: the caller knows the backend is down. A sheet reads
 * this to decide which action leads.
 */
export function useGuideCommandRuns(serverId: string | undefined, terminalDown = false): boolean {
  const selectedId = useGatewayConnectionStore((state) => state.record?.serverId);
  const known = useGatewayConnectionStore((state) =>
    serverId ? state.records.some((record) => record.serverId === serverId) : false
  );
  const ids = useMemo(() => (serverId ? [serverId] : []), [serverId]);
  // On the Pad the workspace holds the connection, as it does for Home.
  const activeConnection = useActiveConnection((state) => state.connection);
  const status =
    useConnectionStatuses(ids, selectedId, activeConnection)[serverId ?? ''] ?? 'unknown';
  const terminalPlane = useAgents((state) =>
    serverId ? state.index.servers[serverId]?.terminal : undefined
  );
  if (!serverId || !known) return false;
  return (
    guideCommandAction({
      status,
      ...(terminalPlane ? { terminalPlane } : {}),
      terminalDown,
    }) === 'run'
  );
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
  copiedLabel,
  copyHint,
  numberOfLines,
  terminalDown = false,
}: {
  /** The computer the guide is about; the command runs there and nowhere else. */
  serverId: string | undefined;
  command: string;
  testID?: string;
  /** The copy row's spoken label, when the guide has its own words for it. */
  copyLabel?: string;
  /** What the row says once copied, when the guide has its own words. */
  copiedLabel?: string;
  /** The copy row's spoken hint. */
  copyHint?: string;
  /** A cap on the command's lines, for a guide that wraps rather than shrinks. */
  numberOfLines?: number;
  /** The computer's terminal backend is known to be down: no Run. */
  terminalDown?: boolean;
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
  const runs = useGuideCommandRuns(serverId, terminalDown);
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

  // A run that outlives the guide (the reader closed it) must not navigate.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const openPane = (sessionId: string, paneId: string) => {
    if (!mounted.current || !serverId) return;
    chooseSession({ serverId, sessionId });
    choosePanel({ serverId, paneId });
    router.push({
      pathname: '/servers/[serverId]',
      params: { serverId, sessionId, paneId },
    } as Href);
  };

  const run = () => {
    if (running || !computer || !serverId) return;
    setRunning(true);
    setError(null);
    const isCurrent = () => mounted.current;
    // Errors the reader reads are worded here, never a thrown sentence.
    const unavailable = t`Could not open a terminal on this computer.`;
    const noSession = t`No terminal session is available on this computer.`;
    const notTyped = t`The terminal opened, but the command could not be typed.`;
    const fail = (message: string) => {
      void feedback('warning');
      if (mounted.current) setError(message);
    };
    void settleAfter(
      () =>
        recoverWith(
          async () => {
            // The new-terminal path: the computer selected, its terminal
            // session (the one last used there, else the first), a new pane.
            if (useGatewayConnectionStore.getState().record?.serverId !== serverId) {
              if (!(await selectRecord(serverId))) {
                fail(unavailable);
                return;
              }
            }
            const choices = sessionChoices((await loadRecordSessions(computer)).sessions);
            if (choices.length === 0) {
              fail(noSession);
              return;
            }
            const sessionId = resolveSessionId(
              choices,
              useServerSession.getState().byServer[serverId]
            );
            const created = await createWorkspace(sessionId, { focus: false });
            if (!created.paneId) {
              fail(unavailable);
              return;
            }
            // The pane exists: whatever happens while typing, the reader is
            // shown it.
            await recoverWith(
              async () => {
                await waitForShell(sessionId, created.paneId, isCurrent);
                for (const line of guideCommandLines(command)) {
                  await sendBoundPaneText(
                    computer,
                    sessionId,
                    created.paneId,
                    line,
                    true,
                    isCurrent
                  );
                }
                void feedback('success');
              },
              // What failed is the typing, not the terminal: say so, with
              // the gateway's own reason.
              (failure) => fail(describeGatewayFailure(failure, notTyped).message)
            );
            openPane(sessionId, created.paneId);
          },
          (failure) => fail(describeGatewayFailure(failure, unavailable).message)
        ),
      () => {
        if (mounted.current) setRunning(false);
      }
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
        accessibilityLabel={
          copied ? (copiedLabel ?? t`Copied`) : (copyLabel ?? t`Copy the command`)
        }
        {...(copyHint ? { accessibilityHint: copyHint } : {})}
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
          {...(numberOfLines ? { numberOfLines } : {})}
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
