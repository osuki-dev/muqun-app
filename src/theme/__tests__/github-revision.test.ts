import { expect, test } from 'bun:test';
import { githubThemeRevisionResolver } from '../github-revision';
import { parseGitThemeRequest, resolveGitThemeReview } from '../git-source';
import type { PublicThemeTransport } from '../remote-import';

const repository = 'https://github.com/example/theme';
const sha = 'a'.repeat(40);
const body = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const metadata = [{ sha, url: `https://api.github.com/repos/example/theme/commits/${sha}` }];

test('default branch resolves once to the exact immutable review', async () => {
  const calls: string[] = [];
  const transport: PublicThemeTransport = {
    async get(url, options) {
      calls.push(url);
      expect(options.maxBytes).toBe(1024 * 1024);
      return { status: 200, bytes: body(metadata) };
    },
  };
  const review = await resolveGitThemeReview(
    parseGitThemeRequest(repository),
    githubThemeRevisionResolver(transport)
  );
  expect(review.source.commit).toBe(sha);
  expect(calls).toEqual(['https://api.github.com/repos/example/theme/commits?per_page=1']);
});

test('literal slash refs are encoded as query data, not guessed path components', async () => {
  let requested = '';
  const resolver = githubThemeRevisionResolver({
    async get(url) {
      requested = url;
      return { status: 200, bytes: body(metadata) };
    },
  });
  await resolver.resolve(parseGitThemeRequest(repository, { revision: 'release/spring' }), {});
  expect(requested).toBe(
    'https://api.github.com/repos/example/theme/commits?per_page=1&sha=release%2Fspring'
  );
});

test('redirects and rate limits never retry or follow response destinations', async () => {
  for (const status of [301, 302, 307, 403, 404, 429, 500]) {
    let calls = 0;
    const resolver = githubThemeRevisionResolver({
      async get() {
        calls++;
        return { status, bytes: body({}), location: 'https://other.example.com/private' };
      },
    });
    await expect(resolver.resolve(parseGitThemeRequest(repository), {})).rejects.toThrow();
    expect(calls).toBe(1);
  }
});

test('metadata from another repository, invalid commits and ambiguous results are rejected', async () => {
  for (const payload of [
    [],
    [...metadata, ...metadata],
    [{ sha, url: `https://api.github.com/repos/example/other/commits/${sha}` }],
    [{ sha: 'main', url: metadata[0].url }],
    [{ sha, url: `${metadata[0].url}?redirect=1` }],
    [null],
  ]) {
    const resolver = githubThemeRevisionResolver({
      get: async () => ({ status: 200, bytes: body(payload) }),
    });
    await expect(resolver.resolve(parseGitThemeRequest(repository), {})).rejects.toThrow();
  }
});

test('canceling an unresponsive adapter settles without retaining the review', async () => {
  const controller = new AbortController();
  let observed: AbortSignal | undefined;
  const resolver = githubThemeRevisionResolver({
    get: (_, options) => {
      observed = options.signal;
      return new Promise(() => {});
    },
  });
  const pending = resolver.resolve(parseGitThemeRequest(repository), { signal: controller.signal });
  controller.abort(new Error('Canceled'));
  await expect(pending).rejects.toThrow('Canceled');
  expect(observed?.aborted).toBe(true);
});
