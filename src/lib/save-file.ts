import { Directory, File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';
import { readAssetBytes, type SessionAsset } from '@/lib/gateway-client';

const LIMIT = 10 * 1024 * 1024;
let sequence = 0;

export async function exportFile(name: string, mime: string, bytes: Uint8Array, photos = false) {
  if (bytes.length > LIMIT) throw new Error('File exceeds the download limit');
  const leaf =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^\p{L}\p{N}._ -]/gu, '_') || 'file';
  const safeName = /^\.+$/.test(leaf) ? 'file' : leaf;
  if (!photos && Platform.OS === 'android') {
    const destination = await Directory.pickDirectoryAsync();
    destination.createFile(safeName, mime).write(bytes);
    return;
  }
  const directory = new Directory(Paths.cache, `file-export-${Date.now()}-${sequence++}`);
  directory.create();
  const file = new File(directory, safeName);
  try {
    file.create();
    file.write(bytes);
    if (photos) {
      const permission = await requestPermissionsAsync(true, []);
      if (!permission.granted) throw new Error('Photo permission denied');
      await Asset.create(file.uri);
    } else {
      if (!(await Sharing.isAvailableAsync())) throw new Error('File sharing unavailable');
      await Sharing.shareAsync(file.uri, { mimeType: mime });
    }
  } catch (error) {
    directory.delete();
    throw error;
  }
  directory.delete();
}

export async function saveSessionAsset(asset: SessionAsset, photos = asset.kind === 'image') {
  const bytes = await readAssetBytes(asset, { maxBytes: LIMIT, download: true });
  await exportFile(asset.name, asset.mime, bytes, photos);
}

/** Handles local attachments, decrypted images and authenticated gateway images. */
export async function savePreviewImage(source: { uri: string; headers?: Record<string, string> }) {
  let bytes: Uint8Array;
  let mime = 'image/jpeg';
  if (/^(?:file|content):/.test(source.uri)) {
    const file = new File(source.uri);
    if (file.size > LIMIT) throw new Error('Image exceeds the download limit');
    bytes = await file.bytes();
    mime = file.type || mime;
  } else {
    const response = await fetch(source.uri, { headers: source.headers, redirect: 'error' });
    if (!response.ok) throw new Error('Image download failed');
    if (Number(response.headers.get('content-length')) > LIMIT)
      throw new Error('Image exceeds the download limit');
    mime = response.headers.get('content-type')?.split(';')[0] || mime;
    // The bounded asset endpoint caps gateway images; bound every other source too.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Image download failed');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > LIMIT) throw new Error('Image exceeds the download limit');
        chunks.push(value);
      }
    } finally {
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
  await exportFile(`muqun-image.${extension}`, mime, bytes, true);
}
