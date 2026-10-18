import { containedPreviewSize, type PreviewSize } from './image-preview-geometry';

export function contentImageIdentity(source?: { uri: string; cacheKey?: string }) {
  return source ? JSON.stringify([source.cacheKey, source.uri]) : '';
}

export interface ContentImagePreviewState {
  identity: string;
  cropped: boolean;
}

/** Chat previews share one budget; only unusually long canvases use a labelled crop. */
export function contentImageLayout(
  size: PreviewSize | undefined,
  viewport: PreviewSize,
  previewable: boolean
) {
  const maxWidth = Math.min(280, Math.max(44, viewport.width - 64));
  const maxHeight = Math.min(240, Math.max(110, viewport.height * 0.32));
  if (
    !size ||
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  )
    return { width: Math.min(160, maxWidth), height: 110, cropped: false };

  const cropped = previewable && size.height / size.width > 3;
  if (cropped) {
    const width = Math.min(size.width, maxWidth);
    return { width, height: Math.min(maxHeight, size.height), cropped };
  }
  const fitted = containedPreviewSize(size, {
    width: Math.min(size.width, maxWidth),
    height: Math.min(size.height, maxHeight),
  });
  return { ...fitted, cropped };
}
