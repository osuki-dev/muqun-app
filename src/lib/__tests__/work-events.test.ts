import { describe, expect, test } from 'bun:test';
import { consumeWorkEventStream, type WorkStreamResponse } from '../work-events';
import { EncryptedEventStreamDecryptor } from '../sse-record';

const taskId = '00000000-0000-4000-8000-000000000001';
const foreignId = '00000000-0000-4000-8000-000000000002';
const page = (cursor: number, id = taskId, reset = false) => ({
  changes: reset
    ? []
    : [{ cursor, task_id: id, revision: cursor, kind: 'operation_changed', entity_id: id }],
  cursor,
  reset_required: reset,
});
const frame = (event: string, data: unknown) =>
  new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
function fixture(chunks: Uint8Array[], encrypted = false) {
  let canceled = 0;
  let opens = 0;
  let signal: AbortSignal | undefined;
  const response: WorkStreamResponse = {
    ok: true,
    headers: {
      get: (name) =>
        name === 'content-type'
          ? 'text/event-stream'
          : name === 'x-muqun-transport' && encrypted
            ? '1'
            : null,
    },
    body: {
      getReader: () => ({
        read: async () => {
          const value = chunks.shift();
          return { done: !value, value };
        },
        cancel: async () => {
          canceled++;
        },
      }),
    },
  };
  const changes: number[] = [];
  const resets: number[] = [];
  let unavailable = 0;
  return {
    response,
    options: {
      afterCursor: 0,
      decoder: new TextDecoder(),
      isCurrent: () => true,
      open: async (value: AbortSignal) => {
        opens++;
        signal = value;
        return response;
      },
      onChanges: (value: { cursor: number }) => {
        changes.push(value.cursor);
      },
      onReset: (value: { cursor: number }) => {
        resets.push(value.cursor);
      },
      onUnavailable: () => {
        unavailable++;
      },
    },
    state: () => ({ canceled, opens, aborted: signal?.aborted, changes, resets, unavailable }),
  };
}

describe('bound work event lifecycle', () => {
  test('task details ignore foreign-task notices while advancing the session cursor', async () => {
    const test = fixture([
      frame('work.changes', page(1, foreignId)),
      frame('work.changes', page(2)),
    ]);
    await consumeWorkEventStream({ ...test.options, taskId });
    expect(test.state().changes).toEqual([2]);
    expect(test.state().opens).toBe(1);
    expect(test.state().canceled).toBe(1);
    expect(test.state().aborted).toBe(true);
  });

  test('scope change while a response is in flight suppresses all callbacks', async () => {
    const test = fixture([frame('work.changes', page(1))]);
    let current = true;
    await consumeWorkEventStream({
      ...test.options,
      isCurrent: () => current,
      open: async (signal) => {
        const response = await test.options.open(signal);
        current = false;
        return response;
      },
    });
    expect(test.state().changes).toEqual([]);
    expect(test.state().canceled).toBe(1);
  });

  test('abort releases a pending open without waiting for the server and cancels a late body', async () => {
    const test = fixture([]);
    const controller = new AbortController();
    let resolveOpen: (value: WorkStreamResponse) => void = () => undefined;
    const pending = consumeWorkEventStream({
      ...test.options,
      signal: controller.signal,
      open: () =>
        new Promise((resolve) => {
          resolveOpen = resolve;
        }),
    });
    controller.abort();
    await pending;
    resolveOpen(test.response);
    await Promise.resolve();
    expect(test.state().canceled).toBe(1);
  });

  test('abort cancels a stalled reader with no automatic reconnect', async () => {
    const test = fixture([]);
    const controller = new AbortController();
    let reading: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let canceled = 0;
    const response: WorkStreamResponse = {
      ...test.response,
      body: {
        getReader: () => ({
          read: () => {
            reading();
            return new Promise(() => undefined);
          },
          cancel: async () => {
            canceled++;
          },
        }),
      },
    };
    const pending = consumeWorkEventStream({
      ...test.options,
      signal: controller.signal,
      open: async () => response,
    });
    await started;
    controller.abort();
    await pending;
    expect(canceled > 0).toBe(true);
    expect(test.state().changes).toEqual([]);
  });

  test('reset and unavailable notify once, close and never consume later messages', async () => {
    const reset = fixture([
      frame('work.reset', page(0, taskId, true)),
      frame('work.changes', page(1)),
    ]);
    await consumeWorkEventStream(reset.options);
    expect(reset.state().resets).toEqual([0]);
    expect(reset.state().changes).toEqual([]);
    const unavailable = fixture([frame('work.unavailable', {}), frame('work.changes', page(1))]);
    await consumeWorkEventStream(unavailable.options);
    expect(unavailable.state().unavailable).toBe(1);
    expect(unavailable.state().changes).toEqual([]);
  });

  test('an invalid sealed record poisons the stream and releases the reader', async () => {
    const test = fixture(
      [frame('muqun.encrypted', { v: 1, sid: 'stream', seq: 0, ciphertext: 'bad' })],
      true
    );
    const decryptor = new EncryptedEventStreamDecryptor({
      material: new Uint8Array(32),
      requestAad: 'GET /captured',
      requestNonce: 'one',
      crypto: {
        hkdf: () => new Uint8Array(32),
        open: () => {
          throw new Error('Invalid authentication tag');
        },
        fromBase64Url: () => new Uint8Array(16),
      },
    });
    await expect(consumeWorkEventStream({ ...test.options, decryptor })).rejects.toThrow();
    expect(test.state().canceled).toBe(1);
    expect(test.state().opens).toBe(1);
    expect(test.state().changes).toEqual([]);
  });

  test('plaintext cannot bypass encryption and cursor replay cannot trigger duplicate notices', async () => {
    const plaintext = fixture([frame('work.changes', page(1))], true);
    await expect(
      consumeWorkEventStream({
        ...plaintext.options,
        decryptor: {
          open: () => {
            throw new Error('Must not be called');
          },
        },
      })
    ).rejects.toThrow();
    const replay = fixture([frame('work.changes', page(1)), frame('work.changes', page(1))]);
    await expect(consumeWorkEventStream(replay.options)).rejects.toThrow();
    expect(replay.state().changes).toEqual([1]);
  });
});
