import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

import type { FeatherRect, FeatherSize } from '@/lib/hero-feather';
import { launchArtworkRect, publishLaunchArtworkRect } from '@/lib/launch-artwork-rect';

/** Register the decoded image's window bounds after its layout has settled. */
export function useLaunchHomeArtwork({
  view,
  source,
  image,
  intrinsic,
  cropped = false,
}: {
  view: RefObject<View | null>;
  source: string;
  image: FeatherRect | null;
  intrinsic: FeatherSize | null;
  cropped?: boolean;
}) {
  const focused = useIsFocused();
  const active = useRef(false);
  const generation = useRef(0);
  const measure = useCallback(() => {
    if (!active.current || !focused || !image || !intrinsic) return;
    const measuredGeneration = generation.current;
    view.current?.measureInWindow((x, y, width, height) => {
      if (!active.current || measuredGeneration !== generation.current || !width || !height) return;
      publishLaunchArtworkRect({
        x: x + image.x,
        y: y + image.y,
        width: image.width,
        height: image.height,
        source,
        intrinsicWidth: intrinsic.width,
        intrinsicHeight: intrinsic.height,
        cropped,
      });
    });
  }, [view, source, image, intrinsic, cropped, focused]);

  useEffect(() => {
    active.current = focused;
    const frame = requestAnimationFrame(measure);
    return () => {
      active.current = false;
      generation.current += 1;
      cancelAnimationFrame(frame);
      if (launchArtworkRect()?.source === source) publishLaunchArtworkRect(null);
    };
  }, [measure, source, focused]);
  return measure;
}
