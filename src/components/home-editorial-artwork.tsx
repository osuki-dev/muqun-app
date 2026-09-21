import {
  Canvas,
  Image as SkiaImage,
  LinearGradient,
  Mask,
  Rect,
  useImage,
  vec,
} from '@shopify/react-native-skia';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import { coveredImageRect } from '@/lib/hero-feather';
import type { ResolvedHomeHeroAsset } from '@/theme/home-hero';

const BOTTOM_FEATHER_START = 0.68;

/**
 * Editorial-only cover art: full bleed at the top, transparent only at the
 * bottom. The layout owns this geometry; the theme still owns the image,
 * opacity, responsive override and focal point.
 */
export function HomeEditorialArtwork({
  resolution,
  onAvailabilityChange,
}: {
  resolution: ResolvedHomeHeroAsset;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const { width } = useWindowDimensions();
  const height = Math.min(width >= 768 ? 360 : 280, Math.max(220, width * 0.64));
  return (
    <HomeEditorialArtworkImage
      key={resolution.source}
      resolution={resolution}
      height={height}
      onAvailabilityChange={onAvailabilityChange}
    />
  );
}

function HomeEditorialArtworkImage({
  resolution,
  height,
  onAvailabilityChange,
}: {
  resolution: ResolvedHomeHeroAsset;
  height: number;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const onError = useCallback(() => {
    setFailed(true);
    onAvailabilityChange?.(false);
  }, [onAvailabilityChange]);
  const image = useImage(resolution.source, onError);
  const focalPoint = resolution.resolved.image.focalPoint;
  const imageRect = useMemo(
    () =>
      box && image
        ? coveredImageRect(box, { width: image.width(), height: image.height() }, focalPoint)
        : null,
    [box, focalPoint, image]
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout;
    setBox((current) =>
      current?.width === next.width && current.height === next.height
        ? current
        : { width: next.width, height: next.height }
    );
  }, []);
  if (failed) return null;
  return (
    <View
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
