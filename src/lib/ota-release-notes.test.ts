import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEngineDatabase,
  createMemoryAdapter,
  generateEngineSql,
  migrateCoreSchema,
  toolingTargetOf,
} from '@hot-updater/plugin-core';
import { createHotUpdater } from '@hot-updater/server';
import { apiKeys } from '@hot-updater/server/plugins';
import { localizedReleaseNotes } from '../../infrastructure/ota-notes/plugin';
import { parseOtaNotesManifest } from '../../infrastructure/ota-notes/manifest';
import {
  deployedOtaReleaseId,
  finishOtaPublication,
  nativeOtaFingerprintHash,
  publishOtaNotesAndEnable,
  recordOtaPublicationFailure,
} from '../../scripts/publish-ota-notes';
import {
  fetchOtaReleaseNote,
  fetchOtaReleaseNotes,
  OTA_NOTES_MAX_LENGTH,
  otaNotesFallbacks,
} from './ota-release-notes';

const clientKey = Buffer.alloc(32, 1).toString('base64url');
const artifactId = '0199aabb-ccdd-7a00-8000-001122334455';
const notes = {
  en: '## Fixed\n- Restore drafts',
  zh: '## 修复\n- 恢复草稿',
  'zh-tw': '## 修正\n- 還原草稿',
};
const target = {
  channel: 'ota-test',
  platform: 'android',
  fingerprintHash: 'native-hash',
} as const;

async function fixture(
  fingerprintHash: string = target.fingerprintHash,
  platform: 'android' | 'ios' = 'android'
) {
  const auth = apiKeys();
  const plugin = localizedReleaseNotes();
  const adapter = createMemoryAdapter();
  await migrateCoreSchema(adapter, 'notes-test', [auth, plugin]);
  const server = createHotUpdater({
    database: createEngineDatabase({ name: 'notes-test', adapter }),
    storage: {
      name: 'test',
      protocol: 'r2',
      get: async () => ({ response: null }),
      getDownloadUrl: async () => ({ url: 'https://example.test/manifest' }),
    },
    plugins: [auth, plugin],
  });
  await server.api.apiKeys.register({ apiKey: clientKey, name: 'notes test' });
  const [result] = await server.core.deploy([
    {
      bundle: {
        id: artifactId,
        platform,
        gitCommitHash: null,
        manifestStorageUri: 'r2://test/manifest',
        manifestFileHash: 'a'.repeat(64),
        assetBaseStorageUri: 'r2://test/assets',
      },
      release: {
        channel: target.channel,
        enabled: false,
        fingerprintHash,
        message: notes.en,
        shouldForceUpdate: true,
        targetAppVersion: null,
      },
    },
  ]);
  if (!result.release) throw new Error('Missing test release');
  const release = result.release;
  const api = {
    publish: server.api.localized_release_notes.publish,
    get: (id: string, locale: string) =>
      fetchOtaReleaseNote(id, locale, clientKey, async (input, init) =>
        server.handlers.client(new Request(input, init))
      ),
  };
  const request = (locale: string, key = clientKey) =>
    server.handlers.client(
      new Request(`https://example.test/release-notes/${release.id}?locale=${locale}`, {
        headers: { 'x-api-key': key },
      })
    );
  return { server, release, api, request };
}

