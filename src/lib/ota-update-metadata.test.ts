import { describe, expect, test } from 'bun:test';
import type { UpdateCheckResult } from '@hot-updater/react-native';
import type { AvailableUpdate } from './app-update-controller';
import { createOtaUpdateMetadata } from './ota-update-metadata';

const fromBundleId = '0199aabb-ccdd-7a00-8000-001122334455';
const toBundleId = '0199aabb-ccdd-7a00-8000-001122334466';
const releaseId = '0199aabb-ccdd-7a00-8000-001122334477';
const event: UpdateCheckResult = {
  status: 'UPDATE_AVAILABLE',
  channel: 'production',
  fromBundleId,
  fromReleaseId: null,
  toBundleId,
  toReleaseId: releaseId,
  transitionKind: 'INSTALL',
  updateStatus: 'UPDATE',
  shouldForceUpdate: false,
  updateStrategy: 'fingerprint',
};
const update: AvailableUpdate = {
  id: releaseId,
  shouldForceUpdate: false,
  transitionKind: 'INSTALL',
  updateBundle: async () => true,
};

describe('public SDK update-check association', () => {
  test('ignores stale release events and unchanged events while waiting for the matching check', async () => {
    const metadata = createOtaUpdateMetadata();
    const hook = metadata.plugin.setup().hooks.onUpdateCheck;
    const checking = metadata.check(
      async () => {
        hook({ ...event, toReleaseId: toBundleId });
        hook({
          status: 'UNCHANGED',
          channel: 'production',
          bundleId: fromBundleId,
          releaseId: null,
          previousReleaseId: null,
        });
        return update;
      },
      fromBundleId,
      'production'
    );
    await Promise.resolve();
    hook(event);
    await checking;
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')?.toBundleId).toBe(toBundleId);
  });
  test('waits for a delayed public hook and binds target to release, base and channel', async () => {
    const metadata = createOtaUpdateMetadata();
    const hook = metadata.plugin.setup().hooks.onUpdateCheck;
    const checking = metadata.check(async () => update, fromBundleId, 'production');
    await Promise.resolve();
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toBeNull();
    hook(event);
    expect(await checking).toBe(update);
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toEqual({
      releaseId,
      fromBundleId,
      toBundleId,
      channel: 'production',
    });
    expect(metadata.getTarget(toBundleId, fromBundleId, 'production')).toBeNull();
    expect(metadata.getTarget(releaseId, toBundleId, 'production')).toBeNull();
    expect(metadata.getTarget(releaseId, fromBundleId, 'preview')).toBeNull();
  });

  test('rejects mismatched hook association and clears prior mapping at the next check', async () => {
    const metadata = createOtaUpdateMetadata(1);
    const hook = metadata.plugin.setup().hooks.onUpdateCheck;
    for (const changed of [
      event,
      { ...event, toReleaseId: toBundleId },
      { ...event, fromBundleId: toBundleId },
      { ...event, channel: 'preview' },
      { ...event, transitionKind: 'ADOPT_RELEASE' as const },
    ]) {
      await metadata.check(
        async () => {
          hook(changed);
          return update;
        },
        fromBundleId,
        'production'
      );
      expect(metadata.getTarget(releaseId, fromBundleId, 'production') !== null).toBe(
        changed === event
      );
    }
    // A late event outside an active check cannot recreate a cleared mapping.
    hook(event);
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toBeNull();
  });

  test('unchanged, errors, built-in rollback and adoption never retain an install target', async () => {
    const metadata = createOtaUpdateMetadata();
    const hook = metadata.plugin.setup().hooks.onUpdateCheck;
    for (const transitionKind of ['ADOPT_RELEASE', 'USE_BUILTIN'] as const) {
      await metadata.check(
        async () => {
          hook({ ...event, transitionKind });
          return { ...update, transitionKind };
        },
        fromBundleId,
        'production'
      );
      expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toBeNull();
    }
    await metadata.check(
      async () => {
        hook({
          status: 'UNCHANGED',
          channel: 'production',
          bundleId: fromBundleId,
          releaseId: null,
          previousReleaseId: null,
        });
        return null;
      },
      fromBundleId,
      'production'
    );
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toBeNull();
    await expect(
      metadata.check(
        async () => {
          throw new Error('check failed');
        },
        fromBundleId,
        'production'
      )
    ).rejects.toThrow('check failed');
    hook(event);
    expect(metadata.getTarget(releaseId, fromBundleId, 'production')).toBeNull();
  });
});
