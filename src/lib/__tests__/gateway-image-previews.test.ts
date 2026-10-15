import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  failedPreviewLoad,
  saveOriginalPreview,
  deferUnmappedImage,
  unavailableMessageImage,
  gatewayImagePlan,
  IMAGE_PREVIEWS_CAPABILITY,
  IMAGE_VERSIONS_CAPABILITY,
  parseOriginalImageVersion,
  imageAssetPath,
  messageImageForSource,
  originalPreviewSource,
  previewFallbackSource,
  readPreviewWithFallback,
  readThumbnailOnly,
  withMessageImageFiles,
  shouldLoadImagePreview,
  type GatewayImageScope,
  type PreviewImageDescriptor,
} from '../gateway-image-previews';
import { parseMessageImageAssets, type MessageImageAsset } from '../message-images';
import { parseTimelineItem } from '../agent-protocol';
import { filesFromContent } from '../agent-tool-output';
import { sessionAssetsFromResponse } from '../session-assets';

const capabilities = [IMAGE_PREVIEWS_CAPABILITY];
const asset: MessageImageAsset = {
  src: '/api/agent-images/ai_fixture/original',
  asset_id: 'ai_fixture',
  url: '/api/agent-images/ai_fixture/original',
  mime: 'image/png',
  width: 1200,
  height: 800,
  thumbnail_url: '/api/agent-images/ai_fixture/thumbnail',
  preview_url: '/api/agent-images/ai_fixture/preview',
  download_url: '/api/agent-images/ai_fixture/download',
};
const scope: GatewayImageScope = {
  serverId: 'synthetic-server-a',
  baseUrl: 'https://gateway.example:8443',
  pairingKey: 'synthetic-opaque-pairing-a',
  headers: { Authorization: 'Bearer synthetic-test-token' },
};
const plan = () => gatewayImagePlan(asset, scope, capabilities)!;
const failureStatus = (error: unknown) =>
  error instanceof Error ? Number(error.message.match(/^HTTP (\d+)/)?.[1] ?? 0) : 0;

