import { Directory, File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { readAssetBytes, assetPreviewImage, type SessionAsset } from '@/lib/gateway-client';
import { FILE_CONTENT_LIMIT, fileContentLimit } from '@/lib/media-limits';
import { verifiedOriginalImageFile } from '@/lib/image-original-ranges';
import { saveOriginalPreview, type PreviewImageSource } from '@/lib/gateway-image-previews';

const LIMIT = FILE_CONTENT_LIMIT;
let sequence = 0;

function assertSaveActive(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('Image save cancelled');
}

export async function exportFile(
  name: string,
  mime: string,
  bytes: Uint8Array,
  photos = false,
  signal?: AbortSignal
) {
  assertSaveActive(signal);
  if (bytes.length > fileContentLimit(mime)) throw new Error('File exceeds the download limit');
  const leaf =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^\p{L}\p{N}._ -]/gu, '_') || 'file';
  const safeName = /^\.+$/.test(leaf) ? 'file' : leaf;
  if (!photos && Platform.OS === 'android') {
    const destination = await Directory.pickDirectoryAsync();
    assertSaveActive(signal);
    await destination.createFile(safeName, mime).write(bytes);
    return;
  }
  const directory = new Directory(Paths.cache, `file-export-${Date.now()}-${sequence++}`);
  directory.create();
  const file = new File(directory, safeName);
  try {
    file.create();
    await file.write(bytes);
    if (photos) {
      const permission = await requestPermissionsAsync(true, []);
      assertSaveActive(signal);
      if (!permission.granted) throw new Error('Photo permission denied');
      await Asset.create(file.uri);
    } else {
      if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing unavailable');
      assertSaveActive(signal);
      await Sharing.shareAsync(file.uri, { mimeType: mime });
    }
  } catch (error) {
    directory.delete();
    throw error;
  }
  directory.delete();
}

export async function saveSessionAsset(asset: SessionAsset, photos = asset.kind === 'image') {
  const image = photos && asset.kind === 'image' ? assetPreviewImage(asset) : null;
  if (image) return saveOriginalPreview(image, savePreviewImage);
  const bytes = await readAssetBytes(asset, {
    maxBytes: fileContentLimit(asset.mime),
    download: true,
  });
  await exportFile(asset.name, asset.mime, bytes, photos);
}

/** Handles local attachments, decrypted images and authenticated gateway images. */
export async function savePreviewImage(source: PreviewImageSource, signal?: AbortSignal) {
  assertSaveActive(signal);
  // A fixed-version/length-checked private file goes to Photos without a full JS buffer.
  // This marker does not claim the App computed a final-file SHA256 digest.
  // Ordinary files, uploads and unverified/local preview callers keep the old limit.
  if (source.verifiedOriginal) {
    const file = new File(source.uri);
    if (
      !file.exists ||
      !verifiedOriginalImageFile(source.uri, Paths.cache.uri, file.size, source.verifiedOriginal)
    )
      throw new Error('Invalid original image file');
    const permission = await requestPermissionsAsync(true, []);
    assertSaveActive(signal);
    if (!permission.granted) throw new Error('Photo permission denied');
    await Asset.create(file.uri);
    return;
  }
  let bytes: Uint8Array;
  let mime = 'image/jpeg';
  if (/^(?:file|content):/.test(source.uri)) {
    const file = new File(source.uri);
    if (file.size > LIMIT) throw new Error('Image exceeds the download limit');
    bytes = await file.bytes();
    assertSaveActive(signal);
    mime = file.type || mime;
  } else {
    const response = await fetch(source.uri, {
      headers: source.headers,
      redirect: 'error',
      signal,
    });
    if (signal?.aborted) {
      await response.body?.cancel().catch(() => undefined);
      assertSaveActive(signal);
    }
    if (!response.ok) throw new Error('Image download failed');
    if (Number(response.headers.get('content-length')) > LIMIT)
      throw new Error('Image exceeds the download limit');
    mime = response.headers.get('content-type')?.split(';')[0] || mime;
    // The bounded asset endpoint caps gateway images; bound every other source too.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Image download failed');
    const abort = () => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        assertSaveActive(signal);
        const { value, done } = await reader.read();
        assertSaveActive(signal);
        if (done) break;
        length += value.length;
        if (length > LIMIT) throw new Error('Image exceeds the download limit');
        chunks.push(value);
      }
    } finally {
      signal?.removeEventListener('abort', abort);
      await reader.cancel().catch(() => undefined);
    }
    bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const extension =
    { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic' }[mime] ??
    'jpg';
  await exportFile(`muqun-image.${extension}`, mime, bytes, true, signal);
}
