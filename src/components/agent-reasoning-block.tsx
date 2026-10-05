import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import { ChevronDown } from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ThinkingIndicator } from '@/components/agent-thinking-indicator';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { fadeIn, fadeOut, timing } from '@/lib/motion';
import { formatThoughtDuration } from '@/lib/agent-reasoning';
import { withAlpha } from '@/lib/color';
import { useMarkdownFonts } from '@/hooks/use-user-fonts';
import { createThoughtMarkdownStyle } from '@/lib/markdown-style';
import { AGENT_TYPE } from '@/constants/agent-type';
import {
  TRANSCRIPT_GRID,
  TRANSCRIPT_HANG,
  TRANSCRIPT_RULE_X,
  transcriptRuleTrim,
} from '@/constants/transcript-grid';

/** A live status label needs whole seconds, not a ten-Hz stopwatch. */
const TICK_MS = 1000;

export interface AgentReasoningBlockProps {
  text: string;
  /** The summed duration of the run, once every step has reported one. */
  durationMs?: number;
  /**
   * Whether the model is still thinking.
   *
   * The label counts up while this is true and settles on `durationMs` when it
   * clears -- the block never sits there as an empty pill, which is what a
   * reasoning part that has only just started used to draw.
   */
  pending?: boolean;
  defaultExpanded?: boolean;
  /** Called after the body mounts so a virtualised list can re-measure row heights. */
  onSizeChange?: () => void;
}

export const AgentReasoningBlock = memo(function AgentReasoningBlock({
  text,
  durationMs,
  pending = false,
  defaultExpanded = false,
  onSizeChange,
}: AgentReasoningBlockProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const plate = useTranscriptPlate();
  const markdownFonts = useMarkdownFonts();
  const markdownStyle = useMemo(() => {
    const base = createThoughtMarkdownStyle(theme.colors, markdownFonts);
    return {
      ...base,
      codeBlock: { ...base.codeBlock, borderRadius: profile.chrome.surface },
      table: { ...base.table, borderRadius: profile.chrome.surface },
    };
  }, [theme.colors, markdownFonts, profile.chrome.surface]);
  const [expanded, setExpanded] = useState(defaultExpanded);

  /**
   * The live count, while the model is still thinking.
   *
   * Started at mount rather than from a timestamp on the wire: a reasoning
   * part that has only just begun has no `time` of its own, and the reader is
   * watching this block from the moment it appears, so the moment it appeared
   * is the honest zero.
   */
  const startedAt = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    if (!pending) return;
    // Read the clock in the effect, never during render: a render that asks
    // the time is a render whose result changes on its own.
    const from = startedAt.current ?? Date.now();
    startedAt.current = from;
    const timer = setInterval(
      () => setElapsedMs(Math.floor((Date.now() - from) / TICK_MS) * TICK_MS),
      TICK_MS
    );
    return () => clearInterval(timer);
  }, [pending]);

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing('micro'));
  }, [expanded, chevronProgress]);
  // Closed points down, open points up, like every other fold in the
  // transcript. It turned 90 degrees and pointed left when open.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

  // Settled beats live: the moment the engine reports a real duration, that
  // is what the block says.
  const shown = durationMs !== undefined ? durationMs : pending ? elapsedMs : null;
  const durationStr =
    shown === null
      ? null
      : pending && durationMs === undefined && shown < 60_000
        ? `${Math.floor(shown / 1000)}s`
        : formatThoughtDuration(shown);
  const label = durationStr ? t`Thought · ${durationStr}` : t`Thought`;

  // The body mounts into a virtualised row whose cached height predates it;
  // tell the list to re-measure once the layout settled so the rows below are
  // never painted over the expanded body.
  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(() => onSizeChange?.(), 80);
    return () => clearTimeout(timer);
  }, [expanded, onSizeChange]);

  return (
    <View style={styles.container}>
      <Pressable
        testID="agent-reasoning-accordion"
        accessibilityLabel={expanded ? t`Collapse reasoning` : t`Expand reasoning`}
        hitSlop={6}
        disabled={!text}
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [
          styles.headerPill,
          { borderRadius: profile.chrome.control },
          { backgroundColor: withAlpha(theme.colors.primary, 0.08) },
          pressed && { opacity: 0.7 },
        ]}>
        {/* The marker column every transcript row has: the same mark the
            assistant thinks with while it is thinking, the fold's chevron once
            it has settled. The column keeps its width when it is empty, so
            the label always starts where a tool's name does. */}
        <View style={styles.marker}>
          {pending ? (
            <Animated.View exiting={fadeOut('micro')}>
              <ThinkingIndicator size={12} color={theme.colors.primary} />
            </Animated.View>
          ) : text ? (
            <Animated.View style={chevronStyle}>
              <ChevronDown size={12} color={theme.colors.primary} style={styles.chevron} />
            </Animated.View>
          ) : null}
        </View>
        {/* Update the same text node. Keying by the clock restarted the fade
            before it could finish, making a running thought flash forever. */}
        <Text variant="caption" weight="medium" color={theme.colors.primary} style={styles.title}>
          {label}
        </Text>
      </Pressable>

      {/* The body brings its own ground: the pill sits on the wallpaper, and
          only the paragraph it opens onto needs a surface to be read on. */}
      {expanded && text ? (
        <Animated.View entering={fadeIn('micro')} style={[styles.body, plate]}>
          {/* The rule hangs in the marker column, under the chevron that
              opened it, and runs from the first line's cap height to the last
              line's baseline -- the text box, not the line boxes around it. */}
          <View
            testID="agent-reasoning-rule"
            style={[
              styles.rule,
              { backgroundColor: withAlpha(theme.colors.primary, TRANSCRIPT_GRID.ruleAlpha) },
            ]}
          />
          <View style={styles.quoteText}>
            {/* Reasoning is markdown like the answer: numbered plans, backticked
                names, the odd heading. It read as one flat italic run before. */}
            <BoundedMarkdown
              markdown={text}
              markdownStyle={markdownStyle}
              containerStyle={styles.reasoningBody}
              openLinks={false}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
});

