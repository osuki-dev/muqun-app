import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { assertStandaloneVideo, videoCacheExtension } from '../media-file';
import type { SessionAsset } from '../session-assets';

const asset: SessionAsset = {
  id: 'video',
  path: '/workspace/placeholder.mp4',
  name: 'placeholder.mp4',
  kind: 'video',
  mime: 'video/mp4',
  previewable: true,
  size: 0,
  modified_unix_ms: 0,
};

/** Execute the production lifecycle with native IO/player boundaries observed. */
function harness(
  resolved: SessionAsset,
  bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
  afterWrite?: () => void
) {
  const events: string[] = [];
  const runtime = runInNewContext(
    transpile(
      `${declaration('src/lib/video-preview.ts', 'videoPreviewRuntime')}\nvideoPreviewRuntime(asset, { resolve: async () => resolved, onPrepared: () => events.push('prepared') })`
    ),
    {
      asset,
      resolved,
      events,
      sequence: 0,
      assertStandaloneVideo,
      videoCacheExtension,
      VIDEO_CONTENT_LIMIT: 1234,
      readAssetBytes: async (source: SessionAsset, options: { maxBytes: number }) => {
        expect(source).toBe(resolved);
        expect(options.maxBytes).toBe(1234);
        events.push('read');
        return bytes;
      },
      protectTemporaryCacheEntry: async () => {
        events.push('protect');
        return () => events.push('release-cache');
      },
      Paths: { cache: 'private-cache' },
      File: class {
        uri = 'file:///private-cache/video';
        constructor(_root: string, name: string) {
          events.push(`file:${name.split('.').pop()}`);
        }
        create() {
          events.push('create');
        }
        async write(value: Uint8Array) {
          expect(value).toBe(bytes);
          events.push('write');
          afterWrite?.();
        }
      },
      VideoPlayer: class {
        constructor() {
          events.push('player');
        }
        release() {
          events.push('release-player');
        }
      },
    }
  ) as { prepare(signal: AbortSignal): Promise<void>; release(): void };
  return { runtime, events };
}

test('video preparation uses resolved container suffix and preserves bounded authenticated byte reading/cache ownership', async () => {
  for (const [name, mime, suffix] of [
    ['clip.WEBM', 'video/webm', 'WEBM'],
    ['clip.mkv', 'video/x-matroska', 'mkv'],
    ['clip.ts', 'video/mp2t', 'ts'],
    ['clip.future', 'video/x-new-container', 'future'],
    ['clip', 'video/x-new-container', 'bin'],
  ]) {
    const { runtime, events } = harness({ ...asset, name, path: `/workspace/${name}`, mime });
    await runtime.prepare(new AbortController().signal);
    expect(events).toEqual([
      'read',
      `file:${suffix}`,
      'protect',
      'create',
      'write',
      'player',
      'prepared',
    ]);
    runtime.release();
    expect(events.slice(-2)).toEqual(['release-player', 'release-cache']);
  }
});

test('resolved or mislabeled playlists never reach native player/cache creation', async () => {
  for (const [name, mime, body] of [
    ['list.m3u8', 'video/mp4', 'arbitrary'],
    ['list', 'video/vnd.mpegurl', 'arbitrary'],
    ['clip.mp4', 'video/mp4', '#EXTM3U\nhttps://other-host/segment.ts'],
    [
      'clip.webm',
      'video/webm',
      '<?xml version="1.0"?>\n<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">',
    ],
  ]) {
    const { runtime, events } = harness({ ...asset, name, mime }, new TextEncoder().encode(body));
    await expect(runtime.prepare(new AbortController().signal)).rejects.toThrow('playlists');
    expect(events).toEqual(['read']);
  }
});

test('a cancellation after byte resolution cannot create a native player or cache file', async () => {
  const { runtime, events } = harness(asset);
  const controller = new AbortController();
  controller.abort();
  await expect(runtime.prepare(controller.signal)).rejects.toThrow('cancelled');
  expect(events).toEqual(['read']);
});

test('cancellation during an asynchronous cache write cannot create a detached native player', async () => {
  const controller = new AbortController();
  const { runtime, events } = harness(asset, undefined, () => controller.abort());
  await expect(runtime.prepare(controller.signal)).rejects.toThrow('cancelled');
  expect(events).not.toContain('player');
  runtime.release();
  expect(events.at(-1)).toBe('release-cache');
});
