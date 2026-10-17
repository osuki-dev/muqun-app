import { Gesture } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';

/** A sideways pull starts once the finger has gone this far across, in points. */
export const SIDEWAYS_ACTIVATE = 14;
/** ... and at least this many times further across than up or down. */
export const SIDEWAYS_DOMINANCE = 1.8;
/** A drag this far up or down, more than across, is the page's scroll. */
export const SIDEWAYS_YIELD = 8;

/**
 * A pan that only ever starts sideways, for the surfaces Home turns with the
 * ash dissolve (the computer sheaf and the recent sessions).
 *
 * Offsets alone (`activeOffsetX` / `failOffsetY`) let a scroll that set off a
 * little diagonally be taken as a turn. This decides from the direction of
 * travel: a drag that goes up or down first, or mostly, is let go at once so
 * the page scrolls; only a clearly sideways one activates. `origin` holds
 * where the finger went down.
 */
export function sidewaysPan(origin: SharedValue<{ x: number; y: number }>) {
  return Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      'worklet';
      const touch = event.changedTouches[0];
      if (touch) origin.set({ x: touch.absoluteX, y: touch.absoluteY });
    })
    .onTouchesMove((event, manager) => {
      'worklet';
      const touch = event.changedTouches[0];
      if (!touch) return;
      const start = origin.get();
      const across = Math.abs(touch.absoluteX - start.x);
      const along = Math.abs(touch.absoluteY - start.y);
      if (along > SIDEWAYS_YIELD && along >= across) {
        manager.fail();
        return;
      }
      if (across > SIDEWAYS_ACTIVATE && across > along * SIDEWAYS_DOMINANCE) manager.activate();
    });
}
