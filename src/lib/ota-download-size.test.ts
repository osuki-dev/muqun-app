import { describe, expect, test } from 'bun:test';
import {
  createEngineDatabase,
  createMemoryAdapter,
  migrateCoreSchema,
} from '@hot-updater/plugin-core';
import { createHotUpdater } from '@hot-updater/server';
import { apiKeys } from '@hot-updater/server/plugins';
import type { ArtifactInfo } from '@hot-updater/protocol';
import { localizedReleaseNotes } from '../../infrastructure/ota-notes/plugin';
import { estimateOtaDownloadSize } from '../../infrastructure/ota-notes/download-size';
import { fetchOtaDownloadSize } from './ota-download-size';

const baseId = '0199aabb-ccdd-7a00-8000-001122334455';
const targetId = '0199aabb-ccdd-7a00-8000-001122334466';
const hash = 'a'.repeat(64);
const newHash = 'b'.repeat(64);
const manifest = (bundleId: string, changed = false) => ({
  bundleId,
  assets: {
    'index.bundle': { fileHash: changed ? newHash : hash, byteSize: 8000, downloadByteSize: 2000 },
    'font.ttf': { fileHash: hash, byteSize: 4000, downloadByteSize: 4000 },
  },
  archive: { downloadFileHash: hash, downloadByteSize: 5000, tarByteSize: 14000 },
});
const artifact: ArtifactInfo = {
  artifactProtocolVersion: 1,
  manifestUrl: 'https://example.test/manifest',
  manifestFileHash: hash,
  archiveUrl: 'https://example.test/bundle.tar.br',
  assets: {
    'index.bundle': {
      fileHash: newHash,
      file: { url: 'https://example.test/index.bundle.br' },
      patch: {
        algorithm: 'bsdiff',
        baseBundleId: baseId,
        baseFileHash: hash,
        patchFileHash: hash,
        patchUrl: 'https://example.test/patch',
        byteSize: 300,
      },
    },
    'font.ttf': { fileHash: hash, file: { url: 'https://example.test/font.ttf' } },
  },
};

