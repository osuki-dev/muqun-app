import type { MessageImageAsset } from './message-images';

export const IMAGE_PREVIEWS_CAPABILITY = 'agent_image_previews_v1';
export const IMAGE_VERSIONS_CAPABILITY = 'agent_image_versions_v1';

export function deferUnmappedImage(capabilities: readonly string[], unavailable: boolean): boolean {
  return unavailable && capabilities.includes(IMAGE_PREVIEWS_CAPABILITY);
}

export function unavailableMessageImage(
  assets: readonly MessageImageAsset[] | undefined,
  src: string
): boolean {
  return Boolean(
    assets?.some(
      (asset) =>
        asset.unavailable_reason?.trim() &&
        (asset.src === src || (!asset.src && src.startsWith('data:')))
    )
  );
}

export interface PreviewImageSource {
  uri: string;
  headers?: Record<string, string>;
  cacheKey?: string;
  dispose?: () => void;
  originalLoaded?: boolean;
  verifiedOriginal?: { size: number; mime: string };
}

/** Optional fields preserve every existing local/original-only modal caller. */
export interface PreviewImageDescriptor extends PreviewImageSource {
  id: string;
  original?: PreviewImageSource;
  fallback?: PreviewImageSource;
  deferred?: boolean;
  resolveSource?: (signal: AbortSignal) => Promise<PreviewImageSource>;
  resolveOriginal?: (signal?: AbortSignal) => Promise<PreviewImageSource>;
  resolvePreview?: (signal: AbortSignal) => Promise<PreviewImageSource>;
}

export interface GatewayImageScope {
  serverId: string;
  baseUrl: string;
  /** An opaque pairing fingerprint, never the bearer token. */
  pairingKey: string;
  headers: Record<string, string>;
}

export interface GatewayImagePlan {
  id: string;
  thumbnail: PreviewImageSource | null;
  preview: PreviewImageSource;
  original: PreviewImageSource;
  fallback: PreviewImageSource;
  version?: PreviewImageSource;
}

export function shouldLoadImagePreview(
  image: PreviewImageDescriptor,
  active: boolean,
  loaded: boolean
): boolean {
  return !image.deferred || active || loaded;
}

/** Metadata is never allowed to choose an origin, query, traversal or another asset id. */
export function imageAssetPath(
  value: unknown,
  assetId: string,
  variant: 'original' | 'thumbnail' | 'preview' | 'download' | 'version'
): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(assetId) || typeof value !== 'string') return undefined;
  if (value === `/api/agent-images/${assetId}/${variant}`) return value;
  if (variant === 'original' && value === `/api/assets/${assetId}/content`) return value;
  if (variant === 'download' && value === `/api/assets/${assetId}/download`) return value;
  return undefined;
}

export interface OriginalImageVersion {
  id: string;
  version: string;
  etag: string;
  size: number;
  mime: string;
  url: string;
  download_url: string;
}

/** R4 returns data.asset, not a timeline image_assets entry. Never synthesize a URL. */
export function parseOriginalImageVersion(value: unknown, assetId: string): OriginalImageVersion {
  const data = value && typeof value === 'object' ? (value as Record<string, unknown>).data : null;
  const asset = data && typeof data === 'object' ? (data as Record<string, unknown>).asset : null;
  const rec = asset && typeof asset === 'object' ? (asset as Record<string, unknown>) : {};
  if (
    !/^[A-Za-z0-9_-]+$/.test(assetId) ||
    rec.id !== assetId ||
    typeof rec.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(rec.version) ||
    rec.etag !== `"sha256-${rec.version}"` ||
    typeof rec.size !== 'number' ||
    !Number.isSafeInteger(rec.size) ||
    rec.size <= 0 ||
    typeof rec.mime !== 'string' ||
    !/^image\/[a-z0-9.+-]+$/.test(rec.mime) ||
    rec.url !== `/api/agent-images/${assetId}/original/${rec.version}` ||
    rec.download_url !== `/api/agent-images/${assetId}/download/${rec.version}`
  )
    throw new Error('Gateway returned an invalid original image version');
  return {
    id: assetId,
    version: rec.version,
    etag: rec.etag as string,
    size: rec.size,
    mime: rec.mime,
    url: rec.url as string,
    download_url: rec.download_url as string,
  };
}

