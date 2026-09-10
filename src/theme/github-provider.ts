import { throwIfThemeAborted, themeAbortReason, abortThemeOperation } from '@/theme/abort';
import {
  GIT_THEME_LIMITS,
  gitThemeSource,
  inspectProviderGitTree,
  type GitThemeObjects,
  type GitThemeSource,
} from './git-import';
import { parseGitThemeRequest } from './git-source';
import type { PublicThemeTransport } from './remote-import';

const encoder = new TextEncoder();
const sha = /^[a-f0-9]{40}$/;
const metadataLimit = 2 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid GitHub object metadata');
  return value as Record<string, unknown>;
}

async function metadata(
  transport: PublicThemeTransport,
  url: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  throwIfThemeAborted(signal);
  const controller = new AbortController();
  const cancel = () => abortThemeOperation(controller, themeAbortReason(signal));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => abortThemeOperation(controller, new Error('GitHub download timed out')),
    30_000
  );
  let rejectAbort: (() => void) | undefined;
  try {
    if (signal?.aborted) cancel();
    throwIfThemeAborted(controller.signal);
    const response = await Promise.race([
      transport.get(url, { maxBytes, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        rejectAbort = () => reject(themeAbortReason(controller.signal));
        controller.signal.addEventListener('abort', rejectAbort, { once: true });
        if (controller.signal.aborted) rejectAbort();
      }),
    ]);
    throwIfThemeAborted(controller.signal);
    if (response.status !== 200)
      throw new Error(`GitHub object download failed (HTTP ${response.status})`);
    if (
      !(response.bytes instanceof Uint8Array) ||
      response.bytes.length > maxBytes ||
      response.contentType?.split(';')[0].trim().toLowerCase() === 'text/html'
    )
      throw new Error('Invalid or oversized GitHub response');
    return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.bytes)));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}

function blobBytes(data: Record<string, unknown>, maxBytes: number): Uint8Array {
  if (
    data.encoding !== 'base64' ||
    typeof data.content !== 'string' ||
    typeof data.size !== 'number' ||
    !Number.isSafeInteger(data.size) ||
    data.size < 0 ||
    data.size > maxBytes
  )
    throw new Error('Invalid or oversized GitHub blob');
  const content = data.content.replace(/[\r\n]/g, '');
  const padding = (3 - (data.size % 3)) % 3;
  const end = content.length - padding;
  if (
    content.length !== Math.ceil(data.size / 3) * 4 ||
    /[^A-Za-z0-9+/]/.test(content.slice(0, end)) ||
    content.slice(end) !== '='.repeat(padding)
  )
    throw new Error('Invalid GitHub blob encoding');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const bytes = new Uint8Array(data.size);
  let offset = 0;
  for (let index = 0; index < content.length; index += 4) {
    const a = alphabet.indexOf(content[index]);
    const b = alphabet.indexOf(content[index + 1]);
    const c = content[index + 2] === '=' ? 0 : alphabet.indexOf(content[index + 2]);
    const d = content[index + 3] === '=' ? 0 : alphabet.indexOf(content[index + 3]);
    bytes[offset++] = (a << 2) | (b >> 4);
    if (content[index + 2] !== '=') bytes[offset++] = (b << 4) | (c >> 2);
    if (content[index + 3] !== '=') bytes[offset++] = (c << 6) | d;
  }
  if (offset !== data.size) throw new Error('GitHub blob length mismatch');
  return bytes;
}

/** GitHub REST attests commit→root over the public-only TLS transport. It cannot
 * reproduce arbitrary raw commit bytes (timezone/signature headers), so this
 * adapter never fabricates a commit or claims signature verification. Trees are
 * reconstructed canonically and hashed by the shared inspector; blobs likewise.
 * No Contents API, checkout, recursive tree, archive, LFS, response URL or fetch
 * fallback is used. Consumers stage each yielded image before reading the next. */
