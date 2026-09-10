import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createThemeStarter } from '@/theme/authoring';
import { packTheme } from '@/theme/package';
import {
  inspectRemoteTheme,
  publicThemeUrl,
  type PublicThemeTransport,
} from '@/theme/remote-import';
import { THEME_LIMITS } from '@/theme/schema';

const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const ok = (bytes: Uint8Array) => ({ status: 200, bytes });

test('URL policy rejects credentials, alternate address literals, private names and unsafe schemes', () => {
  for (const url of [
    'http://example.com/a',
    'https://u:p@example.com/a',
    'https://127.1/a',
    'https://0x7f000001/a',
    'https://[::1]/a',
    'https://router.local/a',
    'https://localhost/a',
    'https://example.com:8443/a',
    'https://example.com\\@127.0.0.1/a',
  ])
    expect(() => publicThemeUrl(url)).toThrow();
  expect(publicThemeUrl('https://raw.githubusercontent.com/org/repo/theme.json#x')).toBe(
    'https://raw.githubusercontent.com/org/repo/theme.json'
  );
});

test('redirect destinations are validated before requesting them and loops are bounded', async () => {
  const calls: string[] = [];
  const transport: PublicThemeTransport = {
    async get(url) {
      calls.push(url);
      return { status: 302, location: 'https://127.0.0.1/private', bytes: new Uint8Array() };
    },
  };
  await expect(inspectRemoteTheme(transport, 'https://example.com/theme')).rejects.toThrow();
  expect(calls).toEqual(['https://example.com/theme']);
  transport.get = async () => ({ status: 302, location: '/theme', bytes: new Uint8Array() });
  await expect(inspectRemoteTheme(transport, 'https://example.com/theme')).rejects.toThrow('loop');
});

test('manifest size, HTML, malformed UTF-8 and canceled requests fail without library writes', async () => {
  for (const response of [
    ok(new Uint8Array(THEME_LIMITS.manifestBytes + 1)),
    { ...ok(text({})), contentType: 'text/html; charset=utf-8' },
    ok(new Uint8Array([0xff])),
  ]) {
    await expect(
      inspectRemoteTheme({ get: async () => response }, 'https://example.com/theme')
    ).rejects.toThrow();
  }
  const controller = new AbortController();
  let requested = false;
  controller.abort();
  await expect(
    inspectRemoteTheme(
      {
        get: async () => {
          requested = true;
          return ok(text(createThemeStarter()));
        },
      },
      'https://example.com/theme',
      { signal: controller.signal }
    )
  ).rejects.toThrow();
  expect(requested).toBe(false);
});

test('resource domains are inspectable before images download; returned manifest is isolated', async () => {
  const manifest = createThemeStarter();
  manifest.assets = {
    paper: { url: 'https://images.example.com/paper.png', sha256: 'a'.repeat(64) },
  };
  manifest.decoration = { 'shell.background': { asset: 'paper' } };
  const calls: string[] = [];
  const png = new Uint8Array(readFileSync('assets/images/favicon.png'));
  const inspected = await inspectRemoteTheme(
    {
      async get(url) {
        calls.push(url);
        return ok(url.includes('images.example.com') ? png : text(manifest));
      },
    },
    'https://example.com/theme.json'
  );
  expect(calls.length).toBe(1);
  expect(inspected.resourceDomains).toEqual(['images.example.com']);
  inspected.manifest.name = 'Mutated preview';
  const downloaded = await inspected.downloadAssets();
  expect(calls.length).toBe(2);
  expect(downloaded.manifest.name).toBe(manifest.name);
  expect(downloaded.manifest.assets?.paper).toEqual({
    path: 'assets/paper.png',
    sha256: 'a'.repeat(64),
  });
  expect(downloaded.assets.paper).toEqual(png);
});

test('image redirects cannot contact an unreviewed domain and failed images never return partial packages', async () => {
  const manifest = createThemeStarter();
  manifest.assets = { paper: { url: 'https://images.example.com/paper.png' } };
  let requests = 0;
  const inspected = await inspectRemoteTheme(
    {
      async get() {
        requests++;
        return requests === 1
          ? ok(text(manifest))
          : { status: 302, location: 'https://other.example.com/image', bytes: new Uint8Array() };
      },
    },
    'https://example.com/theme.json'
  );
  await expect(inspected.downloadAssets()).rejects.toThrow('unapproved');
  expect(requests).toBe(2);
});

