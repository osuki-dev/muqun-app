import { definePlugin, defineTable, type StorageAdapter } from '@hot-updater/plugin-core';
import { estimateOtaDownloadSize } from './download-size';
import {
  OTA_RELEASE_ID,
  otaNotesFallbacks,
  otaNotesLocale,
  type OtaReleaseNote,
} from '../../src/lib/ota-release-notes';
import { parseOtaNotesManifest } from './manifest';

export function localizedReleaseNotes(storage?: Pick<StorageAdapter, 'get'>) {
  return definePlugin({
    id: 'localized_release_notes',
    schemaVersion: '1',
    schema: {
      notes: defineTable(
        {
          release_id: { type: 'string', maxLength: 36, ascii: true },
          locale: { type: 'string', maxLength: 32, ascii: true },
          markdown: { type: 'string' },
        },
        { key: ['release_id', 'locale'] }
      ),
    },
    init({ db, core }) {
      async function get(releaseId: string, locale: string): Promise<OtaReleaseNote | null> {
        if (!OTA_RELEASE_ID.test(releaseId) || !otaNotesLocale(locale)) return null;
        // A single response includes only the first matching translation.
        for (const candidate of otaNotesFallbacks(locale)) {
          const note = await db.findOne('notes', { release_id: releaseId, locale: candidate });
          if (note) return { releaseId, locale: note.locale, markdown: note.markdown };
        }
        return null;
      }
      async function publish(releaseId: string, expectedRevision: number, input: unknown) {
        const notes = parseOtaNotesManifest(input);
        if (!OTA_RELEASE_ID.test(releaseId)) throw new Error('Invalid OTA release identity');
        const release = await core.getRelease(releaseId);
        if (
          !release ||
          release.enabled ||
          release.revision !== expectedRevision ||
          release.message !== notes.en
        )
          throw new Error(
            'OTA notes require the exact disabled release revision and English message'
          );
        await db.transaction(async (tx) => {
          for (const [locale, markdown] of Object.entries(notes)) {
            const existing = await tx.findOne('notes', { release_id: releaseId, locale });
            // Notes are immutable: a concurrent publisher cannot replace reviewed content.
            if (existing && existing.markdown !== markdown)
              throw new Error('OTA release notes already exist with different content');
            // Hot Updater 1.0.0 create() synchronously stages the row; the
            // enclosing transaction promise resolves only after commit.
            if (!existing) tx.create('notes', { release_id: releaseId, locale, markdown });
          }
        });
      }
      async function readManifest(storageUri: string): Promise<unknown> {
        const response = (await storage?.get?.({ storageUri }))?.response;
        if (!response?.ok || !response.body) return null;
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.byteLength;
            if (length > 2 * 1024 * 1024) return null;
            chunks.push(value);
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        } catch {
          return null;
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      }
      return {
        api: { get, publish },
        endpoints: [
          {
            method: 'GET',
            path: '/release-download-size/:releaseId',
            access: 'client',
            handler: async (request, params) => {
              const headers = { 'Cache-Control': 'private, no-store' };
              const fromBundleId = new URL(request.url).searchParams.get('fromBundleId');
              const releaseId = params.releaseId ?? '';
              if (
                !fromBundleId ||
                !OTA_RELEASE_ID.test(fromBundleId) ||
                !OTA_RELEASE_ID.test(releaseId)
              )
                return new Response(null, { status: 400, headers });
              try {
                const release = await core.getRelease(releaseId);
                if (!release?.enabled) return new Response(null, { status: 404, headers });
                if (!release.bundle_id) return new Response(null, { status: 503, headers });
                const [target, base] = await Promise.all([
                  core.getBundle(release.bundle_id),
                  core.getBundle(fromBundleId),
                ]);
                if (!target) return new Response(null, { status: 503, headers });
                if (base && base.bundle.platform !== target.bundle.platform)
                  return new Response(null, { status: 404, headers });
                // Resolve the SDK's optional patch plan, but return no signed URLs or storage URIs.
                const [artifact, targetManifest, baseManifest] = await Promise.all([
                  core.getArtifactInfo(release.bundle_id, fromBundleId, 1),
                  readManifest(target.bundle.manifest_storage_uri),
                  base ? readManifest(base.bundle.manifest_storage_uri) : Promise.resolve(null),
                ]);
                if (!artifact) return new Response(null, { status: 503, headers });
                const size = estimateOtaDownloadSize(
                  targetManifest,
                  release.bundle_id,
                  baseManifest,
                  fromBundleId,
                  artifact
                );
                if (!size) return new Response(null, { status: 503, headers });
                return Response.json({ releaseId, fromBundleId, ...size }, { headers });
              } catch {
                return new Response(null, { status: 503, headers });
              }
            },
          },
          {
            method: 'GET',
            path: '/release-notes/:releaseId',
            access: 'client',
            handler: async (request, params) => {
              // Missing notes must not survive publication in a shared cache.
              const headers = { 'Cache-Control': 'private, no-store' };
              const locale = new URL(request.url).searchParams.get('locale');
              if (
                !locale ||
                !otaNotesLocale(locale) ||
                !OTA_RELEASE_ID.test(params.releaseId ?? '')
              )
                return new Response(null, { status: 400, headers });
              const release = await core.getRelease(params.releaseId);
              // Disabled releases stay out of the catalog; known IDs can be read
              // through client authentication for verification before enablement.
              if (!release) return new Response(null, { status: 404, headers });
              const note = await get(params.releaseId, locale);
              return note
                ? Response.json(note, { headers })
                : new Response(null, { status: 404, headers });
            },
          },
        ],
      };
    },
  });
}