export async function inspectGithubTheme(
  transport: PublicThemeTransport,
  digest: GitThemeObjects['digest'],
  input: GitThemeSource,
  signal?: AbortSignal
) {
  const source = gitThemeSource(input);
  const request = parseGitThemeRequest(source.repository, {
    revision: source.commit,
    manifestPath: source.manifestPath,
  });
  if (!sha.test(source.commit)) throw new Error('GitHub themes require a SHA-1 commit');
  source.repository = request.repository;
  const base = `https://api.github.com/repos${new URL(source.repository).pathname}/git`;
  const commitUrl = `${base}/commits/${source.commit}`;
  const commit = await metadata(transport, commitUrl, metadataLimit, signal);
  const root = record(commit.tree).sha;
  if (
    commit.sha !== source.commit ||
    typeof commit.url !== 'string' ||
    commit.url.toLowerCase() !== commitUrl ||
    typeof root !== 'string' ||
    !sha.test(root)
  )
    throw new Error('GitHub commit does not match the reviewed revision');
  const types = new Map<string, 'tree' | 'blob'>([[root, 'tree']]);
  const objects: GitThemeObjects = {
    digest,
    async read(oid, options) {
      const type = types.get(oid);
      if (!sha.test(oid) || !type) throw new Error('GitHub object was not declared by its parent');
      const limit = type === 'tree' ? metadataLimit : Math.ceil(options.maxBytes * 1.5) + 65536;
      const data = await metadata(transport, `${base}/${type}s/${oid}`, limit, options.signal);
      if (data.sha !== oid) throw new Error('GitHub object identity mismatch');
      if (type === 'blob') return { type, bytes: blobBytes(data, options.maxBytes) };
      if (
        data.truncated !== false ||
        !Array.isArray(data.tree) ||
        data.tree.length > GIT_THEME_LIMITS.entries
      )
        throw new Error('GitHub tree is truncated or oversized');
      const names = new Set<string>();
      const entries = data.tree.map((value: unknown) => {
        const entry = record(value);
        const modes: Record<string, string> = {
          '040000': 'tree',
          '100644': 'blob',
          '100755': 'blob',
          '120000': 'blob',
          '160000': 'commit',
        };
        if (
          typeof entry.path !== 'string' ||
          !entry.path ||
          entry.path.includes('/') ||
          entry.path.includes('\0') ||
          entry.path === '.' ||
          entry.path === '..' ||
          names.has(entry.path) ||
          typeof entry.mode !== 'string' ||
          !Object.hasOwn(modes, entry.mode) ||
          modes[entry.mode] !== entry.type ||
          typeof entry.sha !== 'string' ||
          !sha.test(entry.sha)
        )
          throw new Error('Invalid GitHub tree entry');
        names.add(entry.path);
        const mode = entry.mode === '040000' ? '40000' : entry.mode;
        const header = encoder.encode(`${mode} ${entry.path}\0`);
        const bytes = new Uint8Array(header.length + 20);
        bytes.set(header);
        for (let index = 0; index < 20; index++)
          bytes[header.length + index] = Number.parseInt(
            entry.sha.slice(index * 2, index * 2 + 2),
            16
          );
        if (entry.type === 'tree' || entry.type === 'blob') {
          if (types.has(entry.sha) && types.get(entry.sha) !== entry.type)
            throw new Error('Conflicting GitHub object types');
          types.set(entry.sha, entry.type);
        }
        return { bytes, sort: encoder.encode(entry.path + (entry.type === 'tree' ? '/' : '')) };
      });
      entries.sort((a, b) => {
        for (let index = 0; index < Math.min(a.sort.length, b.sort.length); index++) {
          if (a.sort[index] !== b.sort[index]) return a.sort[index] - b.sort[index];
        }
        return a.sort.length - b.sort.length;
      });
      const size = entries.reduce((total, entry) => total + entry.bytes.length, 0);
      if (size > options.maxBytes) throw new Error('GitHub tree is oversized');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const entry of entries) {
        bytes.set(entry.bytes, offset);
        offset += entry.bytes.length;
      }
      return { type, bytes };
    },
  };
  return inspectProviderGitTree(objects, source, { provider: 'github', tree: root }, signal);
}
