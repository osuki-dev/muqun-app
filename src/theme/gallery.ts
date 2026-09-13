import { throwIfThemeAborted } from '@/theme/abort';
import { publicThemeUrl, type PublicThemeTransport } from '@/theme/remote-import';

/**
 * # The published catalogue
 *
 * One address, read by three readers. `muqun-theme list` prints it, the gallery
 * on muqun.dev draws it, and this screen lists it -- so there is one catalogue
 * rather than one per reader, and a theme that is published is published
 * everywhere at once.
 *
 * The index is small and carries everything a row needs: name, author,
 * description, tags and the package's size in bytes. That last field is the
 * point of the design. A package may be 25 MiB, and a list that downloaded
 * every one it drew would be unusable on the device this app is for. So nothing
 * is fetched until a reader asks for a particular theme, and the size they are
 * agreeing to is on the row before they do.
 *
 * Served from the site's own origin by a Worker in front of an R2 bucket that
 * the themes repository's CI fills after every merge. That is why this is a
 * plain HTTPS read with no token and no GitHub dependency, and why it keeps
 * working whether or not that repository is public.
 */

/** `https://muqun.dev/api/themes/`, with the trailing slash `new URL` needs. */
export const THEME_GALLERY_BASE = 'https://muqun.dev/api/themes/';

/** Bounds the index itself. The packages it points at carry their own limit. */
export const THEME_INDEX_MAX_BYTES = 512 * 1024;

/** What the site's own gallery calls an entry, kept to the same field names. */
export interface ThemeIndexEntry {
  id: string;
  name: string;
  version: string;
  author?: string;
  license?: string;
  description?: string;
  tags?: readonly string[];
  /** Relative to {@link THEME_GALLERY_BASE}, e.g. `dist/<id>.muqun-theme`. */
  package: string;
  bytes: number;
  sha256?: string;
  assets?: number;
}

/**
 * Parsed defensively, and one bad row does not lose the rest.
 *
 * This is a document from a server, so it is checked rather than trusted: an
 * entry without the four fields a row cannot be drawn without is dropped, and
 * everything optional is only carried when it is the right type. The index is
 * written by the CLI and served from our own origin, which makes a malformed
 * entry a bug rather than an attack -- but a reader looking at a gallery should
 * see the nine themes that are fine instead of an error about the tenth.
 *
 * `package` is deliberately not resolved to a URL here. It stays relative, and
 * {@link themePackageUrl} screens it at the moment of use, so a relative path
 * cannot smuggle in a different host by sitting in a field nobody re-checks.
 */
export function parseThemeIndex(text: string): ThemeIndexEntry[] {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    throw new Error('The theme catalogue could not be read');
  }
  if (
    !document ||
    typeof document !== 'object' ||
    (document as { format?: unknown }).format !== 'muqun-themes-index'
  )
    throw new Error('The theme catalogue could not be read');
  const themes = (document as { themes?: unknown }).themes;
  if (!Array.isArray(themes)) throw new Error('The theme catalogue could not be read');

  const text_ = (value: unknown, max: number) =>
    typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
  const entries: ThemeIndexEntry[] = [];
  for (const row of themes) {
    if (!row || typeof row !== 'object') continue;
    const entry = row as Record<string, unknown>;
    const id = text_(entry.id, 64);
    const name = text_(entry.name, 64);
    const version = text_(entry.version, 32);
    const pkg = text_(entry.package, 512);
    const bytes = entry.bytes;
    if (!id || !name || !version || !pkg) continue;
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) continue;
    const tags = Array.isArray(entry.tags)
      ? entry.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12)
      : undefined;
    entries.push({
      id,
      name,
      version,
      author: text_(entry.author, 100),
      license: text_(entry.license, 100),
      description: text_(entry.description, 280),
      tags: tags?.length ? tags : undefined,
      package: pkg,
      bytes,
      sha256:
        typeof entry.sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256)
          ? entry.sha256
          : undefined,
      assets:
        typeof entry.assets === 'number' && Number.isInteger(entry.assets)
          ? entry.assets
          : undefined,
    });
  }
  return entries;
}

/**
 * A package's address, screened the same way every other theme URL is.
 *
 * `publicThemeUrl` is what refuses anything that is not a public HTTPS host, so
 * resolving through it rather than around it means an index entry gets no more
 * trust than a link a reader typed. The extra check here is narrower still: the
 * result has to stay on the catalogue's own origin, because an entry naming
 * some other host would be the catalogue asking this app to fetch from a place
 * the reader never chose.
 */
export function themePackageUrl(entry: Pick<ThemeIndexEntry, 'package'>): string {
  const url = publicThemeUrl(entry.package, THEME_GALLERY_BASE);
  if (!url.startsWith(THEME_GALLERY_BASE)) throw new Error('Theme is not on the catalogue');
  return url;
}

/** Read the catalogue. The transport is the caller's, for the reason in its docblock. */
export async function loadThemeIndex(
  transport: PublicThemeTransport,
  signal: AbortSignal
): Promise<ThemeIndexEntry[]> {
  throwIfThemeAborted(signal);
  const response = await transport.get(`${THEME_GALLERY_BASE}index.json`, {
    signal,
    maxBytes: THEME_INDEX_MAX_BYTES,
  });
  throwIfThemeAborted(signal);
  if (response.status !== 200) throw new Error('The theme catalogue is not available right now');
  return parseThemeIndex(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes));
}
