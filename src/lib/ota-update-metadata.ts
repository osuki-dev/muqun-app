import type { HotUpdaterClientPlugin, UpdateCheckResult } from '@hot-updater/react-native';
import type { AvailableUpdate } from './app-update-controller';

export type OtaArtifactTarget = {
  releaseId: string;
  fromBundleId: string;
  toBundleId: string;
  channel: string;
};

/** Associates the public SDK check event with only the check currently in flight. */
export function createOtaUpdateMetadata(hookTimeoutMs = 5000) {
  let receive: ((event: UpdateCheckResult) => void) | null = null;
  let target: OtaArtifactTarget | null = null;
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
      let expectedReleaseId: string | null = null;
      const observed = new Map<
        string,
        Extract<UpdateCheckResult, { status: 'UPDATE_AVAILABLE' }>
      >();
      let resolveEvent: (event: UpdateCheckResult | null) => void = () => {};
      const event = new Promise<UpdateCheckResult | null>((resolve) => {
        resolveEvent = resolve;
      });
      // Init dispatches check hooks after its asynchronous launch report. Wait
      // for that hook, without allowing a missing hook to block discovery.
      let timeout: ReturnType<typeof setTimeout> | undefined;
      receive = (checked) => {
        if (
          checked.status !== 'UPDATE_AVAILABLE' ||
          checked.transitionKind !== 'INSTALL' ||
          checked.fromBundleId !== fromBundleId ||
          checked.channel !== channel ||
          !checked.toReleaseId
        )
          return;
        observed.set(checked.toReleaseId, checked);
        if (checked.toReleaseId === expectedReleaseId) resolveEvent(checked);
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
        timeout = setTimeout(() => resolveEvent(null), hookTimeoutMs);
        const checked = observed.get(update.id) ?? (await event);
        if (
          checked?.status === 'UPDATE_AVAILABLE' &&
          checked.transitionKind === 'INSTALL' &&
          checked.toReleaseId === update.id &&
          checked.fromBundleId === fromBundleId &&
          checked.channel === channel
        ) {
          target = {
            releaseId: update.id,
            fromBundleId,
            toBundleId: checked.toBundleId,
            channel,
          };
        }
        return update;
      } finally {
        receive = null;
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
