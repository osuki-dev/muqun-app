/** Only a successfully verified native update can trigger the automatic restart. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'restarting'
  | 'restart-failed'
  | 'failed';
export type UpdateSnapshot = {
  phase: UpdatePhase;
  progress: number;
  releaseNotes?: string;
  downloadedBytes?: number;
  totalBytes?: number;
};
export type UpdateProgress = {
  progress: number;
  details?: {
    files: { status: string; downloadedBytes?: number; totalBytes?: number }[];
  };
};

function downloadBytes(
  event: UpdateProgress
): Pick<UpdateSnapshot, 'downloadedBytes' | 'totalBytes'> {
  const files = event.details?.files;
  if (!files?.length) return {};
  const valid = (value: number | undefined): value is number =>
    value !== undefined && Number.isSafeInteger(value) && value >= 0;
  // Each event replaces the current transfer plan, including archive-to-diff
  // fallback. Never accumulate events or infer transfer bytes from overall %.
  const measured = files.some((file) => valid(file.downloadedBytes));
  const allMeasured = files.every(
    (file) => valid(file.downloadedBytes) || file.status === 'pending'
  );
  const downloadedBytes = files.reduce((sum, file) => sum + (file.downloadedBytes ?? 0), 0);
  const totalBytes = files.reduce((sum, file) => sum + (file.totalBytes ?? 0), 0);
  return {
    ...(measured && allMeasured && valid(downloadedBytes) ? { downloadedBytes } : {}),
    ...(files.every((file) => valid(file.totalBytes)) && valid(totalBytes) && totalBytes > 0
      ? { totalBytes }
      : {}),
  };
}
export interface UpdateClient {
  checkForUpdate(options: {
    updateStrategy: 'fingerprint';
    onError: (error: unknown) => void;
  }): Promise<{
    readonly transitionKind?: 'INSTALL' | 'ADOPT_RELEASE' | 'USE_BUILTIN';
    readonly message?: string | null;
    updateBundle(): Promise<boolean>;
  } | null>;
  addListener(event: 'onProgress', listener: (event: UpdateProgress) => void): () => void;
  reload(): Promise<void>;
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
  let bytes: Pick<UpdateSnapshot, 'downloadedBytes' | 'totalBytes'> = {};
  const publishProgress = (progress: number) =>
    publish({ phase, progress, ...(releaseNotes ? { releaseNotes } : {}), ...bytes });

  async function run() {
    if (!client) return;
    phase = 'checking';
    releaseNotes = undefined;
    bytes = {};
    publishProgress(0);
    let checkFailed = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = client.addListener('onProgress', (event) => {
        const { progress } = event;
        if (phase !== 'downloading' || !Number.isFinite(progress)) return;
        bytes = downloadBytes(event);
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
      phase = 'restarting';
      publishProgress(1);
      await client.reload();
    } catch {
      // No request URLs, response bodies, headers or credentials in logs/UI.
      if (phase === 'restarting') {
        // The verified bundle remains staged. Do not loop on a failed native
        // restart; a later user-initiated launch can still activate it.
        phase = 'restart-failed';
        publishProgress(1);
      } else {
        phase = 'failed';
        releaseNotes = undefined;
        bytes = {};
        publishProgress(0);
      }
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
      if (!client || phase === 'restarting' || phase === 'restart-failed' || now() < nextCheckAt)
        return Promise.resolve();
      if (pending) return pending;
      pending = run().finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}
