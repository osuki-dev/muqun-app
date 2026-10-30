import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { NoticeIcon, DisclosureDownIcon, StackIcon, LoadingIcon, CloseIcon } from '@/icons';
import { useLingui } from '@lingui/react/macro';
import * as Clipboard from 'expo-clipboard';
import { useThemeTokens, useToast, PressableScale, Text } from '@osuki-dev/ui';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { BoundedMarkdown } from '@/components/bounded-markdown';
import { usePaneChatMarkdownStyle } from '@/components/pane-chat-blocks';
import { useAppActive } from '@/hooks/use-app-active';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { CompactionActivity } from '@/lib/agent-compaction';
import { fadeIn, fadeOut } from '@/lib/motion';

/** A local, continuous 3.2-second breath, not the global page-transition ease. */
const BREATH = { low: 0.72, halfCycleMs: 1600 };

export function CompactionPill({
  activity,
  onDismiss,
}: {
  activity: CompactionActivity;
  onDismiss?: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const markdownStyle = usePaneChatMarkdownStyle();
  const { showToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const running = activity.status === 'running';
  const failed = activity.status === 'failed';
  const hasSummary = Boolean(activity.summary.trim());
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const pulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(pulse);
    if (running && !reduceMotion && appActive) {
      pulse.set(BREATH.low);
      pulse.set(
        withRepeat(
          withTiming(1, {
            duration: BREATH.halfCycleMs,
            easing: Easing.inOut(Easing.sin),
            reduceMotion: ReduceMotion.System,
          }),
          -1,
          true,
          undefined,
          ReduceMotion.System
        )
      );
    } else {
      pulse.set(1);
    }
    return () => cancelAnimation(pulse);
  }, [appActive, pulse, reduceMotion, running]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }));

  const label = failed
    ? t`Compaction failed`
    : running
      ? activity.reason === 'manual'
        ? t`Compacting context…`
        : t`Compacting context automatically…`
      : activity.reason === 'manual'
        ? t`Context compacted · manual`
        : t`Context compacted · auto`;
  const canDismiss = !running && Boolean(onDismiss);
  const toggleLabel = expanded ? t`Hide output` : t`Show details`;

  return (
    <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')} style={styles.wrap}>
      <View
        style={[
          styles.plate,
          {
            borderRadius: profile.chrome.control,
            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
            borderColor: failed ? theme.colors.danger : 'transparent',
          },
        ]}>
        <View style={styles.header}>
          <PressableScale
            testID="agent-composer-compaction-pill"
            pressedScale={1}
            accessibilityRole={hasSummary || canDismiss ? 'button' : 'progressbar'}
            accessibilityState={{ busy: running, ...(hasSummary ? { expanded } : {}) }}
            accessibilityLabel={
              hasSummary
                ? `${label} · ${toggleLabel}`
                : canDismiss
                  ? t`Compaction failed — tap to dismiss`
                  : label
            }
            disabled={!hasSummary && !canDismiss}
            onPress={hasSummary ? () => setExpanded((value) => !value) : onDismiss}
            style={styles.pill}>
            <Animated.View style={pulseStyle} accessible={false}>
              {failed ? (
                <NoticeIcon size={12} color={theme.colors.danger} />
              ) : running ? (
                <LoadingIcon size={12} color={theme.colors.primary} />
              ) : (
                <StackIcon size={12} color={theme.colors.textMuted} />
              )}
            </Animated.View>
            <Text
              variant="caption"
              weight="semibold"
              style={styles.label}
              color={failed ? theme.colors.danger : theme.colors.text}>
              {label}
            </Text>
            {hasSummary ? (
              <DisclosureDownIcon
                size={12}
                color={theme.colors.textMuted}
                style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
              />
            ) : null}
          </PressableScale>
          {hasSummary && canDismiss ? (
            <PressableScale
              testID="agent-compaction-dismiss"
              pressedScale={1}
              accessibilityRole="button"
              accessibilityLabel={t`Dismiss`}
              onPress={onDismiss}
              style={styles.action}>
              <CloseIcon size={14} color={theme.colors.textMuted} />
            </PressableScale>
          ) : null}
        </View>
        {failed && activity.error?.message ? (
          <Text
            testID="agent-compaction-error"
            variant="caption"
            color={theme.colors.danger}
            style={styles.error}
            numberOfLines={4}>
            {activity.error.message}
          </Text>
        ) : null}
        {hasSummary && expanded ? (
          <View testID="agent-compaction-details" style={styles.details}>
            <ScrollView
              testID="agent-compaction-output"
              style={styles.output}
              nestedScrollEnabled
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}>
              <BoundedMarkdown
                markdown={activity.summary}
                markdownStyle={markdownStyle}
                openLinks={false}
              />
            </ScrollView>
            <PressableScale
              testID="agent-compaction-copy"
              pressedScale={1}
              accessibilityRole="button"
              accessibilityLabel={t`Copy output`}
              onPress={() => {
                void Clipboard.setStringAsync(activity.summary).then(() =>
                  showToast({
                    variant: 'info',
                    title: t`Copied`,
                    message: t`Output copied to clipboard`,
                  })
                );
              }}
              style={styles.copy}>
              <Text variant="caption" color={theme.colors.textMuted}>{t`Copy output`}</Text>
            </PressableScale>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 12, marginBottom: 6 },
  plate: { maxWidth: '100%', borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth },
  header: { flexDirection: 'row', alignItems: 'center' },
  pill: {
    minHeight: 45,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: { flexShrink: 1 },
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  error: { paddingHorizontal: 12, paddingBottom: 10 },
  details: { paddingHorizontal: 12 },
  output: { maxHeight: 180 },
  copy: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
});
