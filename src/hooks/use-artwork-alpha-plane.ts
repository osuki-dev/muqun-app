import { useEffect, useState } from 'react';
import type { SkImage } from 'react-native-skia';

import { readAlphaPlane, type AlphaPlane } from '@/lib/artwork-alpha';

/** The image's alpha plane once it has been read; null while it reads or when it cannot be. */
export function useArtworkAlphaPlane(image: SkImage | null | undefined): AlphaPlane | null {
  const [loaded, setLoaded] = useState<{ image: SkImage; plane: AlphaPlane | null } | null>(null);
  useEffect(() => {
    if (!image) return;
    let live = true;
    readAlphaPlane(image).then(
      (plane) => {
        if (live) setLoaded({ image, plane });
      },
      () => {
        if (live) setLoaded({ image, plane: null });
      }
    );
    return () => {
      live = false;
    };
  }, [image]);
  return image && loaded?.image === image ? loaded.plane : null;
}
