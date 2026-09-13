import { throwIfThemeAborted } from '@/theme/abort';
import { cloneThemeData } from './clone';
import { inspectThemeImage } from './image-inspection';
import { publicThemeUrl } from './remote-import';
import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from './schema';

export const GIT_THEME_LIMITS = Object.freeze({
  depth: 12,
  entries: 4096,
  metadataBytes: 1024 * 1024,
  commitBytes: 64 * 1024,
});

export type GitThemeSource = { repository: string; commit: string; manifestPath: string };
export type GitDataObject = { type: 'commit' | 'tree' | 'blob'; bytes: Uint8Array };

/** Data-only port. Implementations must bound bytes BEFORE buffering, honor
 * cancellation and never checkout, filter, execute hooks or fetch submodules.
 * A production remote adapter must enforce PublicThemeTransport's connection
 * policy. The local Git implementation belongs exclusively in tests. */
export interface GitThemeObjects {
  read(oid: string, options: { maxBytes: number; signal?: AbortSignal }): Promise<GitDataObject>;
  digest(algorithm: 'sha1' | 'sha256', bytes: Uint8Array): Promise<string>;
}

export function gitThemePath(value: string): string {
  const parts = value.split('/');
  if (
    value.length > 512 ||
    parts.length > GIT_THEME_LIMITS.depth ||
    parts.some(
      (part) => !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) || part.toLowerCase() === '.git'
    )
  )
    throw new Error('Invalid Git theme path');
  return value;
}

export function gitThemeSource(source: GitThemeSource): GitThemeSource {
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.commit))
    throw new Error('Git themes require a full commit object ID');
  const repository = publicThemeUrl(source.repository);
  if (new URL(repository).search || new URL(source.repository).hash)
    throw new Error('Use a repository URL without a query or fragment');
  return { repository, commit: source.commit, manifestPath: gitThemePath(source.manifestPath) };
}

type TreeEntry = { mode: string; oid: string };

/** Only the manifest and its declared regular files are traversed. Repository
 * contents are data: no scripts, checkout, Git attributes or LFS resolution.
 * Assets stream individually so total theme size is not an arbitrary policy
 * limit. Consumers must stage/release each item before requesting the next. */
export async function inspectGitTheme(
  objects: GitThemeObjects,
  input: GitThemeSource,
  signal?: AbortSignal
) {
  return inspectGitTree(objects, input, signal);
}

/** Provider adapters may attest the commit-to-tree mapping over authenticated
 * HTTPS when their API cannot return raw commit bytes. This does NOT verify a
 * commit hash/signature. Every tree/blob still receives Git identity validation.
 * Keep this explicit entry point separate from inspectGitTheme's raw-Git proof. */
export async function inspectProviderGitTree(
  objects: GitThemeObjects,
  input: GitThemeSource,
  root: { provider: 'github'; tree: string },
  signal?: AbortSignal
) {
  if (!/^[a-f0-9]{40}$/.test(root.tree) || input.commit.length !== 40)
    throw new Error('Invalid provider-attested Git tree');
  const result = await inspectGitTree(objects, input, signal, root.tree);
  return { ...result, verification: 'provider-attested-commit-verified-objects' as const };
}

