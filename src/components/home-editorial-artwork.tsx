import {
  AlphaType,
  ColorType,
  Canvas,
  Image as SkiaImage,
  LinearGradient,
  Mask,
  Rect,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useLaunchHomeArtwork } from '@/hooks/use-launch-home-artwork';
import { artworkVisibleTop, editorialArtworkRect } from '@/lib/hero-feather';
import { fadeIn, listLayout } from '@/lib/motion';
import type { ResolvedHomeArtworkAsset } from '@/theme/home-artwork';

const BOTTOM_FEATHER_START = 0.68;

/**
 * Editorial-only cover art: full bleed at the top, transparent only at the
 * bottom. The layout owns this geometry; the theme still owns the image,
 * opacity, responsive override and focal point.
 */
export function HomeEditorialArtwork({
  resolution,
  cover = false,
  onAvailabilityChange,
  onVisibleTopChange,
}: {
  resolution: ResolvedHomeArtworkAsset;
  cover?: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  onVisibleTopChange?: (source: string, top: number) => void;
}) {
  return (
    <HomeEditorialArtworkImage
      key={resolution.source}
      resolution={resolution}
      cover={cover}
      onAvailabilityChange={onAvailabilityChange}
      onVisibleTopChange={onVisibleTopChange}
    />
  );
}

function HomeEditorialArtworkImage({
  resolution,
  cover,
  onAvailabilityChange,
  onVisibleTopChange,
}: {
  resolution: ResolvedHomeArtworkAsset;
  cover: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  onVisibleTopChange?: (source: string, top: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const height = cover ? Math.min(640, width * 0.9) : Math.min(280, width / 2);
  const box = useMemo(() => (width > 0 ? { width, height } : null), [width, height]);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
    onAvailabilityChange?.(false);
  }, [onAvailabilityChange]);
  const image = useImage(resolution.source, onError);
  const { focalPoint, fit } = resolution.resolved.image;
  const imageRect = useMemo(
    () =>
      box && image
        ? editorialArtworkRect(
            box,
            { width: image.width(), height: image.height() },
            fit,
            focalPoint
          )
        : null,
    [box, focalPoint, image, fit]
  );
  const visibleTop = useMemo(() => {
    if (!cover || !image) return 0;
    const pixels = image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      colorType: ColorType.Alpha_8,
      alphaType: AlphaType.Unpremul,
    });
    return pixels ? artworkVisibleTop(pixels, image.width(), image.height()) : 0;
  }, [cover, image]);
  useEffect(() => {
    if (!image || !imageRect) return;
    onVisibleTopChange?.(
      resolution.source,
      Math.max(0, imageRect.y + (visibleTop * imageRect.height) / image.height())
    );
  }, [image, imageRect, onVisibleTopChange, resolution.source, visibleTop]);
  const view = useRef<View | null>(null);
  const intrinsic = useMemo(
    () => (image ? { width: image.width(), height: image.height() } : null),
    [image]
  );
  const measureArtwork = useLaunchHomeArtwork({
    view,
    source: resolution.source,
    image: failed ? null : imageRect,
    intrinsic,
    // The bottom mask (and cover clipping) cannot be reproduced by scaling the
    // unmasked launch image. Cross-fade to the real Home drawing instead.
    cropped: true,
  });
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout;
      setWidth((current) => (current === next.width ? current : next.width));
      measureArtwork();
    },
    [measureArtwork]
  );
  if (failed) return null;
  return (
    <Animated.View
      ref={view}
      collapsable={false}
      testID="home-editorial-artwork"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      entering={fadeIn('medium')}
      layout={listLayout('medium')}
      onLayout={onLayout}
      style={[styles.root, { height }]}>
      {image && imageRect && box ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Mask
            mode="alpha"
            mask={
              <Rect x={0} y={0} width={box.width} height={box.height}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, box.height)}
                  colors={['white', 'white', 'transparent']}
                  positions={[0, BOTTOM_FEATHER_START, 1]}
                />
              </Rect>
            }>
            <SkiaImage
              image={image}
              x={imageRect.x}
              y={imageRect.y}
              width={imageRect.width}
              height={imageRect.height}
              fit="fill"
              opacity={resolution.resolved.image.opacity ?? 1}
            />
          </Mask>
        </Canvas>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', overflow: 'hidden' },
});
