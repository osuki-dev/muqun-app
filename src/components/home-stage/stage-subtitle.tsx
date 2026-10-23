import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { memo, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  LayoutAnimationConfig,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { agentDisplayName } from '@/lib/home-launch-model';
import { inlineMarkdownSpans } from '@/lib/markdown-text';
import { calmFadeIn, calmFadeOut, timing } from '@/lib/motion';
import { stageSubtitleStep, type StageProgress } from '@/lib/stage-overlay';
import { useAgents } from '@/stores/agents';
import { SHEET_FROST_ALPHA, surfaceBackgroundFill } from '@/theme/surface-background';
import { STAGE_STRIP_CARD_HEIGHT, STAGE_STRIP_CARD_PADDING } from './stage-session-strip';
import { useStageProgress } from './use-stage-overlay';

/** Compact, independently updating speakers above the session strip. */
export function StageSubtitle({
  serverId,
  paused = false,
  compact = false,
  maxRows = 5,
  onShownChange,
  onOpen,
}: {
  serverId: string;
  /**
   * Home is not in front. The stack is kept mounted and draws nothing: it
   * used to unmount with the Stage, and every return from a conversation
   * then re-followed each speaker's session from scratch -- a whole
   * transcript read per session, on the frames Home was sliding back in.
   * The subscriptions are cheap and keep the lines current; only the pane
   * reads pause (`useStageProgress`).
   */
  paused?: boolean;
  compact?: boolean;
  maxRows?: number;
  onShownChange?: (shown: boolean) => void;
  onOpen?: (line: StageProgress) => void;
}) {
  const lines = useStageProgress(serverId, paused);
  const visible = lines.length > 0 && !paused;
  const report = useEffectEvent((next: boolean) => onShownChange?.(next));
  useEffect(() => {
    report(visible);
  }, [visible]);
  useEffect(() => () => report(false), []);
  return visible ? (
    <SubtitleStack>
      {lines.slice(0, Math.min(maxRows, compact ? 2 : 5)).map((line) => (
        <HeldSubtitleLine
          key={line.key}
          serverId={serverId}
          line={line}
          compact={compact}
          onOpen={onOpen}
        />
      ))}
    </SubtitleStack>
  ) : null;
}

/**
 * The lines there when the stack mounts arrive with it, faded in as one; only
 * lines that join later run their own entering animation. Android misplaces
 * views whose entering animation starts while Home slides back into view
 * (returning from a conversation remounts the stack): they were drawn behind
 * the session strip, outside the stack, and stayed out of the accessibility
 * tree.
 */
function SubtitleStack({ children }: { children: ReactNode }) {
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.set(withTiming(1, timing('short')));
  }, [opacity]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <Animated.View testID="home-stage-subtitle" style={[styles.stack, style]}>
      <LayoutAnimationConfig skipEntering>{children}</LayoutAnimationConfig>
    </Animated.View>
  );
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
            // The session cards' height and padding, so a one-line plate
            // reads as one of the row's cards; two lines grow past it.
            minHeight: STAGE_STRIP_CARD_HEIGHT[compact ? 1 : 0],
            paddingVertical: STAGE_STRIP_CARD_PADDING[compact ? 1 : 0],
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
  stack: { gap: 4, alignItems: 'flex-start' },
  // As wide as its words, up to the row: a short report is a short plate.
  line: { alignSelf: 'flex-start', maxWidth: '100%' },
  plate: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  emphasis: { fontStyle: 'italic' },
});
