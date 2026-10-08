export type AudioPlaybackState = {
  phase: 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error';
  position: number;
  duration: number;
  failure?: 'unsupported';
};

export class AudioPlaybackError extends Error {
  constructor(readonly kind: 'unsupported') {
    super('Audio preview is unsupported.');
  }
}

export interface AudioPlaybackRuntime {
  prepare(signal: AbortSignal): Promise<void>;
  start(onProgress: (position: number, duration: number) => void, onEnd: () => void): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seek(position: number): Promise<void>;
  stop(): Promise<void>;
  release(): void;
}

let activePlayback: AudioPlaybackSession | undefined;
let recordingOwner: object | undefined;

function claimPlayback(session: AudioPlaybackSession) {
  const previous = activePlayback;
  activePlayback = session;
  return previous;
}

export async function prepareRecordingAudio(owner: object) {
  recordingOwner = owner;
  const previous = activePlayback;
  activePlayback = undefined;
  await previous?.close();
}

export function releaseRecordingAudio(owner: object) {
  if (recordingOwner === owner) recordingOwner = undefined;
}

/** Owns one player, including pending downloads/startup, without autoplay. */
export class AudioPlaybackSession {
  private state: AudioPlaybackState = { phase: 'idle', position: 0, duration: 0 };
  private abort = new AbortController();
  private operation = Promise.resolve();
  private cleanup: Promise<void> | undefined;
  private closed = false;
  private disposeRequested = false;
  private released = false;
  private prepared = false;
  private started = false;

  constructor(
    private runtime: AudioPlaybackRuntime,
    private onState: (state: AudioPlaybackState) => void
  ) {}

  play() {
    return this.enqueue(async () => {
      if (this.state.phase === 'playing') return;
      if (recordingOwner) throw new Error('Microphone is in use.');
      const previous = claimPlayback(this);
      if (previous && previous !== this) await previous.close();
      if (this.closed) return;
      if (recordingOwner) throw new Error('Microphone is in use.');
      if (!this.prepared) {
        this.update({ phase: 'loading' });
        await this.runtime.prepare(this.abort.signal);
        this.prepared = true;
      }
      if (this.closed) return;
      if (this.state.phase === 'ended') {
        await this.runtime.stop();
        this.started = false;
        this.update({ phase: 'loading', position: 0 });
      }
      if (this.started) {
        await this.runtime.resume();
      } else {
        // A rejected native startup may still own an active audio session.
        this.started = true;
        await this.runtime.start(
          (position, duration) => {
            if (this.closed) return;
            const length = Number.isFinite(duration) ? Math.max(0, duration) : 0;
            const cursor = Number.isFinite(position) ? Math.max(0, Math.min(position, length)) : 0;
            this.update({ position: cursor, duration: length });
          },
          () => {
            if (!this.closed) this.update({ phase: 'ended', position: this.state.duration });
          }
        );
      }
      if (!this.closed && this.state.phase !== 'ended') this.update({ phase: 'playing' });
    });
  }

  pause() {
    return this.enqueue(async () => {
      if (this.state.phase !== 'playing') return;
      await this.runtime.pause();
      if (!this.closed) this.update({ phase: 'paused' });
    });
  }

  seek(position: number) {
    return this.enqueue(async () => {
      if (!this.started || !Number.isFinite(position)) return;
      const cursor = Math.max(0, Math.min(position, this.state.duration));
      await this.runtime.seek(cursor);
      if (!this.closed) this.update({ position: cursor });
    });
  }

  close() {
    this.disposeRequested = true;
    this.closed = true;
    this.abort.abort();
    this.cleanup ??= this.operation.then(async () => {
      await this.runtime.stop().catch(() => undefined);
      this.release();
    });
    return this.cleanup;
  }

  private enqueue(run: () => Promise<void>) {
    this.operation = this.operation
      .then(() => (this.closed ? undefined : run()))
      .catch(async (error) => {
        if (this.closed) return;
        this.closed = true;
        this.abort.abort();
        await this.runtime.stop().catch(() => undefined);
        this.release();
        if (!this.disposeRequested)
          this.update({
            phase: 'error',
            failure: error instanceof AudioPlaybackError ? error.kind : undefined,
          });
      });
    return this.operation;
  }

  private release() {
    if (this.released) return;
    this.released = true;
    try {
      this.runtime.release();
    } finally {
      if (activePlayback === this) activePlayback = undefined;
    }
  }

  private update(next: Partial<AudioPlaybackState>) {
    this.state = { ...this.state, ...next };
    this.onState(this.state);
  }
}
