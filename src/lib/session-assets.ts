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
export type AssetKind = 'image' | 'markdown' | 'text' | 'pdf' | 'binary';

export interface SessionAsset {
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
}

const ASSET_KINDS: readonly AssetKind[] = ['image', 'markdown', 'text', 'pdf', 'binary'];

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

  const kind = ASSET_KINDS.find((entry) => entry === raw.kind) ?? 'binary';
  const name = typeof raw.name === 'string' && raw.name ? raw.name : fileNameOf(path);
  return {
    id,
    path,
    name,
    kind,
    mime: typeof raw.mime === 'string' ? raw.mime : 'application/octet-stream',
    size: typeof raw.size === 'number' && raw.size >= 0 ? raw.size : 0,
    modified_unix_ms: typeof raw.modified_unix_ms === 'number' ? raw.modified_unix_ms : 0,
    origin: normalizeAssetOrigin(raw.origin),
    // An older gateway that does not send the flag still gets a sensible
    // answer: everything but an opaque binary is worth trying to render.
    previewable: typeof raw.previewable === 'boolean' ? raw.previewable : kind !== 'binary',
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
  const mime = (header('content-type') ?? '').split(';')[0].trim();
  const name = fileNameFromContentDisposition(header('content-disposition')) || assetId;
  const declaredKind = header('x-asset-kind');
  const kind =
    ASSET_KINDS.find((entry) => entry === declaredKind) ?? assetKindFromMime(mime);
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

function assetKindFromMime(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
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
