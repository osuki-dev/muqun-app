export class VoiceInputError extends Error {
  constructor(
    public code: 'permission' | 'transcription' | 'response' | 'unsupported' | 'connection'
  ) {
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
type PermissionRequest = <T>(request: () => Promise<T>) => Promise<T>;

interface VoiceLifecycle {
  /** Read native-backed state again after the permission promise settles. */
  appState: () => string;
  onBackground: () => void;
}

export interface VoiceRecordingRuntime {
  start(
    signal: AbortSignal,
    onMeter: (level: number, seconds: number) => void,
    onFailure: (error: unknown) => void,
    requestPermission: PermissionRequest
  ): Promise<void>;
  stop(): Promise<void>;
  transcribe(signal: AbortSignal): Promise<string>;
  release(): void | Promise<void>;
}

/** Serializes native recorder ownership across stop, cancellation and upload. */
export class VoiceRecordingSession {
  private abort = new AbortController();
  private starting: Promise<void> | undefined;
  private finishing: Promise<void> | undefined;
  private cleanup: Promise<void> | undefined;
  private cancelled = false;
  private ownsRecorder = false;
  private releasing: Promise<void> | undefined;
  private releaseLease: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private appState = 'active';
  private awaitingPermission = false;
  private permissionResumed: (() => void) | undefined;

  constructor(
    private runtime: VoiceRecordingRuntime,
    private onState: (state: VoiceState) => void,
    private onMeter: (level: number, seconds: number) => void,
    private onText: (text: string) => void,
    private onError: (error: unknown) => void,
    private lifecycle?: VoiceLifecycle
  ) {}

  setAppState(state: string) {
    this.appState = state;
    if (state === 'active') this.permissionResumed?.();
    else if (state === 'background' && !this.awaitingPermission) this.cancelForBackground();
  }

  private cancelForBackground() {
    if (this.cancelled) return;
    void this.cancel();
    this.lifecycle?.onBackground();
  }

  private async requestPermission<T>(request: () => Promise<T>): Promise<T> {
    if (this.cancelled || this.abort.signal.aborted) throw new Error('Operation cancelled.');
    this.awaitingPermission = true;
    try {
      const permission = await request();
      if (this.cancelled) throw new Error('Operation cancelled.');
      this.appState = this.lifecycle?.appState() ?? this.appState;
      if (this.appState !== 'active') await this.waitForPermissionResume();
      if (this.cancelled) throw new Error('Operation cancelled.');
      // A real background event may follow resume before this continuation.
      if ((this.lifecycle?.appState() ?? this.appState) !== 'active') {
        this.cancelForBackground();
        throw new Error('Operation cancelled.');
      }
      return permission;
    } finally {
      this.awaitingPermission = false;
    }
  }

  private waitForPermissionResume() {
    if (this.cancelled || this.abort.signal.aborted)
      return Promise.reject(new Error('Operation cancelled.'));
    return new Promise<void>((resolve, reject) => {
      // Android can settle permission before Activity.onResume is delivered.
      // Never start capture in that gap or resume it on a much later app visit.
      const timeout = setTimeout(() => this.cancelForBackground(), 1000);
      const cleanup = () => {
        clearTimeout(timeout);
        this.abort.signal.removeEventListener('abort', aborted);
        this.permissionResumed = undefined;
      };
      const aborted = () => {
        cleanup();
        reject(new Error('Operation cancelled.'));
      };
      this.permissionResumed = () => {
        cleanup();
        resolve();
      };
      this.abort.signal.addEventListener('abort', aborted, { once: true });
    });
  }

  start() {
    this.starting ??= this.begin().catch((error: unknown) => this.fail(error));
    return this.starting;
  }

  private async begin() {
    if (this.cancelled) return;
    this.releaseLease = await claimRecorder();
    if (this.cancelled) {
      await this.release();
      return;
    }
    this.ownsRecorder = true;
    await this.runtime.start(
      this.abort.signal,
      (level, seconds) => {
        if (!this.cancelled) this.onMeter(level, seconds);
      },
      (error) => {
        if (this.cancelled || this.releasing) return;
        this.onError(error);
        // Wait for startup/stop before releasing a recorder after an asynchronous
        // transport or microphone failure. Never dispose it during native startup.
        void this.cancel();
      },
      (request) => this.requestPermission(request)
    );
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
      await this.release();
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
    await this.release();
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
    this.releasing ??= this.releaseRuntime();
    return this.releasing;
  }

  private async releaseRuntime() {
    try {
      await this.runtime.release();
    } catch {
      // Cleanup is best effort, but must not retain the global microphone lease.
    } finally {
      this.releaseLease?.();
    }
  }
}
