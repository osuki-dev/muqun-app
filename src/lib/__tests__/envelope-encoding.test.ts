/**
 * Compression inside the encrypted envelope, from both ends.
 *
 * What makes this worth a suite of its own: the gateway seals before anything
 * can compress, so an encrypted pairing pays about 1.78x the bytes of a
 * cleartext one for identical JSON, and the bodies are not small -- the
 * catalog is 136 kB on the wire and 25 kB gzipped. Moving the compression
 * inside the envelope is the only place it can go, and the cost of getting it
 * wrong is a body read as if it were not compressed: unparseable JSON,
 * surfacing a long way from the cause.
 *
 * The gateway had not yet named its flag when this was written, so all three
 * plausible spellings are read and all three are pinned here. If the gateway
 * lands one of them, the other two stay harmlessly supported; if it lands a
 * fourth, this is the test that says so.
 *
 * The fixtures are gzipped by node's zlib rather than by `fflate`, so the test
 * proves the app reads real gzip and not merely its own round trip.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  decodeSealedBody,
  ENVELOPE_ACCEPT_ENCODINGS,
  ENVELOPE_ACCEPT_HEADER,
  sealedBodyEncoding,
  type SealedResponseEncoding,
} from '../envelope-encoding';

const JSON_BODY = JSON.stringify({
  data: {
    sessions: Array.from({ length: 40 }, (_, index) => ({
      asid: `asid-${index}`,
      title: 'a session with a title long enough to be worth compressing',
      tokens: { input: 1200, output: 340, reasoning: 0 },
    })),
  },
});

const PLAIN = new TextEncoder().encode(JSON_BODY);
const GZIPPED = new Uint8Array(gzipSync(Buffer.from(JSON_BODY, 'utf8')));

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe('what the request advertises', () => {
  test('one header, one token, and nothing that touches Accept-Encoding', () => {
    // Cronet and NSURLSession own `Accept-Encoding` and decompress
    // transparently; this is deliberately a different header on a different
    // layer, read by the gateway rather than by anything in between.
    expect(ENVELOPE_ACCEPT_HEADER).toBe('X-Muqun-Envelope-Accept');
    expect(ENVELOPE_ACCEPT_HEADER.toLowerCase()).not.toBe('accept-encoding');
    expect(ENVELOPE_ACCEPT_ENCODINGS).toBe('gzip');
  });
});

/**
 * The transport itself cannot be imported under bun -- it reaches react-native
 * through the generated API client -- so the two lines that wire this into it
 * are read off the source. Weak on its own; it is here because the failure it
 * catches is silent: an app that inflates correctly and never advertises gets
 * an uncompressed answer forever and nothing ever says so.
 */
const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'gateway-client.ts');

