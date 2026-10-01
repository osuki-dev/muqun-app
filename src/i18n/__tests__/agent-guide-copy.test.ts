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

function sentence(kind: string, field: 'start' | 'setupStart'): string | undefined {
  const block = LABELS.match(new RegExp(`\\n  ${kind}: \\{\\n([\\s\\S]*?)\\n  \\},`))?.[1] ?? '';
  return block.match(new RegExp(`\\b${field}: msg\`([^\`]*)\``))?.[1];
}

function commandOf(kind: string): string | undefined {
  return LABELS.match(new RegExp(`\\n  ${kind}: \\{\\n[\\s\\S]*?\\n    command: '([^']*)'`))?.[1];
}

describe('the T3 setup guide', () => {
  test('tells the reader to pair the gateway within the token window', () => {
    const setup = sentence('t3', 'setupStart');
    expect(setup).toBeDefined();
    expect(setup).toContain('t3 pair');
    expect(setup).toContain('t3.pairing_token');
    expect(setup).toContain('5 minutes');
  });

  test('starts T3 without colliding with the desktop app', () => {
    expect(sentence('t3', 'start')).toContain('t3 service install');
  });

  test.each(['start', 'setupStart'] as const)(
    'ships the %s sentence in the English catalog',
    (field) => {
      const text = withoutClosingFullStop(sentence('t3', field) ?? '');
      const shipped = Object.values(enMessages).flat();
      expect(shipped.some((part) => typeof part === 'string' && part.includes(text))).toBe(true);
    }
  );
});

describe('the setup commands', () => {
  test('T3 starts with t3 service install and pairs with t3 pair', () => {
    const block = LABELS.match(/\n  t3: \{\n([\s\S]*?)\n  \},/)?.[1] ?? '';
    expect(block).toContain("command: 't3 service install'");
    expect(block).toContain("setupCommand: 't3 pair'");
  });

  test('OpenCode is started by its service, not by serve', () => {
    expect(commandOf('opencode')).toBe('opencode service start');
    expect(sentence('opencode', 'start')).toContain('Start the OpenCode service');
  });

  test('DeepSeek Harness does not open a browser on the host', () => {
    expect(commandOf('deepseek')).toBe('bunx @deepseek-ai/dsh web --no-open');
    expect(sentence('deepseek', 'start')).toContain('Enable deepseek in the gateway config');
  });
});
