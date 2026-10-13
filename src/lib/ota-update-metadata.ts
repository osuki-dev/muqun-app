import type { HotUpdaterClientPlugin, UpdateCheckResult } from '@hot-updater/react-native';
import type { AvailableUpdate } from './app-update-controller';

export type OtaArtifactTarget = {
  releaseId: string;
  fromBundleId: string;
  toBundleId: string;
  channel: string;
};

/** Associates public SDK events with the latest successful install check. */
export function createOtaUpdateMetadata(hookTimeoutMs = 5000) {
  let receive: ((event: UpdateCheckResult) => void) | null = null;
  let target: OtaArtifactTarget | null = null;
  let generation = 0;
  const plugin = {
    id: 'muqunUpdateMetadata',
    setup: () => ({
      hooks: {
        onUpdateCheck: (event) => {
          receive?.(event);
        },
      },
    }),
  } satisfies HotUpdaterClientPlugin;
  return {
    plugin,
    async check(
      operation: () => Promise<AvailableUpdate | null>,
      fromBundleId: string,
      channel: string
    ): Promise<AvailableUpdate | null> {
      target = null;
      const checkGeneration = ++generation;
      let successfulInstall = false;
      let expectedReleaseId: string | null = null;
      const observed = new Map<
        string,
        Extract<UpdateCheckResult, { status: 'UPDATE_AVAILABLE' }>
      >();
      let resolveEvent: (event: UpdateCheckResult | null) => void = () => {};
      const event = new Promise<UpdateCheckResult | null>((resolve) => {
        resolveEvent = resolve;
      });
      const associate = (checked: UpdateCheckResult) => {
        if (
          checkGeneration !== generation ||
          checked.status !== 'UPDATE_AVAILABLE' ||
          checked.transitionKind !== 'INSTALL' ||
          checked.toReleaseId !== expectedReleaseId ||
          !expectedReleaseId ||
          checked.fromBundleId !== fromBundleId ||
          checked.channel !== channel
        )
          return;
        target = {
          releaseId: expectedReleaseId,
          fromBundleId,
          toBundleId: checked.toBundleId,
          channel,
        };
        resolveEvent(checked);
      };
      // Init dispatches check hooks after its asynchronous launch report. Wait
      // for that hook, without allowing a missing hook to block discovery.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      receive = (checked) => {
        if (
          checked.status !== 'UPDATE_AVAILABLE' ||
          checkGeneration !== generation ||
          checked.transitionKind !== 'INSTALL' ||
          checked.fromBundleId !== fromBundleId ||
          checked.channel !== channel ||
          !checked.toReleaseId
        )
          return;
        observed.set(checked.toReleaseId, checked);
        associate(checked);
      };
      try {
        const update = await operation();
        if (
          !update ||
          update.transitionKind === 'ADOPT_RELEASE' ||
          update.transitionKind === 'USE_BUILTIN'
        )
          return update;
        expectedReleaseId = update.id;
        successfulInstall = true;
        timeout = setTimeout(() => resolveEvent(null), hookTimeoutMs);
        const checked = observed.get(update.id);
        if (checked) associate(checked);
        else await event;
        return update;
      } finally {
        // A launch hook can arrive after the bounded discovery wait. Keep the
        // successful check's exact identity so a metadata-only retry recovers.
        // The next check replaces this receiver and invalidates its generation.
        if (checkGeneration === generation && !successfulInstall) {
          receive = null;
          target = null;
        }
        clearTimeout(timeout);
      }
    },
    getTarget(releaseId: string, fromBundleId: string, channel: string): OtaArtifactTarget | null {
      return target?.releaseId === releaseId &&
        target.fromBundleId === fromBundleId &&
        target.channel === channel
        ? target
        : null;
    },
  };
}
