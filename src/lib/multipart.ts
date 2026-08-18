/**
 * Assembling a multipart body in JavaScript, for the one transport that has to.
 *
 * On the plaintext transport nothing here runs: nitro-fetch recognises React
 * Native's `{ uri, name, type }` triple inside a `FormData` and writes the
 * multipart body natively, off the JS thread. The encrypted transport cannot
 * delegate that, because it has to have the finished request body as bytes
 * before it can seal it into an envelope -- and asking React Native for those
 * bytes does not work: its `Response` stores a `FormData` unread and then
 * throws `could not read FormData body as blob` from `arrayBuffer()`, which is
 * why every attachment upload failed on an encrypted pairing without a single
 * byte reaching the gateway. It also reports no `content-type` for a FormData,
 * so the boundary has to come from here too or the gateway is handed a body it
 * cannot split.
 */

/** One already-read part: its headers, and its bytes. */
export interface MultipartPart {
  /** Lowercase header names, as React Native's `FormData.getParts()` writes them. */
  headers: Record<string, string>;
  content: Uint8Array;
}

const CRLF = '\r\n';

/**
 * UTF-8 without a `TextEncoder`, which Hermes does not ship -- the mirror of the
 * decoder `sse-record.ts` carries for the same reason. Lone surrogates are
 * written as U+FFFD rather than throwing, because a part value comes from a
 * document provider's filename and a malformed one is not worth failing a send.
 */
export function utf8Bytes(value: string): Uint8Array {
  const out: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * A boundary that cannot occur inside the parts it separates.
 *
 * The delimiter is only safe if no part contains it, and the parts here are
 * arbitrary file bytes that cannot be scanned cheaply. `randomHex` is therefore
 * expected to carry real entropy -- with 16 random bytes an accidental match is
 * not a case worth handling, and the fixed prefix keeps the whole token inside
 * the character set RFC 2046 allows.
 */
export function multipartBoundary(randomHex: string): string {
  return `----MuqunBoundary${randomHex}`;
}

export function multipartContentType(boundary: string): string {
  return `multipart/form-data; boundary=${boundary}`;
}

/**
 * The complete body: every part behind its delimiter, then the closing one.
 *
 * Header order follows insertion order so the encoding is reproducible, which
 * is what makes this testable at all.
 */
export function encodeMultipart(parts: MultipartPart[], boundary: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    let head = `--${boundary}${CRLF}`;
    for (const [name, value] of Object.entries(part.headers)) {
      head += `${name}: ${value}${CRLF}`;
    }
    head += CRLF;
    chunks.push(utf8Bytes(head));
    chunks.push(part.content);
    chunks.push(utf8Bytes(CRLF));
  }
  chunks.push(utf8Bytes(`--${boundary}--${CRLF}`));

  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}
