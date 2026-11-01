import { videoFileMime } from '@/lib/media-file';
import { isHostPathSource } from '@/lib/message-images';

/** Local media and file links become players or chips; code examples and web links stay markdown. */
export type AudioMarkdownPart =
  | { kind: 'markdown'; text: string; start: number }
  | (({ kind: 'audio' } | { kind: 'video' } | { kind: 'file' }) & {
      uri: string;
      name: string;
      start: number;
    })
  /** The body of a closed ```muqun-theme fence, offered as a preview below it. */
  | { kind: 'theme'; source: string; start: number };

/** A theme manifest or package path as an agent prints it: absolute, `~`, relative or `file://`. */
const THEME_PATH = /^(?:file:\/\/)?[^\s`'"<>()[\]:*]+\.muqun-theme(?:\.json)?$/i;

export function isThemeFilePath(path: string): boolean {
  return THEME_PATH.test(path) && isHostPathSource(path);
}

function mediaKind(path: string): 'audio' | 'video' | 'file' {
  if (videoFileMime({ uri: path })) return 'video';
  if (/\.(wav|mp3|m4a|aac|ogg|opus|flac|aiff?)$/i.test(path)) return 'audio';
  return 'file';
}

function basename(path: string): string {
  return path.slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1) || path;
}

/** Source-link locations are navigation hints, not part of the host filename.
 * Keep percent-encoded delimiters literal; only explicit local Markdown links
 * use this convention, never arbitrary file APIs or URLs to other hosts.
 */
function stripLocation(uri: string): string {
  return uri.replace(
    /(?::[1-9]\d*(?::[1-9]\d*)?|#L[1-9]\d*(?:C[1-9]\d*)?(?:-L?[1-9]\d*(?:C[1-9]\d*)?)?)$/,
    ''
  );
}

/**
 * The host path a local file link names, or `null` when it names none.
 *
 * The one place a link destination becomes a path, for the chip and for the
 * link left inline in a sentence alike. A `file:` URL is parsed, refused when
 * it names another host (`localhost` is this one), and its path decoded once;
 * a plain absolute, `~` or relative path is passed as written, because the
 * Gateway resolves those itself. A location suffix (`:12`, `#L3`) is dropped
 * before decoding, so an encoded `%3A10` stays part of the name.
 */
export function localFileLinkPath(destination: string): string | null {
  const trimmed = destination.trim();
  if (trimmed.startsWith('#') || !isHostPathSource(trimmed)) return null;
  let path = stripLocation(trimmed);
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path);
      if (url.host) return null;
      path = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  // oxlint-disable-next-line no-control-regex -- a decoded NUL or newline is never a filename
  return path && !/[\u0000-\u001f\u007f]/.test(path) ? path : null;
}

/**
 * Destinations `localFileLinkPath` may accept, as a native link-variant pattern
 * (valid for both ICU and Java regex): `file:`, or no scheme and neither a
 * network path nor an in-page anchor. The renderer draws these as files.
 */
export const LOCAL_FILE_LINK_PATTERN = '^(?:[Ff][Ii][Ll][Ee]:|(?!//|#|[A-Za-z][A-Za-z0-9+.-]+:))';