/** The thought body's rule stops at its text box: cap height to baseline. */
const RULE_TRIM = transcriptRuleTrim(AGENT_TYPE.meta.size, AGENT_TYPE.mono.lineHeight);

const styles = StyleSheet.create({
  container: {
    // Full row width, not shrink-to-fit: the native markdown view measures its
    // height at the width it is offered, and a plate that sized itself around
    // its text measured at one width and drew at another, leaving the plate
    // (and the rule) one line tall under overflowing text.
    alignSelf: 'stretch',
  },
  headerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TRANSCRIPT_GRID.markerGap,
    paddingVertical: 5,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    borderCurve: 'continuous',
    alignSelf: 'flex-start',
  },
  marker: {
    width: TRANSCRIPT_GRID.markerWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: AGENT_TYPE.meta.size,
    fontVariant: ['tabular-nums'],
  },
  chevron: {
    opacity: 0.75,
  },
  // The markdown's last block margin is not part of its measured height, so
  // the plate's padding is the whole of the space under the last line, and
  // it is the same as the space over the first.
  body: {
    marginTop: TRANSCRIPT_GRID.attachGap,
    paddingVertical: TRANSCRIPT_GRID.plateInsetY,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
  },
  // Pinned to the plate's top and bottom, so it is the text's height however
  // many lines it has or grows to while streaming.
  rule: {
    position: 'absolute',
    left: TRANSCRIPT_RULE_X,
    width: TRANSCRIPT_GRID.ruleWidth,
    top: TRANSCRIPT_GRID.plateInsetY + RULE_TRIM.top,
    bottom: TRANSCRIPT_GRID.plateInsetY + RULE_TRIM.bottom,
  },
  // Stretched across the plate rather than shrink-wrapped: the markdown brings
  // no intrinsic width of its own on iOS.
  quoteText: {
    alignSelf: 'stretch',
    marginLeft: TRANSCRIPT_HANG,
  },
  reasoningBody: {},
});
