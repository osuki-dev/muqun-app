/** OTA staging never reloads a live terminal. Native startup owns activation and rollback. */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'failed';
export type UpdateSnapshot = { phase: UpdatePhase; progress: number };
export interface UpdateClient {
  checkForUpdate(options: {
    updateStrategy: 'fingerprint';
    onError: (error: unknown) => void;
  }): Promise<{
    readonly transitionKind?: 'INSTALL' | 'ADOPT_RELEASE' | 'USE_BUILTIN';
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

  async function run() {
    if (!client) return;
    phase = 'checking';
    publish({ phase, progress: 0 });
    let checkFailed = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = client.addListener('onProgress', ({ progress }) => {
        if (phase !== 'downloading' || !Number.isFinite(progress)) return;
        publish({ phase, progress: Math.max(0, Math.min(1, progress)) });
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
        publish({ phase, progress: 0 });
        return;
      }
      if (update.transitionKind !== 'ADOPT_RELEASE') {
        phase = 'downloading';
        publish({ phase, progress: 0 });
      }
      const staged = await update.updateBundle();
      if (!staged) throw new Error('Update staging failed');
      if (update.transitionKind === 'ADOPT_RELEASE') {
        // A release can adopt the already-running artifact. No restart is
        // needed, and later checks must still discover actual bundle changes.
        phase = 'idle';
        publish({ phase, progress: 0 });
        return;
      }
      phase = 'ready';
      publish({ phase, progress: 1 });
    } catch {
      // No request URLs, response bodies, headers or credentials in logs/UI.
      phase = 'failed';
      publish({ phase, progress: 0 });
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
