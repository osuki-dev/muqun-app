import { expect, test } from 'bun:test';
import { VoiceRecordingSession, type VoiceRecordingRuntime } from '../voice-input-session';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(
  overrides: Partial<VoiceRecordingRuntime> = {},
  lifecycle?: ConstructorParameters<typeof VoiceRecordingSession>[5]
) {
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
    () => events.push('error'),
    lifecycle
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

test('an asynchronous transport failure stops capture and never delivers provisional text', async () => {
  let fail!: (error: unknown) => void;
  const { session, events } = fixture({
    start: async (_signal, _meter, onFailure) => {
      fail = onFailure;
    },
  });
  await session.start();
  fail(new Error('disconnected'));
  fail(new Error('duplicate close event'));
  await session.cancel();
  expect(events).toEqual(['recording', 'error', 'stop', 'release']);
});

test('a new recorder waits for asynchronous audio session deactivation', async () => {
  const released = deferred<void>();
  const entered = deferred<void>();
  const first = fixture({
    release: () => {
      entered.resolve();
      return released.promise;
    },
  });
  const second = fixture();
  await first.session.start();
  const cancel = first.session.cancel();
  await entered.promise;
  const start = second.session.start();
  await Promise.resolve();
  expect(second.events).toEqual([]);
  released.resolve();
  await Promise.all([cancel, start]);
  expect(second.events).toEqual(['start', 'recording']);
  await second.session.cancel();
});

test('transport failure during native startup waits before stopping the microphone', async () => {
  const entered = deferred<void>();
  const started = deferred<void>();
  let fail!: (error: unknown) => void;
  const { session, events } = fixture({
    start: (_signal, _meter, onFailure) => {
      fail = onFailure;
      entered.resolve();
      return started.promise;
    },
  });
  const start = session.start();
  await entered.promise;
  fail(new Error('disconnected'));
  expect(events).toEqual(['error']);
  started.resolve();
  await start;
  await session.cancel();
  expect(events).toEqual(['error', 'stop', 'release']);
});

function permissionFixture() {
  const permission = deferred<boolean>();
  const requested = deferred<void>();
  let nativeState = 'active';
  const recording = fixture(
    {
      start: async (signal, _meter, _failure, requestPermission) => {
        requested.resolve();
        const granted = await requestPermission(() => permission.promise);
        if (signal.aborted) throw new Error('cancelled');
        if (!granted) throw new Error('permission denied');
        recording.events.push('capture');
      },
    },
    {
      appState: () => nativeState,
      onBackground: () => recording.events.push('closed'),
    }
  );
  return {
    ...recording,
    permission,
    requested,
    setNativeState: (state: string) => {
      nativeState = state;
    },
    changeAppState(state: string) {
      nativeState = state;
      recording.session.setAppState(state);
    },
  };
}

test('background cancellation during audio preparation never opens a later permission prompt', async () => {
  const prepared = deferred<void>();
  const preparing = deferred<void>();
  let requested = false;
  const f = fixture({
    start: async (_signal, _meter, _failure, requestPermission) => {
      preparing.resolve();
      await prepared.promise;
      await requestPermission(async () => {
        requested = true;
        return true;
      });
    },
  });
  const start = f.session.start();
  await preparing.promise;
  f.session.setAppState('background');
  prepared.resolve();
  await Promise.all([start, f.session.cancel()]);
  expect(requested).toBe(false);
  expect(f.events).toEqual(['stop', 'release']);
});

test('first-use permission background waits for approval and active before capture', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  expect(f.events).toEqual([]);
  f.permission.resolve(true);
  await Promise.resolve();
  expect(f.events).toEqual([]);
  f.changeAppState('active');
  await start;
  expect(f.events).toEqual(['capture', 'recording']);
  await f.session.cancel();
});

test('native state is reread after permission, even before its background event arrives', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.setNativeState('background');
  f.permission.resolve(true);
  await Promise.resolve();
  expect(f.events).toEqual([]);
  f.changeAppState('active');
  await start;
  expect(f.events).toEqual(['capture', 'recording']);
  await f.session.cancel();
});

test('denied permission returns an error without starting capture', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  f.permission.resolve(false);
  f.changeAppState('active');
  await start;
  expect(f.events).toEqual(['error', 'stop', 'release']);
});

test('navigation or cancellation while permission is open cannot start late capture', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  const cancel = f.session.cancel();
  f.permission.resolve(true);
  f.changeAppState('active');
  await Promise.all([start, cancel]);
  expect(f.events).toEqual(['stop', 'release']);
});

test('cancelling approved permission while awaiting resume never starts capture', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  f.permission.resolve(true);
  await Promise.resolve();
  await f.session.cancel();
  f.changeAppState('active');
  await start;
  expect(f.events).toEqual(['stop', 'release']);
});

test('returning from permission then backgrounding before capture still cancels', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  f.permission.resolve(true);
  await Promise.resolve();
  f.changeAppState('active');
  f.changeAppState('background');
  await start;
  await f.session.cancel();
  expect(f.events).toEqual(['closed', 'stop', 'release']);
});

test('permission approved while genuinely backgrounded expires instead of recording on a later visit', async () => {
  const f = permissionFixture();
  const start = f.session.start();
  await f.requested.promise;
  f.changeAppState('background');
  f.permission.resolve(true);
  await start;
  await f.session.cancel();
  expect(f.events).toEqual(['closed', 'stop', 'release']);
  f.changeAppState('active');
  expect(f.events).not.toContain('capture');
});

test('a normal background event still immediately cancels an active recording', async () => {
  const f = permissionFixture();
  f.permission.resolve(true);
  await f.session.start();
  f.changeAppState('background');
  expect(f.events).toContain('closed');
  await f.session.cancel();
  expect(f.events).toEqual(['capture', 'recording', 'closed', 'stop', 'release']);
});

test('background during transcription still aborts and discards late output', async () => {
  const transcript = deferred<string>();
  const uploading = deferred<void>();
  const f = fixture({
    transcribe: () => {
      uploading.resolve();
      return transcript.promise;
    },
  });
  await f.session.start();
  const finish = f.session.finish();
  await uploading.promise;
  f.session.setAppState('background');
  transcript.resolve('late');
  await Promise.all([finish, f.session.cancel()]);
  expect(f.events).not.toContain('text:late');
  expect(f.events).toContain('release');
});
