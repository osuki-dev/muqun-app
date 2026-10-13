import { useMemo } from 'react';
import { AlphaType, ColorType, type SkImage } from 'react-native-skia';

import { hasTransparentArtworkUpperEdges } from '@/lib/artwork-edge-alpha';

/** Bottom feathering belongs to scenes too; only the upper silhouette identifies a cutout. */
export function useHomeArtworkForeground(image: SkImage | null) {
  return useMemo(() => {
    if (!image || image.getImageInfo().alphaType === AlphaType.Opaque) return false;
    return hasTransparentArtworkUpperEdges(
      image.width(),
      image.height(),
      (x, y) =>
        image.readPixels(x, y, {
          width: 1,
          height: 1,
          colorType: ColorType.Alpha_8,
          alphaType: AlphaType.Unpremul,
        })?.[0]
    );
  }, [image]);
}
