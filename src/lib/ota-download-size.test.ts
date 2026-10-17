import { describe, expect, test } from 'bun:test';
import { fetchOtaDownloadSize } from './ota-download-size';
import type { OtaArtifactTarget } from './ota-update-metadata';

const target: OtaArtifactTarget = {
  releaseId: '0199aabb-ccdd-7a00-8000-001122334455',
  fromBundleId: '0199aabb-ccdd-7a00-8000-001122334466',
  toBundleId: '0199aabb-ccdd-7a00-8000-001122334477',
  channel: 'production',
};
const manifestUrl = 'https://storage.example.test/manifest.json?signature=test';
const artifact = {
  artifactProtocolVersion: 1,
  manifestUrl,
  archiveUrl: 'https://storage.example.test/bundle.tar.br',
};
const manifest = {
  bundleId: target.toBundleId,
  assets: {
    'index.bundle': { byteSize: 80_000, downloadByteSize: 2000 },
    'font.ttf': { byteSize: 40_000, downloadByteSize: 4000 },
  },
  archive: { downloadByteSize: 5000 },
};
function requests(descriptor: unknown = artifact, payload: unknown = manifest) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(calls.length === 1 ? descriptor : payload);
  };
  return { request, calls };
}

describe('official OTA size metadata', () => {
  test('reads only official artifact metadata and signed manifest, keeping credentials on the API host', async () => {
    const f = requests();
    expect(await fetchOtaDownloadSize(target, 'client-key', f.request)).toEqual({
      fullBytes: 5000,
    });
    expect(f.calls.map((call) => call.url)).toEqual([
      `https://updates.muqun.dev/artifacts/v1/${target.toBundleId}/from/${target.fromBundleId}`,
      manifestUrl,
    ]);
    expect(f.calls[0].init?.headers).toEqual({ 'x-api-key': 'client-key' });
    expect(f.calls[0].init?.redirect).toBe('error');
    expect(f.calls[1].init?.headers).toBeUndefined();
    expect(f.calls[1].init?.redirect).toBe('error');
    expect(f.calls.some((call) => call.url.endsWith('bundle.tar.br'))).toBe(false);
  });

  test('without an archive, sums compressed file bytes once, never decompressed bytes', async () => {
    const f = requests({ ...artifact, archiveUrl: undefined });
    expect(await fetchOtaDownloadSize(target, 'key', f.request)).toEqual({ fullBytes: 6000 });
  });

  test('rejects unrelated bundle, invalid sizes, missing metadata, and unsafe manifest URLs', async () => {
    for (const payload of [
      { ...manifest, bundleId: target.fromBundleId },
      { ...manifest, archive: { downloadByteSize: -1 } },
      { ...manifest, archive: { downloadByteSize: 0 } },
      { ...manifest, archive: { downloadByteSize: Number.MAX_SAFE_INTEGER + 1 } },
      { ...manifest, assets: {} },
    ]) {
      expect(
        await fetchOtaDownloadSize(target, 'key', requests(artifact, payload).request)
      ).toBeNull();
    }
    const noArchive = { ...artifact, archiveUrl: undefined };
    for (const payload of [
      { ...manifest, assets: { file: { byteSize: 1000 } } },
      { ...manifest, assets: { file: { downloadByteSize: -1 } } },
      {
        ...manifest,
        assets: { a: { downloadByteSize: Number.MAX_SAFE_INTEGER }, b: { downloadByteSize: 1 } },
      },
    ]) {
      expect(
        await fetchOtaDownloadSize(target, 'key', requests(noArchive, payload).request)
      ).toBeNull();
    }
    for (const url of [
      'http://storage.example.test/manifest',
      'file:///manifest',
      'https://user:password@storage.example.test/manifest',
    ]) {
      const f = requests({ ...artifact, manifestUrl: url });
      expect(await fetchOtaDownloadSize(target, 'key', f.request)).toBeNull();
      expect(f.calls.length).toBe(1);
    }
    expect(
      await fetchOtaDownloadSize(
        target,
        'key',
        requests({ ...artifact, artifactProtocolVersion: 2 }).request
      )
    ).toBeNull();
  });

  test('contains outages and bounds metadata before parsing, including native fetch without streams', async () => {
    expect(
      await fetchOtaDownloadSize(target, 'key', async () => {
        throw new Error('offline');
      })
    ).toBeNull();
    expect(
      await fetchOtaDownloadSize(target, 'key', async () => new Response(null, { status: 503 }))
    ).toBeNull();
    const tooLarge = new Response('x'.repeat(2 * 1024 * 1024 + 1));
    expect(await fetchOtaDownloadSize(target, 'key', async () => tooLarge)).toBeNull();
    let calls = 0;
    expect(
      await fetchOtaDownloadSize(target, 'key', async () => {
        const response = Response.json(calls++ === 0 ? artifact : manifest);
        Object.defineProperty(response, 'body', { value: null });
        return response;
      })
    ).toEqual({ fullBytes: 5000 });
  });
});
