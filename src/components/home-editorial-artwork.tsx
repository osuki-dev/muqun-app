import {
  AlphaType,
  ColorType,
  Canvas,
  useCanvasRef,
  Image as SkiaImage,
  LinearGradient,
  Mask,
  Rect,
  vec,
} from 'react-native-skia';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated from 'react-native-reanimated';

import { useHomeArtworkForeground } from '@/hooks/use-home-artwork-foreground';
import { useSkiaDrawReady, useThemeRenderReady } from '@/hooks/use-theme-render-ready';
import { useSharedSkiaImage } from '@/lib/skia-image-cache';
import { useLaunchHomeArtwork } from '@/hooks/use-launch-home-artwork';
import {
  artworkVisibleTop,
  editorialArtworkRect,
  homeCoverSceneRect,
  HOME_COVER_BOTTOM_FEATHER_START,
} from '@/lib/hero-feather';
import { fadeIn, listLayout } from '@/lib/motion';
import { homeCoverArtworkHeight } from '@/lib/responsive-layout';
import type { ResolvedHomeArtworkAsset } from '@/theme/home-artwork';

/**
 * Editorial-only cover art: full bleed at the top, transparent only at the
 * bottom. The layout owns this geometry; the theme still owns the image,
 * opacity, responsive override and focal point.
 */
export function HomeEditorialArtwork({
  resolution,
  cover = false,
  fill = false,
  onAvailabilityChange,
  onVisibleTopChange,
  onForegroundChange,
  fullBleed = false,
}: {
  resolution: ResolvedHomeArtworkAsset;
  onForegroundChange?: (source: string, foreground: boolean) => void;
  fullBleed?: boolean;
  cover?: boolean;
  /** Take the height the layout gives it (the Pad cover block) instead of its own proportion. */
  fill?: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  onVisibleTopChange?: (source: string, top: number) => void;
}) {
  return (
    <HomeEditorialArtworkImage
      key={resolution.source}
      resolution={resolution}
      cover={cover}
      fill={fill}
      onAvailabilityChange={onAvailabilityChange}
      onVisibleTopChange={onVisibleTopChange}
      onForegroundChange={onForegroundChange}
      fullBleed={fullBleed}
    />
  );
}

function HomeEditorialArtworkImage({
  resolution,
  cover,
  fill,
  onAvailabilityChange,
  onVisibleTopChange,
  onForegroundChange,
  fullBleed,
}: {
  resolution: ResolvedHomeArtworkAsset;
  cover: boolean;
  onForegroundChange?: (source: string, foreground: boolean) => void;
  fullBleed: boolean;
  fill: boolean;
  onAvailabilityChange?: (available: boolean) => void;
  onVisibleTopChange?: (source: string, top: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const [filledHeight, setFilledHeight] = useState(0);
  const height = fill
    ? filledHeight
    : cover
      ? homeCoverArtworkHeight(width)
      : Math.min(280, width / 2);
  const box = useMemo(() => (width > 0 && height > 0 ? { width, height } : null), [width, height]);
  const [failed, setFailed] = useState(false);
  const canvas = useCanvasRef();
  const [drawn, setDrawn] = useState(false);
  useThemeRenderReady(resolution.source, failed || drawn);
  const onError = useCallback(() => {
    setFailed(true);
    onAvailabilityChange?.(false);
  }, [onAvailabilityChange]);
  const image = useSharedSkiaImage(resolution.source, onError);
  const foreground = useHomeArtworkForeground(image);
  useEffect(() => {
    if (image) onForegroundChange?.(resolution.source, foreground);
  }, [image, resolution.source, foreground, onForegroundChange]);
  const { focalPoint, fit } = resolution.resolved.image;
  const imageRect = useMemo(
    () =>
      box && image
        ? (fullBleed && !foreground ? homeCoverSceneRect : editorialArtworkRect)(
            box,
            { width: image.width(), height: image.height() },
            fit,
            focalPoint
          )
        : null,
    [box, focalPoint, image, fit, fullBleed, foreground]
  );
  useSkiaDrawReady(canvas, imageRect, Boolean(image && imageRect && box), () => setDrawn(true));
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
      if (fill) setFilledHeight((current) => (current === next.height ? current : next.height));
      measureArtwork();
    },
    [fill, measureArtwork]
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
      // A filled painting's size is its parent's, which snaps (see the Pad cover).
      layout={fill ? undefined : listLayout('medium')}
      onLayout={onLayout}
      style={[styles.root, fill ? styles.fill : { height }]}>
      {image && imageRect && box ? (
        <Canvas ref={canvas} style={StyleSheet.absoluteFill}>
          <Mask
            mode="alpha"
            mask={
              <Rect x={0} y={0} width={box.width} height={box.height}>
                <LinearGradient
                  start={vec(0, 0)}
                  end={vec(0, box.height)}
                  colors={['white', 'white', 'transparent']}
                  positions={[0, HOME_COVER_BOTTOM_FEATHER_START, 1]}
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
  fill: { height: '100%' },
});