describe('pre-consent OTA download size', () => {
  test('uses compressed patch bytes, excludes unchanged assets and keeps archive size separate', () => {
    expect(
      estimateOtaDownloadSize(
        manifest(targetId, true),
        targetId,
        manifest(baseId),
        baseId,
        artifact
      )
    ).toEqual({ estimatedBytes: 300, fullBytes: 5000 });
    const originals = structuredClone(artifact);
    delete originals.assets['index.bundle'].patch;
    expect(
      estimateOtaDownloadSize(
        manifest(targetId, true),
        targetId,
        manifest(baseId),
        baseId,
        originals
      )
    ).toEqual({ estimatedBytes: 2000, fullBytes: 5000 });
  });

  test('uses a smaller archive when multiple changed originals would be downloaded', () => {
    const target = manifest(targetId, true);
    target.assets['font.ttf'].fileHash = newHash;
    const originals = structuredClone(artifact);
    delete originals.assets['index.bundle'].patch;
    originals.assets['font.ttf'].fileHash = newHash;
    expect(estimateOtaDownloadSize(target, targetId, manifest(baseId), baseId, originals)).toEqual({
      estimatedBytes: 5000,
      fullBytes: 5000,
    });
  });

  test('missing base, wrong identity, invalid sizes and missing archive never invent bytes', () => {
    expect(
      estimateOtaDownloadSize(manifest(targetId, true), targetId, null, baseId, artifact)
    ).toEqual({ estimatedBytes: null, fullBytes: 5000 });
    expect(
      estimateOtaDownloadSize(manifest(targetId, true), baseId, null, baseId, artifact)
    ).toEqual({ estimatedBytes: null, fullBytes: null });
    const invalid = manifest(targetId, true);
    invalid.assets['index.bundle'].downloadByteSize = Infinity;
    expect(estimateOtaDownloadSize(invalid, targetId, manifest(baseId), baseId, artifact)).toEqual({
      estimatedBytes: null,
      fullBytes: null,
    });
    const noArchive = { ...artifact, archiveUrl: undefined };
    expect(
      estimateOtaDownloadSize(manifest(targetId, true), targetId, null, baseId, noArchive)
    ).toEqual({ estimatedBytes: null, fullBytes: null });
  });

  test('client binds metadata to the requested release/base and contains failures', async () => {
    const valid = {
      releaseId: targetId,
      fromBundleId: baseId,
      estimatedBytes: 300,
      fullBytes: 5000,
    };
    const request = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain(`/release-download-size/${targetId}?fromBundleId=${baseId}`);
      expect(init?.headers).toEqual({ 'x-api-key': 'client-key' });
      return Response.json(valid);
    };
    expect(await fetchOtaDownloadSize(targetId, baseId, 'client-key', request)).toEqual({
      estimatedBytes: 300,
      fullBytes: 5000,
    });
    for (const payload of [
      { ...valid, releaseId: baseId },
      { ...valid, fromBundleId: targetId },
      { ...valid, estimatedBytes: -1 },
      { ...valid, fullBytes: 0 },
      { ...valid, estimatedBytes: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, privateUri: 'r2://private' },
    ]) {
      expect(
        await fetchOtaDownloadSize(targetId, baseId, 'key', async () => Response.json(payload))
      ).toBeNull();
    }
    expect(
      await fetchOtaDownloadSize(targetId, baseId, 'key', async () => {
        throw new Error('offline');
      })
    ).toBeNull();
  });

  test('server preserves authentication, validates IDs and reads only manifests', async () => {
    const objects = new Map([
      ['r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334455/manifest.json', manifest(baseId)],
      [
        'r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334466/manifest.json',
        manifest(targetId, true),
      ],
    ]);
    const reads: string[] = [];
    const storage = {
      name: 'test',
      protocol: 'r2',
      get: async ({ storageUri }: { storageUri: string }) => {
        reads.push(storageUri);
        return {
          response: objects.has(storageUri) ? Response.json(objects.get(storageUri)) : null,
        };
      },
      getDownloadUrl: async () => ({ url: 'https://example.test/artifact' }),
    };
    const auth = apiKeys();
    const plugin = localizedReleaseNotes(storage);
    const adapter = createMemoryAdapter();
    await migrateCoreSchema(adapter, 'size-test', [auth, plugin]);
    const server = createHotUpdater({
      database: createEngineDatabase({ name: 'size-test', adapter }),
      storage,
      plugins: [auth, plugin],
    });
    const key = Buffer.alloc(32, 1).toString('base64url');
    await server.api.apiKeys.register({ apiKey: key, name: 'size test' });
    const deploy = async (id: string, uri: string) => {
      const [result] = await server.core.deploy([
        {
          bundle: {
            id,
            platform: 'android',
            gitCommitHash: null,
            manifestStorageUri: uri,
            manifestFileHash: hash,
            assetBaseStorageUri: 'r2://test/assets',
          },
          release: {
            channel: 'size-test',
            enabled: true,
            fingerprintHash: 'native-hash',
            message: 'test',
            shouldForceUpdate: false,
            targetAppVersion: null,
          },
        },
      ]);
      if (!result.release) throw new Error('Missing release');
      return result.release.id;
    };
    await deploy(baseId, 'r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334455/manifest.json');
    const releaseId = await deploy(
      targetId,
      'r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334466/manifest.json'
    );
    const request = (from: string, clientKey = key) =>
      server.handlers.client(
        new Request(
          `https://example.test/release-download-size/${releaseId}?fromBundleId=${from}`,
          { headers: { 'x-api-key': clientKey } }
        )
      );
    expect((await request(baseId, 'wrong')).status).toBe(401);
    reads.length = 0;
    expect((await request('invalid')).status).toBe(400);
    expect(reads).toEqual([]);
    const response = await request(baseId);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({
      releaseId,
      fromBundleId: baseId,
      estimatedBytes: 2000,
      fullBytes: 5000,
    });
    expect(
      reads.every(
        (uri) =>
          uri === 'r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334455/manifest.json' ||
          uri === 'r2://test/bundles/0199aabb-ccdd-7a00-8000-001122334466/manifest.json'
      )
    ).toBe(true);
    const unknownBaseId = '0199aabb-ccdd-7a00-8000-001122334477';
    const builtIn = await request(unknownBaseId);
    expect(await builtIn.json()).toEqual({
      releaseId,
      fromBundleId: unknownBaseId,
      estimatedBytes: null,
      fullBytes: 5000,
    });
    const release = await server.core.getRelease(releaseId);
    if (!release) throw new Error('Missing release');
    await server.core.updateReleasePolicy({
      releaseId,
      expectedRevision: release.revision,
      patch: { enabled: false },
    });
    expect((await request(baseId)).status).toBe(404);
  });
});
