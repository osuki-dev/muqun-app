/** OTA staging never reloads a live terminal. Native startup owns activation and rollback. */
export type UpdatePhase = 'idle' | 'checking' | 'downloading' | 'ready' | 'failed';
export type UpdateSnapshot = { phase: UpdatePhase; progress: number };
export interface UpdateClient {
  checkForUpdate(options: {
    updateStrategy: 'fingerprint';
    onError: (error: unknown) => void;
  }): Promise<{ updateBundle(): Promise<boolean> } | null>;
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
    const unsubscribe = client.addListener('onProgress', ({ progress }) => {
      if (phase !== 'downloading' || !Number.isFinite(progress)) return;
      publish({ phase, progress: Math.max(0, Math.min(1, progress)) });
    });
    try {
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
      phase = 'downloading';
      publish({ phase, progress: 0 });
      const staged = await update.updateBundle();
      if (!staged) throw new Error('Update staging failed');
      phase = 'ready';
      publish({ phase, progress: 1 });
    } catch {
      // No request URLs, response bodies, headers or credentials in logs/UI.
      phase = 'failed';
      publish({ phase, progress: 0 });
    } finally {
      unsubscribe();
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
