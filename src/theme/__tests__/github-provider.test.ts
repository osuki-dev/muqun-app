import { afterAll, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createThemeStarter } from '../authoring';
import { inspectGithubTheme } from '../github-provider';
import type { PublicThemeTransport } from '../remote-import';
import { createGitFixture } from './git-fixture';

const fixture = createGitFixture();
afterAll(() => fixture.dispose());
const image = new Uint8Array(
  readFileSync(new URL('../../../assets/images/favicon.png', import.meta.url))
);
const manifest = createThemeStarter();
manifest.assets = { logo: { path: 'assets/logo.png' } };
manifest.decoration = { 'shell.background': { asset: 'logo' } };
const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
const imageOid = fixture.blob(image);
const manifestOid = fixture.blob(manifestBytes);
const assetTree = fixture.tree([`100644 blob ${imageOid}\tlogo.png`]);
const rootTree = fixture.tree([
  `040000 tree ${assetTree}\tassets`,
  `100644 blob ${manifestOid}\ttheme.json`,
]);
const commit = fixture.commit(rootTree);
const repository = 'https://github.com/example/theme';
const base = 'https://api.github.com/repos/example/theme/git';
const source = { repository, commit, manifestPath: 'theme.json' };
type Payload = Record<string, unknown>;
const blob = (sha: string, bytes: Uint8Array): Payload => ({
  sha,
  size: bytes.length,
  encoding: 'base64',
  content: Buffer.from(bytes).toString('base64'),
});
const payloads: Record<string, Payload> = {
  [`${base}/commits/${commit}`]: {
    sha: commit,
    url: `${base}/commits/${commit}`,
    tree: { sha: rootTree },
  },
  [`${base}/trees/${rootTree}`]: {
    sha: rootTree,
    truncated: false,
    tree: [
      // Provider order is immaterial; Git canonical byte ordering determines hash.
      { path: 'theme.json', mode: '100644', type: 'blob', sha: manifestOid },
      { path: 'assets', mode: '040000', type: 'tree', sha: assetTree },
    ],
  },
  [`${base}/trees/${assetTree}`]: {
    sha: assetTree,
    truncated: false,
    tree: [{ path: 'logo.png', mode: '100644', type: 'blob', sha: imageOid }],
  },
  [`${base}/blobs/${manifestOid}`]: blob(manifestOid, manifestBytes),
  [`${base}/blobs/${imageOid}`]: blob(imageOid, image),
};
function transport(change?: (url: string, payload: Payload) => void) {
  const calls: string[] = [];
  const port: PublicThemeTransport = {
    async get(url, options) {
      options.signal.throwIfAborted();
      calls.push(url);
      if (!(url in payloads)) throw new Error('Unexpected request');
      const payload = JSON.parse(JSON.stringify(payloads[url])) as Payload;
      change?.(url, payload);
      return { status: 200, bytes: new TextEncoder().encode(JSON.stringify(payload)) };
    },
  };
  return { port, calls };
}

test('GitHub REST reconstructs actual isolated Git tree/blob identities and streams real image', async () => {
  const { port, calls } = transport();
  const result = await inspectGithubTheme(port, fixture.objects.digest, source);
  expect(result.manifest).toEqual(manifest);
  expect(result.verification).toBe('provider-attested-commit-verified-objects');
  expect(calls.length).toBe(3);
  const assets = [];
  for await (const asset of result.assets()) assets.push(asset);
  expect(assets).toEqual([{ id: 'logo', bytes: image }]);
  expect(calls.length).toBe(5);
  expect(calls.every((url) => url.startsWith(base + '/'))).toBe(true);
});

test('pinned commit metadata must match both repository and immutable revision', async () => {
  for (const changes of [
    { sha: 'a'.repeat(40) },
    { url: `${base}/commits/other` },
    { tree: { sha: 'HEAD' } },
  ]) {
    const { port } = transport((url, value) => {
      if (url.includes('/commits/')) Object.assign(value, changes);
    });
    await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow(
      'reviewed'
    );
  }
});

test('tree modifications cannot pass by retaining the original SHA metadata', async () => {
  const { port } = transport((url, value) => {
    if (url === `${base}/trees/${rootTree}`) {
      const entries = value.tree as Payload[];
      entries[0].path = 'changed.json';
    }
  });
  await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow(
    'identity'
  );
});

