import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { withAlpha } from '@/lib/color';
import { agentDisplayName } from '@/lib/home-launch-model';
import { inlineMarkdownSpans } from '@/lib/markdown-text';
import { calmFadeIn, calmFadeOut } from '@/lib/motion';
import { stageSubtitleStep, type StageProgress } from '@/lib/stage-overlay';
import { useAgents } from '@/stores/agents';
import { SHEET_FROST_ALPHA, surfaceBackgroundFill } from '@/theme/surface-background';
import { useStageProgress } from './use-stage-overlay';

/**
 * What a working agent on the selected computer last reported, as one or two
 * faint lines at the art's foot: "claude · running tests…". Nothing while no
 * agent reports anything. A new line replaces the old with a short
 * cross-fade when the agent changes, and in place when the same agent says
 * something new, at most once every two seconds (`stageSubtitleStep`); the text
 * is never animated otherwise, so an idle Stage runs nothing.
 */
export function StageSubtitle({
  serverId,
  onShownChange,
  onOpen,
}: {
  serverId: string;
  /** Whether a line is up, so the agent chips it stands in for can step aside. */
  onShownChange?: (shown: boolean) => void;
  /** A tap opens the agent the line is about, as its chip would. */
  onOpen?: (line: StageProgress) => void;
}) {
  const line = useStageProgress(serverId);
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
  const visible = shown.line !== null;
  const report = useEffectEvent((next: boolean) => onShownChange?.(next));
  useEffect(() => {
    report(visible);
  }, [visible]);
  useEffect(() => () => report(false), []);
  // Keyed by its agent: a new agent's line fades in over the old one, and the
  // same agent's next words replace its own in place, with no fade to redo.
  return shown.line ? (
    <SubtitleLine key={shown.line.key} serverId={serverId} line={shown.line} onOpen={onOpen} />
  ) : null;
}

/**
 * The line sits on a small frosted plate in the theme's raised surface and
 * control corner, in the agent chips' place, so it reads over any art; the
 * agent's name leads in the accent, and the report's bold, emphasis and code
 * keep their marks.
 */
function SubtitleLine({
  serverId,
  line,
  onOpen,
}: {
  serverId: string;
  line: StageProgress;
  onOpen?: (line: StageProgress) => void;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const monoFontFamily = useMonoFontFamily();
  const agents = useAgents((state) => state.index.servers[serverId]?.agents?.agents);
  const who = line.agentLabel ?? agentDisplayName(agents, line.agentId);
  const spans = useMemo(() => inlineMarkdownSpans(line.text), [line.text]);
  return (
    <Animated.View
      testID="home-stage-subtitle"
      pointerEvents="box-none"
      entering={calmFadeIn()}
      exiting={calmFadeOut()}
      style={styles.line}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${who}, ${line.text}`}
        disabled={!onOpen}
        onPress={() => onOpen?.(line)}
        style={[
          styles.plate,
          {
            backgroundColor: surfaceBackgroundFill(theme.colors.surfaceRaised, SHEET_FROST_ALPHA),
            borderColor: withAlpha(theme.colors.border, 0.6),
            borderRadius: profile.chrome.control,
          },
        ]}>
        <Text
          variant="caption"
          numberOfLines={2}
          ellipsizeMode="tail"
          color={theme.colors.textMuted}>
          <Text variant="caption" weight="semibold" color={theme.colors.primary}>
            {who}
          </Text>
          {'  '}
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
}

const styles = StyleSheet.create({
  line: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'flex-start' },
  plate: {
    maxWidth: '100%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emphasis: { fontStyle: 'italic' },
});
