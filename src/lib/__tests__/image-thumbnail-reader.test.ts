import { expect, test } from 'bun:test';
import {
  gatewayImagePlan,
  readThumbnailOnly,
  IMAGE_PREVIEWS_CAPABILITY,
} from '../gateway-image-previews';
import { downloadOriginalImageRanges } from '../image-original-ranges';
import { parseMessageImageAssets } from '../message-images';

const scope = {
  serverId: 'qa',
  baseUrl: 'https://gateway.invalid',
  pairingKey: 'opaque',
  headers: {},
};
const asset = {
  src: 'fixture.png',
  asset_id: 'qa_image',
  mime: 'image/png',
  url: '/api/assets/qa_image/content',
};

test('old metadata without derivatives remains an original-only thumbnail reader', async () => {
  for (const capabilities of [[], [IMAGE_PREVIEWS_CAPABILITY]]) {
    const parsed = parseMessageImageAssets([asset])[0]!;
    const plan = gatewayImagePlan(parsed, scope, capabilities)!;
    const reads: string[] = [];
    const source = await readThumbnailOnly(plan, async (source) => {
      reads.push(source.uri);
      return source;
    });
    expect(reads).toEqual(['https://gateway.invalid/api/assets/qa_image/content']);
    expect(source).toBe(plan.original);
    expect(plan.version).toBeUndefined();
  }
});

test('declared thumbnails never load preview, original, or version endpoints', async () => {
  const parsed = parseMessageImageAssets([
    {
      ...asset,
      url: '/api/agent-images/qa_image/original',
      thumbnail_url: '/api/agent-images/qa_image/thumbnail',
      preview_url: '/api/agent-images/qa_image/preview',
      download_url: '/api/agent-images/qa_image/download',
      version_url: '/api/agent-images/qa_image/version',
    },
  ])[0]!;
  const plan = gatewayImagePlan(parsed, scope, [
    IMAGE_PREVIEWS_CAPABILITY,
    'agent_image_versions_v1',
  ])!;
  const reads: string[] = [];
  await readThumbnailOnly(plan, async (source) => {
    reads.push(source.uri);
    return source;
  });
  expect(reads).toEqual(['https://gateway.invalid/api/agent-images/qa_image/thumbnail']);
});

test('invalid declared thumbnail remains unavailable instead of bypassing endpoint authorization', async () => {
  const parsed = parseMessageImageAssets([
    { ...asset, thumbnail_url: 'https://other.invalid/private' },
  ])[0]!;
  const plan = gatewayImagePlan(parsed, scope, [IMAGE_PREVIEWS_CAPABILITY])!;
  let requests = 0;
  expect(
    await readThumbnailOnly(plan, async (source) => {
      requests++;
      return source;
    })
  ).toBeNull();
  expect(requests).toBe(0);
});

test('unversioned agent-image original still supports a bounded legacy 200 response', async () => {
  const parsed = parseMessageImageAssets([
    { ...asset, url: '/api/agent-images/qa_image/original' },
  ])[0]!;
  const plan = gatewayImagePlan(parsed, scope, [IMAGE_PREVIEWS_CAPABILITY])!;
  const bytes = new Uint8Array([137, 80, 78, 71]);
  const written: number[] = [];
  let requests = 0;
  const result = await readThumbnailOnly(plan, async (source) => {
    expect(source).toBe(plan.original);
    return downloadOriginalImageRanges({
      size: bytes.length,
      request: async () => {
        requests++;
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'image/png', 'Content-Length': String(bytes.length) },
        });
      },
      sink: {
        write: (chunk) => {
          written.push(...chunk);
        },
        finish: () => ({ uri: 'file:///qa/original.png' }),
        abort: () => {
          throw new Error('Unexpected abort');
        },
      },
    });
  });
  expect(requests).toBe(1);
  expect(written).toEqual([...bytes]);
  expect(result?.uri).toBe('file:///qa/original.png');
});