describe('localized OTA notes publication', () => {
  test('uses only the selected platform hash from a real native archive structure', async () => {
    const archive = {
      android: { sources: [{ type: 'dir', filePath: 'android' }], hash: 'a'.repeat(40) },
      ios: { sources: [{ type: 'dir', filePath: 'ios' }], hash: 'b'.repeat(40) },
    };
    for (const platform of ['android', 'ios'] as const) {
      const hash = nativeOtaFingerprintHash(archive, platform);
      expect(hash).toBe(archive[platform].hash);
      const f = await fixture(hash, platform);
      const wrongHash = archive[platform === 'ios' ? 'android' : 'ios'].hash;
      await expect(
        publishOtaNotesAndEnable(f.server.core, f.api, f.release.id, notes, {
          ...target,
          platform,
          fingerprintHash: wrongHash,
        })
      ).rejects.toThrow('exact disabled release');
      expect(await f.api.get(f.release.id, 'en')).toBeNull();
      await publishOtaNotesAndEnable(f.server.core, f.api, f.release.id, notes, {
        ...target,
        platform,
        fingerprintHash: hash,
      });
      expect((await f.server.core.getRelease(f.release.id))?.enabled).toBe(true);
    }
  });

  test('rejects missing or malformed selected platform fingerprints without root or other-platform fallback', () => {
    for (const archive of [
      null,
      [],
      { hash: 'a'.repeat(40), sources: [] },
      { ios: { hash: 'a'.repeat(40), sources: [] } },
      { android: null },
      { android: [] },
      { android: { sources: {}, hash: 'a'.repeat(40) } },
      ...['', ' ', 'not-a-hash', ` ${'a'.repeat(40)}`, 'a'.repeat(129), 1].map((hash) => ({
        android: { sources: [], hash },
      })),
    ])
      expect(() => nativeOtaFingerprintHash(archive, 'android')).toThrow();
  });

  test('retains private failed-run evidence and contains cleanup exceptions', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'muqun-ota-log-test-'));
    const logPath = join(workspace, 'deploy.log');
    try {
      writeFileSync(logPath, 'private CLI output', { mode: 0o600 });
      recordOtaPublicationFailure(
        logPath,
        'disabled deployment',
        new Error('private provider details')
      );
      let disposed = false;
      expect(
        await finishOtaPublication(workspace, false, [
          async () => {
            throw new Error('private flush details');
          },
          async () => {
            disposed = true;
          },
        ])
      ).toBe(false);
      expect(disposed).toBe(true);
      expect(statSync(workspace).mode & 0o777).toBe(0o700);
      expect(statSync(logPath).mode & 0o777).toBe(0o600);
      expect(readFileSync(logPath, 'utf8')).toContain('private provider details');
      expect(readFileSync(logPath, 'utf8')).toContain('private flush details');
      expect(
        await finishOtaPublication(workspace, true, [
          async () => {
            throw new Error('cleanup failed after enablement');
          },
        ])
      ).toBe(false);
      expect(existsSync(logPath)).toBe(true);
      expect(await finishOtaPublication(workspace, true, [async () => {}])).toBe(true);
      expect(existsSync(workspace)).toBe(false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test('validates the complete local manifest before publishing', () => {
    expect(parseOtaNotesManifest({ en: ' notes ', 'zh-TW': ' 筆記 ' })).toEqual({
      en: 'notes',
      'zh-tw': '筆記',
    });
    for (const input of [
      null,
      [],
      {},
      { ja: 'notes' },
      { en: '' },
      { en: 'x'.repeat(OTA_NOTES_MAX_LENGTH + 1) },
      { en: 'notes', EN: 'duplicate' },
      { en: 'notes', '../de': 'invalid' },
    ])
      expect(() => parseOtaNotesManifest(input)).toThrow();
  });

  test('pins the migration to the plugin schema', () => {
    const targetSchema = toolingTargetOf([localizedReleaseNotes()]);
    const sql = generateEngineSql('sqlite', targetSchema.schema, targetSchema.settings)
      .filter((statement) => statement.includes('localized_release_notes'))
      .map((statement) => `${statement};`)
      .join('\n\n');
    expect(
      readFileSync(new URL('../../infrastructure/ota-notes/migration.sql', import.meta.url), 'utf8')
    ).toContain(sql);
  });

  test('reads one exact/language/English note behind client authentication', async () => {
    const f = await fixture();
    expect((await f.request('zh-TW')).status).toBe(404);
    await publishOtaNotesAndEnable(f.server.core, f.api, f.release.id, notes, target);
    expect((await f.request('zh-TW', 'wrong-key')).status).toBe(401);
    for (const [requested, resolved] of [
      ['zh-TW', 'zh-tw'],
      ['zh-CN', 'zh'],
      ['ja', 'en'],
    ]) {
      const response = await f.request(requested);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        releaseId: f.release.id,
        locale: resolved,
        markdown: notes[resolved as keyof typeof notes],
      });
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect((await f.server.core.getRelease(f.release.id))?.message).toBe(notes.en);
    expect((await f.request('../en')).status).toBe(400);
    expect(
      (
        await f.server.handlers.client(
          new Request(`https://example.test/release-notes/${f.release.id}`, {
            method: 'POST',
            headers: { 'x-api-key': clientKey },
          })
        )
      ).status
    ).toBe(404);
  });

  test('notes failure leaves the release disabled', async () => {
    const f = await fixture();
    await expect(
      publishOtaNotesAndEnable(
        f.server.core,
        { ...f.api, get: async () => null },
        f.release.id,
        notes,
        target
      )
    ).rejects.toThrow('readback');
    expect((await f.server.core.getRelease(f.release.id))?.enabled).toBe(false);
    // Known disabled IDs can be verified without adding the release to a catalog.
    expect((await f.request('zh')).status).toBe(200);
    await expect(
      f.api.publish(f.release.id, f.release.revision, { ...notes, zh: 'replacement' })
    ).rejects.toThrow('different content');
    expect((await f.api.get(f.release.id, 'zh'))?.markdown).toBe(notes.zh);
  });

  test('rejects wrong platform or fingerprint before uploading notes', async () => {
    const f = await fixture();
    for (const wrong of [
      { ...target, platform: 'ios' as const },
      { ...target, fingerprintHash: 'wrong' },
    ])
      await expect(
        publishOtaNotesAndEnable(f.server.core, f.api, f.release.id, notes, wrong)
      ).rejects.toThrow('exact disabled release');
    expect(await f.api.get(f.release.id, 'en')).toBeNull();
  });

  test('concurrent release changes refuse enablement with the original revision', async () => {
    const f = await fixture();
    const api = {
      ...f.api,
      publish: async (...args: Parameters<typeof f.api.publish>) => {
        await f.api.publish(...args);
        await f.server.core.updateReleasePolicy({
          releaseId: f.release.id,
          expectedRevision: f.release.revision,
          patch: { shouldForceUpdate: false },
        });
      },
    };
    await expect(
      publishOtaNotesAndEnable(f.server.core, api, f.release.id, notes, target)
    ).rejects.toThrow();
    expect((await f.server.core.getRelease(f.release.id))?.enabled).toBe(false);
  });

  test('accepts only a single full CLI deployment receipt', () => {
    const receipt = `└ Deployment successful\n    ID:       ${artifactId}\n`;
    expect(deployedOtaReleaseId(receipt)).toBe(artifactId);
    expect(() => deployedOtaReleaseId(`${receipt}${receipt}`)).toThrow();
    expect(() => deployedOtaReleaseId(`Build ID: ${artifactId}`)).toThrow();
    expect(() => deployedOtaReleaseId('Deployment successful\nID: truncated')).toThrow();
  });
});

