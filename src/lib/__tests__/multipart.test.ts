import { describe, expect, test } from 'bun:test';

import { encodeMultipart, multipartBoundary, multipartContentType, utf8Bytes } from '../multipart';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('binary');

describe('multipart encoding', () => {
  test('wraps a file part in its delimiters and keeps the bytes byte-exact', () => {
    // A PNG signature, which is what the gateway sniffs for. It survives only
    // if the part is spliced in as bytes rather than run through any text step.
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00]);
    const body = encodeMultipart(
      [
        {
          headers: {
            'content-disposition': 'form-data; name="file"; filename="shot.png"',
            'content-type': 'image/png',
          },
          content: png,
        },
      ],
      'BOUND'
    );

    expect(decode(body)).toBe(
      '--BOUND\r\n' +
        'content-disposition: form-data; name="file"; filename="shot.png"\r\n' +
        'content-type: image/png\r\n' +
        '\r\n' +
        '\x89PNG\r\n\x1a\n\xff\x00' +
        '\r\n' +
        '--BOUND--\r\n'
    );
  });

  test('an empty file still produces a well-formed part', () => {
    const body = encodeMultipart(
      [{ headers: { 'content-disposition': 'form-data; name="file"' }, content: new Uint8Array() }],
      'B'
    );
    expect(decode(body)).toBe(
      '--B\r\ncontent-disposition: form-data; name="file"\r\n\r\n\r\n--B--\r\n'
    );
  });

  test('every part gets its own delimiter and only the last one closes', () => {
    const body = decode(
      encodeMultipart(
        [
          { headers: { 'content-disposition': 'form-data; name="a"' }, content: utf8Bytes('1') },
          { headers: { 'content-disposition': 'form-data; name="b"' }, content: utf8Bytes('2') },
        ],
        'B'
      )
    );
    expect(body.match(/--B\r\n/g)).toHaveLength(2);
    expect(body.endsWith('--B--\r\n')).toBe(true);
  });

  test('a body with no parts is just the closing delimiter', () => {
    expect(decode(encodeMultipart([], 'B'))).toBe('--B--\r\n');
  });

  test('the content type carries the boundary the body was written with', () => {
    const boundary = multipartBoundary('0123456789abcdef');
    expect(boundary).toBe('----MuqunBoundary0123456789abcdef');
    expect(multipartContentType(boundary)).toBe(
      'multipart/form-data; boundary=----MuqunBoundary0123456789abcdef'
    );
    expect(decode(encodeMultipart([], boundary)).startsWith(`--${boundary}--`)).toBe(true);
  });
});

describe('utf8 encoding', () => {
  test('encodes ASCII, multi-byte and astral characters like TextEncoder would', () => {
    for (const value of ['file.png', '報告.pdf', 'résumé', '⏺ pane', '🐙.txt', '']) {
      expect(Array.from(utf8Bytes(value))).toEqual(Array.from(Buffer.from(value, 'utf8')));
    }
  });

  test('replaces a lone surrogate rather than throwing, so a bad name still sends', () => {
    expect(Array.from(utf8Bytes('\ud800'))).toEqual(Array.from(Buffer.from('�', 'utf8')));
    expect(Array.from(utf8Bytes('a\udc00b'))).toEqual(Array.from(Buffer.from('a�b', 'utf8')));
  });
});
