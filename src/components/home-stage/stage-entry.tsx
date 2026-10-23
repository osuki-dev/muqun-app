import { useEffect, useMemo, useState } from 'react';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type AnimatedProps,
  type SharedValue,
} from 'react-native-reanimated';
import type { ViewProps } from 'react-native';

import { DURATION, ENTRY_BUDGET_MS, entryRiseProgress, RISE_DISTANCE, STAGGER } from '@/lib/motion';
import { entryDelay } from '@/lib/stagger';
import { useLaunchHandoff } from '@/stores/launch-handoff';

/**
 * The Stage foot's entrance on Home's first entry: the agent row, the
 * sessions handle and the session strip rise in, in that order, on the entry
 * stagger every Home layout's sections use (`entryRise`'s curve, beat and
 * budget). It waits for the launch cover to start leaving, so the rise is seen
 * rather than spent under the cover, and the blocks are laid out with their
 * data from the first frame: only their opacity and offset wait.
 *
 * One clock on the UI thread drives every block, so a data update re-renders
 * nothing here and replays nothing, and a block mounted after the clock has
 * run rests in place. Under reduce motion the blocks fade in together, without
 * travel, as `calmFadeIn` does.
 */
export type StageEntry = {
  /** Milliseconds into the sequence; `ENTRY_BUDGET_MS` once it has landed. */
  clock: SharedValue<number>;
  /** Blocks in the sequence, for the beat. */
  count: number;
  reduced: boolean;
};

export function useStageEntry(entering: boolean, count: number): StageEntry {
  const reduced = useReducedMotion();
  // Decided at mount: Home's entry window closes on its own clock, which can
  // run out while the Stage is still waiting under the cover for its scene.
  const [plays] = useState(entering);
  // `settle` sets this as well, and web has no cover: true from the start.
  const revealed = useLaunchHandoff((state) => state.revealing);
  const clock = useSharedValue(plays ? 0 : ENTRY_BUDGET_MS);
  useEffect(() => {
    if (!plays || !revealed) return;
    // Linear: the clock is time; each block eases its own share of it. Never
    // reduced here, because under reduce motion the blocks still fade.
    clock.set(
      withTiming(ENTRY_BUDGET_MS, {
        duration: ENTRY_BUDGET_MS,
        easing: Easing.linear,
        reduceMotion: ReduceMotion.Never,
      })
    );
  }, [plays, revealed, clock]);
  return useMemo(() => ({ clock, count, reduced }), [clock, count, reduced]);
}

/** One block of the Stage foot's entrance, at `slot` in the sequence. */
export function StageEntryRise({
  entry,
  slot,
  style,
  ...props
}: AnimatedProps<ViewProps> & { entry: StageEntry; slot: number }) {
  const { clock, count, reduced } = entry;
  const delay = reduced
    ? 0
    : entryDelay(slot, count, 0, STAGGER.entry, DURATION.short, ENTRY_BUDGET_MS);
  const rise = useAnimatedStyle(() => {
    const progress = entryRiseProgress(clock.get(), delay);
    return {
      opacity: progress,
      transform: [{ translateY: reduced ? 0 : (1 - progress) * RISE_DISTANCE }],
    };
  });
  return <Animated.View {...props} style={[style, rise]} />;
}
