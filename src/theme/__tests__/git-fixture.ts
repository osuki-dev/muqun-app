import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitThemeObjects, GitDataObject } from '../git-import';

/** Test-only Git adapter. No checkout, filters, network, inherited Git config
 * or user repositories. Explicit acceptance fixtures can be retained for review. */
export function createGitFixture(existing?: string) {
  const directory = realpathSync(existing ?? mkdtempSync(join(tmpdir(), 'muqun-git-theme-test-')));
  if (!/\/muqun-git-theme-(?:test|fixture)[.-][a-zA-Z0-9]+$/.test(directory))
    throw new Error('Not an isolated Git theme fixture');
  if (existsSync(join(directory, '.git')))
    throw new Error('Fixture must not contain an existing repository');
  const home = join(directory, 'isolated-home');
  mkdirSync(home, { mode: 0o700 });
  const env = {
    NODE_ENV: 'test' as const,
    PATH: '/usr/bin:/bin',
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Muqun Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Muqun Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    GIT_AUTHOR_DATE: '2026-09-10T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-09-10T00:00:00Z',
    LC_ALL: 'C',
  };
  function git(args: string[], input?: string | Uint8Array, maxBytes = 1024 * 1024) {
    const result = spawnSync(
      '/usr/bin/git',
      [
        '--no-replace-objects',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'protocol.allow=never',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'init.templateDir=',
        '-C',
        directory,
        ...args,
      ],
      { env, input, maxBuffer: maxBytes, timeout: 3000, killSignal: 'SIGKILL' }
    );
    if (result.error || result.status !== 0) throw new Error('Isolated Git command failed');
    return new Uint8Array(result.stdout);
  }
  const text = (args: string[], input?: string | Uint8Array) =>
    new TextDecoder().decode(git(args, input)).trim();
  git(['init', '--quiet', '--object-format=sha1']);
  const objects: GitThemeObjects = {
    async digest(algorithm, bytes) {
      return createHash(algorithm).update(bytes).digest('hex');
    },
    async read(oid, { maxBytes, signal }) {
      signal?.throwIfAborted();
      if (!/^[a-f0-9]{40}$/.test(oid)) throw new Error('Invalid fixture object ID');
      const type = text(['cat-file', '-t', oid]);
      const size = Number(text(['cat-file', '-s', oid]));
      if (
        !['commit', 'tree', 'blob'].includes(type) ||
        !Number.isSafeInteger(size) ||
        size > maxBytes
      )
        throw new Error('Invalid or oversized Git object');
      // Bare type + object ID never invokes --filters or --textconv.
      const bytes = git(['cat-file', type, oid], undefined, Math.max(1, maxBytes));
      if (bytes.length !== size) throw new Error('Truncated fixture object');
      signal?.throwIfAborted();
      return { type: type as GitDataObject['type'], bytes };
    },
  };
  return {
    dispose: () => {
      if (existing) throw new Error('Explicit acceptance fixtures are retained for review');
      // Only the canonical, freshly created mkdtemp directory owned by this fixture.
      rmSync(directory, { recursive: true, force: true });
    },
    directory,
    objects,
    git,
    text,
    blob: (bytes: string | Uint8Array) => text(['hash-object', '-w', '--stdin'], bytes),
    tree: (entries: string[]) => text(['mktree'], entries.join('\n') + '\n'),
    commit: (tree: string) => text(['commit-tree', tree, '-m', 'Isolated theme fixture']),
  };
}
