import { afterAll, expect, test } from 'bun:test';
import { createThemeStarter } from '../authoring';
import { inspectThemeLinkSource, isGitHubThemeLink } from '../link-source';
import { createGitFixture } from './git-fixture';

const fixture = createGitFixture();
afterAll(() => fixture.dispose());
const manifest = createThemeStarter();
const encoded = new TextEncoder().encode(JSON.stringify(manifest));
const blob = fixture.blob(encoded);
const tree = fixture.tree([`100644 blob ${blob}\ttheme.json`]);
const commit = fixture.commit(tree);
const base = 'https://api.github.com/repos/example/theme';
const json = (value: unknown) => ({
  status: 200,
  bytes: new TextEncoder().encode(JSON.stringify(value)),
});

test('repository field detection has no network side effects and excludes download links', () => {
  expect(isGitHubThemeLink('https://github.com/example/theme')).toBe(true);
  expect(isGitHubThemeLink(`https://github.com/example/theme/blob/${commit}/theme.json`)).toBe(
    true
  );
  expect(isGitHubThemeLink('https://github.com/example/theme/releases/download/v1/theme.zip')).toBe(
    false
  );
  expect(isGitHubThemeLink('https://raw.githubusercontent.com/example/theme/main/theme.json')).toBe(
    false
  );
  expect(isGitHubThemeLink('not a URL')).toBe(false);
});

test('a direct theme uses the remote inspector without invoking Git hashing', async () => {
  const calls: string[] = [];
  const result = await inspectThemeLinkSource(
    {
      async get(url) {
        calls.push(url);
        return { status: 200, bytes: encoded };
      },
    },
    async () => {
      throw new Error('Not a Git request');
    },
    'https://example.com/theme.json'
  );
  expect(result.manifest).toEqual(manifest);
  expect(result.commit).toBeUndefined();
  expect(calls).toEqual(['https://example.com/theme.json']);
});

test('repository import pins the default branch then inspects actual Git objects before preview', async () => {
  const payloads: Record<string, unknown> = {
    [`${base}/commits?per_page=1`]: [{ sha: commit, url: `${base}/commits/${commit}` }],
    [`${base}/git/commits/${commit}`]: {
      sha: commit,
      url: `${base}/git/commits/${commit}`,
      tree: { sha: tree },
    },
    [`${base}/git/trees/${tree}`]: {
      sha: tree,
      truncated: false,
      tree: [{ path: 'theme.json', mode: '100644', type: 'blob', sha: blob }],
    },
    [`${base}/git/blobs/${blob}`]: {
      sha: blob,
      size: encoded.length,
      encoding: 'base64',
      content: Buffer.from(encoded).toString('base64'),
    },
  };
  const calls: string[] = [];
  const result = await inspectThemeLinkSource(
    {
      async get(url) {
        calls.push(url);
        if (!Object.hasOwn(payloads, url)) throw new Error('Unexpected request');
        return json(payloads[url]);
      },
    },
    fixture.objects.digest,
    'https://github.com/example/theme'
  );
  expect(result.commit).toBe(commit);
  expect(result.manifest).toEqual(manifest);
  expect(result.resourceDomains).toEqual([]);
  expect(calls).toEqual(Object.keys(payloads));
  const assets = [];
  for await (const asset of result.assets()) assets.push(asset);
  expect(assets).toEqual([]);
  expect(calls).toHaveLength(4);
});

test('invalid local and ambiguous repository sources never start a request', async () => {
  for (const input of [
    'https://127.0.0.1/theme.json',
    'https://github.com/example/theme/blob/main/theme.json',
  ]) {
    let calls = 0;
    await expect(
      inspectThemeLinkSource(
        {
          async get() {
            calls++;
            return json({});
          },
        },
        fixture.objects.digest,
        input
      )
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
