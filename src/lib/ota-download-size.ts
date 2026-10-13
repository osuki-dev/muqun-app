import { OTA_RELEASE_ID } from './ota-release-notes';

/** File payload bytes only; native reuse, fallback, manifests and retries can change transfer. */
export type OtaDownloadSize = { estimatedBytes: number | null; fullBytes: number | null };

export function otaByteSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export async function fetchOtaDownloadSize(
  releaseId: string,
  fromBundleId: string,
  clientApiKey: string,
  request: typeof fetch = fetch
): Promise<OtaDownloadSize | null> {
  if (!OTA_RELEASE_ID.test(releaseId) || !OTA_RELEASE_ID.test(fromBundleId)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await request(
      `https://updates.muqun.dev/release-download-size/${releaseId}?fromBundleId=${fromBundleId}`,
      { headers: { 'x-api-key': clientApiKey }, signal: controller.signal }
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object' || Object.keys(payload).length !== 4) return null;
    const size = payload as Record<string, unknown>;
    if (
      size.releaseId !== releaseId ||
      size.fromBundleId !== fromBundleId ||
      !(size.estimatedBytes === null || otaByteSize(size.estimatedBytes)) ||
      !(size.fullBytes === null || (otaByteSize(size.fullBytes) && size.fullBytes > 0))
    )
      return null;
    return { estimatedBytes: size.estimatedBytes, fullBytes: size.fullBytes };
  } catch {
    // Size metadata is optional; it must never prevent reading or accepting an update.
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
