import { useMemo } from 'react';
import { AlphaType, type SkImage } from 'react-native-skia';

import { useArtworkAlphaPlane } from '@/hooks/use-artwork-alpha-plane';
import { alphaAt } from '@/lib/artwork-alpha';
import { hasTransparentArtworkUpperEdges } from '@/lib/artwork-edge-alpha';

/** Bottom feathering belongs to scenes too; only the upper silhouette identifies a cutout. */
export function useHomeArtworkForeground(image: SkImage | null) {
  const alpha = useArtworkAlphaPlane(image);
  return useMemo(() => {
    if (!image || !alpha || image.getImageInfo().alphaType === AlphaType.Opaque) return false;
    return hasTransparentArtworkUpperEdges(alpha.width, alpha.height, alphaAt(alpha));
  }, [image, alpha]);
}
