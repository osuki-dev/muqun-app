// The commands an agent that needs setup is shown are the ones that host has
// to run. `labels.ts` is macro source bun cannot import, so they are read from
// the source.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABELS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'labels.ts'),
  'utf8'
);

function field(kind: string, name: 'command' | 'setupCommand'): string | undefined {
  const block = LABELS.match(new RegExp(`\\n  ${kind}: \\{\\n([\\s\\S]*?)\\n  \\},`))?.[1] ?? '';
  return block.match(new RegExp(`\\n    ${name}: '([^']*)'`))?.[1];
}

describe('the setup commands', () => {
  test('each agent starts the way its host expects', () => {
    // T3 runs as a service so it does not collide with the desktop app, and
    // pairs the gateway with its own command; OpenCode is started by its
    // service, not by `serve`; DeepSeek Harness must not open a browser on the
    // host.
    expect({
      t3: field('t3', 'command'),
      t3Setup: field('t3', 'setupCommand'),
      opencode: field('opencode', 'command'),
      deepseek: field('deepseek', 'command'),
    }).toEqual({
      t3: 't3 service install',
      t3Setup: 't3 pair',
      opencode: 'opencode service start',
      deepseek: 'bunx @deepseek-ai/dsh web --no-open',
    });
  });
});
