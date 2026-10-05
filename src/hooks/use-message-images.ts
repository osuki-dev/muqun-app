import { useEffect, useMemo, useState } from 'react';

import { gatewayAuthHeaders, messageImageUrl, readMessageImageFile } from '@/lib/gateway-client';
import type { MessageImageAsset } from '@/lib/message-images';

const NO_URIS: ReadonlyMap<string, string> = new Map();
const NO_SOURCES: ReadonlySet<string> = new Set();
const NO_ASSETS: readonly MessageImageAsset[] = [];

function assetsKey(assets: readonly MessageImageAsset[] | undefined): string {
  return assets?.map((asset) => `${asset.src}\u0000${asset.asset_id}`).join('\n') ?? '';
}

export interface MessageImageSources {
  /** Source as written -> the URI the renderer should load instead. */
  uris: ReadonlyMap<string, string>;
  /** Sources whose bytes are still on their way (encrypted transport only). */
  pending: ReadonlySet<string>;
  /** Headers for the renderer's own requests, when any URI is a gateway URL. */
  headers?: Record<string, string>;
}

/**
 * The URIs a text part's `image_assets` load from.
 *
 * On a plain transport every image is the gateway URL, fetched by the
 * renderer with the device's credentials. On an encrypted transport each one is
 * downloaded through the sealed channel into a cache file first; until it lands
 * the source is `pending`, and if it never does it simply drops out, which the
 * caller draws as a caption.
 *
 * Keyed on the sources and ids rather than the array: a streamed part hands a
 * new array on every token, and nothing about its images changed.
 */
export function useMessageImages(
  assets: readonly MessageImageAsset[] | undefined
): MessageImageSources {
  const key = assetsKey(assets);
  const [held, setHeld] = useState(() => ({ key, assets: assets ?? NO_ASSETS }));
  if (held.key !== key) setHeld({ key, assets: assets ?? NO_ASSETS });
  const stable = held.key === key ? held.assets : (assets ?? NO_ASSETS);
  const [files, setFiles] = useState<ReadonlyMap<string, string>>(NO_URIS);
  const [failed, setFailed] = useState<ReadonlySet<string>>(NO_SOURCES);

  useEffect(() => {
    let live = true;
    for (const asset of stable) {
      if (messageImageUrl(asset.url) !== null) continue;
      readMessageImageFile(asset).then(
        (uri) => {
          if (live) setFiles((prev) => new Map(prev).set(asset.asset_id, uri));
        },
        () => {
          if (live) setFailed((prev) => new Set(prev).add(asset.asset_id));
        }
      );
    }
    return () => {
      live = false;
    };
  }, [stable]);

  return useMemo(() => {
    if (stable.length === 0) return { uris: NO_URIS, pending: NO_SOURCES };
    const uris = new Map<string, string>();
    const pending = new Set<string>();
    let direct = false;
    for (const asset of stable) {
      const url = messageImageUrl(asset.url);
      if (url !== null) {
        uris.set(asset.src, url);
        direct = true;
        continue;
      }
      const file = files.get(asset.asset_id);
      if (file) uris.set(asset.src, file);
      else if (!failed.has(asset.asset_id)) pending.add(asset.src);
    }
    return { uris, pending, ...(direct ? { headers: gatewayAuthHeaders() } : {}) };
  }, [stable, files, failed]);
}
