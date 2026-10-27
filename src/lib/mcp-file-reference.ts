import { assetKindFromMime, sessionAssetsFromResponse, type SessionAsset } from './session-assets';
import { gatewayUploadName } from './uploaded-attachments';

export type McpFileReference = { serverId: string } & (
  | { path: string; uploadName?: never; expiresAt?: never }
  | { path?: never; uploadName: string; expiresAt: number }
);

/** Tool text is untrusted: bind paths to a paired computer, never supplied URLs or credentials. */
export function mcpFileAssets(result: Record<string, unknown> | null): SessionAsset[] {
  const serverId = result?.server_id;
  if (typeof serverId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(serverId)) return [];
  if (!Array.isArray(result?.files)) return [];
  return result.files.slice(0, 8).flatMap((value: unknown): SessionAsset[] => {
    if (!value || typeof value !== 'object') return [];
    const file = value as Record<string, unknown>;
    if (typeof file.path === 'string') {
      if (
        !/^(?:\/|~\/)/.test(file.path) ||
        file.path.startsWith('//') ||
        file.path.length > 8192 ||
        /[\u0000-\u001f\u007f]/.test(file.path)
      )
        return [];
      const normalized = sessionAssetsFromResponse([file])[0];
      if (
        !normalized ||
        normalized.name.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(normalized.name) ||
        !Number.isSafeInteger(normalized.size) ||
        normalized.size < 0
      )
        return [];
      return [
        {
          id: `mcp:${serverId}:${normalized.id}`,
          path: file.path,
          name: normalized.name,
          mime: normalized.mime,
          kind: normalized.kind,
          size: normalized.size,
          modified_unix_ms: normalized.modified_unix_ms,
          previewable: normalized.previewable,
          mcpFile: { serverId, path: file.path },
        },
      ];
    }
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
