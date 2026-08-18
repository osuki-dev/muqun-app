import type { PickedFile } from './attachment-queue';

/** The subset of Expo's document asset that survives into the upload queue. */
export interface PickedDocumentAsset {
  uri: string;
  name: string;
  mimeType?: string;
  size?: number;
}

const EXTENSION_MIMES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  md: 'text/markdown',
  markdown: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  toml: 'application/toml',
  xml: 'application/xml',
};

function extensionOf(value: string): string {
  const withoutQuery = value.split(/[?#]/)[0] ?? '';
  const match = withoutQuery.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * A document provider controls the display name. Keep it useful while making
 * sure it cannot add paths, line breaks or an unbounded label to the composer.
 * The gateway repeats the same defence before echoing the name back.
 */
export function safePickedFileName(raw: string): string {
  const base = raw
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!base || /^\.+$/.test(base)) return 'file';
  return Array.from(base).slice(0, 120).join('');
}

export function pickedFilesFromDocuments(assets: PickedDocumentAsset[]): PickedFile[] {
  return assets.map((asset) => {
    const name = safePickedFileName(asset.name);
    const reported = asset.mimeType?.trim();
    const extension = extensionOf(name) || extensionOf(asset.uri);
    const mime =
      reported && reported !== 'application/octet-stream'
        ? reported
        : (EXTENSION_MIMES[extension] ?? reported ?? 'application/octet-stream');
    return {
      uri: asset.uri,
      name,
      mime,
      size: asset.size,
    };
  });
}
