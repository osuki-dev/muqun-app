import { parseWorkChanges, type WorkChangePage } from './work-api';
import { ENCRYPTED_SSE_EVENT, type DecryptedStreamEvent } from './sse-record';
import { ServerSentEventParser } from './sse-stream';

export type WorkEventObserver = {
  isCurrent: () => boolean;
  signal?: AbortSignal;
  /** A task detail only needs notifications for this task; list views omit it. */
  taskId?: string;
  onChanges: (page: WorkChangePage) => void;
  onReset: (page: WorkChangePage) => void;
  onUnavailable: () => void;
};
export type WorkStreamResponse = {
  ok: boolean;
  headers: { get: (name: string) => string | null };
  body: {
    getReader: () => {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
      cancel: () => Promise<unknown>;
    };
  } | null;
};

/** One connection only. Its owner decides when to create a new encrypted request. */
export async function consumeWorkEventStream(
  options: WorkEventObserver & {
    afterCursor: number;
    open: (signal: AbortSignal) => Promise<WorkStreamResponse>;
    decoder: { decode: (value: Uint8Array, options: { stream: boolean }) => string };
    decryptor?: { open: (data: string) => DecryptedStreamEvent };
  }
): Promise<void> {
  if (!Number.isSafeInteger(options.afterCursor) || options.afterCursor < 0)
    throw new Error('Invalid work event cursor.');
  const controller = new AbortController();
  const isCurrent = () =>
    !controller.signal.aborted && !options.signal?.aborted && options.isCurrent();
  let reader: ReturnType<NonNullable<WorkStreamResponse['body']>['getReader']> | undefined;
  let releaseAbort: (() => void) | undefined;
  const aborted = new Promise<null>((resolve) => {
    releaseAbort = () => resolve(null);
  });
  const abort = () => {
    controller.abort();
    releaseAbort?.();
    if (reader) void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (!isCurrent()) return;
    const opened = options.open(controller.signal).then((response) => {
      if (!isCurrent()) {
        const lateReader = response.body?.getReader();
        if (lateReader) void lateReader.cancel().catch(() => undefined);
        return null;
      }
      return response;
    });
    const response = await Promise.race([opened, aborted]);
    if (!response || !isCurrent()) return;
    if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream'))
      throw new Error('The Gateway did not provide a work event stream.');
    if (options.decryptor && response.headers.get('x-muqun-transport') !== '1')
      throw new Error('The Gateway did not provide an encrypted work event stream.');
    reader = response.body?.getReader();
    if (!reader) throw new Error('The work event stream has no readable body.');
    const parser = new ServerSentEventParser();
    let cursor = options.afterCursor;
    let bytesWithoutBoundary = 0;
    while (isCurrent()) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (!chunk || !isCurrent() || chunk.done) break;
      if (!chunk.value) continue;
      bytesWithoutBoundary += chunk.value.byteLength;
      // Bound an unterminated/malformed frame before the shared parser buffers it.
      if (bytesWithoutBoundary > 1024 * 1024) throw new Error('Work event frame is too large.');
      const events = parser.push(options.decoder.decode(chunk.value, { stream: true }));
      if (events.length) bytesWithoutBoundary = 0;
      for (const event of events) {
        if (!isCurrent()) return;
        if (options.decryptor && event.event !== ENCRYPTED_SSE_EVENT)
          throw new Error('Plaintext received on an encrypted work event stream.');
        const opened = options.decryptor ? options.decryptor.open(event.data) : event;
        if (opened.event === 'work.unavailable') {
          const value: unknown = JSON.parse(opened.data);
          if (
            !value ||
            typeof value !== 'object' ||
            Array.isArray(value) ||
            Object.keys(value).length
          )
            throw new Error('Invalid work unavailable event.');
          options.onUnavailable();
          return;
        }
        if (opened.event !== 'work.changes' && opened.event !== 'work.reset') continue;
        const page = parseWorkChanges(JSON.parse(opened.data), cursor);
        if (page.changes.length > 100 || (opened.event === 'work.reset') !== page.reset_required)
          throw new Error('Invalid work change event.');
        cursor = page.cursor;
        if (page.reset_required) {
          options.onReset(page);
          return;
        }
        if (
          page.changes.length &&
          (!options.taskId || page.changes.some((change) => change.task_id === options.taskId))
        )
          options.onChanges(page);
      }
    }
  } catch (error) {
    if (isCurrent()) throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    abort();
  }
}
