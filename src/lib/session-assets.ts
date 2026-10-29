/**
 * The gateway's unified content model (schema 1.0) as the app sees it: what an
 * asset is, how a listing is read, and how a file the user pointed at is
 * matched to one.
 *
 * Kept apart from `gateway-client` so the matching rules -- the part that
 * decides whether a tapped file opens or reports itself missing -- can be
 * tested without a network stack.
 */

/** What the gateway sniffed the file to be; decides which viewer opens. */
import { imageAssetPath } from './gateway-image-previews';
import { gatewayUploadName } from './uploaded-attachments';
import { isVideoManifest, normalizedFileMime, videoFileMime } from './media-file';
export type AssetKind = 'image' | 'audio' | 'video' | 'markdown' | 'text' | 'pdf' | 'binary';

export interface SessionAsset {
  /** Explicit MCP handoff, resolved against its own saved pairing. */
  mcpFile?: import('./mcp-file-reference').McpFileReference;
  id: string;
  /** Absolute path on the gateway host, which is also how output refers to it. */
  path: string;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
  modified_unix_ms: number;
  origin?: {
    session_id?: string;
    pane_id?: string;
    workspace_id?: string;
  };
  previewable: boolean;
  thumbnail_url?: string;
  preview_url?: string;
  download_url?: string;
  version_url?: string;
  preview_declared?: boolean;
  /** Bound by the client, never trusted from Gateway JSON. */
  gatewayServerId?: string;
  /** Only set for a file picked on this device, never for a host file:// URI. */
  localUri?: string;
  /** Validated upload name; uploads are outside the session workspace root. */
  uploadName?: string;
}

const ASSET_KINDS: readonly AssetKind[] = [
  'image',
  'audio',
  'video',
  'markdown',
  'text',
  'pdf',
  'binary',
];

/**
 * The `kind=` value for a listing request, or null for "ask for everything".
 *
 * The filter belongs on the request rather than on the answer: the gateway
 * applies the allow-list while it walks, so `kind=image` is the newest images
 * and not the images among the newest N -- which on a session whose agent is
 * editing source is the difference between a full screen and an empty one.
 *
 * Empty means no parameter rather than a parameter that matches nothing, so a
 * chip with no kinds behind it still reads as "no filter". The kinds are bare
 * words from a closed set, so they are safe in a query string unescaped, and a
 * gateway too old to know the parameter ignores it and answers as it always
 * did -- which the caller's own filter still narrows.
 */
export function assetKindQuery(kinds: readonly AssetKind[] | undefined): string | null {
  if (!kinds || kinds.length === 0) return null;
  // Deduplicated and put in the taxonomy's own order, so the same filter is the
  // same URL however the caller happened to list it -- which is what lets a
  // response cache key on the request.
  const known = ASSET_KINDS.filter((kind) => kinds.includes(kind));
  // A kind this app does not know is still asked for rather than dropped. The
  // gateway matches nothing for it, which is the honest answer to a narrow
  // question; dropping it would leave an empty allow-list, and an empty
  // allow-list is no filter at all -- so a narrow question would come back
  // answered with the entire listing.
  const unknown = kinds.filter((kind) => !ASSET_KINDS.includes(kind));
  return [...new Set([...known, ...unknown])].join(',');
}

export function sessionAssetsFromResponse(value: unknown): SessionAsset[] {
  const entries = assetListFromResponse(value);
  const assets = entries
    .map(normalizeSessionAsset)
    .filter((asset): asset is SessionAsset => asset !== null);
  // The endpoint promises newest first; re-sorting means a gateway that only
  // sorts by scan order still lists the way the UI says it does.
  return assets.sort((left, right) => right.modified_unix_ms - left.modified_unix_ms);
}

export interface SessionAssetPage {
  assets: SessionAsset[];
  nextCursor: string | null;
  limited: boolean;
}

/** Never manufacture an older-page cursor from a capped legacy listing. */
export function sessionAssetPageFromResponse(
  value: unknown,
  paginated: boolean,
  limit: number
): SessionAssetPage {
  const assets = sessionAssetsFromResponse(value);
  if (!paginated) return { assets, nextCursor: null, limited: assets.length >= limit };
  const envelope = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const data =
    envelope.data && typeof envelope.data === 'object'
      ? (envelope.data as Record<string, unknown>)
      : envelope;
  const cursor = data.next_cursor;
  if (
    (cursor !== null && (typeof cursor !== 'string' || !cursor.length)) ||
    typeof data.truncated !== 'boolean' ||
    data.truncated !== (cursor !== null)
  ) {
    throw new Error('Invalid file pagination response');
  }
  return { assets, nextCursor: cursor as string | null, limited: data.inventory_limited === true };
}

export function mergeSessionAssetPage(
  previous: SessionAsset[],
  next: SessionAsset[]
): SessionAsset[] {
  const byId = new Map(previous.map((asset) => [asset.id, asset]));
  for (const asset of next) byId.set(asset.id, asset);
  return [...byId.values()];
}

