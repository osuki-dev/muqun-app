export interface PreviewSize {
  width: number;
  height: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

export type PreviewTransform = {
  scale: number;
  x: number;
  y: number;
};

export const RESTING_PREVIEW: PreviewTransform = { scale: 1, x: 0, y: 0 };
export const MAX_PREVIEW_SCALE = 4;

export function containedPreviewSize(source: PreviewSize, viewport: PreviewSize): PreviewSize {
  'worklet';
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return { width: 0, height: 0 };
  }
  const fit = Math.min(viewport.width / source.width, viewport.height / source.height);
  return { width: source.width * fit, height: source.height * fit };
}

/** Translations are in viewport points, after scaling a centered contain image. */
export function clampPreviewTransform(
  transform: PreviewTransform,
  source: PreviewSize,
  viewport: PreviewSize
): PreviewTransform {
  'worklet';
  const size = containedPreviewSize(source, viewport);
  if (size.width === 0 || size.height === 0) return RESTING_PREVIEW;
  const scale = Number.isFinite(transform.scale)
    ? Math.max(1, Math.min(MAX_PREVIEW_SCALE, transform.scale))
    : 1;
  if (scale === 1) return RESTING_PREVIEW;
  const boundX = Math.max(0, (size.width * scale - viewport.width) / 2);
  const boundY = Math.max(0, (size.height * scale - viewport.height) / 2);
  return {
    scale,
    x:
      boundX > 0 && Number.isFinite(transform.x)
        ? Math.max(-boundX, Math.min(boundX, transform.x))
        : 0,
    y:
      boundY > 0 && Number.isFinite(transform.y)
        ? Math.max(-boundY, Math.min(boundY, transform.y))
        : 0,
  };
}

/** Keep the image point under `from` under `to`, unless an image edge intervenes. */
export function zoomPreviewAt(
  start: PreviewTransform,
  nextScale: number,
  from: PreviewPoint,
  to: PreviewPoint,
  source: PreviewSize,
  viewport: PreviewSize
): PreviewTransform {
  'worklet';
  const current = clampPreviewTransform(start, source, viewport);
  const scale = Math.max(1, Math.min(MAX_PREVIEW_SCALE, nextScale));
  const ratio = scale / current.scale;
  return clampPreviewTransform(
    {
      scale,
      x: to.x - (from.x - current.x) * ratio,
      y: to.y - (from.y - current.y) * ratio,
    },
    source,
    viewport
  );
}

/** Rebase the translation origin after a pinch or a change in pointer count. */
export function panPreviewFrom(
  start: PreviewTransform,
  origin: PreviewPoint,
  translation: PreviewPoint,
  source: PreviewSize,
  viewport: PreviewSize
): PreviewTransform {
  'worklet';
  return clampPreviewTransform(
    {
      scale: start.scale,
      x: start.x + translation.x - origin.x,
      y: start.y + translation.y - origin.y,
    },
    source,
    viewport
  );
}

export function previewPageIndex(index: number, count: number): number {
  'worklet';
  return Math.max(
    0,
    Math.min(Math.max(0, count - 1), Number.isFinite(index) ? Math.trunc(index) : 0)
  );
}

/** Only a successful, entirely one-finger, unzoomed stream may navigate. */
export function finishPreviewPan(input: {
  success: boolean;
  zoomedAtStart: boolean;
  usedMultiplePointers: boolean;
  axis: 'horizontal' | 'vertical' | null;
  index: number;
  count: number;
  width: number;
  translationX: number;
  velocityX: number;
  dragY: number;
  velocityY: number;
}): { index: number; dismiss: boolean } {
  'worklet';
  let index = previewPageIndex(input.index, input.count);
  let dismiss = false;
  if (input.success && !input.zoomedAtStart && !input.usedMultiplePointers) {
    if (input.axis === 'horizontal') {
      const flicked = Math.abs(input.velocityX) > 500;
      const direction = flicked ? input.velocityX : input.translationX;
      const step =
        flicked || Math.abs(input.translationX) > input.width * 0.3 ? (direction < 0 ? 1 : -1) : 0;
      index = previewPageIndex(index + step, input.count);
    } else if (input.axis === 'vertical') {
      dismiss = input.dragY > 120 || input.velocityY > 900;
    }
  }
  return { index, dismiss };
}
