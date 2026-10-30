import { gatewayUploadName } from './uploaded-attachments';

/** Unmapped host paths are file links, never local image pages on the phone. */
export function rawAlbumImage(
  uri: string,
  attachment: boolean,
  localRoots: readonly string[] = []
): { uri: string; uploadName?: string } | null {
  if (/^https?:\/\//i.test(uri) || /^data:image\//i.test(uri)) return { uri };
  if (!attachment) return null;
  const uploadName = gatewayUploadName(uri);
  if (uploadName) return { uri, uploadName };
  if (/^content:\/\/[^/]+\//i.test(uri)) return { uri };
  try {
    const local = new URL(decodeURIComponent(uri));
    if (local.protocol !== 'file:' || local.host || /[\u0000-\u001f\u007f]/.test(local.pathname))
      return null;
    return localRoots.some((root) => {
      const path = new URL(decodeURIComponent(root)).pathname.replace(/\/$/, '') + '/';
      return local.pathname.startsWith(path);
    })
      ? { uri }
      : null;
  } catch {
    return null;
  }
}
