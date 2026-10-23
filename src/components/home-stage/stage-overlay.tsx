import { memo, useEffect, useEffectEvent } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import { NO_SIDE_INSETS, type SideInsets } from '@/hooks/use-side-insets';
import { HOME_DOCK_OUTER_INSET } from '@/lib/home-pad-geometry';
import type { StageOverlayBand } from '@/lib/home-stage-geometry';
import { calmFadeIn, calmFadeOut, riseIn } from '@/lib/motion';
import { StageNeedsCard, type StageNeedActions } from './stage-needs-card';
import { useStageNeeds } from './use-stage-overlay';

/**
 * What floats over the selected computer's art, standing on the foot rows
 * inside the band the Stage measured (`stageOverlayBand`): the request
 * waiting on the reader. While none waits, the progress subtitle shows in
 * the agent chips' place instead (`StageSubtitle`). Plain views over the
 * canvas: nothing here reaches the scene. Mounted only while Home is in front.
 */
export const StageOverlay = memo(function StageOverlay({
  serverId,
  band,
  sideInsets = NO_SIDE_INSETS,
  actions,
  onWaitingChange,
}: {
  serverId: string;
  band: StageOverlayBand;
  /** The side safe areas the card keeps clear of, like the chips under it. */
  sideInsets?: SideInsets;
  actions: StageNeedActions;
  /** Whether a request is up, which keeps the progress subtitle down. */
  onWaitingChange: (waiting: boolean) => void;
}) {
  const reduced = useReducedMotion();
  const { top, more, terminal } = useStageNeeds(serverId);
  const waiting = top !== null && top !== undefined;
  const report = useEffectEvent((next: boolean) => onWaitingChange(next));
  useEffect(() => {
    report(waiting);
  }, [waiting]);
  useEffect(() => () => report(false), []);
  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.band,
        {
          top: band.top,
          height: Math.max(0, band.bottom - band.top),
          left: HOME_DOCK_OUTER_INSET + sideInsets.left,
          right: HOME_DOCK_OUTER_INSET + sideInsets.right,
        },
      ]}>
      {top ? (
        // Keyed by the request: the next one rises in as the answered one fades.
        <Animated.View
          key={top.key}
          entering={reduced ? calmFadeIn() : riseIn()}
          exiting={calmFadeOut()}
          style={styles.foot}>
          <StageNeedsCard
            serverId={serverId}
            need={top}
            more={more}
            terminal={terminal}
            actions={actions}
          />
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  // The dock's gutter from the safe edges, set at render, so the card lines
  // up with the agent chips under it.
  band: { position: 'absolute' },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '100%' },
});
