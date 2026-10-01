// The guide an agent that needs setup is shown is its kind's `start` sentence
// (see `agentGuideBlurb`). `labels.ts` is macro source bun cannot import, so
// the sentence is read from the source and held to the catalog that ships,
// the way `macro-expansion.test.ts` does.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { messages as enMessages } from '../locales/en/messages';
import { withoutClosingFullStop } from '../../../scripts/normalize-translation-punctuation';

const LABELS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'labels.ts'),
  'utf8'
);

function startSentence(kind: string): string | undefined {
  return LABELS.match(
    new RegExp(`\\n  ${kind}: \\{\\n(?:\\s*//.*\\n)*\\s*start: msg\`([^\`]*)\``)
  )?.[1];
}

describe('the T3 setup guide', () => {
  test('tells the reader to pair the gateway', () => {
    const start = startSentence('t3');
    expect(start).toBeDefined();
    expect(start).toContain('t3 pair');
    expect(start).toContain('t3.pairing_token');
  });

  test('is the sentence the English catalog ships', () => {
    const start = withoutClosingFullStop(startSentence('t3') ?? '');
    const shipped = Object.values(enMessages).flat();
    expect(shipped.some((part) => typeof part === 'string' && part.includes(start))).toBe(true);
  });
});
