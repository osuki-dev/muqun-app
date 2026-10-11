/** OTA staging never reloads a live terminal. Native startup owns activation and rollback. */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'failed';
export type UpdateSnapshot = { phase: UpdatePhase; progress: number; releaseNotes?: string };
export interface UpdateClient {
  checkForUpdate(options: {
    updateStrategy: 'fingerprint';
    onError: (error: unknown) => void;
  }): Promise<{
    readonly transitionKind?: 'INSTALL' | 'ADOPT_RELEASE' | 'USE_BUILTIN';
    readonly message?: string | null;
    updateBundle(): Promise<boolean>;
  } | null>;
  addListener(event: 'onProgress', listener: (event: { progress: number }) => void): () => void;
}

export function createAppUpdateController(
  client: UpdateClient | null,
  publish: (snapshot: UpdateSnapshot) => void,
  now: () => number = Date.now
) {
  let phase: UpdatePhase = 'idle';
  let pending: Promise<void> | null = null;
  let nextCheckAt = 0;
  let releaseNotes: string | undefined;
  const publishProgress = (progress: number) =>
    publish({ phase, progress, ...(releaseNotes ? { releaseNotes } : {}) });

  async function run() {
    if (!client) return;
    phase = 'checking';
    releaseNotes = undefined;
    publishProgress(0);
    let checkFailed = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = client.addListener('onProgress', ({ progress }) => {
        if (phase !== 'downloading' || !Number.isFinite(progress)) return;
        publishProgress(Math.max(0, Math.min(1, progress)));
      });
      const update = await client.checkForUpdate({
        updateStrategy: 'fingerprint',
        onError: () => {
          checkFailed = true;
        },
      });
      if (checkFailed) throw new Error('Update check failed');
      if (!update) {
        phase = 'idle';
        publishProgress(0);
        return;
      }
      releaseNotes = update.message?.trim() || undefined;
      if (update.transitionKind !== 'ADOPT_RELEASE') {
        phase = 'downloading';
        publishProgress(0);
      }
      const staged = await update.updateBundle();
      if (!staged) throw new Error('Update staging failed');
      if (update.transitionKind === 'ADOPT_RELEASE') {
        // A release can adopt the already-running artifact. No restart is
        // needed, and later checks must still discover actual bundle changes.
        phase = 'idle';
        publishProgress(0);
        return;
      }
      phase = 'ready';
      publishProgress(1);
    } catch {
      // No request URLs, response bodies, headers or credentials in logs/UI.
      phase = 'failed';
      releaseNotes = undefined;
      publishProgress(0);
    } finally {
      try {
        unsubscribe?.();
      } catch {
        // A native teardown race cannot turn successful staging into a failure
        // or reject the launch/foreground callback's intentionally detached promise.
      }
      nextCheckAt = now() + (phase === 'failed' ? 60_000 : 15 * 60_000);
    }
  }

  return {
    check() {
      if (!client || phase === 'ready' || now() < nextCheckAt) return Promise.resolve();
      if (pending) return pending;
      pending = run().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
