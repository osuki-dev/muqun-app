/** Keep cached video downloads bounded; other files retain the existing limit. */
export const VIDEO_CONTENT_LIMIT = 32 * 1024 * 1024;
export const FILE_CONTENT_LIMIT = 10 * 1024 * 1024;

export function fileContentLimit(mime: string): number {
  return mime.startsWith('video/') ? VIDEO_CONTENT_LIMIT : FILE_CONTENT_LIMIT;
}
