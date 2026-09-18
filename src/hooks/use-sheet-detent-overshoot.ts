import { useNavigation, useRoute } from 'expo-router';
import { useCallback, useEffect } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { timing } from '@/lib/motion';
import { sheetDetentOvershoot, sheetRouteDetents } from '@/lib/route-presentation';

/**
 * The one event react-native-screens gives a sheet about its own height.
 *
 * Typed here rather than imported, because `useNavigation`'s default type is
 * the root param list's `NavigationProp` and the native stack's event map is
 * not on it. The shape is `NativeStackNavigationEventMap['sheetDetentChange']`
 * in `expo-router/build/react-navigation/native-stack/types.d.ts:34-39`, which
 * `NativeStackView.native.tsx` emits from the screen's `onSheetDetentChanged`.
 */
type SheetDetentChangeEvent = { data?: { index: number; stable: boolean } };

type DetentAwareNavigation = {
  addListener(
    type: 'sheetDetentChange',
    callback: (event: SheetDetentChangeEvent) => void
  ): () => void;
};

/**
 * Give an Android sheet's column back the height the native layout took.
 *
 * react-native-screens lays an Android form sheet out at its **largest** detent
 * whatever detent it is resting at, and reaches a smaller one by sliding the
 * whole view down the screen -- the full citation is on `resolveDetents`. So at
 * any detent but the largest, the bottom `(largest - current) / largest` of the
 * sheet's layout is below the screen edge, and a `flex: 1` scroller inside it
 * is handed a viewport whose own bottom is off-screen. A scroller's travel is
 * `content - viewport`, so those last rows sit in a dead zone that scrolling
 * cannot enter. That is the bug the owner found on the workspace switcher.
 *
 * Yoga is never told which detent the sheet is at, so this tells it. The
 * `sheetDetentChange` navigation event reports the resting detent's index; the
 * scene's own `onLayout` reports the laid-out height; and the product of the
 * two is padding on the **column**, not on the scroller's content.
 *
 * Padding the column rather than the content is what makes this a fix rather
 * than a patch. The scroller is a `flex: 1` child, so shrinking its parent's
 * content box shrinks the *viewport* -- its bottom edge lands exactly on the
 * sheet's visible bottom edge at every detent. Everything that reads the
 * viewport then agrees: the scroll indicator, the scroll-to-end clamp, the
 * momentum boundary, and `LegendList`'s windowing. Extra bottom padding on the
 * content would have hidden the symptom on a `ScrollView` and left the two diff
 * sheets -- which have no `SheetSceneFooter` to hang it on -- still broken.
 *
 * Dragging then does what it looks like: the sheet grows, the padding shrinks
 * by the same amount in the same beat, and the list grows into the space
 * instead of trailing dead ground behind it.
 *
 * **During a drag** the value is the one the sheet left, not the one it is
 * heading for. `SheetDelegate.kt:105-121` sends `lastStableDetentIndex` with
 * `isStable = false` while the sheet is dragging or settling, so the only
 * honest moment to move the padding is the settle -- which is what this reads.
 * Dragging up therefore shows a strip of bare sheet ground for the length of
 * the settle, and dragging down briefly puts the last row back under the edge.
 * Neither is a jump: the padding eases over `short`, so the column closes the
 * gap rather than snapping shut.
 *
 * **With the keyboard up** this needs no special case, and gets none.
 * `SheetDelegate.onApplyWindowInsets` forces a multi-detent sheet to
 * `STATE_EXPANDED` while the IME is visible (`SheetDelegate.kt:251-270`), which
 * arrives here as an ordinary stable detent change to the largest index --
 * overshoot zero, the whole sheet on screen, and `KeyboardInset` still paying
 * for the keyboard itself at the end of the content.
 *
 * **On iOS** every value below is zero and no listener is ever registered:
 * `sheetDetentOvershoot` gates on `process.env.EXPO_OS`, which is inlined per
 * bundle. iOS resizes the presented view to each detent, so there is nothing
 * hanging off any edge and nothing to pay back.
 *
 * Nothing here re-renders. The index arrives on the JS thread, becomes a
 * fraction, and is written straight into a shared value -- so changing detent
 * on a sheet listing 126 models moves one padding number on the UI thread
 * rather than reconciling the list.
 */
export function useSheetDetentOvershoot() {
  const route = useRoute();
  const navigation = useNavigation<DetentAwareNavigation>();
  const detents = sheetRouteDetents[route.name] ?? 'full';

  // The sheet's own laid-out height, which is the largest detent's. Written on
  // layout and left alone: it changes on rotation and at no other time.
  const laidOutHeight = useSharedValue(0);

  // Seeded at the opening detent rather than at zero. `sheetInitialDetentIndex`
  // defaults to 0, so a sheet that opens at `[0.6, 1]` is 40% off-screen on its
  // very first frame -- before any event could have told us so.
  const overshoot = useSharedValue(sheetDetentOvershoot(detents, 0));

  useEffect(() => {
    if (process.env.EXPO_OS !== 'android') return;
    return navigation.addListener('sheetDetentChange', ({ data }) => {
      if (!data?.stable) return;
      overshoot.value = withTiming(sheetDetentOvershoot(detents, data.index), timing('short'));
    });
  }, [navigation, detents, overshoot]);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      laidOutHeight.value = event.nativeEvent.layout.height;
    },
    [laidOutHeight]
  );

  // A fraction of the scene's *own* measured height, so this never needs a
  // window height, a status-bar inset or display metrics -- and so can never
  // disagree with the native side about any of them.
  const style = useAnimatedStyle(() => ({
    paddingBottom: laidOutHeight.value * overshoot.value,
  }));

  return { onLayout, style };
}
