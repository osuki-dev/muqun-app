export class VoiceInputError extends Error {
  constructor(public code: 'permission' | 'transcription' | 'response') {
    super(code);
  }
}

let recorderReleased = Promise.resolve();

function claimRecorder() {
  const previous = recorderReleased;
  let release!: () => void;
  recorderReleased = new Promise<void>((done) => {
    release = done;
  });
  return previous.then(() => release);
}

export type VoiceState = 'starting' | 'recording' | 'processing';

export interface VoiceRecordingRuntime {
  start(signal: AbortSignal, onMeter: (level: number, seconds: number) => void): Promise<void>;
  stop(): Promise<void>;
  transcribe(signal: AbortSignal): Promise<string>;
  release(): void;
}

/** Serializes native recorder ownership across stop, cancellation and upload. */
export class VoiceRecordingSession {
  private abort = new AbortController();
  private starting: Promise<void> | undefined;
  private finishing: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  private cancelled = false;
  private ownsRecorder = false;
  private released = false;
  private releaseLease: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private runtime: VoiceRecordingRuntime,
    private onState: (state: VoiceState) => void,
    private onMeter: (level: number, seconds: number) => void,
    private onText: (text: string) => void,
    private onError: (error: unknown) => void
  ) {}

  start() {
    this.starting ??= this.begin().catch((error: unknown) => this.fail(error));
    return this.starting;
  }

  private async begin() {
    if (this.cancelled) return;
    this.releaseLease = await claimRecorder();
    if (this.cancelled) {
      this.release();
      return;
    }
    this.ownsRecorder = true;
    await this.runtime.start(this.abort.signal, (level, seconds) => {
      if (!this.cancelled) this.onMeter(level, seconds);
    });
    if (this.cancelled) return;
    this.onState('recording');
    this.timer = setTimeout(() => void this.finish(), 120_000);
  }

  finish() {
    this.finishing ??= this.complete().catch((error: unknown) => this.fail(error));
    return this.finishing;
  }

  private async complete() {
    await this.starting;
    if (this.cancelled || !this.ownsRecorder) return;
    clearTimeout(this.timer);
    this.onState('processing');
    await this.stop();
    if (this.cancelled) return;
    const timeout = setTimeout(() => this.abort.abort(), 135_000);
    try {
      const text = await this.runtime.transcribe(this.abort.signal);
      if (!this.cancelled) this.onText(text);
    } finally {
      clearTimeout(timeout);
      this.release();
    }
  }

  private async stop() {
    if (!this.ownsRecorder) return;
    // Keep ownership until native stop settles, including a failed stop.
    await this.runtime.stop();
    this.ownsRecorder = false;
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.timer);
    this.abort.abort();
    this.cleanup ??= this.clean();
    return this.cleanup;
  }

  private async clean() {
    await this.starting;
    await this.finishing;
    await this.stop().catch(() => undefined);
    this.release();
  }

  private fail(error: unknown) {
    if (!this.cancelled) this.onError(error);
    this.cancelled = true;
    clearTimeout(this.timer);
    this.abort.abort();
    return this.stop()
      .catch(() => undefined)
      .then(() => this.release());
  }

  private release() {
    if (this.released) return;
    this.released = true;
    try {
      this.runtime.release();
    } finally {
      this.releaseLease?.();
    }
  }
}
