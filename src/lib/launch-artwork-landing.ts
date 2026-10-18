import { containedImageRect, type FeatherRect, type FeatherSize } from './hero-feather';
import type { LaunchArtworkRect } from './launch-artwork-rect';

/** Once space is lost, do not jump back into it if the viewport expands again. */
export function launchArtworkDepartureLimit(previous: number, allowed: number) {
  'worklet';
  if (!Number.isFinite(previous) || !Number.isFinite(allowed)) return 0;
  return Math.min(0, Math.max(previous, allowed));
}

/** Project the travelled offset, not the endpoint: a resize cannot redirect an offset that still fits. */
export function launchArtworkDepartureOffset(captured: number, progress: number, allowed: number) {
  'worklet';
  if (
    !Number.isFinite(captured) ||
    !Number.isFinite(progress) ||
    !Number.isFinite(allowed) ||
    captured >= 0 ||
    progress <= 0 ||
    allowed >= 0
  )
    return 0;
  // A newly smaller viewport may exclude the current position. Only that
  // unavoidable boundary correction is immediate; the original clock continues.
  return Math.max(captured * Math.min(1, progress), allowed);
}

/** A single lift, not a landing in a different picture. Use the full box so late decoding cannot change it. */
export function launchArtworkDeparture({
  enabled,
  reducedMotion,
  box,
  viewport,
  centre,
}: {
  enabled: boolean;
  reducedMotion: boolean;
  box: FeatherSize;
  viewport: FeatherRect;
  centre: { x: number; y: number };
}): number {
  if (!enabled || reducedMotion) return 0;
  if (
    ![box.width, box.height, viewport.width, viewport.height].every(
      (value) => Number.isFinite(value) && value > 0
    ) ||
    ![viewport.x, viewport.y, centre.x, centre.y].every(Number.isFinite)
  )
    return 0;
  const top = centre.y - box.height / 2;
  if (
    top <= viewport.y ||
    centre.y + box.height / 2 > viewport.y + viewport.height ||
    centre.x - box.width / 2 < viewport.x ||
    centre.x + box.width / 2 > viewport.x + viewport.width
  )
    return 0;
  return -Math.min(16, viewport.height * 0.02, top - viewport.y);
}

/** Matching images land in Home; an independent figure has no Home landing (its gentle departure is separate). */
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
