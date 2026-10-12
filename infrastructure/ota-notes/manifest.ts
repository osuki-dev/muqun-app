import { OTA_NOTES_MAX_LENGTH, otaNotesLocale } from '../../src/lib/ota-release-notes';

/** Locale-to-Markdown input, validated before any build or remote mutation. */
export function parseOtaNotesManifest(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('OTA notes must be a locale-to-Markdown JSON object');
  const entries = Object.entries(input);
  if (!entries.length || entries.length > 32) throw new Error('OTA notes require 1–32 locales');
  const notes: Record<string, string> = {};
  for (const [locale, markdown] of entries) {
    const normalized = otaNotesLocale(locale);
    if (!normalized || Object.hasOwn(notes, normalized))
      throw new Error('Invalid or duplicate OTA notes locale');
    if (typeof markdown !== 'string' || !markdown.trim() || markdown.length > OTA_NOTES_MAX_LENGTH)
      throw new Error('OTA notes must contain nonempty Markdown within the size limit');
    notes[normalized] = markdown.trim();
  }
  if (!notes.en) throw new Error('OTA notes require an English fallback');
  return notes;
}
