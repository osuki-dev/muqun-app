import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { Check, Copy, ExternalLink, RefreshCw, Terminal } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { SheetScene, SHEET_LADDER } from '@/components/sheet-scene';
import { appChrome } from '@/constants/appearance';
import { feedback } from '@/lib/feedback';
import {
  agentGuideBlurb,
  agentGuideCommand,
  agentGuideStart,
  showsAgentSetupCommand,
  type AgentReadiness,
} from '@/lib/home-agent-readiness';
import { agentGuideFor } from '@/i18n/labels';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

export interface AgentGuideSheetProps {
  serverLabel: string;
  /** What the gateway calls the agent, or the id with its first letter raised. */
  agentName: string;
  /** The agent's kind, which picks the copy: `opencode`, `deepseek`, `t3`, or anything else. */
  agentKind: string;
  onClose: () => void;
  readiness: AgentReadiness;
  onCheckAgain: () => Promise<AgentReadiness>;
  onOpenAgent?: () => void;
}

const COPIED_HOLD_MS = 2000;

/**
 * What to do when an agent is not answering, as a native form sheet route.
 *
 * Content-sized, and the shortest sheet in the app: one sentence, one command
 * to copy, one button. `sheet-scene.tsx`'s heading and ground, and no card
 * around the command -- the monospace line on the ground is the object.
 */
export const AgentGuideSheet = memo(function AgentGuideSheet({
  serverLabel,
  agentName,
  agentKind,
  onClose,
  readiness,
  onCheckAgain,
  onOpenAgent,
}: AgentGuideSheetProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  // Read as separate values: the copy is a table's row, and a callback that
  // closed over the row could not be proven stable.
  const command = agentGuideCommand(agentGuideFor(agentKind), readiness.status);
  const installUrl = agentGuideFor(agentKind).installUrl;
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();

  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (command) await Clipboard.setStringAsync(command);
    void feedback('success');
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), COPIED_HOLD_MS);
  }, [command]);

  const handleCheckAgain = useCallback(async () => {
    setChecking(true);
    setStatusMessage(null);
    return settleAfter(
      async () => {
        try {
          const result = await onCheckAgain();
          if (result.status === 'ready') {
            void feedback('success');
            if (onOpenAgent) onOpenAgent();
            else onClose();
            return;
          }
          void feedback('warning');
          // The parent applies the returned readiness state, whose explanation is
          // specific to unsupported, missing, unreachable, or stopped services.
          setStatusMessage(null);
        } catch {
          void feedback('warning');
          setStatusMessage(
            t`This gateway is not answering. Check the server connection, then try again.`
          );
        }
      },
      () => {
        setChecking(false);
      }
    );
  }, [onCheckAgain, onClose, onOpenAgent, t]);

  const showServiceCommand = showsAgentSetupCommand(readiness) && Boolean(command);
  const blurbKind = agentGuideBlurb(readiness);
  const blurb =
    blurbKind === 'ready'
      ? t`${agentName} is ready on this host.`
      : blurbKind === 'unsupported'
        ? t`This gateway does not advertise ${agentName} sessions.`
        : blurbKind === 'update'
          ? t`Update Muqun Gateway on this host to use ${agentName}.`
          : blurbKind === 'not-installed'
            ? t`${agentName} was not found on this host. Install it, then check again.`
            : blurbKind === 'health'
              ? t`This gateway is not answering. Check the server connection, then try again.`
              : blurbKind === 'setup'
                ? _(agentGuideStart(agentGuideFor(agentKind), readiness.status))
                : t`${agentName}'s installation could not be confirmed. If it is installed, start it on the host.`;

  return (
    <SheetScene
      testID="agent-guide-sheet"
      title={t`Start ${agentName}`}
      caption={serverLabel}
      contentSized>
      <View
        style={[styles.column, { paddingBottom: Math.max(insets.bottom, SHEET_LADDER.section) }]}>
        {readiness.status === 'needs-update' && readiness.reason ? (
          <Text selectable variant="caption" color={theme.colors.textMuted} style={styles.blurb}>
            {readiness.reason}
          </Text>
        ) : null}
        <Text variant="caption" color={theme.colors.textMuted} style={styles.blurb}>
          {blurb}
        </Text>

        {readiness.status === 'not-installed' && installUrl ? (
          <PressableScale
            testID="agent-guide-install-btn"
            accessibilityRole="link"
            accessibilityLabel={t`Open the ${agentName} installation guide`}
            onPress={() => void Linking.openURL(installUrl)}
            style={[styles.command, { borderColor: theme.colors.border }]}>
            <ExternalLink size={15} color={theme.colors.primary} strokeWidth={2.2} />
            <Text
              variant="bodySmall"
              weight="semibold"
              color={theme.colors.text}
              style={styles.commandText}>
              {t`Open installation guide`}
            </Text>
          </PressableScale>
        ) : null}

        {showServiceCommand ? (
          <>
            <PressableScale
              testID="agent-guide-copy-cmd"
              accessibilityRole="button"
              accessibilityLabel={copied ? t`Copied` : t`Copy the command`}
              onPress={handleCopy}
              style={[styles.command, { borderColor: theme.colors.border }]}>
              <Text variant="caption" color={theme.colors.primary} weight="bold">
                $
              </Text>
              <Text
                selectable
                variant="bodySmall"
                weight="semibold"
                color={theme.colors.text}
                style={styles.commandText}>
                {command}
              </Text>
              {copied ? (
                <Check size={14} color={theme.colors.success} strokeWidth={2.5} />
              ) : (
                <Copy size={14} color={theme.colors.textSubtle} strokeWidth={2} />
              )}
            </PressableScale>

            <View style={styles.tip}>
              <Terminal size={13} color={theme.colors.textSubtle} />
              <Text variant="caption" color={theme.colors.textSubtle} style={styles.tipText}>
                {t`Run it under systemd or tmux to keep it up after you log out.`}
              </Text>
            </View>
          </>
        ) : null}

        {statusMessage ? (
          <Text variant="caption" color={theme.colors.danger} style={styles.status}>
            {statusMessage}
          </Text>
        ) : null}

        <PressableScale
          testID="agent-guide-check-again-btn"
          accessibilityRole="button"
          accessibilityLabel={t`Check again`}
          disabled={checking}
          onPress={handleCheckAgain}
          style={[styles.action, { backgroundColor: theme.colors.primary }]}>
          {checking ? (
            <ActivityIndicator size="small" color={theme.colors.onPrimary} />
          ) : (
            <RefreshCw size={15} color={theme.colors.onPrimary} strokeWidth={2.2} />
          )}
          <Text variant="bodySmall" weight="bold" color={theme.colors.onPrimary}>
            {t`Check again`}
          </Text>
        </PressableScale>
      </View>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  column: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: SHEET_LADDER.gap,
    gap: SHEET_LADDER.snug,
  },
  blurb: { lineHeight: 18 },
  // A hairline box, not a filled card: the command is a line of text on the
  // ground with a tap target around it.
  command: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.snug,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  commandText: { flex: 1, letterSpacing: 0.2 },
  tip: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.gap },
  tipText: { flex: 1, lineHeight: 16 },
  status: { lineHeight: 16 },
  action: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    marginTop: SHEET_LADDER.tight,
  },
});