async function inspectGitTree(
  objects: GitThemeObjects,
  input: GitThemeSource,
  signal?: AbortSignal,
  attestedRoot?: string
): Promise<{
  source: GitThemeSource;
  manifest: ThemeManifest;
  assets: (signal?: AbortSignal) => AsyncGenerator<{ id: string; bytes: Uint8Array }>;
}> {
  const source = gitThemeSource(input);
  const algorithm = source.commit.length === 40 ? 'sha1' : 'sha256';
  const oidBytes = source.commit.length / 2;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let metadataBytes = 0;
  let entryCount = 0;
  const trees = new Map<string, Map<string, TreeEntry>>();
  const read = async (
    oid: string,
    type: GitDataObject['type'],
    maxBytes: number,
    currentSignal?: AbortSignal
  ) => {
    throwIfThemeAborted(currentSignal);
    const object = await objects.read(oid, { maxBytes, signal: currentSignal });
    throwIfThemeAborted(currentSignal);
    if (
      object.type !== type ||
      !(object.bytes instanceof Uint8Array) ||
      object.bytes.length > maxBytes
    )
      throw new Error('Invalid or oversized Git object');
    const header = encoder.encode(`${type} ${object.bytes.length}\0`);
    const identity = new Uint8Array(header.length + object.bytes.length);
    identity.set(header);
    identity.set(object.bytes, header.length);
    if ((await objects.digest(algorithm, identity)) !== oid)
      throw new Error('Git object identity mismatch');
    throwIfThemeAborted(currentSignal);
    return object.bytes;
  };
  const tree = async (oid: string, currentSignal?: AbortSignal) => {
    const cached = trees.get(oid);
    if (cached) return cached;
    const bytes = await read(
      oid,
      'tree',
      GIT_THEME_LIMITS.metadataBytes - metadataBytes,
      currentSignal
    );
    metadataBytes += bytes.length;
    const entries = new Map<string, TreeEntry>();
    let offset = 0;
    while (offset < bytes.length) {
      if (++entryCount > GIT_THEME_LIMITS.entries) throw new Error('Git tree has too many entries');
      const space = bytes.indexOf(32, offset);
      const nul = bytes.indexOf(0, space + 1);
      if (space < offset || nul < space || nul + 1 + oidBytes > bytes.length)
        throw new Error('Malformed Git tree');
      const mode = decoder.decode(bytes.subarray(offset, space));
      const name = decoder.decode(bytes.subarray(space + 1, nul));
      if (!name || name.includes('/') || entries.has(name)) throw new Error('Malformed Git tree');
      const child = Array.from(bytes.subarray(nul + 1, nul + 1 + oidBytes), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      entries.set(name, { mode, oid: child });
      offset = nul + 1 + oidBytes;
    }
    trees.set(oid, entries);
    return entries;
  };
  let rootOid = attestedRoot;
  if (!rootOid) {
    const commit = await read(source.commit, 'commit', GIT_THEME_LIMITS.commitBytes, signal);
    const root = decoder.decode(commit).split('\n', 1)[0];
    if (!new RegExp(`^tree [a-f0-9]{${source.commit.length}}$`).test(root))
      throw new Error('Malformed Git commit');
    rootOid = root.slice(5);
  }
  const verifiedRoot = rootOid;
  const resolve = async (path: string, currentSignal?: AbortSignal) => {
    const parts = gitThemePath(path).split('/');
    let oid = verifiedRoot;
    for (let index = 0; index < parts.length; index++) {
      throwIfThemeAborted(currentSignal);
      const entry = (await tree(oid, currentSignal)).get(parts[index]);
      if (!entry) throw new Error('Git theme file is missing');
      if (entry.mode !== (index === parts.length - 1 ? '100644' : '40000'))
        throw new Error('Git themes cannot use links, submodules or executable files');
      oid = entry.oid;
    }
    return oid;
  };
  const manifestOid = await resolve(source.manifestPath, signal);
  const raw = await read(manifestOid, 'blob', THEME_LIMITS.manifestBytes, signal);
  const manifest = parseThemeManifest(decoder.decode(raw));
  const directory = source.manifestPath.slice(0, source.manifestPath.lastIndexOf('/') + 1);
  const resources = Object.entries(manifest.assets ?? {}).map(([id, asset]) => {
    if (!('path' in asset))
      throw new Error('Git themes must contain their images in the pinned commit');
    return { id, path: gitThemePath(directory + asset.path), sha256: asset.sha256 };
  });
  return {
    source,
    manifest: cloneThemeData(manifest),
    async *assets(currentSignal = signal) {
      for (const resource of resources) {
        const oid = await resolve(resource.path, currentSignal);
        const bytes = await read(oid, 'blob', THEME_LIMITS.assetBytes, currentSignal);
        const lfsHeader = encoder.encode('version https://git-lfs.github.com/spec/v1');
        if (lfsHeader.every((byte, index) => bytes[index] === byte))
          throw new Error('Git LFS images must be stored as ordinary Git blobs');
        inspectThemeImage(bytes);
        if (resource.sha256 && (await objects.digest('sha256', bytes)) !== resource.sha256)
          throw new Error('Theme image checksum mismatch');
        throwIfThemeAborted(currentSignal);
        yield { id: resource.id, bytes };
      }
    },
  };
}
