/**
 * What the reader pasted, turned into what the parser accepts.
 *
 * This is presentation, not validation. It never widens what
 * `parseGitThemeRequest` will accept: it only splits a link the reader already
 * has into the three fields that screen already shows, so the mutable branch
 * stays visible and confirmable rather than being a dead end. Everything here
 * is re-validated downstream.
 */

const FULL_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export type NormalizedThemeLink = {
  url: string;
  revision?: string;
  manifestPath?: string;
  /** The link named a moving ref. The reader confirms it before anything downloads. */
  branchFromLink?: boolean;
};

export function normalizeThemeLink(input: string): NormalizedThemeLink {
  const trimmed = input.trim();
  if (!trimmed) return { url: trimmed };
  // A pasted host without a scheme is the most common first mistake, and the
  // raw URL constructor's TypeError is not a sentence anyone should be shown.
  const withScheme = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    // Leave it alone and let the real parser produce the real complaint.
    return { url: trimmed };
  }
  if (url.hostname.toLowerCase() !== 'github.com') return { url: withScheme };

  // GitHub's own address bar and copy-link hand out `?tab=readme-ov-file`. The
  // query carries no repository identity, so dropping it loses nothing.
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(1);
  const [owner, repo] = parts;
  if (!owner || !repo) return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
  const repository = `${url.origin}/${owner}/${repo}`;
  const kind = parts[2];
  const ref = parts[3];
  if ((kind !== 'blob' && kind !== 'tree') || !ref) return { url: repository };
  if (FULL_OBJECT_ID.test(ref)) {
    // Already pinned: the parser handles this link as it stands.
    return { url: `${url.origin}${url.pathname.replace(/\/+$/, '')}` };
  }
  const path = parts.slice(4).join('/');
  return {
    url: repository,
    revision: ref,
    manifestPath: kind === 'blob' ? path || undefined : path ? `${path}/theme.json` : undefined,
    branchFromLink: true,
  };
}
