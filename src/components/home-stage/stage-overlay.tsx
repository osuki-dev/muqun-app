import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';

import type { StageOverlayBand } from '@/lib/home-stage-geometry';
import { calmFadeIn, calmFadeOut, riseIn } from '@/lib/motion';
import { StageNeedsCard, type StageNeedActions } from './stage-needs-card';
import { StageSubtitle } from './stage-subtitle';
import { useStageNeeds } from './use-stage-overlay';

/**
 * What floats over the selected computer's art, standing on the foot rows
 * inside the band the Stage measured (`stageOverlayBand`): the request
 * waiting on the reader, or, when none waits, what a working agent last
 * reported. Plain views over the canvas: nothing here reaches the scene.
 * Mounted only while Home is in front.
 */
export const StageOverlay = memo(function StageOverlay({
  serverId,
  band,
  actions,
}: {
  serverId: string;
  band: StageOverlayBand;
  actions: StageNeedActions;
}) {
  const reduced = useReducedMotion();
  const { top, more, terminal } = useStageNeeds(serverId);
  return (
    <View
      pointerEvents="box-none"
      style={[styles.band, { top: band.top, height: Math.max(0, band.bottom - band.top) }]}>
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
      ) : (
        <StageSubtitle serverId={serverId} />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  band: { position: 'absolute', left: 16, right: 16 },
  foot: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '100%' },
});
