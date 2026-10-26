import { assetKindFromMime, type SessionAsset } from './session-assets';
import { gatewayUploadName } from './uploaded-attachments';

export interface McpFileReference {
  serverId: string;
  uploadName: string;
  expiresAt: number;
}

/** Tool text is untrusted: accept an opaque upload name, never a URL or credential. */
export function mcpFileAssets(result: Record<string, unknown> | null): SessionAsset[] {
  const serverId = result?.server_id;
  if (typeof serverId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(serverId)) return [];
  if (!Array.isArray(result?.files)) return [];
  return result.files.slice(0, 8).flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') return [];
    const file = value as Record<string, unknown>;
    const uploadName = file.upload_name;
    if (typeof uploadName !== 'string') return [];
    const path = `/muqun-gateway/uploads/${uploadName}`;
    if (gatewayUploadName(path) !== uploadName) return [];
    if (
      typeof file.name !== 'string' ||
      !file.name ||
      file.name.length > 256 ||
      /[\u0000-\u001f]/.test(file.name)
    )
      return [];
    if (typeof file.mime !== 'string' || file.mime.length > 128) return [];
    if (
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > (file.mime.startsWith('video/') ? 64 : 25) * 1024 * 1024
    )
      return [];
    if (typeof file.expires_at_ms !== 'number' || !Number.isSafeInteger(file.expires_at_ms))
      return [];
    const kind = assetKindFromMime(file.mime.split(';')[0]);
    return [
      {
        id: `mcp:${serverId}:${uploadName}`,
        path,
        name: file.name,
        mime: file.mime,
        kind,
        size: file.size,
        modified_unix_ms: 0,
        previewable: kind !== 'binary',
        mcpFile: { serverId, uploadName, expiresAt: file.expires_at_ms },
      },
    ];
  });
}