test('blob modifications are detected against the Git object hash', async () => {
  const { port } = transport((url, value) => {
    if (url === `${base}/blobs/${manifestOid}`) {
      const bytes = manifestBytes.slice();
      bytes[0] = 32;
      value.content = Buffer.from(bytes).toString('base64');
    }
  });
  await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow(
    'identity'
  );
});

test('valid Git identities do not authorize symlinks, executable files or submodules', async () => {
  for (const mode of ['120000', '100755', '160000']) {
    const type = mode === '160000' ? 'commit' : 'blob';
    const oid = type === 'commit' ? commit : manifestOid;
    const tree = fixture.tree([`${mode} ${type} ${oid}\ttheme.json`]);
    const pinned = fixture.commit(tree);
    const calls: string[] = [];
    const port: PublicThemeTransport = {
      async get(url) {
        calls.push(url);
        const payload =
          url === `${base}/commits/${pinned}`
            ? { sha: pinned, url, tree: { sha: tree } }
            : { sha: tree, truncated: false, tree: [{ path: 'theme.json', mode, type, sha: oid }] };
        return { status: 200, bytes: new TextEncoder().encode(JSON.stringify(payload)) };
      },
    };
    await expect(
      inspectGithubTheme(port, fixture.objects.digest, { ...source, commit: pinned })
    ).rejects.toThrow('links, submodules or executable');
    expect(calls.length).toBe(2);
  }
});

test('oversized transport bodies are rejected even when a faulty adapter ignores its bound', async () => {
  const port: PublicThemeTransport = {
    async get(_, options) {
      return { status: 200, bytes: new Uint8Array(options.maxBytes + 1) };
    },
  };
  await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow(
    'oversized'
  );
});

test('truncated trees, malformed paths, duplicate entries and unknown modes reject', async () => {
  for (const mutate of [
    (value: Payload) => {
      value.truncated = true;
    },
    (value: Payload) => {
      (value.tree as Payload[])[0].path = '../theme.json';
    },
    (value: Payload) => {
      (value.tree as Payload[])[0].mode = '000000';
    },
    (value: Payload) => {
      (value.tree as Payload[]).push((value.tree as Payload[])[0]);
    },
  ]) {
    const { port } = transport((url, value) => {
      if (url.includes('/trees/')) mutate(value);
    });
    await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow();
  }
});

test('base64 encoding and reported size are checked before blob allocation', async () => {
  for (const changes of [
    { size: 99_000_000 },
    { encoding: 'utf-8' },
    { content: '@@@@' },
    { size: -1 },
  ]) {
    const { port } = transport((url, value) => {
      if (url.includes('/blobs/')) Object.assign(value, changes);
    });
    await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow();
  }
});

test('redirects and rate limits never follow or retry response destinations', async () => {
  for (const status of [301, 302, 307, 403, 404, 429]) {
    let calls = 0;
    const port: PublicThemeTransport = {
      async get() {
        calls++;
        return { status, location: 'https://127.0.0.1/secret', bytes: new Uint8Array() };
      },
    };
    await expect(inspectGithubTheme(port, fixture.objects.digest, source)).rejects.toThrow('HTTP');
    expect(calls).toBe(1);
  }
});

test('cancellation covers transport and asset iterator without additional requests', async () => {
  const controller = new AbortController();
  const { port, calls } = transport();
  const result = await inspectGithubTheme(port, fixture.objects.digest, source, controller.signal);
  controller.abort(new Error('Canceled'));
  await expect(result.assets().next()).rejects.toThrow('Canceled');
  expect(calls.length).toBe(3);
  await expect(
    inspectGithubTheme(port, fixture.objects.digest, source, controller.signal)
  ).rejects.toThrow('Canceled');
  expect(calls.length).toBe(3);
});

test('aborting a transport that ignores its signal still settles promptly', async () => {
  const controller = new AbortController();
  const pending = inspectGithubTheme(
    { get: () => new Promise(() => {}) },
    fixture.objects.digest,
    source,
    controller.signal
  );
  controller.abort(new Error('Stop'));
  await expect(pending).rejects.toThrow('Stop');
});
