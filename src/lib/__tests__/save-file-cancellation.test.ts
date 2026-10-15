import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';

// Import the real production save functions in an isolated Bun process. Only native
// edges are controlled; local reads/export cleanup use real temporary files. No VM
// rendering or process-wide mocks can replace another suite's filesystem/transport.
const runtime = `
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const scenario = process.env.SAVE_CASE;
const root = mkdtempSync(join(tmpdir(), 'muqun-save-cancel-'));
const cache = { uri: pathToFileURL(root).href + '/' };
const gate = () => Promise.withResolvers();
const readEntered = gate(), readRelease = gate(), permissionEntered = gate(), permissionRelease = gate();
const fetchEntered = gate(), fetchRelease = gate(), bodyEntered = gate(), bodyRelease = gate();
const photosEntered = gate(), photosRelease = gate();
let reads = 0, fetches = 0, permissions = 0, photos = 0, fetchedSignal;
let bodyCancelled = false;
const photoNames = [];
const pathOf = value => typeof value === 'string' ? fileURLToPath(value) : fileURLToPath(value.uri);
class Directory {
  constructor(parent, name) { this.path = name ? join(pathOf(parent), name) : pathOf(parent); this.uri = pathToFileURL(this.path).href; }
  create() { mkdirSync(this.path); }
  delete() { rmSync(this.path, { recursive: true }); }
}
class File {
  constructor(parent, name) { this.path = name ? join(pathOf(parent), name) : pathOf(parent); this.uri = pathToFileURL(this.path).href; }
  get exists() { return existsSync(this.path); }
  get size() { return statSync(this.path).size; }
  get type() { return 'image/png'; }
  create() { writeFileSync(this.path, '', { flag: 'wx' }); }
  write(bytes) { writeFileSync(this.path, bytes); }
  async bytes() {
    reads++; readEntered.resolve();
    if (scenario === 'local-read-cancel') await readRelease.promise;
    return new Uint8Array(readFileSync(this.path));
  }
}
mock.module('expo-file-system', () => ({ Directory, File, Paths: { cache } }));
mock.module('expo-media-library', () => ({
  async requestPermissionsAsync(...args) {
    assert.deepEqual(args, [true, []]);
    permissions++; permissionEntered.resolve();
    if (scenario.endsWith('permission-cancel')) await permissionRelease.promise;
    return { granted: scenario !== 'local-permission-denied' };
  },
  Asset: { async create(uri) {
    assert.ok(existsSync(fileURLToPath(uri)));
    photos++; photoNames.push(fileURLToPath(uri).split('/').pop()); photosEntered.resolve();
    if (scenario === 'already-started-photos') await photosRelease.promise;
  } }
}));
mock.module('expo-sharing', () => ({}));
mock.module('react-native', () => ({ Platform: { OS: 'android' } }));
mock.module('@/lib/gateway-client', () => ({
  assetPreviewImage() { return null; }, readAssetBytes() { throw new Error('Unexpected asset read'); }
}));
mock.module('expo/fetch', () => ({ async fetch(_url, init) {
  fetches++; fetchedSignal = init.signal; fetchEntered.resolve();
  assert.equal(init.redirect, 'error');
  if (scenario === 'remote-fetch-cancel') {
    await fetchRelease.promise;
    if (init.signal?.aborted) throw new Error('Transport aborted');
  }
  const body = scenario === 'remote-body-cancel'
    ? new ReadableStream({ async pull(controller) {
        bodyEntered.resolve(); await bodyRelease.promise;
        if (!bodyCancelled) { controller.enqueue(new Uint8Array([1,2,3,4])); controller.close(); }
      }, cancel() { bodyCancelled = true; } }, { highWaterMark: 0 })
    : new Uint8Array([1,2,3,4]);
  return new Response(body, { headers: { 'Content-Type': 'image/png', 'Content-Length': '4' } });
} }));
const { savePreviewImage } = await import('./src/lib/save-file.ts');
const { saveOriginalPreview } = await import('./src/lib/gateway-image-previews.ts');
const controller = new AbortController();
const localPath = join(root, 'source.png'); writeFileSync(localPath, new Uint8Array([1,2,3,4]));
let source = { uri: scenario.startsWith('remote-') ? 'https://synthetic.example/image' : pathToFileURL(localPath).href };
if (scenario === 'verified-permission-cancel') {
  const directory = join(root, 'file-export-123-1'); mkdirSync(directory);
  const path = join(directory, 'original.png'); writeFileSync(path, new Uint8Array([1,2,3,4]));
  source = { uri: pathToFileURL(path).href, verifiedOriginal: { size: 4, mime: 'image/png' }, dispose() { rmSync(directory, { recursive: true }); } };
}
try {
  if (scenario === 'pre-aborted') controller.abort();
  const operation = saveOriginalPreview({ id: 'fixture', ...source }, savePreviewImage, controller.signal);
  const settled = operation.then(() => ({ ok: true }), error => ({ error }));
  if (scenario.endsWith('permission-cancel')) {
    await permissionEntered.promise;
    assert.equal(photos, 0);
    controller.abort(); permissionRelease.resolve();
  } else if (scenario === 'local-read-cancel') {
    await readEntered.promise; controller.abort(); readRelease.resolve();
  } else if (scenario === 'remote-fetch-cancel') {
    await fetchEntered.promise; controller.abort(); fetchRelease.resolve();
  } else if (scenario === 'remote-body-cancel') {
    await bodyEntered.promise; controller.abort(); bodyRelease.resolve();
  } else if (scenario === 'already-started-photos') {
    await photosEntered.promise; controller.abort(); photosRelease.resolve();
  }
  const result = await settled;
  if (scenario.endsWith('-cancel') || scenario === 'pre-aborted') {
    assert.ok(result.error, 'cancelled save must reject');
    assert.match(result.error.message, /cancelled|aborted/i);
    assert.equal(photos, 0, 'cancelled save must not start Photos');
  } else if (scenario === 'local-permission-denied') {
    assert.equal(result.error?.message, 'Photo permission denied'); assert.equal(photos, 0);
  } else {
    assert.equal(result.ok, true); assert.equal(photos, 1);
    assert.deepEqual(photoNames, ['muqun-image.png']);
  }
  if (scenario.startsWith('remote-')) assert.equal(fetchedSignal, controller.signal);
  else assert.equal(fetches, 0, 'local/verified image must not fetch');
  if (scenario === 'verified-permission-cancel') assert.equal(reads, 0);
  if (['local-read-cancel', 'remote-fetch-cancel', 'remote-body-cancel', 'pre-aborted'].includes(scenario)) assert.equal(permissions, 0);
  if (scenario === 'remote-body-cancel') assert.equal(bodyCancelled, true);
  assert.deepEqual(readdirSync(root), ['source.png'], 'owned staging/export directories must be cleaned');
} finally { rmSync(root, { recursive: true, force: true }); }
`;

test.each([
  'verified-permission-cancel',
  'local-permission-cancel',
  'remote-permission-cancel',
  'local-read-cancel',
  'remote-fetch-cancel',
  'remote-body-cancel',
  'local-permission-success',
  'local-permission-denied',
  'already-started-photos',
  'pre-aborted',
])('production image save: %s', (scenario) => {
  const result = spawnSync(process.execPath, ['--eval', runtime], {
    env: { ...process.env, SAVE_CASE: scenario },
    encoding: 'utf8',
    timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
