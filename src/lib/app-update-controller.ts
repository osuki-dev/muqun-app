/** Only a successfully verified native update can trigger the automatic restart. */
export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'deferred'
  | 'download-failed'
  | 'applying'
  | 'downloading'
  | 'restarting'
  | 'restart-failed'
  | 'failed';
export type UpdateSnapshot = {
  phase: UpdatePhase;
  progress: number;
  releaseNotes?: string;
  releaseId?: string;
  required?: boolean;
  downloadedBytes?: number;
  totalBytes?: number;
};
export type UpdateProgress = {
  progress: number;
  details?: {
    files: readonly { status: string; downloadedBytes?: number; totalBytes?: number }[];
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
export interface AvailableUpdate {
  readonly id: string;
  readonly shouldForceUpdate: boolean;
  readonly transitionKind?: 'INSTALL' | 'ADOPT_RELEASE' | 'USE_BUILTIN';
  readonly message?: string | null;
  updateBundle(): Promise<boolean>;
}
/** The selected release can name a staged update; match the launched artifact. */
export function runningAppReleaseId(
  state: {
    activeSelection: { bundleId: string; releaseId: string | null; channel: string } | null;
    stableSelection: { bundleId: string; releaseId: string | null; channel: string } | null;
  },
  launchedBundleId: string,
  channel: string
): string | null {
  return (
    [state.activeSelection, state.stableSelection].find(
      (selection) => selection?.bundleId === launchedBundleId && selection.channel === channel
    )?.releaseId ?? null
  );
}

export interface UpdateClient {
  checkForUpdate(options: {
    updateStrategy: 'fingerprint';
    onError: (error: unknown) => void;
  }): Promise<AvailableUpdate | null>;
  getRunningReleaseId?(): Promise<string | null>;
  getReleaseNotes?(releaseId: string): Promise<string | null>;
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
  let update: AvailableUpdate | null = null;
  let localizedNotes: string | null = null;
  let bytes: Pick<UpdateSnapshot, 'downloadedBytes' | 'totalBytes'> = {};
  const publishProgress = (progress: number) => {
    const releaseNotes = localizedNotes ?? update?.message?.trim();
    publish({
      phase,
      progress,
      ...(update ? { releaseId: update.id, required: update.shouldForceUpdate } : {}),
      ...(releaseNotes ? { releaseNotes } : {}),
      ...bytes,
    });
  };

  async function discover() {
    if (!client) return;
    phase = 'checking';
    publishProgress(0);
    let checkFailed = false;
    try {
      // This SDK method only resolves the release catalog. Artifact resolution,
      // staging and selection commits live in updateBundle(), below consent.
      update = await client.checkForUpdate({
        updateStrategy: 'fingerprint',
        onError: () => {
          checkFailed = true;
        },
      });
      if (checkFailed) throw new Error('Update check failed');
      if (update?.transitionKind === 'ADOPT_RELEASE' && client.getRunningReleaseId) {
        // Catalog receipts contain the selection context from before install.
        // Launching that release changes the context, so the SDK can offer a
        // metadata-only adoption for the exact release already running. It is
        // not another update and must never ask to download itself again.
        let runningReleaseId: string | null = null;
        try {
          runningReleaseId = await client.getRunningReleaseId();
        } catch {
          // Unknown running identity must not hide a legitimate update.
        }
        if (runningReleaseId === update.id) update = null;
      }
      localizedNotes = null;
      if (update && client.getReleaseNotes) {
        try {
          localizedNotes = await client.getReleaseNotes(update.id);
        } catch {
          // Missing translations retain the release catalog's English message.
        }
      }
      phase = update ? 'available' : 'idle';
    } catch {
      update = null;
      localizedNotes = null;
      phase = 'failed';
    }
    publishProgress(0);
    nextCheckAt = now() + (phase === 'failed' ? 60_000 : 15 * 60_000);
  }

  async function apply() {
    if (!client || !update) return;
    const restartOnly = phase === 'restart-failed';
    let unsubscribe: (() => void) | undefined;
    try {
      if (!restartOnly) {
        phase = update.transitionKind === 'ADOPT_RELEASE' ? 'applying' : 'downloading';
        bytes = {};
        publishProgress(0);
        unsubscribe = client.addListener('onProgress', (event) => {
          if (phase !== 'downloading' || !Number.isFinite(event.progress)) return;
          bytes = downloadBytes(event);
          publishProgress(Math.max(0, Math.min(1, event.progress)));
        });
        const staged = await update.updateBundle();
        if (!staged) throw new Error('Update staging failed');
        if (update.transitionKind === 'ADOPT_RELEASE') {
          // The selected release uses the already-running artifact. Adoption
          // still requires consent, but it needs neither transfer nor restart.
          update = null;
          localizedNotes = null;
          phase = 'idle';
          bytes = {};
          publishProgress(0);
          nextCheckAt = now() + 15 * 60_000;
          return;
        }
      }
      phase = 'restarting';
      publishProgress(1);
      await client.reload();
    } catch {
      // Preserve the actual notes for reading and explicit retry. Never expose
      // request URLs, headers, credentials or native error payloads.
      phase = phase === 'restarting' ? 'restart-failed' : 'download-failed';
      publishProgress(phase === 'restart-failed' ? 1 : 0);
    } finally {
      try {
        unsubscribe?.();
      } catch {
        // Native teardown cannot reject the detached UI action.
      }
    }
  }

  function run(operation: () => Promise<void>) {
    if (pending) return pending;
    pending = operation().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    check() {
      if (pending) return pending;
      // A prompt, dismissal or transfer survives foreground events for this
      // app session. Those events must never consent or replace readable notes.
      if (!client || update || phase === 'restarting' || now() < nextCheckAt)
        return Promise.resolve();
      return run(discover);
    },
    updateNow() {
      if (pending) return pending;
      if (!update || !['available', 'download-failed', 'restart-failed'].includes(phase))
        return Promise.resolve();
      return run(apply);
    },
    defer() {
      if (
        !update ||
        update.shouldForceUpdate ||
        !['available', 'download-failed', 'restart-failed'].includes(phase)
      )
        return;
      phase = 'deferred';
      publishProgress(0);
    },
  };
}
