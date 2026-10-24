import { StyleSheet, View } from 'react-native';
import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';

import type { AgentSessionRuntime } from '@/lib/agent-session-runtime';

/** Terminal observations do not claim ownership of native turns or approvals. */
export function AgentRuntimeNotice({
  runtime,
  offline,
  refreshing,
  onOpenTerminal,
  onRefresh,
}: {
  runtime: AgentSessionRuntime;
  offline: boolean;
  refreshing: boolean;
  onOpenTerminal?: () => void;
  onRefresh?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const status = offline ? 'unknown' : (runtime.status ?? 'unknown');
  const terminalStatus = {
    idle: t`Terminal · Idle`,
    working: t`Terminal · Working`,
    blocked: t`Terminal · Needs input`,
    starting: t`Terminal · Starting`,
    completed: t`Terminal · Completed`,
    unknown: t`Terminal · Status unavailable`,
  }[status];
  return (
    <View testID="agent-runtime-notice" style={styles.notice}>
      <Text variant="caption" color={theme.colors.textMuted}>
        {runtime.source === 'terminal'
          ? terminalStatus
          : !offline && runtime.interaction === 'native'
            ? t`Saved history · Send a message to resume`
            : t`Saved history · Live status unavailable`}
      </Text>
      <View style={styles.actions}>
        {onOpenTerminal ? (
          <PressableScale
            testID="agent-runtime-open-terminal"
            accessibilityRole="button"
            accessibilityLabel={t`Open terminal`}
            disabled={offline}
            onPress={onOpenTerminal}
            style={styles.action}>
            <Text variant="caption" color={offline ? theme.colors.textMuted : theme.colors.primary}>
              <Trans>Open terminal</Trans>
            </Text>
          </PressableScale>
        ) : null}
        {onRefresh ? (
          <PressableScale
            testID="agent-runtime-refresh-history"
            accessibilityRole="button"
            accessibilityLabel={t`Refresh history`}
            disabled={offline || refreshing}
            onPress={onRefresh}
            style={styles.action}>
            <Text
              variant="caption"
              color={offline || refreshing ? theme.colors.textMuted : theme.colors.primary}>
              {refreshing ? t`Refreshing history…` : t`Refresh history`}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { gap: 2, alignItems: 'flex-start', paddingHorizontal: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: { minHeight: 36, justifyContent: 'center' },
});
