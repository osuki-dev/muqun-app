import { useEffect, useMemo, useState } from 'react';
import {
  configuredGatewayServerId,
  gatewayImageBinding,
  gatewayImageConnectionKey,
} from '@/lib/gateway-client';
import type { MessageImageAsset } from '@/lib/message-images';
import type { PreviewImageSource } from '@/lib/gateway-image-previews';
import { useServerCapabilities } from '@/stores/server-capabilities';

const NO_ASSETS: readonly MessageImageAsset[] = [];
const NO_CAPABILITIES: string[] = [];

export interface MessageImageSources {
  uris: ReadonlyMap<string, string>;
  pending: ReadonlySet<string>;
  sources: ReadonlyMap<string, PreviewImageSource>;
  headers?: Record<string, string>;
}

/** Markdown's header prop is global. Authenticated local thumbnails keep tokens
 * off unrelated external images. Files/requests are owned by this mounted part. */
export function useMessageImages(
  assets: readonly MessageImageAsset[] | undefined
): MessageImageSources {
  const serverId = configuredGatewayServerId();
  const capabilities = useServerCapabilities((state) =>
    serverId ? (state.byServer[serverId] ?? NO_CAPABILITIES) : NO_CAPABILITIES
  );
  const key = JSON.stringify([gatewayImageConnectionKey(), capabilities, assets]);
  const [held, setHeld] = useState(() => ({ key, assets: assets ?? NO_ASSETS, capabilities }));
  if (held.key !== key) setHeld({ key, assets: assets ?? NO_ASSETS, capabilities });
  const bindings = useMemo(
    () =>
      held.assets.flatMap((asset) => {
        const binding = gatewayImageBinding(asset, held.capabilities);
        return binding ? [{ asset, ...binding }] : [];
      }),
    [held]
  );
  const [owned] = useState(() => new Map<string, PreviewImageSource | null>());
  const [reads] = useState(() => new Map<string, AbortController>());
  const [files, setFiles] = useState<ReadonlyMap<string, PreviewImageSource | null>>(new Map());

  useEffect(
    () => () => {
      for (const controller of reads.values()) controller.abort();
      reads.clear();
      for (const source of owned.values()) source?.dispose?.();
      owned.clear();
    },
    [owned, reads]
  );

  useEffect(() => {
    const desired = new Set(
      bindings.flatMap((binding) =>
        binding.plan.thumbnail
          ? [binding.plan.thumbnail.cacheKey ?? binding.plan.thumbnail.uri]
          : []
      )
    );
    for (const [imageKey, controller] of reads) {
      if (!desired.has(imageKey)) {
        controller.abort();
        reads.delete(imageKey);
      }
    }
    for (const [imageKey, source] of owned) {
      if (!desired.has(imageKey)) {
        source?.dispose?.();
        owned.delete(imageKey);
      }
    }
    setFiles(new Map(owned));
    for (const binding of bindings) {
      const source = binding.plan.thumbnail;
      if (!source) continue;
      const imageKey = source.cacheKey ?? source.uri;
      if (owned.has(imageKey) || reads.has(imageKey)) continue;
      const controller = new AbortController();
      reads.set(imageKey, controller);
      binding.readThumbnail(controller.signal).then(
        (resolved) => {
          if (controller.signal.aborted || reads.get(imageKey) !== controller) {
            resolved?.dispose?.();
            return;
          }
          reads.delete(imageKey);
          if (resolved) {
            owned.set(imageKey, resolved);
            setFiles(new Map(owned));
          }
        },
        () => {
          if (!controller.signal.aborted && reads.get(imageKey) === controller) {
            reads.delete(imageKey);
            owned.set(imageKey, null);
            setFiles(new Map(owned));
          }
        }
      );
    }
  }, [bindings, owned, reads]);

  return useMemo(() => {
    const uris = new Map<string, string>();
    const pending = new Set<string>();
    const sources = new Map<string, PreviewImageSource>();
    for (const binding of bindings) {
      const source = binding.plan.thumbnail;
      if (!source) continue;
      const imageKey = source.cacheKey ?? source.uri;
      const file = files.get(imageKey);
      if (file) {
        uris.set(binding.asset.src, file.uri);
        sources.set(binding.asset.src, file);
      } else if (!files.has(imageKey)) pending.add(binding.asset.src);
    }
    return { uris, pending, sources };
  }, [bindings, files]);
}