/** A line that is nothing but a theme path, optionally bulleted or in a code span. */
function wholeLineThemePath(line: string): string | undefined {
  const bare = line
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^(`+)\s*(.*?)\s*\1$/, '$2');
  return isThemeFilePath(bare) ? bare : undefined;
}

export function splitAudioMarkdown(text: string): AudioMarkdownPart[] {
  const parts: AudioMarkdownPart[] = [];
  const themePaths = new Set<string>();
  let cursor = 0;
  let offset = 0;
  let fence: string | undefined;
  let themeFenceStart: number | undefined;
  const flushTo = (end: number) => {
    if (end > cursor)
      parts.push({ kind: 'markdown', text: text.slice(cursor, end), start: cursor });
    cursor = Math.max(cursor, end);
  };
  const pushThemeFile = (uri: string, start: number) => {
    if (themePaths.has(uri)) return;
    themePaths.add(uri);
    parts.push({ kind: 'file', uri, name: basename(uri), start });
  };
  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length;
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (
        marker?.[0] === fence[0] &&
        marker.length >= fence.length &&
        line.slice(line.indexOf(marker) + marker.length).trim() === ''
      ) {
        fence = undefined;
        if (themeFenceStart !== undefined) {
          const source = text.slice(themeFenceStart, offset);
          themeFenceStart = undefined;
          flushTo(lineEnd);
          parts.push({ kind: 'theme', source, start: offset });
        }
      }
    } else if (marker) {
      fence = marker;
      if (/^muqun-theme\s*$/i.test(line.slice(line.indexOf(marker) + marker.length).trim()))
        themeFenceStart = Math.min(lineEnd + 1, text.length);
    } else if (!/^(?: {4}|\t)/.test(line)) {
      const whole = wholeLineThemePath(line);
      if (whole && !themePaths.has(whole)) {
        flushTo(offset);
        pushThemeFile(whole, offset);
        cursor = lineEnd;
      } else {
        // Consume code spans before scanning links, including angle-wrapped paths.
        // A theme path printed in prose or in a code span keeps the sentence and
        // gets its chip below the line.
        const tokens =
          /(`+)(.*?)\1|:codex-file-citation\{([^}\n]*)\}|\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s()]+))\s*(?:"[^"\n]*"\s*)?\)|(^|[\s(（"'“:：])((?:file:\/\/)?[^\s`'"<>()[\]:*]+?\.muqun-theme(?:\.json)?)(?![\w-]|\.\w)/gi;
        const trailing: { uri: string; start: number }[] = [];
        for (const match of line.matchAll(tokens)) {
          if (match[1]) {
            const code = match[2]!.trim();
            if (isThemeFilePath(code)) trailing.push({ uri: code, start: offset + match.index });
            continue;
          }
          if (match[8]) {
            if (isThemeFilePath(match[8]))
              trailing.push({ uri: match[8], start: offset + match.index + match[7]!.length });
            continue;
          }
          if (match[3] !== undefined) {
            // Codex cites a file it wrote or read as a directive rather than a
            // link: `:codex-file-citation{path="/abs/report.pdf" purpose="output"}`.
            // Drawn raw it is markup the reader cannot use, so it becomes the
            // same tappable file a markdown link to that path would be.
            const cited = /(?:^|\s)path="([^"\n]+)"/.exec(match[3])?.[1];
            const path = cited ? localFileLinkPath(cited) : null;
            if (!cited || !path) continue;
            const start = offset + match.index;
            flushTo(start);
            if (isThemeFilePath(cited)) themePaths.add(cited);
            parts.push({ kind: mediaKind(path), uri: path, name: basename(path), start });
            cursor = start + match[0].length;
            continue;
          }
          if (/[!\\]/.test(line[match.index - 1] ?? '')) continue;
          const destination = match[5] ?? match[6];
          const path = destination ? localFileLinkPath(destination) : null;
          if (!destination || !path) continue;
          // Theme mentions are deduplicated as written, so a link and a bare
          // mention of the same theme file still collapse into one chip.
          const written = stripLocation(destination.trim());
          const start = offset + match.index;
          const kind = mediaKind(path);
          // A file link inside a sentence stays a link in the text, so the
          // sentence is not broken around a block; a player, or a link that is
          // the whole line, becomes its own block.
          if (kind === 'file' && line.trim() !== match[0]) {
            if (isThemeFilePath(written)) trailing.push({ uri: written, start });
            continue;
          }
          flushTo(start);
          if (isThemeFilePath(written)) themePaths.add(written);
          parts.push({ kind, uri: path, name: match[4]!, start });
          cursor = start + match[0].length;
        }
        const fresh = trailing.filter(({ uri }) => !themePaths.has(uri));
        if (fresh.length > 0) {
          flushTo(lineEnd);
          for (const { uri, start } of fresh) pushThemeFile(uri, start);
        }
      }
    }
    offset = lineEnd + 1;
  }
  if (cursor < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: text.slice(cursor), start: cursor });
  return parts;
}