function assetListFromResponse(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || depth > 3) return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.assets)) return record.assets;
  if (Array.isArray(record.items)) return record.items;
  for (const key of ['data', 'result']) {
    if (record[key] !== undefined) return assetListFromResponse(record[key], depth + 1);
  }
  return [];
}

function normalizeSessionAsset(value: unknown): SessionAsset | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const path = typeof raw.path === 'string' ? raw.path : '';
  // Without an id there is nothing to fetch, and without a path there is
  // nothing to name it after; either one missing means the entry is unusable.
  if (!id || !path) return null;

  const mime = normalizedFileMime(typeof raw.mime === 'string' ? raw.mime : '');
  const kind = isVideoManifest({
    mime,
    name: typeof raw.name === 'string' ? raw.name : path,
    uri: path,
  })
    ? 'binary'
    : videoFileMime({ mime })
      ? 'video'
      : (ASSET_KINDS.find((entry) => entry === raw.kind) ?? 'binary');
  const name = typeof raw.name === 'string' && raw.name ? raw.name : fileNameOf(path);
  const thumbnail = imageAssetPath(raw.thumbnail_url, id, 'thumbnail');
  const preview = imageAssetPath(raw.preview_url, id, 'preview');
  const download = imageAssetPath(raw.download_url, id, 'download');
  const version = imageAssetPath(raw.version_url, id, 'version');
  const declared = ['thumbnail_url', 'preview_url', 'download_url'].some((key) => key in raw);
  return {
    id,
    path,
    name,
    kind,
    mime: mime || 'application/octet-stream',
    size: typeof raw.size === 'number' && raw.size >= 0 ? raw.size : 0,
    modified_unix_ms: typeof raw.modified_unix_ms === 'number' ? raw.modified_unix_ms : 0,
    origin: normalizeAssetOrigin(raw.origin),
    // An older gateway that does not send the flag still gets a sensible
    // answer: everything but an opaque binary is worth trying to render.
    previewable: typeof raw.previewable === 'boolean' ? raw.previewable : kind !== 'binary',
    ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
    ...(preview ? { preview_url: preview } : {}),
    ...(download ? { download_url: download } : {}),
    ...(version ? { version_url: version } : {}),
    ...(declared && !thumbnail && !preview && !download ? { preview_declared: true } : {}),
  };
}

function normalizeAssetOrigin(value: unknown): SessionAsset['origin'] {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const origin = {
    session_id: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    pane_id: typeof raw.pane_id === 'string' ? raw.pane_id : undefined,
    workspace_id: typeof raw.workspace_id === 'string' ? raw.workspace_id : undefined,
  };
  return origin.session_id || origin.pane_id || origin.workspace_id ? origin : undefined;
}

/**
 * Find the asset a path printed in the output refers to, among assets already
 * in hand. This is a match, not a lookup: it can only ever answer for the
 * files it was given, which is why the exact-path request in `gateway-client`
 * exists and this is only its fallback.
 */
export function findAssetByPath(assets: SessionAsset[], path: string): SessionAsset | null {
  const wanted = path.replace(/\/+$/, '');
  const exact = assets.find((asset) => asset.path === wanted);
  if (exact) return exact;
  // A `~`-rooted path cannot be expanded on this side, so fall back to the
  // longest tail match, which is unambiguous for anything but a repeated name.
  const suffix = wanted.replace(/^~/, '');
  return assets.find((asset) => asset.path.endsWith(suffix)) ?? null;
}

/** The artifact a part points at, among assets already in hand. */
export function findAssetById(assets: SessionAsset[], assetId: string): SessionAsset | null {
  return assets.find((asset) => asset.id === assetId) ?? null;
}

/**
 * What the content endpoint says an asset is, read from its response headers.
 *
 * The asset index is a rolling window over recent files, so an id can be
 * perfectly valid and still be outside any listing the app can ask for. The
 * bytes endpoint has no such window -- it resolves an id directly -- so when
 * the listing does not know a file, its own answer is the authority on what it
 * is. Everything here is best-effort by design: a missing header costs a
 * detail row, never the ability to open the file.
 */
export function assetFromContentHeaders(
  assetId: string,
  header: (name: string) => string | null | undefined,
  options: { previewable?: boolean } = {}
): SessionAsset {
  const mime = normalizedFileMime(header('content-type'));
  const name = fileNameFromContentDisposition(header('content-disposition')) || assetId;
  const declaredKind = header('x-asset-kind');
  const kind = isVideoManifest({ mime, name })
    ? 'binary'
    : videoFileMime({ mime })
      ? 'video'
      : (ASSET_KINDS.find((entry) => entry === declaredKind) ?? assetKindFromMime(mime));
  const size = Number(header('content-length') ?? '');
  return {
    id: assetId,
    // No path is on the wire and none is invented: the viewer shows this as
    // "where it lives", and a made-up location would be a lie about the host.
    path: name,
    name,
    kind,
    mime: mime || 'application/octet-stream',
    size: Number.isFinite(size) && size > 0 ? size : 0,
    // The endpoint does not date its bytes, and a rendered "just now" would be
    // a claim the app cannot make; zero reads as "unknown" downstream.
    modified_unix_ms: 0,
    previewable: options.previewable ?? kind !== 'binary',
  };
}

