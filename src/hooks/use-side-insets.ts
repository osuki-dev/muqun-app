import { createContext, useContext, useState } from 'react';
import { type LayoutChangeEvent, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SideInsets = { left: number; right: number };

/** No side insets: every portrait iPhone but the Duo. */
export const NO_SIDE_INSETS: SideInsets = Object.freeze({ left: 0, right: 0 });

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

/**
 * How far the column a horizontal row sits in has been padded in from the
 * glass for the side safe areas. Set by the containers that pad for them
 * (sheets, Home's pages, Stage's foot, the docks); zero everywhere else.
 */
const SideBleedContext = createContext<SideInsets>(NO_SIDE_INSETS);

export const SideBleedProvider = SideBleedContext.Provider;

/**
 * For a horizontal row inside such a column: its frame reaches back out to the
 * glass and its content pads back in, so the first and last items rest clear
 * of a side status bar (iPhone Duo) while the rest slide under it and off the
 * screen edge, the way a scroll view runs under the notch in landscape.
 * `gutter` is the row's own horizontal content padding, which this replaces;
 * with no side inset both come out exactly as the row had them.
 */
export function useSideBleed(gutter = 0) {
  const bleed = useContext(SideBleedContext);
  return {
    active: bleed.left > 0 || bleed.right > 0,
    frame: { marginLeft: -bleed.left, marginRight: -bleed.right },
    content: { paddingLeft: gutter + bleed.left, paddingRight: gutter + bleed.right },
  };
}