describe('actual optional image metadata and selection', () => {
  test('r4 version acquisition requires both the actual optional URL and its negotiated capability', () => {
    const version_url = `/api/agent-images/${asset.asset_id}/version`;
    const parsed = parseMessageImageAssets([{ ...asset, version_url }])[0]!;
    expect(parsed.version_url).toBe(version_url);
    expect(gatewayImagePlan(parsed, scope, capabilities)?.version).toBeUndefined();
    expect(
      gatewayImagePlan(parsed, scope, [...capabilities, IMAGE_VERSIONS_CAPABILITY])?.version?.uri
    ).toBe(`${scope.baseUrl}${version_url}`);
    expect(
      gatewayImagePlan(asset, scope, [...capabilities, IMAGE_VERSIONS_CAPABILITY])?.version
    ).toBeUndefined();
    for (const version_url of [
      'https://external.example/version',
      '/api/agent-images/other/version',
      `/api/agent-images/${asset.asset_id}/version?x=1`,
    ]) {
      expect(parseMessageImageAssets([{ ...asset, version_url }])[0]?.version_url).toBeUndefined();
    }
  });

  test('r4 data.asset descriptor binds id, SHA256 version, exact strong ETag and both returned paths', () => {
    const version = 'a'.repeat(64);
    const fixed = {
      id: asset.asset_id,
      version,
      etag: `"sha256-${version}"`,
      size: 33 * 1024 * 1024,
      mime: 'image/png',
      url: `/api/agent-images/${asset.asset_id}/original/${version}`,
      download_url: `/api/agent-images/${asset.asset_id}/download/${version}`,
    };
    expect(parseOriginalImageVersion({ data: { asset: fixed } }, asset.asset_id)).toEqual(fixed);
    for (const override of [
      { id: 'other' },
      { version: 'not-a-digest' },
      { etag: `W/${fixed.etag}` },
      { etag: `"sha256-${'b'.repeat(64)}"` },
      { size: 0 },
      { size: NaN },
      { mime: 'application/pdf' },
      { url: asset.url },
      { download_url: 'https://external.example/original' },
      { download_url: `/api/agent-images/other/download/${version}` },
      { download_url: `${fixed.download_url}?token=unexpected` },
    ]) {
      expect(() =>
        parseOriginalImageVersion({ data: { asset: { ...fixed, ...override } } }, asset.asset_id)
      ).toThrow('invalid original image version');
    }
    expect(() => parseOriginalImageVersion({ asset: fixed }, asset.asset_id)).toThrow();
  });

  test('parses the Gateway original/thumbnail/preview/download contract', () => {
    expect(parseMessageImageAssets([asset])).toEqual([asset]);
    const selected = plan();
    expect(selected.thumbnail?.uri).toBe(`${scope.baseUrl}${asset.thumbnail_url}`);
    expect(selected.preview.uri).toBe(`${scope.baseUrl}${asset.preview_url}`);
    expect(selected.original.uri).toBe(`${scope.baseUrl}${asset.download_url}`);
    expect(selected.fallback.uri).toBe(`${scope.baseUrl}${asset.download_url}`);
  });

  test('old capability absence ignores all new optional URL fields', () => {
    const selected = gatewayImagePlan(asset, scope, [])!;
    expect(selected.thumbnail?.uri).toBe(`${scope.baseUrl}${asset.url}`);
    expect(selected.preview).toEqual(selected.thumbnail!);
    expect(selected.original).toEqual(selected.thumbnail!);
  });

  test('old asset URLs remain valid and missing preview fields open the original', () => {
    const legacy = {
      src: './out/plot.png',
      asset_id: 'as_fixture',
      url: '/api/assets/as_fixture/content',
      mime: 'image/png',
    };
    expect(parseMessageImageAssets([legacy])).toEqual([legacy]);
    const selected = gatewayImagePlan(legacy, scope, capabilities)!;
    expect(selected.thumbnail?.uri).toBe(`${scope.baseUrl}${legacy.url}`);
    expect(selected.preview.uri).toBe(`${scope.baseUrl}${legacy.url}`);
    expect(selected.original).toEqual(selected.preview);
  });

  test('empty optional fields never produce an empty or synthetic derivative request', () => {
    const selected = gatewayImagePlan(
      { ...asset, thumbnail_url: '', preview_url: '', download_url: '' },
      scope,
      capabilities
    )!;
    expect(selected.thumbnail).toBeNull();
    expect(selected.preview.uri).toBe(`${scope.baseUrl}${asset.url}`);
    expect(selected.original).toEqual(selected.preview);
  });

  test('typed MIME and exact source matching are required, not names or extensions', () => {
    expect(messageImageForSource([asset], asset.src)).toBe(asset);
    expect(messageImageForSource([asset], `${asset.src}?other`)).toBeUndefined();
    expect(
      messageImageForSource(
        [{ ...asset, mime: 'application/pdf', src: 'image_view.png' }],
        'image_view.png'
      )
    ).toBeUndefined();
    expect(gatewayImagePlan({ ...asset, mime: 'application/pdf' }, scope, capabilities)).toBeNull();
    expect(gatewayImagePlan({ ...asset, mime: 'image/*' }, scope, capabilities)).toBeNull();
  });

  test('unavailable markers retain failure provenance but cannot create image mappings or URLs', () => {
    const unavailable = parseMessageImageAssets([
      { ...asset, unavailable_reason: 'reference_not_authorized_or_unavailable' },
      {
        src: '',
        asset_id: '',
        url: '',
        mime: 'application/octet-stream',
        unavailable_reason: 'original_storage_unavailable',
      },
    ]);
    expect(unavailable.length).toBe(2);
    expect(unavailable.every((entry) => entry.url === '' && entry.asset_id === '')).toBe(true);
    expect(messageImageForSource(unavailable, asset.src)).toBeUndefined();
    expect(gatewayImagePlan(unavailable[0]!, scope, capabilities)).toBeNull();
    expect(unavailableMessageImage(unavailable, asset.src)).toBe(true);
    expect(unavailableMessageImage(unavailable, 'data:image/png;base64,retained-original')).toBe(
      true
    );
    expect(deferUnmappedImage(capabilities, true)).toBe(true);
    expect(deferUnmappedImage(capabilities, false)).toBe(false);
    expect(deferUnmappedImage([], true)).toBe(false);
  });

  test('size is original metadata and invalid empty preview fields do not trigger eager originals', () => {
    const parsed = parseMessageImageAssets([
      { ...asset, size: 33 * 1024 * 1024, thumbnail_url: '', preview_url: '', download_url: '' },
    ])[0]!;
    expect(parsed.size).toBe(33 * 1024 * 1024);
    expect(parsed.preview_declared).toBe(true);
    expect(gatewayImagePlan(parsed, scope, capabilities)?.thumbnail).toBeNull();
  });

  test('main/child/detail tool data retains envelope metadata without display normalization', () => {
    for (const name of ['image_view', 'read', 'unknown_custom_tool']) {
      const item = parseTimelineItem({
        id: `row-${name}`,
        role: 'assistant',
        updated_ms: 42,
        image_assets: [asset],
        attachments: [asset.src],
        part: {
          type: 'tool',
          id: 'call',
          name,
          state: 'completed',
          content: [{ type: 'file', uri: asset.src, mime: asset.mime }],
          metadata: {},
        },
      })!;
      expect(item.part.type).toBe('tool');
      if (item.part.type !== 'tool') throw new Error('Tool parse failed');
      expect(item.part.image_assets).toEqual([asset]);
      expect(item.part.image_attachments).toEqual([asset.src]);
      const expectedFile = { type: 'file', uri: asset.src, mime: asset.mime };
      expect(
        withMessageImageFiles(
          filesFromContent(item.part.content),
          item.part.image_assets,
          item.part.image_attachments
        )
      ).toEqual([expectedFile]);
      expect(item.part.name).toBe(name);
    }
  });

  test('attachments alone add only structurally mapped bitmaps, with no duplicate original', () => {
    const files = [{ uri: 'file:///a.txt', mime: 'text/plain' }];
    expect(withMessageImageFiles(files, [asset], [asset.src, asset.src, 'made-up.png'])).toEqual([
      ...files,
      { uri: asset.src, mime: asset.mime },
    ]);
    expect(withMessageImageFiles(files, [asset], [])).toEqual(files);
    expect(withMessageImageFiles(files, undefined, ['image_view.png'])).toEqual(files);
  });

  test('file-asset optional fields survive the existing Files parser', () => {
    const parsed = sessionAssetsFromResponse({
      data: {
        assets: [
          {
            id: asset.asset_id,
            path: '/synthetic/image.png',
            kind: 'image',
            mime: asset.mime,
            thumbnail_url: asset.thumbnail_url,
            preview_url: asset.preview_url,
            download_url: asset.download_url,
          },
        ],
      },
    })[0]!;
    expect(parsed.thumbnail_url).toBe(asset.thumbnail_url);
    expect(parsed.preview_url).toBe(asset.preview_url);
    expect(parsed.download_url).toBe(asset.download_url);
    expect(
      sessionAssetsFromResponse([{ id: 'old', path: '/a.png', kind: 'image' }])[0]?.preview_url
    ).toBeUndefined();
  });
});

