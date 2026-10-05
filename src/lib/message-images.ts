/**
 * Images an agent's markdown embeds by host path.
 *
 * An agent that renders a chart and answers `![flow](./out/flow.png)` -- or
 * `file:///home/me/work/out/flow.png` -- wrote a reference only its own machine
 * can follow. Handed to the markdown renderer as it is, the phone looks for
 * that path on itself, finds nothing, and draws an empty image box.
 *
 * The gateway resolves those sources for us: each text part carries
 * `image_assets`, one entry per source that names an image inside the
 * session's directory, with the asset URL that serves it. The text itself is
 * the agent's own and stays that way -- copying a message still copies the
 * paths it was written with. This module swaps the sources at render time,
 * and turns a host-path image the gateway could not serve into a caption
 * rather than a blank, because the phone has no way to load it at all.
 *
 * The scan follows the gateway's (`agents/message_images.rs`): the destination
 * of `![alt](dest "title")` without its `<…>` wrapper, and the `src` of an
 * `<img>`, outside fenced code blocks and inline code spans.
 */

/** One entry of a text part's `image_assets`, as the gateway sends it. */
export interface MessageImageAsset {
  /** The source exactly as the markdown wrote it. */
  src: string;
  asset_id: string;
  /** Gateway-relative: `/api/assets/{asset_id}/content`. */
  url: string;
  mime: string;
  width?: number;
  height?: number;
}

export function parseMessageImageAssets(value: unknown): MessageImageAsset[] {
  if (!Array.isArray(value)) return [];
  const out: MessageImageAsset[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const { src, asset_id: assetId, url, mime } = rec;
    if (typeof src !== 'string' || !src) continue;
    if (typeof assetId !== 'string' || !assetId) continue;
    // Only ever a path on the gateway: a map that pointed anywhere else would
    // send the device's credentials there.
    if (typeof url !== 'string' || !url.startsWith('/api/assets/')) continue;
    out.push({
      src,
      asset_id: assetId,
      url,
      mime: typeof mime === 'string' ? mime : 'image/*',
      ...(typeof rec.width === 'number' && rec.width > 0 ? { width: rec.width } : {}),
      ...(typeof rec.height === 'number' && rec.height > 0 ? { height: rec.height } : {}),
    });
  }
  return out;
}

/**
 * True when a source names a file on the host rather than something the phone
 * can fetch: a `file:` URL, or anything with no scheme at all (an absolute or
 * relative path). Web URLs, data URIs and every other scheme are not.
 */
export function isHostPathSource(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;
  if (/^file:/i.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]+:/i.test(trimmed);
}

/** What to do with one image source. */
export type ImageResolution =
  /** Swap the source for this URI. */
  | { kind: 'uri'; uri: string }
  /** Replace the whole image with a caption built from its alt text. */
  | { kind: 'caption' }
  /** Leave it exactly as written. */
  | { kind: 'keep' };

interface ImageOccurrence {
  /** The whole image: `![…](…)` or the `<img …>` tag. */
  start: number;
  end: number;
  /** The source within it. */
  srcStart: number;
  srcEnd: number;
  src: string;
  alt: string;
}

/**
 * Rewrite the images of a markdown text. `resolve` decides per source;
 * `caption` turns alt text into the markdown drawn in an image's place.
 * Everything that is not an image source -- code, prose, link targets -- is
 * returned byte for byte.
 */
export function rewriteMessageImages(
  markdown: string,
  resolve: (src: string) => ImageResolution,
  caption: (alt: string) => string
): string {
  if (!markdown.includes('![') && !/<img/i.test(markdown)) return markdown;
  const lines = markdown.split(/(?<=\n)/);
  let fence: { marker: string; count: number } | null = null;
  let changed = false;
  const out = lines.map((line) => {
    const body = line.replace(/\r?\n$/, '');
    const marker = fenceMarker(body);
    if (marker) {
      if (!fence) fence = { marker: marker.marker, count: marker.count };
      else if (
        fence.marker === marker.marker &&
        marker.count >= fence.count &&
        !marker.rest.trim()
      ) {
        fence = null;
      }
      return line;
    }
    if (fence) return line;
    const occurrences = findImages(body);
    if (occurrences.length === 0) return line;
    let next = line;
    // Right to left, so earlier offsets stay valid.
    for (const image of occurrences.reverse()) {
      const decision = resolve(image.src);
      if (decision.kind === 'uri') {
        next = next.slice(0, image.srcStart) + decision.uri + next.slice(image.srcEnd);
        changed = true;
      } else if (decision.kind === 'caption') {
        next = next.slice(0, image.start) + caption(image.alt) + next.slice(image.end);
        changed = true;
      }
    }
    return next;
  });
  return changed ? out.join('') : markdown;
}

/**
 * The resolver a transcript part uses: a source the gateway resolved and the
 * app has a URI for is swapped; one still on its way is left as written (an
 * image box that fills in); a host path with nothing to serve it becomes a
 * caption; anything else -- a web URL, a data URI -- is left alone.
 */