export function gatewayImagePlan(
  asset: MessageImageAsset,
  scope: GatewayImageScope,
  capabilities: readonly string[]
): GatewayImagePlan | null {
  if (!/^image\/[a-z0-9.+-]+$/i.test(asset.mime)) return null;
  if (asset.unavailable_reason?.trim()) return null;
  const originalPath = imageAssetPath(asset.url, asset.asset_id, 'original');
  if (!originalPath || !scope.serverId || !scope.pairingKey) return null;
  let base: URL;
  try {
    base = new URL(scope.baseUrl);
  } catch {
    return null;
  }
  if (
    !['https:', 'http:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    return null;
  const enabled = capabilities.includes(IMAGE_PREVIEWS_CAPABILITY);
  const declared =
    asset.preview_declared ||
    asset.thumbnail_url !== undefined ||
    asset.preview_url !== undefined ||
    asset.download_url !== undefined;
  const source = (path: string): PreviewImageSource => ({
    uri: `${scope.baseUrl.replace(/\/$/, '')}${path}`,
    headers: scope.headers,
    cacheKey: JSON.stringify([
      scope.serverId,
      scope.baseUrl,
      scope.pairingKey,
      asset.asset_id,
      asset.mime,
      path,
      asset.cache_revision,
      asset.size,
      asset.width,
      asset.height,
    ]),
  });
  const original = source(originalPath);
  const thumbnailPath = enabled
    ? imageAssetPath(asset.thumbnail_url, asset.asset_id, 'thumbnail')
    : undefined;
  const previewPath = enabled
    ? imageAssetPath(asset.preview_url, asset.asset_id, 'preview')
    : undefined;
  const downloadPath = enabled
    ? imageAssetPath(asset.download_url, asset.asset_id, 'download')
    : undefined;
  const versionPath = capabilities.includes(IMAGE_VERSIONS_CAPABILITY)
    ? imageAssetPath(asset.version_url, asset.asset_id, 'version')
    : undefined;
  return {
    id: original.cacheKey!,
    // A missing/failed new thumbnail is a tappable placeholder, not N eager originals.
    thumbnail: enabled && declared ? (thumbnailPath ? source(thumbnailPath) : null) : original,
    preview: previewPath ? source(previewPath) : downloadPath ? source(downloadPath) : original,
    original: downloadPath ? source(downloadPath) : original,
    fallback: downloadPath ? source(downloadPath) : original,
    ...(versionPath ? { version: source(versionPath) } : {}),
  };
}

/** Exact structural matching only; a tool name or a file extension is not evidence. */
export function messageImageForSource(
  assets: readonly MessageImageAsset[] | undefined,
  src: string
): MessageImageAsset | undefined {
  return assets?.find(
    (asset) =>
      asset.src === src && !asset.unavailable_reason && /^image\/[a-z0-9.+-]+$/i.test(asset.mime)
  );
}

export async function originalPreviewSource(
  image: PreviewImageDescriptor,
  signal?: AbortSignal
): Promise<PreviewImageSource> {
  if (image.resolveOriginal) return image.resolveOriginal(signal);
  return image.original ?? image;
}

export async function saveOriginalPreview(
  image: PreviewImageDescriptor,
  save: (source: PreviewImageSource, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) throw new Error('Image save cancelled');
  const source = await originalPreviewSource(image, signal);
  try {
    if (signal?.aborted) throw new Error('Image save cancelled');
    await save(source, signal);
  } finally {
    source.dispose?.();
  }
}

export function withMessageImageFiles(
  files: readonly { uri: string; mime?: string; name?: string }[],
  assets: readonly MessageImageAsset[] | undefined,
  attachments: readonly string[] | undefined
): { uri: string; mime?: string; name?: string }[] {
  const result = [...files];
  for (const uri of attachments ?? []) {
    const asset = messageImageForSource(assets, uri);
    if (asset && !result.some((file) => file.uri === uri)) result.push({ uri, mime: asset.mime });
  }
  return result;
}

export function readThumbnailOnly(
  plan: GatewayImagePlan,
  read: (source: PreviewImageSource) => Promise<PreviewImageSource>
): Promise<PreviewImageSource | null> {
  return plan.thumbnail ? read(plan.thumbnail) : Promise.resolve(null);
}

/** Opening a thumbnail requests original bytes; a failed original keeps a usable preview. */
export async function readOriginalFirst(
  plan: GatewayImagePlan,
  read: (source: PreviewImageSource) => Promise<PreviewImageSource>,
  signal: AbortSignal
): Promise<PreviewImageSource> {
  try {
    return { ...(await read(plan.original)), originalLoaded: true };
  } catch (error) {
    if (signal.aborted || plan.preview.uri === plan.original.uri) throw error;
  }
  return read(plan.preview);
}

/** The displayed derivative can fall back once; an original failure is terminal. */
export function previewFallbackSource(
  image: PreviewImageDescriptor,
  failed: PreviewImageSource
): PreviewImageSource | null {
  return image.fallback &&
    (failed.uri === image.uri || Boolean(failed.cacheKey && failed.cacheKey === image.cacheKey)) &&
    image.fallback.uri !== image.uri
    ? image.fallback
    : null;
}

export interface PreviewLoadState {
  source: PreviewImageSource | null;
  status: 'loading' | 'loaded' | 'failed';
  original: boolean;
  readySource?: PreviewImageSource;
  previewFallback?: boolean;
  request?: number;
}

export function samePreviewSource(a: PreviewImageSource, b: PreviewImageSource): boolean {
  const headers = (source: PreviewImageSource) =>
    JSON.stringify(Object.entries(source.headers ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return a.uri === b.uri && a.cacheKey === b.cacheKey && headers(a) === headers(b);
}

export function resolvedPreviewLoad(
  state: PreviewLoadState,
  source: PreviewImageSource,
  original: boolean,
  previewFallback: boolean,
  request: number
): PreviewLoadState {
  const ready = state.readySource ?? (state.status === 'loaded' ? state.source : null);
  const same = ready && samePreviewSource(ready, source);
  return {
    source,
    status: same ? 'loaded' : 'loading',
    original,
    readySource: same ? source : (ready ?? undefined),
    previewFallback,
    request,
  };
}

export function failedPreviewLoad(
  state: PreviewLoadState,
  image: PreviewImageDescriptor,
  failed: PreviewImageSource
): PreviewLoadState {
  if (state.source !== failed) return state;
  if (state.readySource && state.readySource !== failed)
    return { ...state, source: state.readySource, status: 'loaded', original: false };
  if (failed.originalLoaded && image.resolvePreview && !state.previewFallback)
    return { ...state, source: null, status: 'loading', original: false, previewFallback: true };
  if (image.resolvePreview) return { ...state, status: 'failed' };
  const fallback = state.original ? null : previewFallbackSource(image, failed);
  const deferred = fallback && image.resolveSource && image.resolveOriginal;
  return {
    source: deferred ? null : (fallback ?? state.source),
    status: fallback ? 'loading' : 'failed',
    original: state.original || fallback !== null,
  };
}

export function canFallbackPreview(status: number, aborted: boolean): boolean {
  return !aborted && (status === 404 || status === 415);
}

/** The same bounded fallback policy is used by the encrypted production reader. */
export async function readPreviewWithFallback(
  plan: GatewayImagePlan,
  read: (source: PreviewImageSource) => Promise<PreviewImageSource>,
  status: (error: unknown) => number,
  signal: AbortSignal
): Promise<PreviewImageSource> {
  try {
    return await read(plan.preview);
  } catch (error) {
    if (
      plan.preview.uri === plan.fallback.uri ||
      !canFallbackPreview(status(error), signal.aborted)
    )
      throw error;
    return read(plan.fallback);
  }
}
