import {
  Blur,
  Canvas,
  Mask,
  RoundedRect,
  useImage,
  Image as SkiaImage,
} from '@shopify/react-native-skia';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { heroFeatherGeometry } from '@/lib/hero-feather';
import { useLaunchHomeArtwork } from '@/hooks/use-launch-home-artwork';
import { fadeIn, listLayout } from '@/lib/motion';
import { homeHeroMaxHeight } from '@/lib/responsive-layout';
import type { ResolvedHomeArtwork, ResolvedHomeArtworkAsset } from '@/theme/home-artwork';

export type { ResolvedHomeArtworkAsset } from '@/theme/home-artwork';

/**
 * The pack's own picture at the top of Home, when there is one to show.
 *
 * Deliberately not a `ThemeArtwork`. Every other slot is a decoration painted
 * *behind* something that reserves its own space, which is why
 * `ThemeArtworkLayer` is an absolute fill and why a missing image costs no
 * layout. A hero is the opposite: it is content, it takes a band of the page,
 * and the rest of the screen moves when it appears. Borrowing the decoration
 * component would have meant a slot that silently behaves like none of the
 * others behind the same name.
 *
 * It is also the only artwork on Home the reader can turn on and off, so the
 * decision about whether to draw anything is not this component's -- see
 * `resolveHomeArtwork`, which is where the author's default, the reader's override
 * and the empty-state fallback meet.
 *
 * Nothing here is a hit target and nothing is announced: it is a picture, and a
 * screen reader moving from the header to the server list should find the
 * server list.
 *
 * `scrollY` is Home's existing offset -- the one the brand block's own swap
 * already rides -- rather than a listener of this component's own. The fade
 * lives here rather than at the call site because its travel is the band's
 * height, and the band's height is this component's answer.
 *
 * ## Why this draws through Skia rather than `expo-image`
 *
 * The picture sits directly on the pack's wallpaper, and shipped as a plain
 * `<Image>` it read as a rounded rectangle stuck on top of one: a hard edge
 * where a printed illustration would have none. Softening that needs an
 * **alpha mask**, not an overlay -- what is behind the hero is the author's own
 * artwork, so any colour painted over the edges is a guess that will be wrong
 * on the next pack.
 *
 * React Native has no alpha-mask primitive, and the two ways to get one are
 * `@react-native-masked-view/masked-view` plus a gradient, or Skia. Skia wins
 * on three counts and not on taste:
 *
 * - It is already a hard dependency here (`skia-terminal`, `simfarm-stage`),
 *   and the masked view is not. A new native dependency for an edge treatment
 *   is a bad trade.
 * - `MaskedView` is two native layers -- the masked content and the mask -- that
 *   the platform composites every frame. This is one `Canvas`, and inside it one
 *   `Mask` node whose geometry is memoised and only recomputed when the band, the
 *   picture or the focal point actually changes.
 * - The mask has to follow the *drawn* image, not the band, and the drawn rect
 *   needs the picture's intrinsic size. `useImage` hands it over (`width()` /
 *   `height()`) on the object it already decoded; with a masked view the size
 *   would have to come back out of a separate `onLoad`.
 *
 * The decode is not duplicated and does not repeat per render: `useImage` loads
 * once per URI and keeps the `SkImage` in state, so this is the same single
 * decode `expo-image`'s memory cache was providing. Nothing is fetched either
 * way -- `resolveHomeArtwork` only ever yields a `file:///` path the theme
 * installer already wrote to disk, so the file cache this replaces was never
 * doing any work for a hero.
 *
 * Entrance, layout and scroll fading use ordinary Reanimated styles. There is
 * no exit retention: changing themes must immediately release the old picture.
 */
export function HomeArtwork({
  scrollY,
  resolution,
  onAvailabilityChange,
  maxHeight,
}: {
  scrollY: SharedValue<number>;
  resolution: ResolvedHomeArtworkAsset;
  onAvailabilityChange?: (available: boolean) => void;
  /** A composition may use a smaller illustration without changing the theme asset. */
  maxHeight?: number;
}) {
  const { width } = useWindowDimensions();
  const defaultBand = homeHeroMaxHeight(width);
  const band =
    maxHeight !== undefined && Number.isFinite(maxHeight) && maxHeight > 0
      ? Math.min(defaultBand, maxHeight)
      : defaultBand;
  // A source change owns a new decoder. Skia's asynchronous loader otherwise
  // keeps the previous image alive until the next URI has decoded.
  return (
    <HomeArtworkImage
      key={resolution.source}
      resolved={resolution.resolved}
      source={resolution.source}
      band={band}
      scrollY={scrollY}
      onAvailabilityChange={onAvailabilityChange}
    />
  );
}

