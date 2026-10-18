import { describe, expect, test } from 'bun:test';
import {
  createAppUpdateController,
  runningAppReleaseId,
  type AvailableUpdate,
  type UpdateClient,
  type UpdateProgress,
  type UpdateSnapshot,
} from './app-update-controller';

const release = (overrides: Partial<AvailableUpdate> = {}): AvailableUpdate => ({
  id: 'release-1',
  shouldForceUpdate: false,
  message: '## Fixed\n- Restore drafts',
  updateBundle: async () => true,
  ...overrides,
});

function fixture(
  check: UpdateClient['checkForUpdate'],
  reload = async () => {},
  runningReleaseId: string | null = null,
  getReleaseNotes?: UpdateClient['getReleaseNotes'],
  getDownloadSize?: UpdateClient['getDownloadSize']
) {
  const states: UpdateSnapshot[] = [];
  let listener = (_event: UpdateProgress) => {};
  let removed = 0;
  let reloads = 0;
  let time = 0;
  const controller = createAppUpdateController(
    {
      checkForUpdate: check,
      getRunningReleaseId: async () => runningReleaseId,
      getReleaseNotes,
      getDownloadSize,
      reload: async () => {
        reloads++;
        await reload();
      },
      addListener: (_name, callback) => {
        listener = callback;
        return () => {
          removed++;
        };
      },
    },
    (state) => states.push(state),
    () => time
  );
  return {
    controller,
    states,
    emit: (event: UpdateProgress) => listener(event),
    removed: () => removed,
    reloads: () => reloads,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const metadata = {
  releaseId: 'release-1',
  required: false,
  releaseNotes: '## Fixed\n- Restore drafts',
};

describe('OTA update consent lifecycle', () => {
  test('size metadata settles before consent without becoming measured progress', async () => {
    let resolveSize: (size: { estimatedBytes: number; fullBytes: number }) => void = () => {};
    const size = new Promise<{ estimatedBytes: number; fullBytes: number }>((resolve) => {
      resolveSize = resolve;
    });
    let downloads = 0;
    const f = fixture(
      async () =>
        release({
          updateBundle: async () => {
            downloads++;
            return true;
          },
        }),
      async () => {},
      null,
      undefined,
      async () => size
    );
    const checking = f.controller.check();
    await Promise.resolve();
    const prematureConsent = f.controller.updateNow();
    resolveSize({ estimatedBytes: 200, fullBytes: 1000 });
    await checking;
    await prematureConsent;
    expect(f.states.at(-1)?.downloadSize).toEqual({ estimatedBytes: 200, fullBytes: 1000 });
    expect(f.states.at(-1)?.totalBytes).toBeUndefined();
    expect(downloads).toBe(0);
    f.controller.defer();
    await f.controller.check();
    expect(downloads).toBe(0);
    await f.controller.checkOnLaunch();
    await f.controller.updateNow();
    expect(downloads).toBe(1);
  });

  test('size outage leaves consent usable and no-transfer transitions skip lookup', async () => {
    for (const transitionKind of ['INSTALL', 'ADOPT_RELEASE', 'USE_BUILTIN'] as const) {
      let calls = 0;
      const f = fixture(
        async () => release({ transitionKind }),
        async () => {},
        null,
        undefined,
        async () => {
          calls++;
          throw new Error('offline');
        }
      );
      await f.controller.check();
      expect(f.states.at(-1)?.phase).toBe('available');
      expect(f.states.at(-1)?.downloadSize).toBeUndefined();
      expect(f.states.at(-1)?.downloadSizeStatus).toBe(
        transitionKind === 'INSTALL' ? 'failed' : undefined
      );
      expect(calls).toBe(transitionKind === 'INSTALL' ? 1 : 0);
      await f.controller.updateNow();
    }
  });
  test('failed size lookup retries only metadata and requires fresh consent after success', async () => {
    let reads = 0;
    let downloads = 0;
    const f = fixture(
      async () =>
        release({
          updateBundle: async () => {
            downloads++;
            return true;
          },
        }),
      async () => {},
      null,
      undefined,
      async () => {
        reads++;
        return reads === 1 ? null : { estimatedBytes: null, fullBytes: 6000 };
      }
    );
    await f.controller.check();
    expect(f.states.at(-1)?.downloadSizeStatus).toBe('failed');
    await f.controller.updateNow();
    expect(f.states.at(-1)?.downloadSize).toEqual({ estimatedBytes: null, fullBytes: 6000 });
    expect(f.states.at(-1)?.downloadSizeStatus).toBeUndefined();
    expect(f.states.some((state) => state.downloadSizeStatus === 'checking')).toBe(true);
    expect(downloads).toBe(0);
    await f.controller.updateNow();
    expect(downloads).toBe(1);
  });
  test.each([false, true])(
    'localized notes load before consent, including required=%s',
    async (required) => {
      let resolveNotes: (notes: string) => void = () => {};
      const notes = new Promise<string>((resolve) => {
        resolveNotes = resolve;
      });
      let downloads = 0;
      const f = fixture(
        async () =>
          release({
            shouldForceUpdate: required,
            updateBundle: async () => {
              downloads++;
              return true;
            },
          }),
        async () => {},
        null,
        async (releaseId) => {
          expect(releaseId).toBe('release-1');
          return notes;
        }
      );
      const checking = f.controller.check();
      await Promise.resolve();
      expect(f.states.at(-1)?.phase).toBe('checking');
      const prematureConsent = f.controller.updateNow();
      // updateNow joins the pending check; it must not grant consent.
      resolveNotes('## 修正\n- 還原草稿');
      await checking;
      await prematureConsent;
      expect(f.states.at(-1)).toEqual({
        ...metadata,
        required,
        phase: 'available',
        progress: 0,
        releaseNotes: '## 修正\n- 還原草稿',
      });
      expect(downloads).toBe(0);
      await f.controller.updateNow();
      expect(downloads).toBe(1);
      expect(f.states.at(-1)?.releaseNotes).toBe('## 修正\n- 還原草稿');
      expect(f.reloads()).toBe(1);
    }
  );

  test.each(['missing', 'offline'])(
    'notes %s keeps the catalog message and consent usable',
    async (failure) => {
      const f = fixture(
        async () => release(),
        async () => {},
        null,
        async () => {
          if (failure === 'offline') throw new Error('offline');
          return null;
        }
      );
      await f.controller.check();
      expect(f.states.at(-1)).toEqual({ ...metadata, phase: 'available', progress: 0 });
      await f.controller.updateNow();
      expect(f.reloads()).toBe(1);
    }
  );

  test.each([false, true])(
    'discovery never downloads or restarts (required=%s)',
    async (required) => {
      let downloads = 0;
      let checks = 0;
      const f = fixture(async () => {
        checks++;
        return release({
          shouldForceUpdate: required,
          updateBundle: async () => {
            downloads++;
            return true;
          },
        });
      });
      await f.controller.check();
      expect(f.states.at(-1)).toEqual({ ...metadata, required, phase: 'available', progress: 0 });
      f.advance(3_600_000);
      await f.controller.check();
      expect(checks).toBe(1);
      expect(downloads).toBe(0);
      expect(f.reloads()).toBe(0);
      expect(f.removed()).toBe(0);
      f.controller.defer();
      expect(f.states.at(-1)?.phase).toBe(required ? 'available' : 'deferred');
      await f.controller.check();
      expect(checks).toBe(1);
      if (required) {
        await f.controller.updateNow();
        expect(downloads).toBe(1);
        expect(f.reloads()).toBe(1);
      } else {
        // Dismissal is a session decision, including when the prompt remounts.
        await f.controller.updateNow();
        expect(downloads).toBe(0);
      }
    }
  );

  test('same installed adoption stays idle, but a later new release still prompts and applies', async () => {
    let applications = 0;
    let checks = 0;
    let releaseId = 'release-1';
    const f = fixture(
      async () => {
        checks++;
        return release({
          id: releaseId,
          transitionKind: releaseId === 'release-1' ? 'ADOPT_RELEASE' : 'INSTALL',
          updateBundle: async () => {
            applications++;
            return true;
          },
        });
      },
      async () => {},
      'release-1'
    );
    await f.controller.check();
    expect(f.states).toEqual([
      { phase: 'checking', progress: 0 },
      { phase: 'idle', progress: 0 },
    ]);
    await f.controller.updateNow();
    f.advance(15 * 60_000);
    await f.controller.check();
    expect(checks).toBe(2);
    expect(applications).toBe(0);
    expect(f.reloads()).toBe(0);
    releaseId = 'release-2';
    f.advance(15 * 60_000);
    await f.controller.check();
    expect(f.states.at(-1)?.phase).toBe('available');
    expect(f.states.at(-1)?.releaseId).toBe('release-2');
    await f.controller.updateNow();
    expect(applications).toBe(1);
    expect(f.reloads()).toBe(1);
  });

  test.each(['same', 'new'] as const)(
    'Later expires on a retained-runtime launch and discovers the %s release',
    async (nextRelease) => {
      let checks = 0;
      let downloads = 0;
      let releaseId = 'release-1';
      const f = fixture(async () => {
        checks++;
        return release({
          id: releaseId,
          updateBundle: async () => {
            downloads++;
            return true;
          },
        });
      });
      await f.controller.checkOnLaunch();
      f.controller.defer();
      f.advance(3_600_000);
      await f.controller.check();
      expect(checks).toBe(1);
      expect(f.states.at(-1)?.phase).toBe('deferred');

      if (nextRelease === 'new') releaseId = 'release-2';
      await f.controller.checkOnLaunch();
      expect(checks).toBe(2);
      expect(f.states.at(-1)).toEqual({
        ...metadata,
        releaseId,
        phase: 'available',
        progress: 0,
      });
      expect(downloads).toBe(0);
      expect(f.reloads()).toBe(0);
      f.controller.defer();
      await f.controller.check();
      expect(checks).toBe(2);
      expect(f.states.at(-1)?.phase).toBe('deferred');
    }
  );

  test('a cold runtime checks the same eligible release after Later without retaining dismissal', async () => {
    let checks = 0;
    const check = async () => {
      checks++;
      return release();
    };
    const firstLaunch = fixture(check);
    await firstLaunch.controller.checkOnLaunch();
    firstLaunch.controller.defer();
    const coldLaunch = fixture(check);
    await coldLaunch.controller.checkOnLaunch();
    expect(checks).toBe(2);
    expect(coldLaunch.states.at(-1)).toEqual({ ...metadata, phase: 'available', progress: 0 });
    expect(coldLaunch.reloads()).toBe(0);
  });

  test('launch checks preserve required consent and an in-flight download', async () => {
    let checks = 0;
    let finishDownload = (_verified: boolean) => {};
    const f = fixture(async () => {
      checks++;
      return release({
        shouldForceUpdate: true,
        updateBundle: () =>
          new Promise<boolean>((resolve) => {
            finishDownload = resolve;
          }),
      });
    });
    await f.controller.checkOnLaunch();
    f.controller.defer();
    await f.controller.checkOnLaunch();
    expect(checks).toBe(1);
    expect(f.states.at(-1)?.phase).toBe('available');
    const downloading = f.controller.updateNow();
    expect(f.controller.checkOnLaunch()).toBe(downloading);
    expect(f.states.at(-1)?.phase).toBe('downloading');
    finishDownload(true);
    await downloading;
    expect(f.reloads()).toBe(1);
  });

  test('a new launch rediscovers a deferred download failure without retrying automatically', async () => {
    let checks = 0;
    let downloads = 0;
    const f = fixture(async () => {
      checks++;
      return release({
        updateBundle: async () => {
          downloads++;
          return false;
        },
      });
    });
    await f.controller.checkOnLaunch();
    await f.controller.updateNow();
    expect(f.states.at(-1)?.phase).toBe('download-failed');
    f.controller.defer();
    await f.controller.checkOnLaunch();
    expect(checks).toBe(2);
    expect(downloads).toBe(1);
    expect(f.states.at(-1)).toEqual({ ...metadata, phase: 'available', progress: 0 });
    expect(f.reloads()).toBe(0);
  });

  test('a launch after deferring a failed restart retains restart-only explicit retry', async () => {
    let checks = 0;
    let downloads = 0;
    const f = fixture(
      async () => {
        checks++;
        return release({
          updateBundle: async () => {
            downloads++;
            return true;
          },
        });
      },
      async () => {
        throw new Error('native restart unavailable');
      }
    );
    await f.controller.checkOnLaunch();
    await f.controller.updateNow();
    f.controller.defer();
    await f.controller.checkOnLaunch();
    expect(f.states.at(-1)).toEqual({ ...metadata, phase: 'restart-failed', progress: 1 });
    expect(f.reloads()).toBe(1);
    await f.controller.updateNow();
    expect(checks).toBe(1);
    expect(downloads).toBe(1);
    expect(f.reloads()).toBe(2);
  });

  test.each(['ADOPT_RELEASE', 'INSTALL', 'USE_BUILTIN'] as const)(
    'a different release %s still waits for consent',
    async (transitionKind) => {
      let applications = 0;
      const f = fixture(
        async () =>
          release({
            transitionKind,
            updateBundle: async () => {
              applications++;
              return true;
            },
          }),
        async () => {},
        'older-release'
      );
      await f.controller.check();
      expect(f.states.at(-1)?.phase).toBe('available');
      expect(applications).toBe(0);
      await f.controller.updateNow();
      expect(applications).toBe(1);
      expect(f.states.at(-1)?.phase).toBe(
        transitionKind === 'ADOPT_RELEASE' ? 'idle' : 'restarting'
      );
    }
  );

  test('consenting to a real adoption publishes Applying before awaiting native commit', async () => {
    let finish = (_applied: boolean) => {};
    const f = fixture(
      async () =>
        release({
          id: 'different-release',
          transitionKind: 'ADOPT_RELEASE',
          updateBundle: () =>
            new Promise<boolean>((resolve) => {
              finish = resolve;
            }),
        }),
      async () => {},
      'release-1'
    );
    await f.controller.check();
    const applying = f.controller.updateNow();
    expect(f.states.at(-1)?.phase).toBe('applying');
    expect(f.controller.updateNow()).toBe(applying);
    finish(true);
    await applying;
    expect(f.states.at(-1)?.phase).toBe('idle');
    expect(f.reloads()).toBe(0);
  });

  test('running identity read failure leaves adoption available and actionable', async () => {
    const states: UpdateSnapshot[] = [];
    let applications = 0;
    const controller = createAppUpdateController(
      {
        checkForUpdate: async () =>
          release({
            transitionKind: 'ADOPT_RELEASE',
            updateBundle: async () => {
              applications++;
              return true;
            },
          }),
        getRunningReleaseId: async () => {
          throw new Error('native identity unavailable');
        },
        addListener: () => () => {},
        reload: async () => {},
      },
      (state) => states.push(state)
    );
    await controller.check();
    expect(states.at(-1)?.phase).toBe('available');
    await controller.updateNow();
    expect(applications).toBe(1);
    expect(states.at(-1)?.phase).toBe('idle');
  });

  test('deduplicates metadata checks and consent actions, and restarts only after verification', async () => {
    let resolveCheck = (_update: AvailableUpdate) => {};
    let finishDownload = (_verified: boolean) => {};
    let checks = 0;
    const f = fixture(() => {
      checks++;
      return new Promise((resolve) => {
        resolveCheck = resolve;
      });
    });
    const checking = f.controller.check();
    expect(f.controller.check()).toBe(checking);
    expect(f.controller.updateNow()).toBe(checking);
    resolveCheck(
      release({
        updateBundle: () =>
          new Promise((resolve) => {
            finishDownload = resolve;
          }),
      })
    );
    await checking;
    const downloading = f.controller.updateNow();
    expect(f.controller.updateNow()).toBe(downloading);
    expect(f.controller.check()).toBe(downloading);
    f.controller.defer();
    f.emit({ progress: 1 });
    expect(f.states.at(-1)?.phase).toBe('downloading');
    expect(f.reloads()).toBe(0);
    f.emit({ progress: NaN });
    expect(f.states.at(-1)?.progress).toBe(1);
    finishDownload(true);
    await downloading;
    expect(f.reloads()).toBe(1);
    expect(f.removed()).toBe(1);
    expect(f.states.at(-1)).toEqual({ ...metadata, phase: 'restarting', progress: 1 });
    f.advance(3_600_000);
    await f.controller.check();
    await f.controller.updateNow();
    expect(checks).toBe(1);
    expect(f.reloads()).toBe(1);
  });

  test('uses measured bytes, replaces fallback plans and never guesses transfer size', async () => {
    const f = fixture(async () =>
      release({
        updateBundle: async () => {
          for (const [event, bytes] of [
            [
              {
                progress: 0.4,
                details: {
                  files: [{ status: 'downloading', downloadedBytes: 200, totalBytes: 1000 }],
                },
              },
              { downloadedBytes: 200, totalBytes: 1000 },
            ],
            [
              {
                progress: 0.5,
                details: {
                  files: [
                    { status: 'downloaded', downloadedBytes: 100, totalBytes: 100 },
                    { status: 'downloading', downloadedBytes: 20 },
                    { status: 'pending' },
                  ],
                },
              },
              { downloadedBytes: 120 },
            ],
            [
              {
                progress: 0.6,
                details: {
                  files: [
                    { status: 'downloaded', downloadedBytes: 100, totalBytes: 100 },
                    { status: 'downloading', downloadedBytes: 50, totalBytes: 200 },
                  ],
                },
              },
              { downloadedBytes: 150, totalBytes: 300 },
            ],
            [
              {
                progress: 0.7,
                details: {
                  files: [{ status: 'downloading', downloadedBytes: NaN, totalBytes: Infinity }],
                },
              },
              {},
            ],
            [
              {
                progress: 0.8,
                details: {
                  files: [{ status: 'downloading', downloadedBytes: -1, totalBytes: -1 }],
                },
              },
              {},
            ],
            [{ progress: 0.9 }, {}],
          ] as const) {
            f.emit(event);
            expect(f.states.at(-1)).toEqual({
              ...metadata,
              phase: 'downloading',
              progress: event.progress,
              ...bytes,
            });
          }
          return true;
        },
      })
    );
    await f.controller.check();
    expect(f.states.at(-1)?.totalBytes).toBeUndefined();
    await f.controller.updateNow();
  });

  test.each(['false', 'reject'] as const)(
    'download %s keeps notes readable and only retries after another click',
    async (failure) => {
      let attempts = 0;
      const f = fixture(async () =>
        release({
          shouldForceUpdate: true,
          updateBundle: async () => {
            attempts++;
            if (attempts > 1) return true;
            if (failure === 'reject') throw new Error('offline');
            return false;
          },
        })
      );
      await f.controller.check();
      await f.controller.updateNow();
      expect(f.states.at(-1)).toEqual({
        ...metadata,
        required: true,
        phase: 'download-failed',
        progress: 0,
      });
      f.controller.defer();
      f.advance(3_600_000);
      await f.controller.check();
      expect(attempts).toBe(1);
      expect(f.reloads()).toBe(0);
      await f.controller.updateNow();
      expect(attempts).toBe(2);
      expect(f.reloads()).toBe(1);
    }
  );

  test('restart retry reuses the verified artifact and requires another click', async () => {
    let downloads = 0;
    let attempts = 0;
    const f = fixture(
      async () =>
        release({
          updateBundle: async () => {
            downloads++;
            return true;
          },
        }),
      async () => {
        attempts++;
        if (attempts === 1) throw new Error('native restart unavailable');
      }
    );
    await f.controller.check();
    await f.controller.updateNow();
    expect(f.states.at(-1)).toEqual({ ...metadata, phase: 'restart-failed', progress: 1 });
    await f.controller.check();
    expect(f.reloads()).toBe(1);
    await f.controller.updateNow();
    expect(f.reloads()).toBe(2);
    expect(downloads).toBe(1);
  });

  test.each(['ADOPT_RELEASE', 'USE_BUILTIN'] as const)(
    '%s still requires consent',
    async (transitionKind) => {
      let applications = 0;
      const f = fixture(async () =>
        release({
          transitionKind,
          shouldForceUpdate: transitionKind === 'USE_BUILTIN',
          updateBundle: async () => {
            applications++;
            return true;
          },
        })
      );
      await f.controller.check();
      expect(applications).toBe(0);
      await f.controller.updateNow();
      expect(applications).toBe(1);
      expect(f.reloads()).toBe(transitionKind === 'ADOPT_RELEASE' ? 0 : 1);
      if (transitionKind === 'ADOPT_RELEASE') {
        expect(f.states.some((state) => state.phase === 'downloading')).toBe(false);
        expect(f.states.at(-1)).toEqual({ phase: 'idle', progress: 0 });
      }
    }
  );

  test.each(['reject', 'callback', 'empty'] as const)(
    'metadata %s failure/absence never locks the app and observes check cooldown',
    async (result) => {
      let checks = 0;
      const f = fixture(async ({ onError }) => {
        checks++;
        if (result === 'reject') throw new Error('offline');
        if (result === 'callback') onError(new Error('offline'));
        return null;
      });
      await f.controller.check();
      expect(f.states.at(-1)).toEqual({
        phase: result === 'empty' ? 'idle' : 'failed',
        progress: 0,
      });
      await f.controller.check();
      expect(checks).toBe(1);
      f.advance(result === 'empty' ? 15 * 60_000 : 60_000);
      await f.controller.check();
      expect(checks).toBe(2);
      expect(f.reloads()).toBe(0);
    }
  );

  test('missing notes stay absent; native listener errors stay contained', async () => {
    const states: UpdateSnapshot[] = [];
    const controller = createAppUpdateController(
      {
        checkForUpdate: async () => release({ message: ' \n ' }),
        reload: async () => {},
        addListener: () => {
          throw new Error('native unavailable');
        },
      },
      (snapshot) => states.push(snapshot)
    );
    await controller.check();
    expect(states.at(-1)?.releaseNotes).toBeUndefined();
    await controller.updateNow();
    expect(states.at(-1)?.phase).toBe('download-failed');
  });

  test('disabled client performs no work', async () => {
    const states: UpdateSnapshot[] = [];
    const controller = createAppUpdateController(null, (state) => states.push(state));
    await controller.checkOnLaunch();
    await controller.check();
    await controller.updateNow();
    controller.defer();
    expect(states).toEqual([]);
  });
});

describe('running release identity', () => {
  test('uses launched artifact identity instead of a staged future selection', () => {
    const state = {
      activeSelection: {
        bundleId: 'future-artifact',
        releaseId: 'future-release',
        channel: 'preview',
      },
      stableSelection: {
        bundleId: 'running-artifact',
        releaseId: 'running-release',
        channel: 'preview',
      },
    };
    expect(runningAppReleaseId(state, 'running-artifact', 'preview')).toBe('running-release');
    expect(runningAppReleaseId(state, 'future-artifact', 'preview')).toBe('future-release');
    expect(runningAppReleaseId(state, 'unknown-artifact', 'preview')).toBeNull();
    expect(runningAppReleaseId(state, 'running-artifact', 'production')).toBeNull();
  });
});
