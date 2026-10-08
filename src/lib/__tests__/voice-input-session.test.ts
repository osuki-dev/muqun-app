import { expect, test } from 'bun:test';
import { VoiceRecordingSession, type VoiceRecordingRuntime } from '../voice-input-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(overrides: Partial<VoiceRecordingRuntime> = {}) {
  const events: string[] = [];
  const runtime: VoiceRecordingRuntime = {
    start: async () => {
      events.push('start');
    },
    stop: async () => {
      events.push('stop');
    },
    transcribe: async () => {
      events.push('upload');
      return 'hello';
    },
    release: () => {
      events.push('release');
    },
    ...overrides,
  };
  const session = new VoiceRecordingSession(
    runtime,
    (state) => events.push(state),
    () => {},
    (text) => events.push(`text:${text}`),
    () => events.push('error')
  );
  return { session, events };
}

test('cancellation waits for pending native startup and never uploads', async () => {
  const started = deferred<void>();
  const entered = deferred<void>();
  const { session, events } = fixture({
    start: () => {
      entered.resolve();
      return started.promise;
    },
  });
  const start = session.start();
  await entered.promise;
  const cancel = session.cancel();
  expect(events).toEqual([]);
  started.resolve();
  await Promise.all([start, cancel]);
  expect(events).toEqual(['stop', 'release']);
  await session.cancel();
  expect(events).toEqual(['stop', 'release']);
});

test('repeated stop uploads once and releases the native object once', async () => {
  const { session, events } = fixture();
  await session.start();
  await Promise.all([session.finish(), session.finish()]);
  await session.cancel();
  expect(events).toEqual([
    'start',
    'recording',
    'processing',
    'stop',
    'upload',
    'text:hello',
    'release',
  ]);
});

test('a service that ignores abort cannot insert text after cancellation', async () => {
  const transcript = deferred<string>();
  const uploading = deferred<void>();
  let signal: AbortSignal | undefined;
  const { session, events } = fixture({
    transcribe: (value) => {
      signal = value;
      uploading.resolve();
      return transcript.promise;
    },
  });
  await session.start();
  const finish = session.finish();
  await uploading.promise;
  const cancel = session.cancel();
  expect(signal?.aborted).toBe(true);
  expect(events).not.toContain('release');
  transcript.resolve('late result');
  await Promise.all([finish, cancel]);
  expect(events).not.toContain('text:late result');
  expect(events.filter((event) => event === 'release')).toHaveLength(1);
});

test('permission or startup failure releases resources without uploading', async () => {
  const { session, events } = fixture({
    start: async () => {
      throw new Error('denied');
    },
  });
  await session.start();
  await session.cancel();
  expect(events).toEqual(['error', 'stop', 'release']);
});

test('upload failure is reported and cleanup remains idempotent', async () => {
  const { session, events } = fixture({
    transcribe: async () => {
      throw new Error('offline');
    },
  });
  await session.start();
  await session.finish();
  await session.cancel();
  expect(events).toEqual(['start', 'recording', 'processing', 'stop', 'release', 'error']);
});

test('cancellation cannot dispose the native object while stop is pending', async () => {
  const stopping = deferred<void>();
  const entered = deferred<void>();
  const { session, events } = fixture({
    stop: () => {
      entered.resolve();
      return stopping.promise;
    },
  });
  await session.start();
  const finish = session.finish();
  await entered.promise;
  const cancel = session.cancel();
  expect(events).not.toContain('release');
  stopping.resolve();
  await Promise.all([finish, cancel]);
  expect(events).not.toContain('upload');
  expect(events.filter((event) => event === 'release')).toHaveLength(1);
});

test('a new recording waits until the cancelled recorder has released its native object', async () => {
  const stopping = deferred<void>();
  const entered = deferred<void>();
  const first = fixture({
    stop: () => {
      entered.resolve();
      return stopping.promise;
    },
  });
  const second = fixture();
  await first.session.start();
  const cancel = first.session.cancel();
  await entered.promise;
  const start = second.session.start();
  await Promise.resolve();
  expect(second.events).toEqual([]);
  stopping.resolve();
  await Promise.all([cancel, start]);
  expect(first.events).toContain('release');
  expect(second.events).toEqual(['start', 'recording']);
  await second.session.cancel();
});
