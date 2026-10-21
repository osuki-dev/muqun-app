/**
 * The Stage's art log and retry rules, free of React, Skia and storage so
 * `bun test` can load them; `stage-art-diagnostics.ts` is the store built on
 * them.
 *
 * The log is a short ring of what happened to each theme picture on its way
 * into the Stage -- decoded, measured, downsampled, uploaded, drawn -- so a
 * missing illustration can be explained after the fact. It names files by
 * their basename only (theme assets are content hashes) and never by path.
 */

/** Which layer, or which picture before it has a layer, an event is about. */
export type StageArtSlot =
  | 'artwork'
  | 'wallpaper'
  | 'backdrop'
  | 'painting'
  | 'hero'
  | 'frame'
  | 'stage';

export type StageArtStep = 'decode' | 'measure' | 'downsample' | 'upload' | 'render' | 'device';

/**
 * - `ok` -- the step worked.
 * - `fallback` -- it did not, and something simpler stood in (a coarser alpha
 *   rule, the static stage, a plain image).
 * - `failed` -- it did not, and it will be tried again when Home returns.
 * - `retry` -- that next try started.
 * - `gave-up` -- out of tries for this session.
 */
export type StageArtStatus = 'ok' | 'fallback' | 'failed' | 'retry' | 'gave-up';

export type StageArtEvent = {
  /** Epoch milliseconds. */
  at: number;
  slot: StageArtSlot;
  step: StageArtStep;
  status: StageArtStatus;
  /** `<theme id>@<version>`, when a custom theme is applied. */
  theme?: string;
  /** The picture's basename. */
  file?: string;
  /** `<width>x<height>` of the decoded picture, or of the texture made from it. */
  size?: string;
  /** The texture cap the step used, in pixels. */
  maxEdge?: number;
  /** Failures of this picture so far this session. */
  attempt?: number;
  quality?: string;
  /** Skia's GPU device was lost (or never available) when this was recorded. */
  gpuLost: boolean;
  error?: string;
  /** How many identical events in a row this one stands for. */
  repeat?: number;
};

export const STAGE_ART_LOG_LIMIT = 30;
/** How many times a session retries one picture after it first fails. */
export const STAGE_ART_RETRIES = 3;
/** Retries halve the texture cap down to this. */
export const STAGE_ART_MIN_EDGE = 256;
const ERROR_LENGTH = 160;
const FILE_LENGTH = 72;

/** The last segment of `uri`, without a query or fragment; never a path. */
export function stageArtFileName(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const bare = uri.split(/[?#]/, 1)[0] ?? '';
  const name = bare.slice(bare.lastIndexOf('/') + 1);
  if (!name) return undefined;
  return name.length > FILE_LENGTH ? `${name.slice(0, FILE_LENGTH - 1)}…` : name;
}

/** An error's message on one line, cut to a readable length. */
export function stageArtErrorText(error: unknown): string | undefined {
  if (error === undefined || error === null) return undefined;
  const raw =
    error instanceof Error ? error.message || error.name : typeof error === 'string' ? error : '';
  const text = (raw || String(error)).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > ERROR_LENGTH ? `${text.slice(0, ERROR_LENGTH - 1)}…` : text;
}

const sameEvent = (a: StageArtEvent, b: StageArtEvent) =>
  a.slot === b.slot &&
  a.step === b.step &&
  a.status === b.status &&
  a.file === b.file &&
  a.error === b.error &&
  a.gpuLost === b.gpuLost;

/**
 * `events` (oldest first) with `event` added: a repeat of the newest event
 * folds into it, counted, and the oldest fall off past `limit`.
 */
export function appendStageArtEvent(
  events: readonly StageArtEvent[],
  event: StageArtEvent,
  limit = STAGE_ART_LOG_LIMIT
): StageArtEvent[] {
  const last = events.at(-1);
  if (last && sameEvent(last, event)) {
    return [...events.slice(0, -1), { ...event, repeat: (last.repeat ?? 1) + 1 }];
  }
  const next = [...events, event];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** A persisted log read back; anything malformed is dropped rather than trusted. */
export function parseStageArtLog(raw: string | undefined, limit = STAGE_ART_LOG_LIMIT) {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is StageArtEvent =>
          typeof item === 'object' &&
          item !== null &&
          typeof item.at === 'number' &&
          typeof item.slot === 'string' &&
          typeof item.step === 'string' &&
          typeof item.status === 'string'
      )
      .slice(-limit);
  } catch {
    return [];
  }
}

/** One line per event, newest first: what the Copy button puts on the clipboard. */
export function formatStageArtLog(events: readonly StageArtEvent[]): string {
  return [...events]
    .reverse()
    .map((event) =>
      [
        new Date(event.at).toISOString(),
        `${event.slot}/${event.step}`,
        event.status,
        event.repeat ? `x${event.repeat}` : null,
        event.theme ? `theme=${event.theme}` : null,
        event.file ? `file=${event.file}` : null,
        event.size ? `size=${event.size}` : null,
        event.maxEdge ? `edge=${event.maxEdge}` : null,
        event.attempt ? `attempt=${event.attempt}` : null,
        event.quality ? `quality=${event.quality}` : null,
        event.gpuLost ? 'gpu-lost' : null,
        event.error ? `error="${event.error}"` : null,
      ]
        .filter(Boolean)
        .join(' ')
    )
    .join('\n');
}

/**
 * Whether a picture that failed should be tried again now: only once Home has
 * come back since the failure (`epoch` moved on), and only `limit` times a
 * session. `failures` counts every failure so far, the first included.
 */
export function stageArtShouldRetry({
  failures,
  failedEpoch,
  epoch,
  limit = STAGE_ART_RETRIES,
}: {
  failures: number;
  failedEpoch: number;
  epoch: number;
  limit?: number;
}): boolean {
  return failures > 0 && failures <= limit && epoch > failedEpoch;
}

/** The texture cap for the next try: halved for every failure so far, never below the floor. */
export function stageArtRetryEdge(
  maxEdge: number,
  failures: number,
  floor = STAGE_ART_MIN_EDGE
): number {
  const base = Math.max(1, Math.round(maxEdge));
  if (failures <= 0) return base;
  return Math.min(base, Math.max(floor, Math.round(base / 2 ** failures)));
}
