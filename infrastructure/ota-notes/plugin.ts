import { definePlugin, defineTable } from '@hot-updater/plugin-core';
import {
  OTA_RELEASE_ID,
  otaNotesFallbacks,
  otaNotesLocale,
  type OtaReleaseNote,
} from '../../src/lib/ota-release-notes';
import { parseOtaNotesManifest } from './manifest';

export function localizedReleaseNotes() {
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
      return {
        api: { get, publish },
        endpoints: [
          {
            method: 'GET',
            path: '/release-notes/:releaseId',
            access: 'client',
            handler: async (request, params) => {
              const locale = new URL(request.url).searchParams.get('locale');
              if (
                !locale ||
                !otaNotesLocale(locale) ||
                !OTA_RELEASE_ID.test(params.releaseId ?? '')
              )
                return new Response(null, { status: 400 });
              const release = await core.getRelease(params.releaseId);
              // Disabled releases stay out of the catalog; known IDs can be read
              // through client authentication for verification before enablement.
              if (!release) return new Response(null, { status: 404 });
              const note = await get(params.releaseId, locale);
              return note
                ? Response.json(note, { headers: { 'Cache-Control': 'private, no-store' } })
                : new Response(null, { status: 404 });
            },
          },
        ],
      };
    },
  });
}
