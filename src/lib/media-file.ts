/** Container hints for legacy paths, not a decoder capability allow-list. */
const VIDEO_MIMES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  qt: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  '3gpp': 'video/3gpp',
  '3g2': 'video/3gpp2',
  '3gpp2': 'video/3gpp2',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  m2v: 'video/mpeg',
  m2ts: 'video/mp2t',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  asf: 'video/x-ms-asf',
};

type MediaFile = { mime?: string; name?: string; uri?: string };

export function normalizedFileMime(mime?: string | null): string {
  return mime?.split(';')[0].trim().toLowerCase() ?? '';
}

/** Only a short, literal suffix may become part of a private cache filename. */
export function fileExtension(name?: string): string {
  return /\.([a-z\d]{1,10})$/i.exec(name?.split(/[?#]/)[0] ?? '')?.[1] ?? '';
}

/** Playlists may reference network resources beyond the authenticated file. */
export function isVideoManifest(file: MediaFile): boolean {
  const mime = normalizedFileMime(file.mime);
  return (
    /^(?:application\/(?:vnd\.apple\.mpegurl|x-mpegurl|dash\+xml|vnd\.ms-sstr\+xml)|(?:audio|video)\/(?:x-mpegurl|mpegurl|vnd\.mpegurl))$/.test(
      mime
    ) || [file.name, file.uri].some((name) => /^(?:m3u8?|mpd|ism|ismc)$/i.test(fileExtension(name)))
  );
}

/** Declared types win; only absent/opaque metadata falls back to path hints.
 * Ambiguous source-code suffixes such as .ts/.mts deliberately have no hint.
 */
export function videoFileMime(file: MediaFile): string | undefined {
  if (isVideoManifest(file)) return undefined;
  const mime = normalizedFileMime(file.mime);
  if (mime && mime !== 'application/octet-stream')
    return mime.startsWith('video/') ? mime : undefined;
  return (
    VIDEO_MIMES[fileExtension(file.name).toLowerCase()] ??
    VIDEO_MIMES[fileExtension(file.uri).toLowerCase()]
  );
}

/** Resolve first: Gateway metadata can change both the filename and type. */
export function videoCacheExtension(file: { name?: string; path?: string; mime?: string }): string {
  const extension = fileExtension(file.name) || fileExtension(file.path);
  if (extension) return extension;
  const mime = normalizedFileMime(file.mime);
  return (
    Object.entries(VIDEO_MIMES).find(([, value]) => value === mime)?.[0] ??
    (mime === 'video/mp2t' ? 'ts' : 'bin')
  );
}

/** Defense at the native-player boundary, including mislabeled playlists. */
export function assertStandaloneVideo(file: MediaFile, bytes: Uint8Array): void {
  const prefix = new TextDecoder()
    .decode(bytes.subarray(0, 1024))
    .replace(/^\uFEFF/, '')
    .trimStart();
  if (
    isVideoManifest(file) ||
    /^#EXTM3U(?:\s|$)/i.test(prefix) ||
    /^(?:<\?xml[^>]*>\s*)?<(?:MPD|SmoothStreamingMedia)(?:\s|>)/i.test(prefix)
  )
    throw new Error('Video playlists cannot be played as standalone files');
}
