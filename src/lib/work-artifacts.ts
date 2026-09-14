import { assertDeliveryCurrent } from './bound-delivery';
import type { GatewayRecord } from './gateway-storage';
import type { WorkArtifact } from './work-api';

export const MAX_WORK_ARTIFACT_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 10 * 1024 * 1024;
export type WorkArtifactPreview =
  | { kind: 'text'; text: string }
  | { kind: 'image'; uri: string; cacheKey: string }
  | { kind: 'unsupported' };
export type WorkArtifactReadContext = { signal?: AbortSignal; isCurrent: () => boolean };
export type WorkArtifactTransport = (
  record: GatewayRecord,
  path: string,
  expectedBytes: number,
  context: WorkArtifactReadContext
) => Promise<Uint8Array>;

/** Identifies saved bytes, never an arbitrary path on the Gateway filesystem. */
export function workArtifactPath(session: string, task: string, submission: string, index: number) {
  if (
    ![session, task, submission].every(
      (id) => id.length > 0 && id.length <= 256 && !/[\r\n\0]/.test(id)
    ) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= 32
  )
    throw new Error('Invalid artifact scope.');
  return `/api/sessions/${encodeURIComponent(session)}/work/tasks/${encodeURIComponent(task)}/results/${encodeURIComponent(submission)}/artifacts/${index}`;
}

/** Bound both declared and received size; binary bytes never pass through the task JSON parser. */
export async function readBoundedArtifactBody(
  response: Response,
  limit: number,
  isCurrent: () => boolean
): Promise<Uint8Array> {
  assertDeliveryCurrent(isCurrent);
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new Error('Artifact exceeds the supported size.');
  const reader = response.body?.getReader();
  if (!reader) {
    // A native response without a streaming reader must provide a size before
    // allocating its body. Check its actual size again before releasing bytes.
    if (declared === null) throw new Error('Artifact size is unavailable.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertDeliveryCurrent(isCurrent);
    if (bytes.length > limit) throw new Error('Artifact exceeds the supported size.');
    return bytes;
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    for (;;) {
      assertDeliveryCurrent(isCurrent);
      const { done, value } = await reader.read();
      assertDeliveryCurrent(isCurrent);
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > limit) throw new Error('Artifact exceeds the supported size.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function previewKind(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extension)) return 'image';
  // Code and markup are rendered as literal text, never interpreted or navigated.
  if (
    [
      'txt',
      'md',
      'json',
      'csv',
      'log',
      'yaml',
      'yml',
      'toml',
      'xml',
      'html',
      'htm',
      'svg',
      'js',
      'jsx',
      'ts',
      'tsx',
      'css',
      'sh',
      'py',
      'rs',
      'go',
      'diff',
      'patch',
    ].includes(extension)
  )
    return 'text';
  return 'unsupported';
}

function rasterMime(bytes: Uint8Array): string | null {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function loadWorkArtifactPreview(
  record: GatewayRecord,
  sessionId: string,
  taskId: string,
  submissionId: string,
  index: number,
  artifact: WorkArtifact,
  context: WorkArtifactReadContext,
  dependencies: {
    transport: WorkArtifactTransport;
    sha256: (bytes: Uint8Array) => string;
    base64: (bytes: Uint8Array) => string;
  }
): Promise<WorkArtifactPreview> {
  const current = () => context.isCurrent() && !context.signal?.aborted;
  assertDeliveryCurrent(current);
  const path = workArtifactPath(sessionId, taskId, submissionId, index);
  const saved = { ...artifact };
  if (
    !Number.isSafeInteger(saved.size_bytes) ||
    saved.size_bytes < 0 ||
    saved.size_bytes > MAX_WORK_ARTIFACT_BYTES ||
    !/^[a-f0-9]{64}$/i.test(saved.sha256)
  )
    throw new Error('Invalid saved artifact metadata.');
  const kind = previewKind(saved.path);
  if (
    kind === 'unsupported' ||
    saved.size_bytes > (kind === 'text' ? MAX_TEXT_PREVIEW_BYTES : MAX_IMAGE_PREVIEW_BYTES)
  )
    return { kind: 'unsupported' };
  const captured = { ...record, sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined };
  const bytes = await dependencies.transport(captured, path, saved.size_bytes, {
    ...context,
    isCurrent: current,
  });
  assertDeliveryCurrent(current);
  if (
    bytes.length !== saved.size_bytes ||
    dependencies.sha256(bytes).toLowerCase() !== saved.sha256.toLowerCase()
  )
    throw new Error('The artifact does not match its saved result.');
  if (kind === 'text') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) return { kind: 'unsupported' };
    return { kind: 'text', text };
  }
  const mime = rasterMime(bytes);
  if (!mime) throw new Error('The artifact is not a supported image.');
  return {
    kind: 'image',
    uri: `data:${mime};base64,${dependencies.base64(bytes)}`,
    cacheKey: `${captured.serverId}:${path}:${saved.sha256}`,
  };
}
