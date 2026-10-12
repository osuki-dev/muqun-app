import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Native mocks are isolated: Bun's process-wide module cache must not replace
// filesystem/image implementations used by the rest of the repository tests.
test('the shared native action preserves ownership and the due check cancels without scanning', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--eval',
      `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    const state = {
      hydrated: true, cacheCleanupIntervalDays: 10,
      cacheCleanupEnabledAt: Date.now(), cacheCleanupLastSuccessAt: 0,
      async update(patch) { Object.assign(state, patch); }
    };
    const root = 'file:///cache/';
    let reads = 0, images = 0, imageResult = true, failDelete = false;
    let names = ['ImagePicker', 'DocumentPicker', 'theme-stage-old', 'enrm_image_cache',
      'mmkv', 'updates', '../documents/ImagePicker'];
    const deleted = [];
    let deletionGate = null;
    mock.module('expo-file-system', () => ({ Paths: { cache: {
      list() { throw new Error('no synchronous filesystem access'); }, uri: root
    } } }));
    mock.module('expo-file-system/legacy', () => ({ cacheDirectory: root,
      async readDirectoryAsync() { reads++; return names; },
      async deleteAsync(uri) {
        if (deletionGate) await deletionGate;
        deleted.push(uri);
        if (failDelete && uri.endsWith('theme-stage-old')) throw new Error('locked');
      }
    }));
    mock.module('expo-image', () => ({ Image: {
      async clearDiskCache() { images++; return imageResult; }
    } }));
    mock.module('@/stores/app-settings', () => ({ useAppSettings: { getState: () => state } }));
    const listeners = new Set();
    const AppState = { currentState: 'active', addEventListener(_, callback) {
      listeners.add(callback); return { remove() { listeners.delete(callback); } };
    } };
    mock.module('react-native', () => ({ AppState }));
    const idle = new Map();
    let nextIdle = 0;
    globalThis.requestIdleCallback = callback => { idle.set(++nextIdle, callback); return nextIdle; };
    globalThis.cancelIdleCallback = handle => idle.delete(handle);
    const clean = await import('./src/lib/cache-cleanup.ts');
    const old = 'audio-preview-' + (clean.CACHE_PROCESS_STARTED_AT - 1) + '-0.mp3';
    const current = 'audio-preview-' + (clean.CACHE_PROCESS_STARTED_AT + 10000) + '-0.mp3';
    names.push(old, current);
    await clean.protectCacheDirectory('ImagePicker');
    await clean.protectCacheDirectory('theme-stage-active');
    names.push('theme-stage-active');
    assert.equal(await clean.clearCache(), true);
    assert.deepEqual(deleted, [root + 'DocumentPicker', root + 'theme-stage-old', root + old]);
    assert.ok(state.cacheCleanupLastSuccessAt > 0);
    const success = state.cacheCleanupLastSuccessAt;
    clean.releaseCacheDirectory('theme-stage-active');
    imageResult = false;
    deleted.length = 0;
    assert.equal(await clean.clearCache(), false);
    assert.ok(deleted.includes(root + 'theme-stage-active'));
    assert.equal(state.cacheCleanupLastSuccessAt, success);
    imageResult = true; failDelete = true;
    deleted.length = 0;
    assert.equal(await clean.clearCache(), false);
    assert.ok(deleted.includes(root + old)); // A locked directory does not abandon the pass.
    assert.equal(state.cacheCleanupLastSuccessAt, success);
    failDelete = false;
    state.cacheCleanupEnabledAt = Date.now();
    const before = reads;
    clean.scheduleAutomaticCacheCleanup()();
    assert.equal(reads, before);
    assert.equal(idle.size, 0);
    state.cacheCleanupEnabledAt = Date.now() - 11 * 86400000;
    state.cacheCleanupLastSuccessAt = 0;
    const cancel = clean.scheduleAutomaticCacheCleanup();
    assert.equal(idle.size, 1);
    AppState.currentState = 'background';
    for (const listener of listeners) listener('background');
    assert.equal(idle.size, 0);
    assert.equal(listeners.size, 0);
    cancel();
    assert.equal(reads, before);
    AppState.currentState = 'active';
    const gate = Promise.withResolvers();
    deletionGate = gate.promise;
    const automatic = clean.clearCache();
    const manual = clean.clearCache();
    assert.equal(automatic, manual);
    await Promise.resolve(); await Promise.resolve();
    let pickerStarted = false;
    const producer = clean.protectCacheDirectory('DocumentPicker').then(() => pickerStarted = true);
    await Promise.resolve();
    assert.equal(pickerStarted, false);
    gate.resolve();
    await automatic; await producer;
    assert.equal(pickerStarted, true);
    deletionGate = null;
    assert.equal(await clean.clearCache(() => false), false);
    assert.ok(images > 0);
  `,
    ],
    { encoding: 'utf8', timeout: 10_000 }
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
