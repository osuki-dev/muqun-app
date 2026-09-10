import { throwIfThemeAborted } from '@/theme/abort';
import { gitThemePath, gitThemeSource, type GitThemeSource } from './git-import';
import { publicThemeUrl } from './remote-import';

export type GitThemeRequest = Readonly<{
  provider: 'github';
  repository: string;
  /** Null asks the provider for its default branch, resolved once to a commit. */
  revision: string | null;
  manifestPath: string;
}>;

export class GitThemeSourceError extends Error {
  constructor(
    readonly code:
      | 'invalid-url'
      | 'unsupported-provider'
      | 'ambiguous-link'
      | 'conflicting-source'
      | 'invalid-revision'
      | 'repository-mismatch'
      | 'stale-review'
  ) {
    super(code);
    this.name = 'GitThemeSourceError';
  }
}

const fullObjectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** A literal ref name, not a rev-parse expression. Never passed to a shell. */
function revision(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (
    value.length > 256 ||
    /[\s\x00-\x1f\x7f~^:?*[\\]/.test(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value === '@' ||
    value.startsWith('-') ||
    value.endsWith('.') ||
    value.split('/').some((part) => !part || part.startsWith('.') || part.endsWith('.lock'))
  )
    throw new GitThemeSourceError('invalid-revision');
  return value;
}

/** GitHub v1 only. Other public Git hosts need explicit provider adapters;
 * accepting their URLs does not magically provide a safe Git transport. */
export function parseGitThemeRequest(
  input: string,
  fields: { revision?: string | null; manifestPath?: string } = {}
): GitThemeRequest {
  if (input.length > 2048) throw new GitThemeSourceError('invalid-url');
  const value = input.trim();
  // Reject before URL normalization can erase traversal or encode ambiguity.
  if (value.includes('%') || value.split('/').some((part) => part === '.' || part === '..'))
    throw new GitThemeSourceError('invalid-url');
  let url: URL;
  try {
    url = new URL(publicThemeUrl(value));
  } catch {
    throw new GitThemeSourceError('invalid-url');
  }
  if (new URL(value).hash || url.search) throw new GitThemeSourceError('invalid-url');
  if (url.hostname !== 'github.com') throw new GitThemeSourceError('unsupported-provider');
  const parts = url.pathname.replace(/\/$/, '').split('/').slice(1);
  const owner = parts[0];
  const repo = parts[1]?.replace(/\.git$/, '');
  if (
    !owner ||
    !/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(owner) ||
    owner.length > 39 ||
    !repo ||
    !/^[a-zA-Z0-9_.-]+$/.test(repo) ||
    repo === '.' ||
    repo === '..' ||
    repo.length > 100
  )
    throw new GitThemeSourceError('invalid-url');
  const repository = `https://github.com/${owner.toLowerCase()}/${repo.toLowerCase()}`;
  let requestedRevision = revision(fields.revision);
  let manifestPath = fields.manifestPath ?? 'theme.json';
  if (parts.length > 2) {
    if ((parts[2] !== 'blob' && parts[2] !== 'tree') || !fullObjectId.test(parts[3] ?? ''))
      throw new GitThemeSourceError('ambiguous-link');
    const commit = parts[3];
    if (requestedRevision !== null && requestedRevision !== commit)
      throw new GitThemeSourceError('conflicting-source');
    requestedRevision = commit;
    const path = parts.slice(4).join('/');
    if (parts[2] === 'blob') {
      if (!path || (fields.manifestPath !== undefined && fields.manifestPath !== path))
        throw new GitThemeSourceError('conflicting-source');
      manifestPath = path;
    } else {
      // A tree link names a directory, not an implicit ref/path split. The
      // proposed filename stays visible/editable before confirming the review.
      if (path) gitThemePath(path);
      manifestPath = fields.manifestPath ?? (path ? `${path}/theme.json` : 'theme.json');
    }
  }
  return Object.freeze({
    provider: 'github',
    repository,
    revision: requestedRevision,
    manifestPath: gitThemePath(manifestPath),
  });
}

/** Metadata resolution only. Production implementations must use the pinned
 * public-network transport, bound response bytes, honor cancellation and reject
 * redirects/repository changes. This interface is NOT an available transport. */
export interface GitThemeRevisionResolver {
  resolve(
    request: GitThemeRequest,
    options: { signal?: AbortSignal }
  ): Promise<{
    repository: string;
    commit: string;
  }>;
}

export type GitThemeReview = Readonly<{
  request: GitThemeRequest;
  source: Readonly<GitThemeSource>;
}>;

/** Freeze the chosen revision before reading any manifest/assets. A provider
 * reply does not prove object contents; inspectGitTheme still verifies hashes. */
export async function resolveGitThemeReview(
  input: GitThemeRequest,
  resolver: GitThemeRevisionResolver,
  options: { signal?: AbortSignal } = {}
): Promise<GitThemeReview> {
  throwIfThemeAborted(options.signal);
  const request = parseGitThemeRequest(input.repository, input);
  let commit = request.revision;
  if (commit === null || !fullObjectId.test(commit)) {
    const resolved = await resolver.resolve(request, options);
    throwIfThemeAborted(options.signal);
    const repository = parseGitThemeRequest(resolved.repository).repository;
    if (repository !== request.repository) throw new GitThemeSourceError('repository-mismatch');
    commit = resolved.commit;
  }
  const source = Object.freeze(
    gitThemeSource({ repository: request.repository, commit, manifestPath: request.manifestPath })
  );
  return Object.freeze({ request, source });
}

/** A confirm tap consumes the exact reviewed commit, never resolves a branch
 * again. Any edited URL/ref/path requires a new review first. */
export function confirmGitThemeReview(
  review: GitThemeReview,
  current: GitThemeRequest
): GitThemeSource {
  const request = parseGitThemeRequest(current.repository, current);
  if (
    request.repository !== review.request.repository ||
    request.revision !== review.request.revision ||
    request.manifestPath !== review.request.manifestPath
  )
    throw new GitThemeSourceError('stale-review');
  const source = gitThemeSource({ ...review.source });
  if (source.repository !== request.repository || source.manifestPath !== request.manifestPath)
    throw new GitThemeSourceError('stale-review');
  return source;
}
