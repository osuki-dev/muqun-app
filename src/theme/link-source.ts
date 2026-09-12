import type { GitThemeObjects } from './git-import';
import { parseGitThemeRequest, resolveGitThemeReview } from './git-source';
import { githubThemeRevisionResolver } from './github-revision';
import { inspectGithubTheme } from './github-provider';
import {
  inspectRemoteTheme,
  publicThemeUrl,
  type PublicThemeTransport,
  type RemoteThemeInspection,
} from './remote-import';

export type ThemeLinkInspection = Pick<
  RemoteThemeInspection,
  'sourceUrl' | 'resourceDomains' | 'manifest' | 'assets'
> & {
  commit?: string;
};
export type ThemeLinkOptions = { revision?: string; manifestPath?: string; signal?: AbortSignal };

/** Display repository fields while typing without starting a request. */
export function isGitHubThemeLink(input: string): boolean {
  try {
    const url = new URL(input.trim());
    if (url.hostname !== 'github.com') return false;
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length === 2 || parts[2] === 'blob' || parts[2] === 'tree';
  } catch {
    return false;
  }
}

/** Inspect metadata only. Downloading images is the subsequent explicit action.
 * A Git branch resolves once; the iterator retains the reviewed commit. */
export async function inspectThemeLinkSource(
  transport: PublicThemeTransport,
  digest: GitThemeObjects['digest'],
  input: string,
  options: ThemeLinkOptions = {}
): Promise<ThemeLinkInspection> {
  const source = publicThemeUrl(input.trim());
  if (isGitHubThemeLink(source)) {
    const request = parseGitThemeRequest(source, {
      ...(options.revision?.trim() ? { revision: options.revision.trim() } : {}),
      ...(options.manifestPath?.trim() ? { manifestPath: options.manifestPath.trim() } : {}),
    });
    const review = await resolveGitThemeReview(
      request,
      githubThemeRevisionResolver(transport),
      options
    );
    const theme = await inspectGithubTheme(transport, digest, review.source, options.signal);
    return {
      sourceUrl: theme.source.repository,
      resourceDomains: Object.keys(theme.manifest.assets ?? {}).length ? ['api.github.com'] : [],
      manifest: theme.manifest,
      assets: theme.assets,
      commit: theme.source.commit,
    };
  }
  return inspectRemoteTheme(transport, source, {
    signal: options.signal,
    format: /\.(muqun-theme|zip)$/i.test(new URL(source).pathname) ? 'package' : 'manifest',
  });
}
