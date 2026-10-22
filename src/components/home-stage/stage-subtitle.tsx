import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { memo, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { agentDisplayName } from '@/lib/home-launch-model';
import { inlineMarkdownSpans } from '@/lib/markdown-text';
import { calmFadeIn, calmFadeOut } from '@/lib/motion';
import { stageSubtitleStep, type StageProgress } from '@/lib/stage-overlay';
import { useAgents } from '@/stores/agents';
import { SHEET_FROST_ALPHA, surfaceBackgroundFill } from '@/theme/surface-background';
import { useStageProgress } from './use-stage-overlay';

/** Compact, independently updating speakers above the session strip. */
export function StageSubtitle({
  serverId,
  compact = false,
  maxRows = 5,
  onShownChange,
  onOpen,
}: {
  serverId: string;
  compact?: boolean;
  maxRows?: number;
  onShownChange?: (shown: boolean) => void;
  onOpen?: (line: StageProgress) => void;
}) {
  const lines = useStageProgress(serverId);
  const visible = lines.length > 0;
  const report = useEffectEvent((next: boolean) => onShownChange?.(next));
  useEffect(() => {
    report(visible);
  }, [visible]);
  useEffect(() => () => report(false), []);
  return visible ? (
    <View testID="home-stage-subtitle" style={styles.stack}>
      {lines.slice(0, Math.min(maxRows, compact ? 2 : 5)).map((line) => (
        <HeldSubtitleLine
          key={line.key}
          serverId={serverId}
          line={line}
          compact={compact}
          onOpen={onOpen}
        />
      ))}
    </View>
  ) : null;
}

function HeldSubtitleLine({
  serverId,
  line,
  compact,
  onOpen,
}: {
  serverId: string;
  line: StageProgress;
  compact: boolean;
  onOpen?: (line: StageProgress) => void;
}) {
  const [shown, setShown] = useState<{ line: StageProgress | null; atMs: number }>({
    line: null,
    atMs: 0,
  });
  const readLine = useLatestReader(line);
  const nextKey = line?.key;
  const nextText = line?.text;
  useEffect(() => {
    const step = stageSubtitleStep({
      shown: shown.line,
      shownAtMs: shown.atMs,
      next:
        nextKey !== undefined && nextText !== undefined ? { key: nextKey, text: nextText } : null,
      nowMs: Date.now(),
    });
    if (step.kind === 'keep') return;
    // Whatever is newest when the wait is over: lines in between are skipped.
    const show = () => setShown({ line: readLine(), atMs: Date.now() });
    if (step.kind === 'show') {
      show();
      return;
    }
    const timer = setTimeout(show, step.waitMs);
    return () => clearTimeout(timer);
  }, [nextKey, nextText, shown, readLine]);
  // Keep the newest routing identity even while the words are held for readability.
  const heldText = shown.line?.text ?? line.text;
  const displayed = useMemo(
    () => (heldText === line.text ? line : { ...line, text: heldText }),
    [line, heldText]
  );
  return <SubtitleLine serverId={serverId} line={displayed} compact={compact} onOpen={onOpen} />;
}

/**
 * The line sits on a small frosted plate in the theme's raised surface and
 * control corner, in the agent chips' place, so it reads over any art; the
 * agent's name leads in the accent, and the report's bold, emphasis and code
 * keep their marks.
 */
const SubtitleLine = memo(function SubtitleLine({
  serverId,
  line,
  compact,
  onOpen,
}: {
  serverId: string;
  line: StageProgress;
  compact: boolean;
  onOpen?: (line: StageProgress) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const monoFontFamily = useMonoFontFamily();
  const agents = useAgents((state) => state.index.servers[serverId]?.agents?.agents);
  const who = line.agentLabel ?? agentDisplayName(agents, line.agentId);
  const spans = useMemo(() => inlineMarkdownSpans(line.text), [line.text]);
  return (
    <Animated.View
      testID={`home-stage-subtitle-${line.key}`}
      pointerEvents="box-none"
      entering={calmFadeIn()}
      exiting={calmFadeOut()}
      style={styles.line}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${who}, ${t`Working`}, ${line.text}`}
        disabled={!onOpen}
        onPress={() => onOpen?.(line)}
        style={[
          styles.plate,
          {
            backgroundColor: surfaceBackgroundFill(theme.colors.surfaceRaised, SHEET_FROST_ALPHA),
            borderRadius: profile.chrome.control,
          },
        ]}>
        <Text
          variant="caption"
          numberOfLines={compact ? 1 : 2}
          ellipsizeMode="tail"
          color={theme.colors.textMuted}>
          <Text variant="caption" weight="semibold" color={theme.colors.primary}>
            {who}
          </Text>
          {` · ${t`Working`}  `}
          {spans.map((span, index) =>
            span.mark === 'code' ? (
              <Text
                key={index}
                variant="caption"
                color={theme.colors.text}
                style={{ fontFamily: monoFontFamily }}>
                {span.text}
              </Text>
            ) : span.mark ? (
              <Text
                key={index}
                variant="caption"
                color={theme.colors.text}
                weight={span.mark === 'strong' ? 'semibold' : undefined}
                style={span.mark === 'emphasis' ? styles.emphasis : undefined}>
                {span.text}
              </Text>
            ) : (
              span.text
            )
          )}
        </Text>
      </PressableScale>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  stack: { gap: 4 },
  line: { alignSelf: 'stretch' },
  plate: {
    alignSelf: 'stretch',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  emphasis: { fontStyle: 'italic' },
});
