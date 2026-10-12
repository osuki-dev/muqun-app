/** Public, bounded wire format: a response contains exactly one resolved locale. */
export const OTA_NOTES_MAX_LENGTH = 16_000;
export const OTA_RELEASE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function otaNotesLocale(locale: string): string | null {
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8}){0,3}$/i.test(locale)) return null;
  return locale.toLowerCase();
}

export function otaNotesFallbacks(locale: string): string[] {
  const normalized = otaNotesLocale(locale);
  if (!normalized) return ['en'];
  return [...new Set([normalized, normalized.split('-')[0], 'en'])];
}

export type OtaReleaseNote = { releaseId: string; locale: string; markdown: string };

export async function fetchOtaReleaseNote(
  releaseId: string,
  locale: string,
  clientApiKey: string,
  request: typeof fetch = fetch
): Promise<OtaReleaseNote | null> {
  if (!OTA_RELEASE_ID.test(releaseId) || !otaNotesLocale(locale)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(
      `https://updates.muqun.dev/release-notes/${releaseId}?locale=${encodeURIComponent(locale)}`,
      { headers: { 'x-api-key': clientApiKey }, signal: controller.signal }
    );
    if (!response.ok) return null;
    const note: unknown = await response.json();
    if (!note || typeof note !== 'object' || Object.keys(note).length !== 3) return null;
    const {
      releaseId: returnedId,
      locale: resolvedLocale,
      markdown,
    } = note as Record<string, unknown>;
    if (
      returnedId !== releaseId ||
      typeof resolvedLocale !== 'string' ||
      !otaNotesFallbacks(locale).includes(resolvedLocale) ||
      typeof markdown !== 'string' ||
      !markdown.trim() ||
      markdown.length > OTA_NOTES_MAX_LENGTH
    )
      return null;
    return { releaseId, locale: resolvedLocale, markdown };
  } catch {
    // The catalog's English message remains usable during notes API outages.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchOtaReleaseNotes(
  releaseId: string,
  locale: string,
  clientApiKey: string,
  request: typeof fetch = fetch
): Promise<string | null> {
  return (await fetchOtaReleaseNote(releaseId, locale, clientApiKey, request))?.markdown ?? null;
}
