import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { ProgressBar, Text, useThemeTokens } from '@osuki-dev/ui';

import { useAppActive } from '@/hooks/use-app-active';
import type { ToolPart } from '@/lib/agent-session';
import { formatToolDuration } from '@/lib/tool-call-detail';

/** An isolated clock keeps live wait updates out of the transcript list. */
export function AgentSleepToolBody({
  durationMs,
  part,
  compact = false,
}: {
  durationMs: number;
  part: ToolPart;
  compact?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const active = useAppActive();
  const [now, setNow] = useState(() => Date.now());
  const startedAt = part.time?.ran;
  const completedAt = part.time?.completed;
  const running = part.state === 'running';
  const deadline = startedAt === undefined ? undefined : startedAt + durationMs;

  useEffect(() => {
    // Reopening the card resumes from the provider's start, never from mount time.
    setNow(Date.now());
    if (!active || !running || deadline === undefined || Date.now() >= deadline) return;
    const timer = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= deadline) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [active, running, deadline]);

  const elapsed =
    startedAt !== undefined && (running || completedAt !== undefined)
      ? Math.min(durationMs, Math.max(0, (completedAt ?? now) - startedAt))
      : undefined;
  const remainingMs = elapsed === undefined ? undefined : Math.max(0, durationMs - elapsed);
  const duration = formatToolDuration(durationMs);
  const remaining = formatToolDuration(Math.ceil((remainingMs ?? durationMs) / 1000) * 1000);
  const status =
    part.state === 'completed'
      ? t`Completed`
      : part.state === 'failed'
        ? t`Failed`
        : running && remainingMs !== undefined
          ? remainingMs > 0
            ? t`${remaining} remaining`
            : t`Waiting for completion…`
          : t`Wait for ${duration}`;

  if (compact) {
    if (!running || remainingMs === undefined) return null;
    return (
      <Text variant="caption" color={theme.colors.textSubtle} style={styles.countdown}>
        {status}
      </Text>
    );
  }

  return (
    <View style={styles.body}>
      <Text
        variant="caption"
        color={part.state === 'failed' ? theme.colors.danger : theme.colors.textMuted}>
        {status}
      </Text>
      {elapsed !== undefined && durationMs > 0 ? (
        <ProgressBar
          value={elapsed}
          max={durationMs}
          size="sm"
          tone={part.state === 'failed' ? 'danger' : 'neutral'}
          accessibilityLabel={t`Wait for ${duration}`}
        />
      ) : null}
    </View>
  );
}

// A discrete, once-per-second progress update needs no looping motion and also
// respects reduced-motion preferences without introducing another animation.
const styles = StyleSheet.create({
  body: { gap: 8, alignSelf: 'stretch' },
  countdown: { flexShrink: 1, fontVariant: ['tabular-nums'] },
});
