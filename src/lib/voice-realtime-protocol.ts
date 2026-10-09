import { VoiceInputError } from './voice-input-session';

export interface VoiceRealtimeSocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

function pending<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  // A failure can arrive while recording, before finish() starts awaiting it.
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

export function realtimeSessionUpdate(model: string, language: string) {
  const transcription: Record<string, unknown> = {};
  if (model) transcription.model = model;
  if (language !== 'auto') {
    if (model.startsWith('gpt-live-transcribe')) transcription.languages = [language.toLowerCase()];
    else transcription.language = language.split('-')[0];
  }
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription,
          turn_detection: null,
        },
      },
    },
  };
}

/** One manually committed recording. Deltas are previews; only the committed
 * item's completed event can produce the final draft. No retries or fallback. */
export class VoiceRealtimeProtocol {
  private ready = pending<void>();
  private final = pending<string>();
  private configured = false;
  private committing = false;
  private closed = false;
  private completed = false;
  private frames = 0;
  private item: string | undefined;
  private transcripts = new Map<string, { text: string; final: boolean }>();
  private timer: ReturnType<typeof setTimeout>;
  private finishTimer: ReturnType<typeof setTimeout> | undefined;
  private abort = () => this.fail(new VoiceInputError('connection'), false);

  constructor(
    private socket: VoiceRealtimeSocket,
    private signal: AbortSignal,
    model: string,
    language: string,
    private onPartial: (text: string) => void,
    private onFailure: (error: unknown) => void
  ) {
    this.timer = setTimeout(() => this.fail(new VoiceInputError('connection')), 15_000);
    socket.onopen = () => this.send(realtimeSessionUpdate(model, language));
    socket.onmessage = ({ data }) => this.receive(data);
    socket.onerror = socket.onclose = () => this.fail(new VoiceInputError('connection'));
    signal.addEventListener('abort', this.abort, { once: true });
    if (signal.aborted) this.abort();
  }

  waitUntilReady() {
    return this.ready.promise;
  }

  append(audio: string, frames: number) {
    if (this.closed || this.committing || !this.configured) return;
    // Bound queued audio even if a native socket stalls. The sheet also stops at 2 minutes.
    if (!Number.isInteger(frames) || frames < 0 || this.frames + frames > 24000 * 121) {
      this.fail(new VoiceInputError('connection'));
      return;
    }
    this.frames += frames;
    this.send({ type: 'input_audio_buffer.append', audio });
  }

  finish() {
    if (!this.closed && !this.committing) {
      this.committing = true;
      if (this.frames === 0) {
        this.completed = true;
        this.final.resolve('');
      } else {
        // OpenAI requires at least 100 ms on commit; don't send a knowingly invalid turn.
        if (this.frames < 2400) {
          const bytes = (2400 - this.frames) * 2;
          const audio =
            'A'.repeat(Math.ceil(bytes / 3) * 4 - ((3 - (bytes % 3)) % 3)) +
            '='.repeat((3 - (bytes % 3)) % 3);
          this.send({ type: 'input_audio_buffer.append', audio });
        }
        if (this.closed) return this.final.promise;
        this.finishTimer = setTimeout(
          () => this.fail(new VoiceInputError('transcription')),
          30_000
        );
        this.send({ type: 'input_audio_buffer.commit' });
      }
    }
    return this.final.promise;
  }

  private send(event: object) {
    if (this.closed) return;
    try {
      this.socket.send(JSON.stringify(event));
    } catch {
      this.fail(new VoiceInputError('connection'));
    }
  }

  private receive(data: unknown) {
    if (this.closed || this.completed) return;
    try {
      if (typeof data !== 'string' || data.length > 256_000) throw new Error('Invalid event');
      const event: unknown = JSON.parse(data);
      if (!event || typeof event !== 'object' || !('type' in event))
        throw new Error('Invalid event');
      const message = event as Record<string, unknown>;
      switch (message.type) {
        case 'session.updated':
          this.configured = true;
          clearTimeout(this.timer);
          this.ready.resolve();
          return;
        case 'error':
        case 'conversation.item.input_audio_transcription.failed':
          this.fail(new VoiceInputError('transcription'));
          return;
        case 'input_audio_buffer.committed':
          if (!this.committing || typeof message.item_id !== 'string' || this.item)
            throw new Error('Unexpected turn');
          this.item = message.item_id;
          this.resolveFinal();
          return;
        case 'conversation.item.input_audio_transcription.delta':
        case 'conversation.item.input_audio_transcription.completed': {
          if (typeof message.item_id !== 'string') throw new Error('Missing item');
          const final = message.type === 'conversation.item.input_audio_transcription.completed';
          const text = final ? message.transcript : message.delta;
          if (typeof text !== 'string') throw new Error('Missing transcript');
          const previous = this.transcripts.get(message.item_id);
          if (previous?.final) return;
          const next = final ? text : (previous?.text ?? '') + text;
          if (next.length > 64_000 || this.transcripts.size > 8)
            throw new Error('Transcript too large');
          this.transcripts.set(message.item_id, { text: next, final });
          this.onPartial(next);
          this.resolveFinal();
        }
      }
    } catch {
      this.fail(new VoiceInputError('response'));
    }
  }

  private resolveFinal() {
    const value = this.item && this.transcripts.get(this.item);
    if (!this.committing || !value || !value.final) return;
    this.completed = true;
    clearTimeout(this.finishTimer);
    this.final.resolve(value.text);
  }

  private fail(error: unknown, report = true) {
    if (this.closed || this.completed) return;
    this.ready.reject(error);
    this.final.reject(error);
    this.dispose();
    if (report) this.onFailure(error);
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    clearTimeout(this.finishTimer);
    this.signal.removeEventListener('abort', this.abort);
    this.ready.reject(new VoiceInputError('connection'));
    this.final.reject(new VoiceInputError('connection'));
    this.socket.onopen = this.socket.onmessage = this.socket.onerror = this.socket.onclose = null;
    this.socket.close();
    this.transcripts.clear();
  }
}

/** Encode normalized 24 kHz samples as mono PCM16 for the realtime service. */
export function voicePcm16(channels: Float32Array[], frames: number, sampleRate: number) {
  if (
    sampleRate !== 24000 ||
    !channels.length ||
    !Number.isInteger(frames) ||
    frames < 0 ||
    channels.some((channel) => channel.length < frames)
  ) {
    throw new Error('Unexpected microphone format');
  }
  const bytes = new Uint8Array(frames * 2);
  const view = new DataView(bytes.buffer);
  let power = 0;
  for (let index = 0; index < frames; index++) {
    let value = 0;
    for (const channel of channels) value += channel[index]! / channels.length;
    value = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    power += value * value;
    view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  const decibels = 20 * Math.log10(Math.max(0.00001, Math.sqrt(power / Math.max(frames, 1))));
  return { bytes, level: Math.max(0, Math.min(1, (decibels + 55) / 55)) };
}