export function assetKindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/') && !isVideoManifest({ mime })) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/markdown') return 'markdown';
  if (mime.startsWith('text/') || mime === 'application/json') return 'text';
  return 'binary';
}

/**
 * `inline; filename="chart.png"` -> `chart.png`. Only the plain form is read:
 * the gateway writes exactly that, and a half-understood RFC 5987 parse would
 * put an unescaped, attacker-chosen string on screen.
 */
function fileNameFromContentDisposition(value: string | null | undefined): string {
  if (!value) return '';
  const quoted = /filename="([^"\\]*)"/.exec(value);
  if (quoted) return fileNameOf(quoted[1]);
  const bare = /filename=([^;]+)/.exec(value);
  return bare ? fileNameOf(bare[1].trim()) : '';
}

/** The last segment, so a header carrying a path cannot name a directory. */
function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * A file a tool returned, as the asset the shared viewer opens.
 *
 * `Tool.FileContent` is `{uri, mime?, name?}` and nothing else: no size, no
 * mtime, no id. The viewer reads the bytes from the gateway by path, so the
 * path is the only field that has to be right -- a `file://` URI is stripped
 * back to the absolute path the gateway host knows it by, and anything that is
 * not a local path (an `http:` result from a browser tool, say) is not an
 * asset this viewer can open and comes back `null` rather than as a chip that
 * opens an empty sheet.
 */
export function assetFromToolFile(
  file: { uri: string; mime?: string; name?: string },
  sessionId?: string
): SessionAsset | null {
  const uri = file.uri ?? '';
  const path = uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
  if (!path.startsWith('/')) return null;
  const mime =
    videoFileMime(file) ?? (isPdfFile(file) ? 'application/pdf' : normalizedFileMime(file.mime));
  const kind = isVideoManifest(file) ? 'binary' : assetKindFromMime(mime);
  return {
    id: path,
    path,
    name: file.name ?? path.split('/').filter(Boolean).pop() ?? path,
    kind,
    mime: mime || 'application/octet-stream',
    // Unknown, and stated as unknown rather than guessed: the viewer shows the
    // bytes it reads, and a fabricated size would appear in its header.
    size: 0,
    modified_unix_ms: 0,
    ...(sessionId ? { origin: { session_id: sessionId } } : {}),
    previewable: kind !== 'binary',
  };
}

/** A filename is the fallback when a picker or tool omits a useful MIME. */
export function isPdfFile(file: { mime?: string; name?: string; uri?: string }): boolean {
  return (
    file.mime?.split(';')[0].trim().toLowerCase() === 'application/pdf' ||
    /\.pdf$/i.test(file.name ?? '') ||
    /\.pdf$/i.test(file.uri ?? '')
  );
}

/** Device-picked bytes are distinct from identically shaped paths on a host. */
export function assetFromLocalPdf(
  file:
    | {
        id: string;
        localUri: string;
        name: string;
        mime: string;
        size?: number;
      }
    | undefined
): SessionAsset | null {
  if (
    !file ||
    !isPdfFile({ ...file, uri: file.localUri }) ||
    !/^(?:file|content):\/\//.test(file.localUri)
  )
    return null;
  return {
    id: file.id,
    path: file.name,
    name: file.name,
    kind: 'pdf',
    mime: 'application/pdf',
    size: file.size ?? 0,
    modified_unix_ms: 0,
    previewable: true,
    localUri: file.localUri,
  };
}

/** Only an explicit device pick may give the native preview a local source. */
export function assetFromLocalVideo(
  file: { id: string; localUri: string; name: string; mime: string; size?: number } | undefined
): SessionAsset | null {
  if (!file || !/^(?:file|content):\/\//.test(file.localUri)) return null;
  const mime = videoFileMime({ ...file, uri: file.localUri });
  if (!mime) return null;
  return {
    id: file.id,
    path: file.name,
    name: file.name,
    kind: 'video',
    mime,
    size: file.size ?? 0,
    modified_unix_ms: 0,
    previewable: true,
    localUri: file.localUri,
  };
}

export function assertAssetGateway(
  asset: Pick<SessionAsset, 'gatewayServerId'>,
  currentServerId: string | null
) {
  if (asset.gatewayServerId && asset.gatewayServerId !== currentServerId)
    throw new Error('The file belongs to a different Gateway');
}

/** Uploaded media lives outside the workspace and uses the authenticated upload route. */
export function assetFromUploadedFile(path: string, serverId: string | null): SessionAsset | null {
  const name = gatewayUploadName(path);
  if (!name) return null;
  const mime = isPdfFile({ name })
    ? 'application/pdf'
    : (videoFileMime({ name }) ?? 'application/octet-stream');
  const kind = assetKindFromMime(mime);
  return {
    id: `upload:${name}`,
    path,
    name,
    kind,
    mime,
    size: 0,
    modified_unix_ms: 0,
    previewable: kind !== 'binary',
    gatewayServerId: serverId ?? undefined,
    uploadName: name,
  };
}
