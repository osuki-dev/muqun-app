import type { WorkTransport } from './work-api';

/** Translate authored demo summaries, never real agent results or immutable evidence. */
export function localizeDemoWorkResponse(
  response: Awaited<ReturnType<WorkTransport>>,
  translateSummary: (source: string) => string
): Awaited<ReturnType<WorkTransport>> {
  function visit(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === 'summary' && typeof entry === 'string' ? translateSummary(entry) : visit(entry),
      ])
    );
  }
  return { ...response, body: visit(response.body) };
}