describe('OTA notes client', () => {
  test('requests exactly one active locale and accepts its resolved English fallback', async () => {
    const requests: string[] = [];
    const request: typeof fetch = async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit
    ) => {
      requests.push(String(input));
      expect(init?.headers).toEqual({ 'x-api-key': 'public-key' });
      return Response.json({ releaseId: artifactId, locale: 'en', markdown: notes.en });
    };
    expect(await fetchOtaReleaseNotes(artifactId, 'zh-TW', 'public-key', request)).toBe(notes.en);
    expect(requests).toEqual([
      `https://updates.muqun.dev/release-notes/${artifactId}?locale=zh-TW`,
    ]);
    expect(otaNotesFallbacks('zh-TW')).toEqual(['zh-tw', 'zh', 'en']);
  });

  test('rejects unrelated release identities/locales, empty or oversized notes and outages', async () => {
    for (const payload of [
      { releaseId: 'other', locale: 'en', markdown: notes.en },
      { releaseId: artifactId, locale: 'de', markdown: notes.en },
      { releaseId: artifactId, locale: 'en', markdown: '' },
      { releaseId: artifactId, locale: 'en', markdown: 'x'.repeat(OTA_NOTES_MAX_LENGTH + 1) },
    ]) {
      const request = async () => Response.json(payload);
      expect(await fetchOtaReleaseNotes(artifactId, 'zh-TW', 'key', request)).toBeNull();
    }
    const request = async () => {
      throw new Error('offline');
    };
    expect(await fetchOtaReleaseNotes(artifactId, 'en', 'key', request)).toBeNull();
  });
});