describe('origin, pairing and cache isolation', () => {
  test('rejects external/protocol-relative/traversal/query original paths before adding headers', () => {
    for (const url of [
      'https://evil.example/a.png',
      '//evil.example/a.png',
      '/api/assets/../outside',
      '/api/assets/ai_fixture/content?redirect=https://evil.example',
      '/api/agent-images/other/original',
      '/api/agent-images/ai_fixture/%2e%2e/original',
      '/api/agent-images/ai_fixture/original#x',
      '/api/agent-images/ai_fixture/original\\evil',
    ]) {
      expect(parseMessageImageAssets([{ ...asset, url }])).toEqual([]);
      expect(gatewayImagePlan({ ...asset, url }, scope, capabilities)).toBeNull();
    }
  });

  test('ignores poisoned derivatives and cross-asset URLs instead of forwarding a bearer', () => {
    for (const url of [
      'https://evil.example/a.webp',
      '//evil.example/a.webp',
      '/api/agent-images/other/thumbnail',
      '/api/agent-images/ai_fixture/thumbnail?next=evil',
      '/api/agent-images/ai_fixture/../thumbnail',
    ]) {
      const parsed = parseMessageImageAssets([
        { ...asset, thumbnail_url: url, preview_url: url, download_url: url },
      ])[0]!;
      expect(parsed.thumbnail_url).toBeUndefined();
      const selected = gatewayImagePlan(parsed, scope, capabilities)!;
      expect(selected.thumbnail).toBeNull();
      for (const source of [selected.preview, selected.original]) {
        expect(new URL(source.uri).origin).toBe(new URL(scope.baseUrl).origin);
        expect(source.uri).not.toContain('evil');
        expect(source.headers).toEqual(scope.headers);
      }
    }
  });

  test('invalid origins, embedded credentials and non-HTTP transport are refused', () => {
    for (const baseUrl of [
      '',
      'file:///private',
      'data:image/png;base64,a',
      'https://user:pass@gateway.example',
      'https://gateway.example?next=evil',
      'https://gateway.example#x',
    ]) {
      expect(gatewayImagePlan(asset, { ...scope, baseUrl }, capabilities)).toBeNull();
    }
    expect(gatewayImagePlan(asset, { ...scope, serverId: '' }, capabilities)).toBeNull();
  });

  test('cache identities separate variant, endpoint, pairing, server and file revision, without headers', () => {
    const first = plan();
    const keys = [
      first.thumbnail!.cacheKey,
      first.preview.cacheKey,
      first.original.cacheKey,
      gatewayImagePlan(asset, { ...scope, serverId: 'server-b' }, capabilities)!.preview.cacheKey,
      gatewayImagePlan(asset, { ...scope, baseUrl: 'https://other.example' }, capabilities)!.preview
        .cacheKey,
      gatewayImagePlan(asset, { ...scope, pairingKey: 'pairing-b' }, capabilities)!.preview
        .cacheKey,
      gatewayImagePlan({ ...asset, cache_revision: 123 }, scope, capabilities)!.preview.cacheKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.join()).not.toContain('synthetic-test-token');
    expect(keys.join()).not.toContain('Authorization');
  });

  test('path selection requires the exact variant for the same typed asset id', () => {
    expect(imageAssetPath(asset.preview_url, asset.asset_id, 'preview')).toBe(asset.preview_url);
    expect(imageAssetPath(asset.preview_url, asset.asset_id, 'original')).toBeUndefined();
    expect(imageAssetPath('/api/assets/ai_fixture/content', asset.asset_id, 'original')).toBe(
      '/api/assets/ai_fixture/content'
    );
    expect(imageAssetPath(asset.url, '../ai_fixture', 'original')).toBeUndefined();
  });
});

