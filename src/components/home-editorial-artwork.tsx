import {
  Canvas,
  Image as SkiaImage,
  LinearGradient,
  Mask,
  Rect,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { useLaunchHomeArtwork } from '@/hooks/use-launch-home-artwork';
import { containedImageRect, coveredImageRect } from '@/lib/hero-feather';
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
}: {
  resolution: ResolvedHomeArtworkAsset;
  cover?: boolean;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  return (
    <HomeEditorialArtworkImage
      key={resolution.source}
      resolution={resolution}
      cover={cover}
      onAvailabilityChange={onAvailabilityChange}
    />
  );
}

function HomeEditorialArtworkImage({
  resolution,
  cover,
  onAvailabilityChange,
}: {
  resolution: ResolvedHomeArtworkAsset;
  cover: boolean;
  onAvailabilityChange?: (available: boolean) => void;
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
  const fitRect = fit === 'contain' ? containedImageRect : coveredImageRect;
  const imageRect = useMemo(
    () =>
      box && image
        ? fitRect(box, { width: image.width(), height: image.height() }, focalPoint)
        : null,
    [box, focalPoint, image, fitRect]
  );
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
    // The cover may crop the subject; its bottom feather also differs from launch.
    cropped: fit !== 'contain',
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
    <View
      ref={view}
      collapsable={false}
      testID="home-editorial-artwork"
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', alignSelf: 'stretch', overflow: 'hidden' },
});
