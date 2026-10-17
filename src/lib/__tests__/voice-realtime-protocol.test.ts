import { expect, jest, test } from 'bun:test';
import {
  VoiceRealtimeProtocol,
  realtimeSessionUpdate,
  voicePcm16,
  type VoiceRealtimeSocket,
} from '../voice-realtime-protocol';

function fixture() {
  const sent: Record<string, unknown>[] = [];
  const previews: string[] = [];
  const errors: unknown[] = [];
  let closes = 0;
  const abort = new AbortController();
  const socket: VoiceRealtimeSocket = {
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    send: (data) => {
      sent.push(JSON.parse(data));
    },
    close: () => {
      closes++;
    },
  };
  const protocol = new VoiceRealtimeProtocol(
    socket,
    abort.signal,
    'gpt-live-transcribe',
    'zh-CN',
    (text) => previews.push(text),
    (error) => errors.push(error)
  );
  const event = (value: object) => socket.onmessage?.({ data: JSON.stringify(value) });
  socket.onopen?.();
  return { protocol, socket, sent, previews, errors, abort, event, closes: () => closes };
}

test('microphone waits for configuration acknowledgement, not just socket open', async () => {
  const f = fixture();
  let ready = false;
  const wait = f.protocol.waitUntilReady().then(() => {
    ready = true;
  });
  f.protocol.append('AAAA', 2);
  await Promise.resolve();
  expect(ready).toBe(false);
  expect(f.sent).toHaveLength(1);
  f.event({ type: 'session.updated' });
  await wait;
  expect(ready).toBe(true);
  f.protocol.dispose();
});

test('live previews stay provisional until manual commit and final replacement', async () => {
  const f = fixture();
  f.event({ type: 'session.updated' });
  f.protocol.append('AAAA', 2400);
  f.event({
    type: 'conversation.item.input_audio_transcription.delta',
    item_id: 'a',
    delta: 'hel',
  });
  f.event({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'a', delta: 'lo' });
  expect(f.previews).toEqual(['hel', 'hello']);
  expect(f.sent.map((e) => e.type)).not.toContain('input_audio_buffer.commit');
  const final = f.protocol.finish();
  void f.protocol.finish();
  f.event({ type: 'input_audio_buffer.committed', item_id: 'a' });
  f.event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'a',
    transcript: 'Hello!',
  });
  expect(await final).toBe('Hello!');
  expect(f.sent.filter((e) => e.type === 'input_audio_buffer.commit')).toHaveLength(1);
  f.protocol.dispose();
});

test('completion before commit acknowledgement is reconciled by item identity', async () => {
  const f = fixture();
  f.event({ type: 'session.updated' });
  f.protocol.append('AAAA', 2400);
  f.event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'other',
    transcript: 'not this turn',
  });
  const final = f.protocol.finish();
  f.event({
    type: 'conversation.item.input_audio_transcription.completed',
    item_id: 'wanted',
    transcript: 'correct turn',
  });
  f.event({ type: 'input_audio_buffer.committed', item_id: 'wanted' });
  expect(await final).toBe('correct turn');
  f.protocol.dispose();
});

test('cancelling a pending final closes once and ignores late transcript', async () => {
  const f = fixture();
  f.event({ type: 'session.updated' });
  f.protocol.append('AAAA', 2400);
  const final = f.protocol.finish();
  const late = f.socket.onmessage!;
  f.abort.abort();
  f.protocol.dispose();
  late({
    data: JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'a',
      delta: 'late',
    }),
  });
  await expect(final).rejects.toThrow();
  expect(f.closes()).toBe(1);
  expect(f.previews).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('disconnects and protocol errors fail immediately without reconnect or upload', async () => {
  for (const failure of ['disconnect', 'error', 'invalid']) {
    const f = fixture();
    if (failure === 'disconnect') f.socket.onclose?.();
    else if (failure === 'invalid') f.socket.onmessage?.({ data: 'bad json' });
    else f.event({ type: 'error', error: { message: 'sensitive provider details' } });
    await expect(f.protocol.waitUntilReady()).rejects.toThrow();
    expect(f.errors).toHaveLength(1);
    expect(String(f.errors[0])).not.toContain('sensitive');
    expect(f.closes()).toBe(1);
    expect(f.sent).toHaveLength(1);
  }
});

test('brief recordings are zero-padded to the minimum commit length', async () => {
  for (const frames of [1, 2, 3, 2399]) {
    const f = fixture();
    f.event({ type: 'session.updated' });
    f.protocol.append('AAAA', frames);
    const final = f.protocol.finish();
    const padding = Buffer.from(f.sent[2]!.audio as string, 'base64');
    expect(padding.length).toBe((2400 - frames) * 2);
    expect(padding.every((byte) => byte === 0)).toBe(true);
    f.abort.abort();
    await expect(final).rejects.toThrow();
  }
});

test('empty capture does not send an invalid commit or invent text', async () => {
  const f = fixture();
  f.event({ type: 'session.updated' });
  expect(await f.protocol.finish()).toBe('');
  expect(f.sent).toHaveLength(1);
  f.protocol.dispose();
});

test('PCM conversion clips, mixes channels, encodes little endian, and rejects wrong rates', () => {
  const { bytes } = voicePcm16([new Float32Array([-2, -1, 0, 1, 2, NaN])], 6, 24000);
  const view = new DataView(bytes.buffer);
  expect(Array.from({ length: 6 }, (_, i) => view.getInt16(i * 2, true))).toEqual([
    -32768, -32768, 0, 32767, 32767, 0,
  ]);
  expect(voicePcm16([new Float32Array([1]), new Float32Array([-1])], 1, 24000).bytes).toEqual(
    new Uint8Array([0, 0])
  );
  expect(() => voicePcm16([new Float32Array(2)], 3, 24000)).toThrow();
  expect(() => voicePcm16([new Float32Array(2)], 2, 48000)).toThrow();
});

test('session configuration preserves optional models and model-specific language fields', () => {
  expect(realtimeSessionUpdate('', 'auto').session.audio.input.transcription).toEqual({});
  expect(
    realtimeSessionUpdate('gpt-live-transcribe', 'zh-CN').session.audio.input.transcription
  ).toEqual({ model: 'gpt-live-transcribe', languages: ['zh-cn'] });
  expect(
    realtimeSessionUpdate('gpt-4o-transcribe', 'zh-CN').session.audio.input.transcription
  ).toEqual({ model: 'gpt-4o-transcribe', language: 'zh' });
  expect(realtimeSessionUpdate('', 'auto').session.audio.input.turn_detection).toBe(null);
});

test('a silent service times out during setup or finalization and closes its socket', async () => {
  jest.useFakeTimers();
  try {
    const connecting = fixture();
    jest.advanceTimersByTime(15_000);
    await expect(connecting.protocol.waitUntilReady()).rejects.toThrow();
    expect(connecting.errors).toHaveLength(1);
    expect(connecting.closes()).toBe(1);

    const finishing = fixture();
    finishing.event({ type: 'session.updated' });
    finishing.protocol.append('AAAA', 2400);
    const final = finishing.protocol.finish();
    jest.advanceTimersByTime(30_000);
    await expect(final).rejects.toThrow();
    expect(finishing.errors).toHaveLength(1);
    expect(finishing.closes()).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});
