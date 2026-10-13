import { containedImageRect, type FeatherRect, type FeatherSize } from './hero-feather';
import type { LaunchArtworkRect } from './launch-artwork-rect';

/** Matching images land in Home; independent launch figures dissolve where they started. */
export function launchArtworkLanding({
  box,
  intrinsic,
  source,
  home,
  viewport,
  centre,
}: {
  box: FeatherSize;
  intrinsic: FeatherSize | null;
  source: string | undefined;
  home: LaunchArtworkRect | null;
  viewport: FeatherRect;
  centre: { x: number; y: number };
}): { centre: { x: number; y: number }; scale: number; exact: boolean } {
  const fallback = { centre, scale: 1, exact: false };
  if (
    !home ||
    source === undefined ||
    home.source !== source ||
    !intrinsic ||
    ![box.width, box.height, intrinsic.width, intrinsic.height].every(
      (value) => Number.isFinite(value) && value > 0
    )
  )
    return fallback;

  const left = Math.max(viewport.x, home.x);
  const top = Math.max(viewport.y, home.y);
  const right = Math.min(viewport.x + viewport.width, home.x + home.width);
  const bottom = Math.min(viewport.y + viewport.height, home.y + home.height);
  const width = right - left;
  const height = bottom - top;
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return fallback;

  const drawing = containedImageRect(box, intrinsic);
  return {
    centre: { x: left + width / 2, y: top + height / 2 },
    scale: Math.min(width / drawing.width, height / drawing.height),
    exact:
      !home.cropped &&
      home.intrinsicWidth === intrinsic.width &&
      home.intrinsicHeight === intrinsic.height &&
      left === home.x &&
      top === home.y &&
      width === home.width &&
      height === home.height,
  };
}
