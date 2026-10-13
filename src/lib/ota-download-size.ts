import { getUtf8ByteLength } from '@hot-updater/protocol';
import { OTA_RELEASE_ID } from './ota-release-notes';
import type { OtaArtifactTarget } from './ota-update-metadata';

/** Compressed full-package payload bytes; native file reuse can reduce the transfer. */
export type OtaDownloadSize = { fullBytes: number };
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function byteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

async function metadata(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.ok) return null;
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_METADATA_BYTES) return null;
        chunks.push(value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      text = await new Response(bytes).text();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  } else {
    // Native fetch may expose only text(), rather than a ReadableStream.
    text = await response.text();
    if (text.length > MAX_METADATA_BYTES || getUtf8ByteLength(text) > MAX_METADATA_BYTES)
      return null;
  }
  return record(JSON.parse(text));
}

export async function fetchOtaDownloadSize(
  target: OtaArtifactTarget,
  clientApiKey: string,
  request: typeof fetch = fetch
): Promise<OtaDownloadSize | null> {
  if (
    ![target.releaseId, target.fromBundleId, target.toBundleId].every((id) =>
      OTA_RELEASE_ID.test(id)
    )
  )
    return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const artifact = await metadata(
      await request(
        `https://updates.muqun.dev/artifacts/v1/${target.toBundleId}/from/${target.fromBundleId}`,
        { headers: { 'x-api-key': clientApiKey }, signal: controller.signal, redirect: 'error' }
      )
    );
    if (artifact?.artifactProtocolVersion !== 1 || typeof artifact.manifestUrl !== 'string')
      return null;
    const manifestUrl = new URL(artifact.manifestUrl);
    if (manifestUrl.protocol !== 'https:' || manifestUrl.username || manifestUrl.password)
      return null;
    // Signed storage URLs have their own authorization. Never forward the
    // application API key away from the fixed official metadata endpoint.
    const manifest = await metadata(
      await request(manifestUrl.toString(), {
        signal: controller.signal,
        redirect: 'error',
      })
    );
    if (manifest?.bundleId !== target.toBundleId) return null;
    const assets = record(manifest.assets);
    if (!assets || !Object.keys(assets).length) return null;
    const archive = record(manifest.archive);
    let fullBytes: number;
    if (typeof artifact.archiveUrl === 'string' && artifact.archiveUrl && archive) {
      if (!byteSize(archive.downloadByteSize) || archive.downloadByteSize <= 0) return null;
      fullBytes = archive.downloadByteSize;
    } else {
      fullBytes = 0;
      for (const value of Object.values(assets)) {
        const asset = record(value);
        if (!asset || !byteSize(asset.downloadByteSize)) return null;
        fullBytes += asset.downloadByteSize;
      }
    }
    return byteSize(fullBytes) && fullBytes > 0 ? { fullBytes } : null;
  } catch {
    // Metadata failure remains visible and retryable before download consent.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
