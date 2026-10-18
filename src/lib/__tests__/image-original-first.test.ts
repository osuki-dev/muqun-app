import { expect, test } from 'bun:test';
import {
  readOriginalFirst,
  resolvedPreviewLoad,
  failedPreviewLoad,
  type GatewayImagePlan,
} from '../gateway-image-previews';

const plan: GatewayImagePlan = {
  id: 'asset',
  thumbnail: { uri: 'thumbnail' },
  preview: { uri: 'preview' },
  original: { uri: 'original' },
  fallback: { uri: 'original' },
};

test('opening an image requests original and never loads its thumbnail', async () => {
  const reads: string[] = [];
  const result = await readOriginalFirst(
    plan,
    async (source) => {
      reads.push(source.uri);
      return source;
    },
    new AbortController().signal
  );
  expect(reads).toEqual(['original']);
  expect(result.originalLoaded).toBe(true);
});

test('original failure falls back once to preview without claiming original quality', async () => {
  const reads: string[] = [];
  const result = await readOriginalFirst(
    plan,
    async (source) => {
      reads.push(source.uri);
      if (source.uri === 'original') throw new Error('offline');
      return source;
    },
    new AbortController().signal
  );
  expect(reads).toEqual(['original', 'preview']);
  expect(result.originalLoaded).toBeUndefined();
});

test('cancellation never starts a fallback download', async () => {
  const controller = new AbortController();
  const reads: string[] = [];
  await expect(
    readOriginalFirst(
      plan,
      async (source) => {
        reads.push(source.uri);
        controller.abort();
        throw new Error('cancelled');
      },
      controller.signal
    )
  ).rejects.toThrow('cancelled');
  expect(reads).toEqual(['original']);
});

test('same decoded cached file stays ready across gallery reactivation', () => {
  const ready = { uri: 'file:///cached.png', cacheKey: 'version-a', headers: { B: '2', A: '1' } };
  const lease = { ...ready, headers: { A: '1', B: '2' } };
  const next = resolvedPreviewLoad(
    { source: ready, readySource: ready, status: 'loaded', original: false },
    lease,
    false,
    false,
    0
  );
  expect(next.status).toBe('loaded');
  expect(next.source).toBe(lease);
  expect(next.readySource).toBe(lease);
});

test('changed version or credentials must decode while the previous ready file remains owned', () => {
  const ready = { uri: 'file:///cached.png', cacheKey: 'version-a', headers: { A: '1' } };
  for (const changed of [
    { ...ready, cacheKey: 'version-b' },
    { ...ready, headers: { A: '2' } },
  ]) {
    const next = resolvedPreviewLoad(
      { source: ready, readySource: ready, status: 'loaded', original: false },
      changed,
      false,
      false,
      0
    );
    expect(next.status).toBe('loading');
    expect(next.readySource).toBe(ready);
  }
});

test('native original decode failure requests preview once and never returns to original automatically', () => {
  const image = { ...plan.preview, id: plan.id, resolvePreview: async () => plan.preview };
  const original = { uri: 'file:///original.heic', originalLoaded: true };
  const fallback = failedPreviewLoad(
    { source: original, status: 'loading', original: false, request: 0 },
    image,
    original
  );
  expect(fallback).toMatchObject({ source: null, previewFallback: true, status: 'loading' });
  const preview = { uri: 'file:///preview.webp' };
  const loaded = resolvedPreviewLoad(fallback, preview, false, true, 0);
  expect(failedPreviewLoad(loaded, image, preview)).toMatchObject({
    status: 'failed',
    previewFallback: true,
    original: false,
  });
});

test('failed native original retry restores the previously decoded preview', () => {
  const preview = { uri: 'file:///preview.webp' };
  const image = { ...plan.preview, id: plan.id, resolvePreview: async () => plan.preview };
  const original = { uri: 'file:///original.heic', originalLoaded: true };
  const retry = resolvedPreviewLoad(
    {
      source: preview,
      readySource: preview,
      status: 'loaded',
      original: false,
      previewFallback: true,
      request: 0,
    },
    original,
    true,
    false,
    1
  );
  const restored = failedPreviewLoad(retry, image, original);
  expect(restored.source).toBe(preview);
  expect(restored.status).toBe('loaded');
  expect(restored.request).toBe(1);
  expect(restored.original).toBe(false);
  expect(failedPreviewLoad(restored, image, original)).toBe(restored);
});
