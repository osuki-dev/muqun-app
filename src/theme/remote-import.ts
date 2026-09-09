import { cloneThemeData } from '@/theme/clone';
import { inspectThemeImage } from '@/theme/image-inspection';
import { unpackTheme, type ThemePackage } from '@/theme/package';
import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';

export const REMOTE_THEME_LIMITS = Object.freeze({ redirects: 5, timeoutMs: 30_000 });

/** Native-only trust boundary: resolve and pin public destination addresses BEFORE
 * connecting, validate TLS for the original hostname, disable proxies, cookies,
 * credentials and automatic redirects, and bound decoded response bytes. Generic
 * JS fetch is NOT a valid implementation of this contract (DNS rebinding). */
export interface PublicThemeTransport {
  get(
    url: string,
    options: { signal: AbortSignal; maxBytes: number }
  ): Promise<{
    status: number;
    location?: string;
    contentType?: string;
    bytes: Uint8Array;
  }>;
}

/** URL screening supplements, never replaces, native connection enforcement.
 * Literal addresses are deliberately unsupported, including alternate IPv4 forms. */
export function publicThemeUrl(value: string, base?: string): string {
  if (value.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(value))
    throw new Error('Use a public HTTPS theme download link');
  const url = new URL(value, base);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    !host.includes('.') ||
    host.includes(':') ||
    /^[\d.]+$/.test(host) ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.split('.').some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
    /(?:^|\.)(?:localhost|local|internal|home|lan|onion|invalid|test)$/.test(host)
  )
    throw new Error('Use a public HTTPS theme download link');
  url.hash = '';
  return url.href;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(signal.reason ?? new Error('Theme download canceled'));
        signal.addEventListener('abort', rejectAbort, { once: true });
        if (signal.aborted) rejectAbort();
      }),
    ]);
  } finally {
    if (rejectAbort) signal.removeEventListener('abort', rejectAbort);
  }
}

async function download(
  transport: PublicThemeTransport,
  input: string,
  maxBytes: number,
  signal?: AbortSignal,
  approvedDomains?: ReadonlySet<string>
): Promise<{ bytes: Uint8Array; url: string }> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error('Theme download timed out')),
    REMOTE_THEME_LIMITS.timeoutMs
  );
  try {
    let url = publicThemeUrl(input);
    const visited = new Set<string>();
    for (let hop = 0; hop <= REMOTE_THEME_LIMITS.redirects; hop++) {
      controller.signal.throwIfAborted();
      if (approvedDomains && !approvedDomains.has(new URL(url).hostname))
        throw new Error('Theme image redirects to an unapproved resource domain');
      if (visited.has(url)) throw new Error('Theme download redirect loop');
      visited.add(url);
      const response = await abortable(
        transport.get(url, { signal: controller.signal, maxBytes }),
        controller.signal
      );
      controller.signal.throwIfAborted();
      if (!(response.bytes instanceof Uint8Array) || response.bytes.byteLength > maxBytes)
        throw new Error('Theme download exceeds the size limit');
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location) throw new Error('Theme redirect is missing its destination');
        url = publicThemeUrl(response.location, url);
        continue;
      }
      if (response.status !== 200)
        throw new Error(`Theme download failed (HTTP ${response.status})`);
      if (response.contentType?.split(';')[0].trim().toLowerCase() === 'text/html')
        throw new Error('This is a web page; use its raw file or download link');
      return { bytes: response.bytes, url };
    }
    throw new Error('Theme download has too many redirects');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export type RemoteThemeInspection = {
  sourceUrl: string;
  resourceDomains: readonly string[];
  manifest: ThemeManifest;
  /** Does not fetch images until the user has reviewed the resource domains.
   * The returned package still requires prepareThemeAssets native decode/hash
   * verification before preview or atomic installation. */
  downloadAssets: (signal?: AbortSignal) => Promise<ThemePackage>;
};

/** No filesystem or library writes. Transport is mandatory and never falls back
 * to JS fetch. Existing native staging owns decode, checksums and installation. */
export async function inspectRemoteTheme(
  transport: PublicThemeTransport,
  input: string,
  options: { signal?: AbortSignal; format?: 'manifest' | 'package' } = {}
): Promise<RemoteThemeInspection> {
  const packaged = options.format === 'package';
  const result = await download(
    transport,
    input,
    packaged ? THEME_LIMITS.packageBytes : THEME_LIMITS.manifestBytes,
    options.signal
  );
  const archive = packaged ? unpackTheme(result.bytes, options.signal) : undefined;
  const manifest =
    archive?.manifest ??
    parseThemeManifest(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes));
  const owned = cloneThemeData(manifest);
  const resources = Object.entries(owned.assets ?? {}).map(([id, asset]) => ({
    id,
    url: 'url' in asset ? publicThemeUrl(asset.url) : publicThemeUrl(asset.path, result.url),
  }));
  return {
    sourceUrl: result.url,
    resourceDomains: archive
      ? []
      : [...new Set(resources.map((asset) => new URL(asset.url).hostname))],
    manifest: cloneThemeData(owned),
    async downloadAssets(signal) {
      signal?.throwIfAborted();
      if (archive)
        return {
          manifest: cloneThemeData(owned),
          assets: Object.fromEntries(
            Object.entries(archive.assets).map(([id, bytes]) => [id, bytes.slice()])
          ),
        };
      const assets: Record<string, Uint8Array> = {};
      const resolved = cloneThemeData(owned);
      let total = result.bytes.length;
      // Sequential downloads bound network concurrency and decoder memory.
      for (const resource of resources) {
        const fetched = await download(
          transport,
          resource.url,
          Math.min(THEME_LIMITS.assetBytes, THEME_LIMITS.extractedBytes - total),
          signal,
          new Set(resources.map((asset) => new URL(asset.url).hostname))
        );
        signal?.throwIfAborted();
        total += fetched.bytes.length;
        const info = inspectThemeImage(fetched.bytes);
        assets[resource.id] = fetched.bytes;
        resolved.assets![resource.id] = {
          path: `assets/${resource.id}.${info.format}`,
          ...(owned.assets![resource.id].sha256
            ? { sha256: owned.assets![resource.id].sha256 }
            : {}),
        };
      }
      return { manifest: resolved, assets };
    },
  };
}
