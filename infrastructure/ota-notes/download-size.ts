import type { ArtifactInfo } from '@hot-updater/protocol';
import { otaByteSize, type OtaDownloadSize } from '../../src/lib/ota-download-size';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type ManifestAsset = { fileHash: string; byteSize: number | null; downloadByteSize: number | null };
type SizeManifest = {
  assets: Record<string, ManifestAsset>;
  archive: { downloadByteSize: number; tarByteSize: number } | null;
};

function sizeManifest(payload: unknown, bundleId: string): SizeManifest | null {
  const manifest = record(payload);
  const assets = record(manifest?.assets);
  if (!manifest || manifest.bundleId !== bundleId || !assets || !Object.keys(assets).length)
    return null;
  const parsed: Record<string, ManifestAsset> = {};
  for (const [path, value] of Object.entries(assets)) {
    const asset = record(value);
    if (!asset || typeof asset.fileHash !== 'string' || !/^[0-9a-f]{64}$/i.test(asset.fileHash))
      return null;
    parsed[path] = {
      fileHash: asset.fileHash,
      byteSize: otaByteSize(asset.byteSize) ? asset.byteSize : null,
      downloadByteSize: otaByteSize(asset.downloadByteSize) ? asset.downloadByteSize : null,
    };
  }
  const archive = record(manifest.archive);
  return {
    assets: parsed,
    archive:
      archive &&
      typeof archive.downloadFileHash === 'string' &&
      /^[0-9a-f]{64}$/i.test(archive.downloadFileHash) &&
      otaByteSize(archive.downloadByteSize) &&
      archive.downloadByteSize > 0 &&
      otaByteSize(archive.tarByteSize) &&
      archive.tarByteSize >= 1024
        ? { downloadByteSize: archive.downloadByteSize, tarByteSize: archive.tarByteSize }
        : null,
  };
}

/** Mirrors SDK 1.0 archive cost selection using the published base, without touching a device. */
export function estimateOtaDownloadSize(
  targetPayload: unknown,
  targetBundleId: string,
  basePayload: unknown,
  fromBundleId: string,
  artifact: ArtifactInfo
): OtaDownloadSize | null {
  const target = sizeManifest(targetPayload, targetBundleId);
  const base = sizeManifest(basePayload, fromBundleId);
  const archive = artifact.archiveUrl ? target?.archive : null;
  if (!target) return null;
  // The full archive is one transport. Without it, count each original file
  // payload once, using downloadByteSize rather than decompressed byteSize.
  let originalBytes: number | null = 0;
  for (const [path, asset] of Object.entries(target.assets)) {
    if (!otaByteSize(asset.downloadByteSize) || !artifact.assets[path]) {
      originalBytes = null;
      break;
    }
    originalBytes += asset.downloadByteSize;
  }
  const fullBytes = archive?.downloadByteSize ?? originalBytes;
  if (!otaByteSize(fullBytes) || fullBytes <= 0) return null;
  if (!base) return { estimatedBytes: null, fullBytes };
  const downloads = Object.entries(target.assets).filter(
    ([path, asset]) => base.assets[path]?.fileHash !== asset.fileHash
  );
  let estimatedBytes = 0;
  let hasPatch = false;
  for (const [path, asset] of downloads) {
    const patch = artifact.assets[path]?.patch;
    if (!artifact.assets[path]) return { estimatedBytes: null, fullBytes };
    const usesPatch =
      patch?.baseBundleId === fromBundleId && patch.baseFileHash === base.assets[path]?.fileHash;
    const patchBytes = usesPatch ? patch.byteSize : null;
    if (usesPatch && !otaByteSize(patchBytes)) return { estimatedBytes: null, fullBytes };
    if (!otaByteSize(patchBytes) && !otaByteSize(asset.downloadByteSize))
      return { estimatedBytes: null, fullBytes };
    estimatedBytes += otaByteSize(patchBytes) ? patchBytes : (asset.downloadByteSize ?? 0);
    hasPatch ||= usesPatch;
  }
  if (!otaByteSize(estimatedBytes)) return { estimatedBytes: null, fullBytes };
  if (
    archive &&
    downloads.length >= 2 &&
    Object.values(target.assets).every((asset) => otaByteSize(asset.byteSize))
  ) {
    const logicalBytes = Object.values(target.assets).reduce(
      (sum, asset) => sum + (asset.byteSize ?? 0),
      0
    );
    const framedLimit = estimatedBytes + archive.tarByteSize - logicalBytes;
    if (
      otaByteSize(logicalBytes) &&
      archive.tarByteSize >= logicalBytes &&
      (archive.downloadByteSize <= estimatedBytes ||
        (!hasPatch &&
          downloads.length === Object.keys(target.assets).length &&
          otaByteSize(framedLimit) &&
          archive.downloadByteSize <= framedLimit))
    )
      estimatedBytes = archive.downloadByteSize;
  }
  return { estimatedBytes, fullBytes };
}
