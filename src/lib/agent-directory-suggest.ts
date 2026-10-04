/**
 * The folder completer behind "Switch project", as pure readings.
 *
 * Two gateways answer `GET /api/agent-directories`, both with the folders as
 * the envelope's `data` array. An older one lists every folder in the parent of
 * what was typed, unfiltered, and says nothing else. A newer one matches the
 * last segment itself, caps the answer, and puts `home` and `truncated` beside
 * `data` in the envelope. The sheet reads both through here.
 */

export interface DirectoryItem {
  name: string;
  path: string;
}

export interface DirectoryListing {
  directories: DirectoryItem[];
  /** The gateway's home directory, absolute; only a newer gateway says. */
  home?: string;
  /** The gateway stopped before it had listed every match. */
  truncated: boolean;
  /** A bare array: the older gateway, which matched nothing itself. */
  legacy: boolean;
}

/** Rows the sheet draws before it asks the reader to keep typing. */
export const MAX_DIRECTORY_SUGGESTIONS = 20;

export const EMPTY_DIRECTORY_LISTING: DirectoryListing = {
  directories: [],
  truncated: false,
  legacy: false,
};

/** Whether a query is a path the completer can answer: absolute or `~`-rooted. */
export function shouldSuggestDirectories(query: string): boolean {
  const q = query.trim();
  return q.startsWith('/') || q.startsWith('~');
}

function directoryItems(value: unknown): DirectoryItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { name, path } = entry as { name?: unknown; path?: unknown };
    if (typeof path !== 'string' || !path) return [];
    return [{ name: typeof name === 'string' ? name : '', path }];
  });
}

/**
 * Either gateway's answer: `data` is the envelope's data, `envelope` the whole
 * body, where a newer gateway puts `home` and `truncated`. An object `data`
 * carrying the same three fields is read too.
 */
export function parseDirectoryListing(data: unknown, envelope?: unknown): DirectoryListing {
  const fields = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { directories?: unknown; home?: unknown; truncated?: unknown })
      : {};
  const inner = fields(data);
  const outer = fields(envelope);
  const home = typeof outer.home === 'string' ? outer.home : inner.home;
  const truncated = typeof outer.truncated === 'boolean' ? outer.truncated : inner.truncated;
  const said = typeof home === 'string' || typeof truncated === 'boolean';
  if (!Array.isArray(data) && !Array.isArray(inner.directories)) return EMPTY_DIRECTORY_LISTING;
  return {
    directories: directoryItems(Array.isArray(data) ? data : inner.directories),
    ...(typeof home === 'string' && home.startsWith('/') ? { home } : {}),
    truncated: truncated === true,
    // An array and nothing beside it is the older gateway, which matched nothing.
    legacy: Array.isArray(data) && !said,
  };
}

/**
 * The older gateway's answer, narrowed the way the newer one narrows its own:
 * names starting with the last typed segment, ignoring case, and dot-folders
 * only when that segment starts with a dot. `~/W` against an older gateway
 * listed all of home; it lists `Work` now.
 */
export function narrowLegacyListing(listing: DirectoryListing, query: string): DirectoryListing {
  if (!listing.legacy) return listing;
  const q = query.trim();
  const partial = q.slice(q.lastIndexOf('/') + 1).toLowerCase();
  // A bare `~` names home itself, and its whole listing is the answer.
  if (q === '~') return listing;
  const wantDot = partial.startsWith('.');
  return {
    ...listing,
    directories: listing.directories.filter((item) => {
      const name = (item.name || item.path.slice(item.path.lastIndexOf('/') + 1)).toLowerCase();
      if (name.startsWith('.') && !wantDot) return false;
      return name.startsWith(partial);
    }),
  };
}

/** The rows drawn, and whether there were more than that to draw. */
export function visibleSuggestions(listing: DirectoryListing): {
  rows: DirectoryItem[];
  more: boolean;
} {
  return {
    rows: listing.directories.slice(0, MAX_DIRECTORY_SUGGESTIONS),
    more: listing.truncated || listing.directories.length > MAX_DIRECTORY_SUGGESTIONS,
  };
}

/**
 * What "go into" puts in the field: the folder and a trailing slash, spelled
 * from `~` when the gateway said where home is and the folder is under it.
 */
export function descendQuery(path: string, home?: string): string {
  const folder = path.replace(/\/+$/, '');
  if (home) {
    const root = home.replace(/\/+$/, '');
    if (root && folder === root) return '~/';
    if (root && folder.startsWith(`${root}/`)) return `~${folder.slice(root.length)}/`;
  }
  return `${folder}/`;
}

/** A typed path the gateway has to expand before it is a workspace. */
export function isHomeRelativePath(directory: string): boolean {
  return directory === '~' || directory.startsWith('~/');
}

/**
 * The workspace a selection lands on: the folder the gateway answered with,
 * which for a typed `~/…` is the absolute path it expanded to, else what was
 * typed. The typed spelling is never the workspace when the gateway named one.
 */
export function settledWorkspaceDirectory(typed: string, answered?: string | null): string {
  return answered || typed;
}
