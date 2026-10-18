import { memo, useState, useCallback } from 'react';
import { View, StyleSheet, ActivityIndicator, Linking } from 'react-native';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { ExternalLink, RefreshCw, Terminal } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GuideCommand, useGuideCommandRuns } from '@/components/guide-command';
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
  /** The computer the guide is about: its command runs there. */
  serverId: string;
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

/**
 * What to do when an agent is not answering, as a native form sheet route.
 *
 * Content-sized, and the shortest sheet in the app: one sentence, one command
 * to copy, one button. `sheet-scene.tsx`'s heading and ground, and no card
 * around the command -- the monospace line on the ground is the object.
 */
export const AgentGuideSheet = memo(function AgentGuideSheet({
  serverId,
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

  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
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
            t`This computer is not answering. Check the computer connection, then try again.`
          );
        }
      },
      () => {
        setChecking(false);
      }
    );
  }, [onCheckAgain, onClose, onOpenAgent, t]);

  const showServiceCommand = showsAgentSetupCommand(readiness) && Boolean(command);
  const runs = useGuideCommandRuns(serverId) && showServiceCommand;
  const checkInk = runs ? theme.colors.primary : theme.colors.onPrimary;
  const blurbKind = agentGuideBlurb(readiness);
  const blurb =
    blurbKind === 'ready'
      ? t`${agentName} is ready on this host.`
      : blurbKind === 'unsupported'
        ? t`This computer does not advertise ${agentName} sessions.`
        : blurbKind === 'update'
          ? t`Update Muqun Gateway on this host to use ${agentName}.`
          : blurbKind === 'not-installed'
            ? t`${agentName} was not found on this host. Install it, then check again.`
            : blurbKind === 'health'
              ? t`This computer is not answering. Check the computer connection, then try again.`
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
            style={styles.command}>
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

        {showServiceCommand && command ? (
          <>
            <GuideCommand serverId={serverId} command={command} testID="agent-guide-cmd" />

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
          // Beside "Run on <computer>", which leads, it is the second action.
          style={[styles.action, !runs && { backgroundColor: theme.colors.primary }]}>
          {checking ? (
            <ActivityIndicator size="small" color={checkInk} />
          ) : (
            <RefreshCw size={15} color={checkInk} strokeWidth={2.2} />
          )}
          <Text variant="bodySmall" weight="bold" color={checkInk}>
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
  // The link is a line of text on the ground with a tap target around it.
  command: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: SHEET_LADDER.snug,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
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