test('offline package downloads reuse bounded archive validation without image requests', async () => {
  let calls = 0;
  const manifest = createThemeStarter();
  const archive = packTheme({ manifest, assets: {} });
  const inspected = await inspectRemoteTheme(
    {
      async get() {
        calls++;
        return ok(archive);
      },
    },
    'https://example.com/theme.muqun-theme',
    { format: 'package' }
  );
  expect(inspected.resourceDomains).toEqual([]);
  expect(await inspected.downloadAssets()).toEqual({ manifest, assets: {} });
  expect(calls).toBe(1);
});

test('abort settles promptly even when a transport never resolves', async () => {
  const controller = new AbortController();
  const result = inspectRemoteTheme(
    { get: () => new Promise(() => {}) },
    'https://example.com/theme',
    { signal: controller.signal }
  );
  controller.abort(new Error('Canceled by user'));
  await expect(result).rejects.toThrow('Canceled by user');
});

test('image iterator waits for consumption and keeps each download budget independent', async () => {
  const manifest = createThemeStarter();
  manifest.assets = {
    paper: { url: 'https://images.example.com/paper.png' },
    chrome: { url: 'https://images.example.com/chrome.png' },
  };
  const png = new Uint8Array(readFileSync('assets/images/favicon.png'));
  const calls: { url: string; maxBytes: number }[] = [];
  const inspected = await inspectRemoteTheme(
    {
      async get(url, options) {
        calls.push({ url, maxBytes: options.maxBytes });
        return ok(url.includes('images.example.com') ? png : text(manifest));
      },
    },
    'https://example.com/theme.json'
  );
  const iterator = inspected.assets();
  expect(calls).toHaveLength(1);
  expect((await iterator.next()).value).toEqual({ id: 'paper', bytes: png });
  await Promise.resolve();
  expect(calls).toHaveLength(2);
  expect((await iterator.next()).value).toEqual({ id: 'chrome', bytes: png });
  expect(calls.slice(1).map((call) => call.maxBytes)).toEqual([
    THEME_LIMITS.assetBytes,
    THEME_LIMITS.assetBytes,
  ]);
  expect((await iterator.next()).done).toBe(true);
  expect(calls).toHaveLength(3);
});

test('stream inherits cancellation and never requests the next image after cancellation', async () => {
  const manifest = createThemeStarter();
  manifest.assets = {
    paper: { path: 'assets/paper.png' },
    chrome: { path: 'assets/chrome.png' },
  };
  const png = new Uint8Array(readFileSync('assets/images/favicon.png'));
  const controller = new AbortController();
  let calls = 0;
  const inspected = await inspectRemoteTheme(
    {
      async get() {
        return ok(++calls === 1 ? text(manifest) : png);
      },
    },
    'https://example.com/theme.json',
    { signal: controller.signal }
  );
  const iterator = inspected.assets();
  await iterator.next();
  controller.abort(new Error('Canceled by user'));
  await expect(iterator.next()).rejects.toThrow('Canceled by user');
  expect(calls).toBe(2);
});

test('editing preview domains cannot authorize new streaming redirect destinations', async () => {
  const manifest = createThemeStarter();
  manifest.assets = { paper: { url: 'https://images.example.com/paper.png' } };
  const calls: string[] = [];
  const inspected = await inspectRemoteTheme(
    {
      async get(url) {
        calls.push(url);
        return calls.length === 1
          ? ok(text(manifest))
          : { status: 302, location: 'https://other.example.com/image', bytes: new Uint8Array() };
      },
    },
    'https://example.com/theme.json'
  );
  (inspected.resourceDomains as string[]).push('other.example.com');
  inspected.manifest.assets!.paper = { url: 'https://other.example.com/image' };
  await expect(inspected.assets().next()).rejects.toThrow('unapproved');
  expect(calls).toEqual(['https://example.com/theme.json', 'https://images.example.com/paper.png']);
});