describe('bounded lazy fallback and original save mapping', () => {
  test('save releases owned original files on success, failure and cancellation before native export', async () => {
    for (const result of ['ok', 'failure', 'cancel']) {
      let disposed = 0;
      let saved = 0;
      const controller = new AbortController();
      const image: PreviewImageDescriptor = {
        id: 'owned',
        uri: 'https://preview.example/a.webp',
        resolveOriginal: async () => {
          if (result === 'cancel') controller.abort();
          return {
            uri: 'file:///synthetic/original.png',
            dispose: () => {
              disposed++;
            },
          };
        },
      };
      const promise = saveOriginalPreview(
        image,
        async (_source, signal) => {
          expect(signal).toBe(controller.signal);
          saved++;
          if (result === 'failure') throw new Error('Native export failed');
        },
        controller.signal
      );
      if (result === 'ok') await promise;
      else await expect(promise).rejects.toThrow();
      expect(disposed).toBe(1);
      expect(saved).toBe(result === 'cancel' ? 0 : 1);
    }
  });
  test('new descriptors do not mount sixteen original decoders before page activation', () => {
    const descriptors = Array.from({ length: 16 }, (_, index) => ({
      id: String(index),
      uri: `${scope.baseUrl}/api/agent-images/ai_${index}/original`,
      deferred: true,
    }));
    expect(
      descriptors.filter((image, index) => shouldLoadImagePreview(image, index === 5, false))
    ).toEqual([descriptors[5]!]);
    expect(
      shouldLoadImagePreview({ id: 'legacy', uri: 'file:///synthetic/local.png' }, false, false)
    ).toBe(true);
  });

  test('sixteen list thumbnails never request previews or originals, including all-404 failure', async () => {
    const paths: string[] = [];
    const plans = Array.from({ length: 16 }, (_, index) => {
      const id = `ai_${index}`;
      return gatewayImagePlan(
        {
          ...asset,
          asset_id: id,
          src: `/api/agent-images/${id}/original`,
          url: `/api/agent-images/${id}/original`,
          thumbnail_url: `/api/agent-images/${id}/thumbnail`,
          preview_url: `/api/agent-images/${id}/preview`,
          download_url: `/api/agent-images/${id}/download`,
        },
        scope,
        capabilities
      )!;
    });
    const results = await Promise.allSettled(
      plans.map((entry) =>
        readThumbnailOnly(entry, async (source) => {
          paths.push(source.uri);
          throw new Error('HTTP 404');
        })
      )
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(paths.length).toBe(16);
    expect(paths.every((uri) => uri.endsWith('/thumbnail'))).toBe(true);
  });

  test('absent new thumbnails make zero read calls rather than decoding all originals', async () => {
    let calls = 0;
    const selected = gatewayImagePlan({ ...asset, thumbnail_url: undefined }, scope, capabilities)!;
    expect(
      await readThumbnailOnly(selected, async (source) => {
        calls++;
        return source;
      })
    ).toBeNull();
    expect(calls).toBe(0);
  });

  test('successful preview does not read an original', async () => {
    const paths: string[] = [];
    await readPreviewWithFallback(
      plan(),
      async (source) => {
        paths.push(source.uri);
        return source;
      },
      failureStatus,
      new AbortController().signal
    );
    expect(paths).toEqual([plan().preview.uri]);
  });

  test('404 and 415 fall back once, from preview to the authorized original', async () => {
    for (const code of [404, 415]) {
      const paths: string[] = [];
      const selected = plan();
      const result = await readPreviewWithFallback(
        selected,
        async (source) => {
          paths.push(source.uri);
          if (paths.length === 1) throw new Error(`HTTP ${code}`);
          return source;
        },
        failureStatus,
        new AbortController().signal
      );
      expect(paths).toEqual([selected.preview.uri, selected.fallback.uri]);
      expect(result).toEqual(selected.fallback);
    }
  });

  test('failed fallback is terminal, not recursive or automatically retried', async () => {
    const paths: string[] = [];
    await expect(
      readPreviewWithFallback(
        plan(),
        async (source) => {
          paths.push(source.uri);
          throw new Error('HTTP 415');
        },
        failureStatus,
        new AbortController().signal
      )
    ).rejects.toThrow('HTTP 415');
    expect(paths.length).toBe(2);
  });

  test('401/403/server/timeout failures do not cause speculative original reads', async () => {
    for (const reason of ['HTTP 401', 'HTTP 403', 'HTTP 500', 'Timed out']) {
      let calls = 0;
      await expect(
        readPreviewWithFallback(
          plan(),
          async () => {
            calls++;
            throw new Error(reason);
          },
          failureStatus,
          new AbortController().signal
        )
      ).rejects.toThrow(reason);
      expect(calls).toBe(1);
    }
  });

  test('cancellation at preview failure never starts an original read', async () => {
    const controller = new AbortController();
    let calls = 0;
    await expect(
      readPreviewWithFallback(
        plan(),
        async () => {
          calls++;
          controller.abort();
          throw new Error('HTTP 415');
        },
        failureStatus,
        controller.signal
      )
    ).rejects.toThrow('HTTP 415');
    expect(calls).toBe(1);
  });

  test('a missing preview already using original is only attempted once', async () => {
    let calls = 0;
    const selected = gatewayImagePlan({ ...asset, preview_url: '' }, scope, capabilities)!;
    await expect(
      readPreviewWithFallback(
        selected,
        async () => {
          calls++;
          throw new Error('HTTP 404');
        },
        failureStatus,
        new AbortController().signal
      )
    ).rejects.toThrow('HTTP 404');
    expect(calls).toBe(1);
  });

  test('native derivative failure changes source once and ignores stale native events', () => {
    const selected = plan();
    const image: PreviewImageDescriptor = {
      id: selected.id,
      ...selected.preview,
      original: selected.original,
      fallback: selected.fallback,
    };
    const initial = { source: image, status: 'loading' as const, original: false };
    const next = failedPreviewLoad(initial, image, image);
    expect(next.source).toBe(selected.fallback);
    expect(next.status).toBe('loading');
    expect(next.original).toBe(true);
    expect(failedPreviewLoad(next, image, image)).toBe(next);
    expect(failedPreviewLoad(next, image, selected.fallback).status).toBe('failed');
    expect(previewFallbackSource(image, selected.fallback)).toBeNull();
  });

  test('a decrypted preview decode failure schedules an authenticated original, not an encrypted URL to native Image', () => {
    const selected = plan();
    const image: PreviewImageDescriptor = {
      id: selected.id,
      ...selected.preview,
      original: selected.original,
      fallback: selected.fallback,
      resolveSource: async () => selected.preview,
      resolveOriginal: async () => selected.original,
    };
    const local = { uri: 'file:///synthetic/preview.webp', cacheKey: selected.preview.cacheKey };
    expect(
      failedPreviewLoad({ source: local, status: 'loading', original: false }, image, local)
    ).toEqual({ source: null, status: 'loading', original: true });
  });

  test('save always maps to original/download with its own headers, never current preview headers', async () => {
    const original = { uri: 'https://download.example/original.png' };
    const image: PreviewImageDescriptor = {
      id: 'synthetic',
      uri: 'https://preview.example/small.webp',
      headers: scope.headers,
      original,
    };
    expect(await originalPreviewSource(image)).toBe(original);
    expect((await originalPreviewSource(image)).headers).toBeUndefined();
    const legacy = { id: 'local', uri: 'file:///synthetic/local.png' };
    expect(await originalPreviewSource(legacy)).toBe(legacy);
  });

  test('encrypted original resolution is lazy and keeps synthetic original byte hash distinct from preview', async () => {
    const selected = plan();
    let reads = 0;
    const originalBytes = new TextEncoder().encode('synthetic original fixture bytes');
    const previewBytes = new TextEncoder().encode('synthetic derivative fixture bytes');
    const localOriginal = {
      uri: 'file:///synthetic/original.png',
      cacheKey: selected.original.cacheKey,
    };
    const image: PreviewImageDescriptor = {
      id: selected.id,
      ...selected.preview,
      original: selected.original,
      resolveOriginal: async () => {
        reads++;
        return localOriginal;
      },
    };
    expect(reads).toBe(0);
    const saved = await originalPreviewSource(image);
    expect(saved).toBe(localOriginal);
    expect(reads).toBe(1);
    const bytes = saved === localOriginal ? originalBytes : previewBytes;
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      createHash('sha256').update(originalBytes).digest('hex')
    );
    expect(createHash('sha256').update(bytes).digest('hex')).not.toBe(
      createHash('sha256').update(previewBytes).digest('hex')
    );
  });
});
