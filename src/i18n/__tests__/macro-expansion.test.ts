// Check committed compiled messages against extractable source, without locking copy.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { messages as enMessages } from '../locales/en/messages';
import { withoutClosingFullStop } from '../../../scripts/normalize-translation-punctuation';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PLAIN_T_LITERAL = /(?<![\w$.])t`([^`$\\]*)`/g;

const PLAIN_MSG_LITERAL = /(?<![\w$.])msg`([^`$\\]*)`/g;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const catalogStrings = new Set(
  Object.values(enMessages as Record<string, unknown>)
    .map((value) => {
      if (typeof value === 'string') return value;
      if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
        return value[0];
      }
      return null;
    })
    .filter((value): value is string => value !== null)
    .map(normalize)
);

function sourceFiles(directory = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'locales') continue;
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('compiled catalog coverage', () => {
  const sources = sourceFiles().map((path) => ({
    path,
    code: stripComments(readFileSync(path, 'utf8')),
  }));

  for (const [name, pattern] of [
    ['t', PLAIN_T_LITERAL],
    ['msg', PLAIN_MSG_LITERAL],
  ] as const) {
    test(`every plain ${name} literal reached the English catalog`, () => {
      const messages = sources.flatMap(({ path, code }) =>
        [...code.matchAll(pattern)].map((match) => ({ path, text: normalize(match[1]) }))
      );
      expect(messages.length).toBeGreaterThan(0);
      const missing = messages
        .filter(({ text }) => text && !catalogStrings.has(withoutClosingFullStop(text)))
        .map(({ path, text }) => `${path.slice(SRC.length + 1)}: ${text}`);
      expect(missing).toEqual([]);
    });
  }
});