export function messageImageResolver(
  uris: ReadonlyMap<string, string>,
  pending: ReadonlySet<string>
): (src: string) => ImageResolution {
  return (src) => {
    const uri = uris.get(src);
    if (uri) return { kind: 'uri', uri };
    if (pending.has(src)) return { kind: 'keep' };
    return isHostPathSource(src) ? { kind: 'caption' } : { kind: 'keep' };
  };
}

/** Markdown-escape alt text so a caption cannot open a link, emphasis or tag. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>#|~!()]/g, (char) => `\\${char}`);
}

function fenceMarker(line: string): { marker: string; count: number; rest: string } | null {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;
  return { marker: match[1][0], count: match[1].length, rest: match[2] };
}

/** `[start, end)` spans of a line that are inside inline code. */
function codeSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    let run = 0;
    while (line[i + run] === '`') run += 1;
    let j = i + run;
    let close = -1;
    while (j < line.length) {
      if (line[j] === '`') {
        let other = 0;
        while (line[j + other] === '`') other += 1;
        if (other === run) {
          close = j + other;
          break;
        }
        j += other;
      } else {
        j += 1;
      }
    }
    if (close < 0) {
      i += run;
    } else {
      spans.push([i, close]);
      i = close;
    }
  }
  return spans;
}

function findImages(line: string): ImageOccurrence[] {
  const spans = codeSpans(line);
  const inCode = (at: number) => spans.some(([start, end]) => at >= start && at < end);
  const found = [...markdownImages(line), ...htmlImages(line)].filter(
    (image) => !inCode(image.start)
  );
  found.sort((a, b) => a.start - b.start);
  // A markdown image never sits inside an <img> tag; drop any overlap anyway.
  const out: ImageOccurrence[] = [];
  for (const image of found) {
    const last = out[out.length - 1];
    if (!last || image.start >= last.end) out.push(image);
  }
  return out;
}

function markdownImages(line: string): ImageOccurrence[] {
  const out: ImageOccurrence[] = [];
  let i = 0;
  for (;;) {
    const open = line.indexOf('![', i);
    if (open < 0) break;
    i = open + 2;
    if (open > 0 && line[open - 1] === '\\') continue;
    let depth = 1;
    let j = open + 2;
    while (j < line.length && depth > 0) {
      const char = line[j];
      if (char === '\\') j += 1;
      else if (char === '[') depth += 1;
      else if (char === ']') depth -= 1;
      j += 1;
    }
    if (depth !== 0 || line[j] !== '(') continue;
    const alt = line.slice(open + 2, j - 1);
    j += 1;
    while (line[j] === ' ' || line[j] === '\t') j += 1;
    let srcStart: number;
    let srcEnd: number;
    if (line[j] === '<') {
      const close = line.indexOf('>', j + 1);
      if (close < 0) continue;
      srcStart = j + 1;
      srcEnd = close;
      j = close + 1;
    } else {
      srcStart = j;
      let parens = 0;
      while (j < line.length) {
        const char = line[j];
        if (char === '\\') {
          j += 2;
          continue;
        }
        if (char === '(') parens += 1;
        else if (char === ')') {
          if (parens === 0) break;
          parens -= 1;
        } else if (char === ' ' || char === '\t') break;
        j += 1;
      }
      srcEnd = Math.min(j, line.length);
    }
    // The end of the image is its closing parenthesis, past any title.
    const close = closingParen(line, j);
    if (srcEnd > srcStart) {
      out.push({
        start: open,
        end: close < 0 ? srcEnd : close + 1,
        srcStart,
        srcEnd,
        src: line.slice(srcStart, srcEnd),
        alt,
      });
    }
    i = Math.max(i, srcEnd);
  }
  return out;
}

/** The `)` that ends an image whose destination ended at `from`. */
function closingParen(line: string, from: number): number {
  let j = from;
  let quote: string | null = null;
  while (j < line.length) {
    const char = line[j];
    if (quote) {
      if (char === '\\') j += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ')') {
      return j;
    }
    j += 1;
  }
  return -1;
}

function htmlImages(line: string): ImageOccurrence[] {
  const out: ImageOccurrence[] = [];
  const pattern = /<img\b[^>]*>/gi;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    const tag = match[0];
    const attr = /(^|[\s/])src\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'/>]+))/i.exec(tag);
    if (!attr) continue;
    const value = attr[3] ?? attr[4] ?? attr[5] ?? '';
    if (!value) continue;
    const quoted = attr[3] !== undefined || attr[4] !== undefined;
    const valueOffset = attr.index + attr[0].length - value.length - (quoted ? 1 : 0);
    const altMatch = /(^|\s)alt\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag);
    out.push({
      start: match.index,
      end: match.index + tag.length,
      srcStart: match.index + valueOffset,
      srcEnd: match.index + valueOffset + value.length,
      src: value,
      alt: altMatch ? (altMatch[3] ?? altMatch[4] ?? '') : '',
    });
  }
  return out;
}
