import { useState } from 'react';
import { type LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SideInsets = { left: number; right: number };

/**
 * The left and right safe-area insets, for content anchored to a screen edge.
 *
 * A portrait iPhone reports zero on both sides, which is why most of the app
 * only ever read `top` and `bottom`. iPhone Duo does not: its outer display
 * stacks the camera, clock and status icons down the right edge and reports a
 * right inset of about 84pt in the portrait-locked app, on the open display as
 * well. Controls and text keep clear of it; full-bleed art and backgrounds do
 * not, they still paint to the glass.
 */
export function useSideInsets(): SideInsets {
  const { left, right } = useSafeAreaInsets();
  return { left, right };
}

/** Horizontal padding that keeps a gutter measured from the safe edges. */
export function sideInsetPadding(insets: SideInsets, gutter = 0) {
  return { paddingLeft: insets.left + gutter, paddingRight: insets.right + gutter };
}

/**
 * How far a container that may or may not reach the screen's sides overlaps
 * the side safe areas: a form sheet is full width on a phone and a centred
 * card on a wide window. Until the container has been measured it assumes it
 * touches both edges, which is the phone case and the one that must not paint
 * a first frame under the status bar.
 */
export function useMeasuredSideInsets(): SideInsets & {
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [frame, setFrame] = useState<{ x: number; width: number } | null>(null);
  const onLayout = (event: LayoutChangeEvent) => {
    const target = event.currentTarget;
    if (typeof target === 'number') return;
    target.measureInWindow((x, _y, width) => {
      setFrame((current) =>
        current && current.x === x && current.width === width ? current : { x, width }
      );
    });
  };
  if (!frame) return { left: insets.left, right: insets.right, onLayout };
  return { ...sideOverlap(frame, windowWidth, insets), onLayout };
}

/** The part of each side safe area a frame, in window points, reaches into. */
export function sideOverlap(
  frame: { x: number; width: number },
  windowWidth: number,
  insets: SideInsets
): SideInsets {
  return {
    left: Math.max(0, insets.left - frame.x),
    right: Math.max(0, frame.x + frame.width - (windowWidth - insets.right)),
  };
}