function HomeArtworkImage({
  resolved,
  source,
  band,
  scrollY,
  onAvailabilityChange,
}: {
  resolved: ResolvedHomeArtwork;
  source: string;
  band: number;
  scrollY: SharedValue<number>;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const scrollStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, band], [1, 0], Extrapolation.CLAMP),
  }));
  const [failed, setFailed] = useState<string | null>(null);
  // The hero's own box, measured rather than assumed. The band's height is
  // known up front but its width is the content column's, which carries the
  // screen's gutter and its pad max-width -- and the feather is computed in the
  // same coordinates the Canvas draws in, so a guess would misplace it.
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  const focalX = resolved?.image.focalPoint?.x;
  const focalY = resolved?.image.focalPoint?.y;

  const onError = useCallback(() => {
    setFailed(source);
    onAvailabilityChange?.(false);
  }, [onAvailabilityChange, source]);
  const image = useImage(source, onError);
  // The band in window coordinates, for the launch opening to land in. The
  // layout event carries the box in the scroll content's coordinates, which is
  // not where the overlay draws -- it sits above the router with the whole
  // window to itself -- so the position has to be measured against the window
  // rather than derived from a header height the overlay cannot see.
  const view = useRef<View | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width: measuredWidth, height: measuredHeight } = event.nativeEvent.layout;
    setBox((previous) =>
      previous?.width === measuredWidth && previous.height === measuredHeight
        ? previous
        : { width: measuredWidth, height: measuredHeight }
    );
  }, []);

  const geometry = useMemo(() => {
    if (!box || !image) return null;
    return heroFeatherGeometry({
      container: box,
      // `SkImage` reports the decoded pixel dimensions, which is the aspect
      // ratio `contain` is fitting. A picture that somehow reports nothing
      // falls back to feathering the container -- see `containedImageRect`.
      intrinsic: { width: image.width(), height: image.height() },
      focalPoint:
        focalX === undefined || focalY === undefined ? undefined : { x: focalX, y: focalY },
    });
  }, [box, image, focalX, focalY]);

  const intrinsic = useMemo(
    () => (image ? { width: image.width(), height: image.height() } : null),
    [image]
  );
  useLaunchHomeArtwork({
    view,
    source,
    image: failed === source ? null : (geometry?.image ?? null),
    intrinsic,
  });

  if (failed === source) return null;

  return (
    <Animated.View
      testID="home-artwork"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      entering={fadeIn('medium')}
      layout={listLayout('medium')}
      onLayout={onLayout}
      ref={view}
      style={[styles.hero, { height: band }]}>
      {/*
        The scroll fade is a node inside the animated one, never the same node.
        Reanimated says so itself -- `Property "opacity" of
        AnimatedComponent(View) may be overwritten by a layout animation` on
        every launch and every theme change -- and it is right: the entering
        and layout animations own this view's opacity while they run, and the
        scroll position owns it the rest of the time. Two owners, one property.
      */}
      <Animated.View style={[StyleSheet.absoluteFill, scrollStyle]}>
        {image && geometry ? (
          <Canvas style={StyleSheet.absoluteFill}>
            <Mask
              mode="alpha"
              mask={
                // One blurred rounded rectangle, not four edge gradients and four
                // corner ones: gradients meeting at a corner either double up into
                // a dark notch or leave a square one, while a rounded rect has
                // already turned away from the corner before either side begins to
                // fade. `heroFeatherGeometry` owns every number here -- the inset
                // is already in the rect, and the sigmas are what make each blurred
                // edge exactly as wide as its axis asked for.
                //
                // An image-filter `Blur` rather than a `BlurMask`: only this one
                // takes a vector, and the top and bottom are softened harder than
                // the left and right. `decal` so the blur falls to nothing outside
                // the shape instead of smearing its edge outwards.
                <RoundedRect
                  x={geometry.mask.x}
                  y={geometry.mask.y}
                  width={geometry.mask.width}
                  height={geometry.mask.height}
                  r={geometry.radius}
                  color="white">
                  <Blur blur={geometry.blur} mode="decal" />
                </RoundedRect>
              }>
              <SkiaImage
                image={image}
                x={geometry.image.x}
                y={geometry.image.y}
                width={geometry.image.width}
                height={geometry.image.height}
                // The rect already *is* the contain-fit result, focal point and
                // all, so there is nothing left to fit. Letting Skia fit it again
                // would be a second opinion about the same rectangle, and the
                // mask is aligned to this one.
                fit="fill"
                opacity={resolved.image.opacity ?? 1}
              />
            </Mask>
          </Canvas>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hero: { width: '100%', alignSelf: 'center' },
});
