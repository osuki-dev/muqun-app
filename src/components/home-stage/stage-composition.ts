import { useMemo } from 'react';

import {
  stageComposition,
  type StageComposition,
  type StageFit,
  type StageFocal,
} from '@/lib/home-stage-layers';
import { useStagePictureFacts } from './stage-textures';

/** A theme picture as Home resolved it for the current mode and width class. */
export type StageImageInput = {
  uri: string;
  fit?: StageFit;
  focal?: StageFocal;
  opacity?: number;
};

/**
 * The Stage's layers for the theme: the resolved slots (the same records the
 * 2D Home draws from), measured once each for their alpha and shape.
 */
export function useStageComposition({
  coverHeader,
  artwork,
  wallpaper,
}: {
  coverHeader: boolean;
  artwork?: StageImageInput | null;
  wallpaper?: StageImageInput | null;
}): StageComposition {
  const artworkFacts = useStagePictureFacts(artwork?.uri, 'artwork');
  const wallpaperFacts = useStagePictureFacts(wallpaper?.uri, 'wallpaper');
  return useMemo(() => {
    const picture = (input: StageImageInput | null | undefined, facts: typeof artworkFacts) =>
      input && facts !== undefined
        ? {
            uri: input.uri,
            fit: input.fit,
            focal: input.focal,
            opacity: input.opacity,
            clear: facts?.clear ?? null,
            aspect: facts?.aspect,
            bounds: facts?.bounds,
            solidBottom: facts?.solidBottom,
            decodeFailed: facts?.decodeFailed,
          }
        : null;
    return stageComposition({
      coverHeader,
      artwork: picture(artwork, artworkFacts),
      wallpaper: picture(wallpaper, wallpaperFacts),
    });
  }, [coverHeader, artwork, artworkFacts, wallpaper, wallpaperFacts]);
}
