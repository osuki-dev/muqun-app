/**
 * Whether the bundle the app runs can reach its first screen, judged by the
 * app itself, because Hot Updater's crash recovery cannot see a render error.
 *
 * Native verifies a launch on React Native's CONTENT_APPEARED marker
 * (`HotUpdaterRecoveryManager.handleContentAppeared` in
 * `@hot-updater/react-native`), the root's first native view. Here that is the
 * provider shell in `_layout.tsx`, mounted before any screen renders, so native
 * counts every launch as healthy within a frame. From then on it rolls back
 * only for a fatal JavaScript exception or a native crash, and a render throw
 * that `AppErrorBoundary` catches is neither. The SDK's JavaScript cannot mark
 * the running bundle crashed either: `notifyAppReady` reads the launch report
 * ("This is a read-only API; native launch state has already been finalized"),
 * and `getCrashHistory`/`clearCrashHistory` read and clear, nothing writes.
 *
 * So the app keeps its own record, per bundle: a launch is healthy once the
 * router and its first route have stayed mounted for {@link LAUNCH_SETTLE_MS}
 * with the boundary catching nothing. Once a downloaded bundle fails to get
 * there {@link FAILED_LAUNCH_LIMIT} times -- across launches, or the boundary's
 * own retry -- the app drops its downloaded bundles through
 * `hotUpdater.resetChannel()`, the one rollback JavaScript can ask for (it
 * "restores the original bundle": native deletes every downloaded bundle and
 * the next launch loads the built-in one), and restarts into it. The built-in
 * bundle has nothing to fall back to and is never rolled back.
 */
export type LaunchHealthUpdater = {
  /** The bundle this process runs; the manifest's id, never a staged one. */
  getBundleId: () => string;
  /** The built-in bundle's id. */
  getMinBundleId: () => string;
  /** The native launch report: UNCHANGED, UPDATE_APPLIED or RECOVERED. */
  notifyAppReady: () => { status: string; fromBundleId?: string; toBundleId?: string };
  resetChannel: () => Promise<boolean>;
  reload: () => Promise<void>;
};

/** A string store, the shape of an MMKV instance. */
export type LaunchHealthStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

type LaunchHealthRecord = { bundleId: string; failures: number };

export const LAUNCH_HEALTH_KEY = 'muqun.launch-health';
/** How long the first route must stay mounted, with nothing caught, to count. */
export const LAUNCH_SETTLE_MS = 3000;
/** Failed launches of one bundle before it is rolled back. One may be transient. */
export const FAILED_LAUNCH_LIMIT = 2;

function parseLaunchHealthRecord(raw: string | undefined): LaunchHealthRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { bundleId, failures } = parsed as Record<string, unknown>;
    if (typeof bundleId !== 'string' || !Number.isSafeInteger(failures) || (failures as number) < 0)
      return null;
    return { bundleId, failures: failures as number };
  } catch {
    return null;
  }
}

/**
 * Records this launch and returns the hooks the root and the boundary call.
 * Without an updater (web, a binary predating the native module) every hook is
 * a no-op: nothing is downloaded there, so nothing can be rolled back.
 */
export function createLaunchHealth({
  updater,
  store,
  log = () => {},
}: {
  updater: LaunchHealthUpdater | null;
  store: LaunchHealthStore;
  log?: (message: string) => void;
}) {
  const read = (): LaunchHealthRecord | null => {
    try {
      return parseLaunchHealthRecord(store.getString(LAUNCH_HEALTH_KEY));
    } catch {
      return null;
    }
  };
  const write = (record: LaunchHealthRecord) => {
    try {
      store.set(LAUNCH_HEALTH_KEY, JSON.stringify(record));
    } catch {
      // A record that cannot be kept costs one more failed launch, not a crash.
    }
  };
  const describe = () => {
    try {
      const bundleId = updater?.getBundleId() ?? null;
      return bundleId === null
        ? null
        : { bundleId, builtIn: bundleId === updater?.getMinBundleId() };
    } catch {
      return null;
    }
  };

  const running = describe();
  // A bundle carries its count across launches; another bundle starts clean.
  const previous = read();
  let failures = running && previous?.bundleId === running.bundleId ? previous.failures : 0;
  if (running) {
    write({ bundleId: running.bundleId, failures });
    log(
      `launch of ${running.bundleId}${running.builtIn ? ' (built-in)' : ''}, failures=${failures}`
    );
  }

  let healthy = false;
  let recovering = false;
  const recover = async () => {
    if (!running || !updater || recovering) return;
    if (running.builtIn) {
      log('the built-in bundle failed to launch; nothing to roll back');
      return;
    }
    recovering = true;
    try {
      log(`rolling back ${running.bundleId} to the built-in bundle`);
      if (!(await updater.resetChannel())) {
        log('rollback refused by native');
        return;
      }
      await updater.reload();
    } catch (error) {
      log(`rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      recovering = false;
    }
  };

  return {
    /** The first route has settled: this bundle launches, whatever it did before. */
    markHealthy() {
      if (!running || !updater) return;
      healthy = true;
      failures = 0;
      write({ bundleId: running.bundleId, failures });
      try {
        const report = updater.notifyAppReady();
        log(
          `launch healthy, report=${report.status}` +
            (report.fromBundleId ? ` from=${report.fromBundleId} to=${report.toBundleId}` : '')
        );
      } catch {
        // The report is diagnostics; the launch is healthy either way.
      }
    },
    /**
     * The boundary caught a render error. One after the launch settled is a
     * screen's fault, not the bundle's, and keeps the boundary's own retry.
     */
    reportRenderFailure(): Promise<void> {
      if (!running || healthy) return Promise.resolve();
      failures += 1;
      write({ bundleId: running.bundleId, failures });
      log(`launch of ${running.bundleId} failed (${failures}/${FAILED_LAUNCH_LIMIT})`);
      return failures >= FAILED_LAUNCH_LIMIT ? recover() : Promise.resolve();
    },
  };
}
