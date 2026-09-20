import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

import { DEMO_REFUSED_LOG_BYTES, demoBundleText, demoChangelogText } from '@/lib/demo-large-files';
import { splitMarkdownBlocks } from '@/lib/markdown-blocks';
import {
  HIGHLIGHT_MAX_CHARS,
  MAX_ASSET_TEXT_BYTES,
  MAX_LINE_COLUMNS,
  indexTextLines,
} from '@/lib/text-preview';

/**
 * The sizes the asset viewer routes on, and the demo files on each side of
 * them.
 *
 * Nothing pinned the old `RENDER_MAX_BYTES`: the number that decided whether a
 * file was drawn or refused had no test at all, so the regression that would
 * have mattered most was the one that could happen quietly. These are the
 * assertions that would have caught it -- each ceiling has a fixture on both
 * sides of it, and the `large-file-preview` flow drives exactly those fixtures
 * on a device.
 */
const DEMO_SOURCE = readFileSync(new URL('../demo-gateway.ts', import.meta.url), 'utf8');

describe('the sizes the asset viewer routes on', () => {
  test('the ceilings are ordered: a line is inside a highlight is inside a read', () => {
    expect(MAX_LINE_COLUMNS).toBeLessThan(HIGHLIGHT_MAX_CHARS);
    expect(HIGHLIGHT_MAX_CHARS).toBeLessThan(MAX_ASSET_TEXT_BYTES);
  });

  test('the read ceiling is well past the size a file used to be refused at', () => {
    // The gate this replaced stood at 64 KiB and the read at 512 KiB. Both are
    // now a long way below what the viewer will open.
    expect(MAX_ASSET_TEXT_BYTES).toBe(5 * 1024 * 1024);
    expect(HIGHLIGHT_MAX_CHARS).toBe(64 * 1024);
  });
});

describe('the demo bundle, which the line viewer draws', () => {
  const bundle = demoBundleText();

  test('it is past the highlight ceiling and inside the read ceiling', () => {
    expect(bundle.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS);
    expect(bundle.length).toBeLessThan(MAX_ASSET_TEXT_BYTES);
  });

  test('it indexes into thousands of rows with a line past the row clamp', () => {
    const index = indexTextLines(bundle);
    expect(index.lines.length).toBeGreaterThan(3_000);
    expect(index.longest).toBeGreaterThan(MAX_LINE_COLUMNS);
  });

  test('building it twice is building it once', () => {
    expect(demoBundleText()).toBe(bundle);
  });
});

describe('the demo changelog, which the document viewer draws', () => {
  const changelog = demoChangelogText();

  test('it is a document no single native view was ever handed', () => {
    expect(changelog.length).toBeGreaterThan(HIGHLIGHT_MAX_CHARS);
    expect(changelog.length).toBeLessThan(MAX_ASSET_TEXT_BYTES);
  });

  test('it becomes many cells, and the cells are the document again', () => {
    const chunks = splitMarkdownBlocks(changelog);
    expect(chunks.length).toBeGreaterThan(20);
    expect(chunks.join('\n')).toBe(changelog);
  });

  test('no cell carries half a fence, or a table without its header', () => {
    for (const chunk of splitMarkdownBlocks(changelog)) {
      expect((chunk.match(/^ {0,3}```/gm) ?? []).length % 2).toBe(0);
      const lines = chunk.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        if (/^\| -+ \| -+ \|$/.test(lines[index])) expect(index).toBeGreaterThan(0);
      }
    }
  });
});

describe('the one file that is still refused', () => {
  test('the demo carries one, and it is past the read ceiling', () => {
    expect(DEMO_REFUSED_LOG_BYTES).toBeGreaterThan(MAX_ASSET_TEXT_BYTES);
  });
});

describe('the Files listing wires all three in', () => {
  // `demo-gateway` reaches the Lingui macro, which a test process cannot load,
  // so the wiring is read rather than imported -- the same bargain
  // `agent-collaboration.test.ts` makes with the same file.
  test('each file is listed as previewable text or markdown', () => {
    for (const name of ['CHANGELOG.md', 'app.bundle.js', 'session.log']) {
      expect(DEMO_SOURCE).toContain(`name: '${name}'`);
    }
    expect(DEMO_SOURCE).toContain("if (assetId === 'as-demo-bundle') return demoBundleText();");
    expect(DEMO_SOURCE).toContain(
      "if (assetId === 'as-demo-changelog') return demoChangelogText();"
    );
    expect(DEMO_SOURCE).toContain('size: DEMO_REFUSED_LOG_BYTES');
  });
});
