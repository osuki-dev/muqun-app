import { expect, test } from 'bun:test';
import { formatThemeJson } from '../format-json';
import { THEME_LIMITS } from '../schema';

test('formats nested containers with two spaces and keeps empty containers compact', () => {
  expect(formatThemeJson(' {"a":[1,{"b":true}],"empty":{},"list":[]} ')).toBe(
    '{\n  "a": [\n    1,\n    {\n      "b": true\n    }\n  ],\n  "empty": {},\n  "list": []\n}'
  );
});

test('preserves duplicate keys, unsafe integers, exponents and negative zero exactly', () => {
  expect(formatThemeJson('{"n":9007199254740993,"n":1e400,"z":-0,"d":1.2300}')).toBe(
    '{\n  "n": 9007199254740993,\n  "n": 1e400,\n  "z": -0,\n  "d": 1.2300\n}'
  );
});

test('retains strings including punctuation, escaped quotes, slashes and Unicode', () => {
  const raw = '{"a":"{,}: [ ]","b":"' + '\\u0061' + '","c":"猫🐈"}';
  const output = formatThemeJson(raw);
  expect(JSON.parse(output)).toEqual(JSON.parse(raw));
  expect(output).toContain('"b": "' + '\\u0061' + '"');
  for (const value of ['a"b', 'a\\b', 'a/b', '\n\t']) {
    const encoded = JSON.stringify(value);
    expect(formatThemeJson(` [ ${encoded} ] `)).toContain(encoded);
  }
  expect(formatThemeJson(output)).toBe(output);
});

test('accepts JSON scalar values without coercion', () => {
  for (const raw of ['null', 'true', 'false', '9007199254740993', '"猫"', '[]', '{}'])
    expect(formatThemeJson(`\n\t${raw}\r `)).toBe(raw);
});

test('rejects invalid drafts without a replacement value', () => {
  for (const raw of ['', '{', '{"x":}', '{"a":1,}', '[1,]', 'undefined', '01', '// comment\n{}']) {
    expect(() => formatThemeJson(raw)).toThrow('invalid-json');
  }
});

test('bounds UTF-8 input and amplified indentation output', () => {
  const limit = THEME_LIMITS.manifestBytes;
  expect(() => formatThemeJson(`"${'猫'.repeat(Math.floor(limit / 3))}"`)).toThrow('too-large');
  expect(() => formatThemeJson(' '.repeat(limit + 1))).toThrow('too-large');
  expect(() => formatThemeJson('['.repeat(600) + '0' + ']'.repeat(600))).toThrow('too-large');
  const boundary = `"${'a'.repeat(limit - 2)}"`;
  expect(formatThemeJson(boundary)).toBe(boundary);
});
