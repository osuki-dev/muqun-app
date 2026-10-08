import { isHostPathSource } from '@/lib/message-images';

/** Local audio links become players; code examples and web links stay markdown. */
export type AudioMarkdownPart =
  | { kind: 'markdown'; text: string; start: number }
  | (({ kind: 'audio' } | { kind: 'video' } | { kind: 'file' }) & {
      uri: string;
      name: string;
      start: number;
    });

export function splitAudioMarkdown(text: string): AudioMarkdownPart[] {
  const parts: AudioMarkdownPart[] = [];
  let cursor = 0;
  let offset = 0;
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (
        marker?.[0] === fence[0] &&
        marker.length >= fence.length &&
        line.slice(line.indexOf(marker) + marker.length).trim() === ''
      )
        fence = undefined;
    } else if (marker) {
      fence = marker;
    } else if (!/^(?: {4}|\t)/.test(line)) {
      // Consume code spans before scanning links, including angle-wrapped paths.
      const tokens =
        /(`+).*?\1|\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|([^\s()]+))\s*(?:"[^"\n]*"\s*)?\)/g;
      for (const match of line.matchAll(tokens)) {
        if (match[1] || /[!\\]/.test(line[match.index - 1] ?? '')) continue;
        const uri = match[3] ?? match[4];
        if (
          !uri ||
          !isHostPathSource(uri) ||
          !/\.(?:wav|mp3|m4a|aac|ogg|opus|flac|aiff?|mp4|mov|m4v|png|jpe?g|webp|gif|pdf|zip|txt|md|json|csv|docx?)$/i.test(
            uri
          )
        )
          continue;
        const start = offset + match.index;
        if (start > cursor)
          parts.push({ kind: 'markdown', text: text.slice(cursor, start), start: cursor });
        parts.push({
          kind: /\.(mp4|mov|m4v)$/i.test(uri)
            ? 'video'
            : /\.(wav|mp3|m4a|aac|ogg|opus|flac|aiff?)$/i.test(uri)
              ? 'audio'
              : 'file',
          uri,
          name: match[2],
          start,
        });
        cursor = start + match[0].length;
      }
    }
    offset += line.length + 1;
  }
  if (cursor < text.length || !parts.length)
    parts.push({ kind: 'markdown', text: text.slice(cursor), start: cursor });
  return parts;
}