describe('the transport is actually wired to it', () => {
  const source = readFileSync(CLIENT, 'utf8');

  test('every sealed request advertises what it can inflate', () => {
    expect(source).toContain('[ENVELOPE_ACCEPT_HEADER]: ENVELOPE_ACCEPT_ENCODINGS');
  });

  test('every sealed answer is decoded before the response is rebuilt', () => {
    expect(source).toContain('decodeSealedBody(fromBase64Url(payload.body), payload)');
    // The rebuilt response carries the decoded body's headers, not the sealed
    // payload's -- otherwise it would announce a compression it no longer has.
    expect(source).toContain('headers: answerHeaders,');
  });

  test('nothing sets Accept-Encoding by hand', () => {
    // Cronet and NSURLSession send it and decompress transparently. An app that
    // sets it itself takes ownership of a decode the platform then stops doing.
    expect(/['"]accept-encoding['"]/i.test(source)).toBe(false);
  });
});

describe('reading the gateway flag', () => {
  test('a payload with no flag is not compressed', () => {
    expect(sealedBodyEncoding({ headers: { 'content-type': 'application/json' } })).toBeNull();
    expect(sealedBodyEncoding({ headers: {} })).toBeNull();
  });

  test('a field beside the headers', () => {
    expect(sealedBodyEncoding({ headers: {}, content_encoding: 'gzip' })).toBe('gzip');
  });

  test('a conventional header inside the map', () => {
    expect(sealedBodyEncoding({ headers: { 'content-encoding': 'gzip' } })).toBe('gzip');
    expect(sealedBodyEncoding({ headers: { 'Content-Encoding': 'GZIP' } })).toBe('gzip');
  });

  test('the underscored spelling inside the map', () => {
    expect(sealedBodyEncoding({ headers: { content_encoding: 'gzip' } })).toBe('gzip');
  });

  test('an empty flag says nothing, which is not the same as saying gzip', () => {
    expect(sealedBodyEncoding({ headers: { 'content-encoding': '   ' } })).toBeNull();
    expect(sealedBodyEncoding({ headers: {}, content_encoding: '' })).toBeNull();
    expect(sealedBodyEncoding({ headers: {}, content_encoding: 7 })).toBeNull();
  });
});

describe('an uncompressed answer is untouched', () => {
  test('the bytes and the headers come back as they arrived', () => {
    const headers = { 'content-type': 'application/json', 'content-length': '42' };
    const decoded = decodeSealedBody(PLAIN, { headers });

    expect(decoded.bytes).toBe(PLAIN);
    // Same object: nothing is rebuilt on the path every response takes.
    expect(decoded.headers).toBe(headers);
  });

  test('an empty body is an empty body', () => {
    const empty = new Uint8Array(0);
    expect(decodeSealedBody(empty, { headers: {} }).bytes).toBe(empty);
  });
});

describe('a compressed answer is inflated before anyone reads it', () => {
  test('the body the gateway meant to send comes out', () => {
    const decoded = decodeSealedBody(GZIPPED, {
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
    });

    expect(text(decoded.bytes)).toBe(JSON_BODY);
    const parsed = JSON.parse(text(decoded.bytes)) as { data: { sessions: { asid: string }[] } };
    expect(parsed.data.sessions[0].asid).toBe('asid-0');
    // Worth having done: this is the ratio the whole feature is for.
    expect(GZIPPED.length).toBeLessThan(PLAIN.length / 2);
  });

  test('the flag is inflated whichever way the gateway spells it', () => {
    const spellings: SealedResponseEncoding[] = [
      { headers: { 'content-encoding': 'gzip' } },
      { headers: { content_encoding: 'gzip' } },
      { headers: {}, content_encoding: 'gzip' },
      { headers: { 'Content-Encoding': 'x-gzip' } },
    ];
    for (const payload of spellings) {
      expect(text(decodeSealedBody(GZIPPED, payload).bytes)).toBe(JSON_BODY);
    }
  });

  test('the headers stop describing a body that is no longer compressed', () => {
    const decoded = decodeSealedBody(GZIPPED, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': String(GZIPPED.length),
        etag: '"abc"',
      },
    });

    // Both of these described the bytes on the wire. Left in place,
    // `content-encoding` tells the next reader to decode what is already
    // decoded and `content-length` is simply the wrong number.
    expect(Object.keys(decoded.headers).map((name) => name.toLowerCase())).toEqual([
      'content-type',
      'etag',
    ]);
    expect(decoded.headers.etag).toBe('"abc"');
  });

  test('an explicit identity is not compression, and still tidies the headers', () => {
    const decoded = decodeSealedBody(PLAIN, {
      headers: { 'content-encoding': 'identity', 'content-type': 'application/json' },
    });
    expect(text(decoded.bytes)).toBe(JSON_BODY);
    expect(decoded.headers).toEqual({ 'content-type': 'application/json' });
  });

  test('a flagged but empty body is nothing to inflate, not a failure', () => {
    const decoded = decodeSealedBody(new Uint8Array(0), {
      headers: { 'content-encoding': 'gzip' },
    });
    expect(decoded.bytes).toHaveLength(0);
  });
});

describe('a disagreement is reported rather than guessed at', () => {
  test('an encoding this app never asked for is named', () => {
    // The payload is authenticated by the time it arrives here, so this is the
    // two implementations disagreeing -- worth a sentence that says which one.
    expect(() => decodeSealedBody(GZIPPED, { headers: { 'content-encoding': 'br' } })).toThrow(
      'br'
    );
    expect(() => decodeSealedBody(GZIPPED, { headers: {}, content_encoding: 'deflate' })).toThrow(
      'deflate'
    );
  });

  test('a body that says gzip and is not one fails here, not in a JSON parse', () => {
    expect(() => decodeSealedBody(PLAIN, { headers: { 'content-encoding': 'gzip' } })).toThrow(
      'could not decompress'
    );
  });

  test('a truncated member fails rather than returning half an answer', () => {
    expect(() =>
      decodeSealedBody(GZIPPED.subarray(0, GZIPPED.length - 8), {
        headers: { 'content-encoding': 'gzip' },
      })
    ).toThrow('could not decompress');
  });
});
