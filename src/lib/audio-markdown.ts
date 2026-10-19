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

function basename(path: string): string {
  return path.slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1) || path;
}

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
          /(`+)(.*?)\1|\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s()]+))\s*(?:"[^"\n]*"\s*)?\)|(^|[\s(（"'“:：])((?:file:\/\/)?[^\s`'"<>()[\]:*]+?\.muqun-theme(?:\.json)?)(?![\w-]|\.\w)/gi;
        const trailing: { uri: string; start: number }[] = [];
        for (const match of line.matchAll(tokens)) {
          if (match[1]) {
            const code = match[2]!.trim();
            if (isThemeFilePath(code)) trailing.push({ uri: code, start: offset + match.index });
            continue;
          }
          if (match[7]) {
            if (isThemeFilePath(match[7]))
              trailing.push({ uri: match[7], start: offset + match.index + match[6]!.length });
            continue;
          }
          if (/[!\\]/.test(line[match.index - 1] ?? '')) continue;
          const uri = match[4] ?? match[5];
          if (
            !uri ||
            !isHostPathSource(uri) ||
            !/\.(?:wav|mp3|m4a|aac|ogg|opus|flac|aiff?|mp4|mov|m4v|png|jpe?g|webp|gif|pdf|zip|txt|md|json|csv|docx?|muqun-theme)$/i.test(
              uri
            )
          )
            continue;
          const start = offset + match.index;
          flushTo(start);
          if (isThemeFilePath(uri)) themePaths.add(uri);
          parts.push({
            kind: /\.(mp4|mov|m4v)$/i.test(uri)
              ? 'video'
              : /\.(wav|mp3|m4a|aac|ogg|opus|flac|aiff?)$/i.test(uri)
                ? 'audio'
                : 'file',
            uri,
            name: match[3]!,
            start,
          });
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
