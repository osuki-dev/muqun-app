import { describe, expect, it } from 'bun:test';

import {
  HIGHLIGHT_MAX_BYTES,
  HIGHLIGHT_MAX_LINES,
  highlightDiff,
  highlightFile,
  isDiffFile,
  languageForFile,
  plainFile,
  spansFromHighlightHtml,
  type CodeLine,
} from '@/lib/code-highlight';

/** The text of a line, ignoring how it was split into roles. */
function textOf(line: CodeLine): string {
  return line.spans.map((span) => span.text).join('');
}

function roleOf(line: CodeLine, needle: string): string | undefined {
  return line.spans.find((span) => span.text.includes(needle))?.role;
}

describe('languageForFile', () => {
  it('maps the extensions an agent actually writes', () => {
    expect(languageForFile('server.ts')).toBe('typescript');
    expect(languageForFile('App.tsx')).toBe('typescript');
    expect(languageForFile('main.rs')).toBe('rust');
    expect(languageForFile('run.sh')).toBe('bash');
    expect(languageForFile('coverage.json')).toBe('json');
    expect(languageForFile('compose.yml')).toBe('yaml');
    expect(languageForFile('pyproject.toml')).toBe('ini');
  });

  it('reads names that carry no extension', () => {
    expect(languageForFile('Dockerfile')).toBe('bash');
    expect(languageForFile('.zshrc')).toBe('bash');
  });

  it('is case-insensitive, because the gateway reports the name from disk', () => {
    expect(languageForFile('README.MD')).toBe('markdown');
    expect(languageForFile('Main.PY')).toBe('python');
  });

  it('returns null for anything it does not know, so the viewer stays plain', () => {
    expect(languageForFile('run.log')).toBeNull();
    expect(languageForFile('notes')).toBeNull();
    expect(languageForFile('archive.tar.gz')).toBeNull();
  });
});

describe('isDiffFile', () => {
  it('recognises the diff extensions and nothing else', () => {
    expect(isDiffFile('theme.diff')).toBe(true);
    expect(isDiffFile('0001-fix.patch')).toBe(true);
    expect(isDiffFile('merge.rej')).toBe(true);
    expect(isDiffFile('theme.ts')).toBe(false);
    // A name that merely contains "diff" is not a diff.
    expect(isDiffFile('difference.md')).toBe(false);
  });
});

describe('spansFromHighlightHtml', () => {
  it('reads a flat span tree back into roled text', () => {
    const spans = spansFromHighlightHtml(
      '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>'
    );
    expect(spans).toEqual([
      { text: 'const', role: 'keyword' },
      { text: ' x = ', role: 'plain' },
      { text: '1', role: 'number' },
    ]);
  });

  it('lets the innermost scope win, which is how JSON literals arrive', () => {
    // hljs emits `hljs-literal > hljs-keyword` for `true`; two roles must not
    // fight over the same characters.
    const spans = spansFromHighlightHtml(
      '<span class="hljs-literal"><span class="hljs-keyword">true</span></span>'
    );
    expect(spans).toEqual([{ text: 'true', role: 'keyword' }]);
  });

  it('resolves a multi-class scope from its first class', () => {
    const spans = spansFromHighlightHtml('<span class="hljs-title function_">render</span>');
    expect(spans).toEqual([{ text: 'render', role: 'name' }]);
  });

  it('resolves a dotted scope through its leading segment', () => {
    const spans = spansFromHighlightHtml('<span class="hljs-title.class">Widget</span>');
    expect(spans).toEqual([{ text: 'Widget', role: 'name' }]);
  });

  it('degrades an unknown scope to plain rather than throwing', () => {
    const spans = spansFromHighlightHtml('<span class="hljs-something-new">x</span>');
    expect(spans).toEqual([{ text: 'x', role: 'plain' }]);
  });

  it('unescapes the entities hljs emits', () => {
    const spans = spansFromHighlightHtml(
      '<span class="hljs-string">&quot;a &amp; b&quot;</span> &lt;tag&gt; &#x27;q&#x27;'
    );
    expect(spans.map((span) => span.text).join('')).toBe('"a & b" <tag> \'q\'');
  });

  it('leaves a numeric entity past the last code point as text', () => {
    // `String.fromCodePoint` throws a RangeError above 0x10FFFF, and `isFinite`
    // does not catch that: 1114112 is a perfectly finite invalid character. The
    // entity comes out of whatever file was opened, so one bad character must
    // not be able to take the preview down.
    const spans = spansFromHighlightHtml('a &#1114112; &#x110000; b');
    expect(spans.map((span) => span.text).join('')).toBe('a &#1114112; &#x110000; b');
  });

  it('still unescapes the last code point that is one', () => {
    const spans = spansFromHighlightHtml('&#x10FFFF;');
    expect(spans.map((span) => span.text).join('')).toBe(String.fromCodePoint(0x10ffff));
  });

  it('merges touching runs of the same role, which is what bounds the span count', () => {
    const spans = spansFromHighlightHtml(
      'a<span class="hljs-comment">b</span><span class="hljs-comment">c</span>d'
    );
    expect(spans).toEqual([
      { text: 'a', role: 'plain' },
      { text: 'bc', role: 'comment' },
      { text: 'd', role: 'plain' },
    ]);
  });

  it('keeps truncated markup as text instead of dropping the tail', () => {
    const spans = spansFromHighlightHtml('ok <span class="hljs-keyw');
    expect(spans.map((span) => span.text).join('')).toBe('ok <span class="hljs-keyw');
  });

  it('returns nothing for empty input', () => {
    expect(spansFromHighlightHtml('')).toEqual([]);
  });
});

describe('highlightFile', () => {
  it('colors TypeScript keywords, strings, numbers and comments', () => {
    const { lines, language } = highlightFile('a.ts', 'const x = 1; // note\nlet s = "hi";');
    expect(language).toBe('typescript');
    expect(roleOf(lines[0], 'const')).toBe('keyword');
    expect(roleOf(lines[0], '1')).toBe('number');
    expect(roleOf(lines[0], '// note')).toBe('comment');
    expect(roleOf(lines[1], '"hi"')).toBe('string');
  });

  it('splits on newlines so every line can be laid out on its own', () => {
    const { lines } = highlightFile('a.ts', 'const a = 1;\nconst b = 2;\nconst c = 3;');
    expect(lines).toHaveLength(3);
    expect(textOf(lines[0])).toBe('const a = 1;');
    expect(textOf(lines[2])).toBe('const c = 3;');
  });

  it('keeps a multi-line comment coloured past its first line', () => {
    // The reason the whole file is tokenized before it is split: a per-line
    // tokenizer loses the state and gets everything after line one wrong.
    const { lines } = highlightFile('a.ts', 'const a = 1;\n/* still\n a comment */\nconst b = 2;');
    expect(roleOf(lines[1], 'still')).toBe('comment');
    expect(roleOf(lines[2], 'a comment')).toBe('comment');
  });

  it('keeps a multi-line Python string coloured past its first line', () => {
    const { lines } = highlightFile('a.py', 'x = """one\ntwo"""\ny = 1');
    expect(roleOf(lines[1], 'two')).toBe('string');
    expect(roleOf(lines[2], '1')).toBe('number');
  });

  it('preserves the text exactly, so nothing is lost to the round trip', () => {
    const source = 'const s = "a & b <c>";\n// tail\n';
    const { lines } = highlightFile('a.ts', source);
    expect(lines.map(textOf).join('\n')).toBe(source);
  });

  it('leaves an unmapped extension plain rather than guessing', () => {
    const { lines, language, skipped } = highlightFile('run.log', 'ERROR something failed');
    expect(language).toBeNull();
    expect(skipped).toBeNull();
    expect(lines[0].spans).toEqual([{ text: 'ERROR something failed', role: 'plain' }]);
  });

  it('falls back to plain above the byte gate, and says why', () => {
    const big = `const x = ${'1 + '.repeat(HIGHLIGHT_MAX_BYTES / 4)}0;`;
    const { language, skipped, lines } = highlightFile('big.ts', big);
    expect(skipped).toBe('size');
    expect(language).toBeNull();
    // Still readable, just not coloured.
    expect(lines.map(textOf).join('\n')).toBe(big);
  });

  it('falls back to plain above the line gate', () => {
    const many = Array.from({ length: HIGHLIGHT_MAX_LINES + 1 }, () => '-x').join('\n');
    const { skipped, lines } = highlightFile('big.diff', many);
    expect(skipped).toBe('lines');
    expect(lines.every((line) => line.diff === undefined)).toBe(true);
  });

  it('handles an empty file without inventing a line', () => {
    const { lines } = highlightFile('a.ts', '');
    expect(lines).toHaveLength(1);
    expect(lines[0].spans).toEqual([]);
  });
});

describe('highlightDiff', () => {
  const sample = [
    'diff --git a/a.ts b/a.ts',
    'index 111..222 100644',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,3 +1,3 @@',
    ' unchanged',
    '-const old = 1;',
    '+const next = 2;',
  ].join('\n');

  it('gives every line its verdict', () => {
    const lines = highlightDiff(sample);
    expect(lines.map((line) => line.diff)).toEqual([
      'meta',
      'meta',
      'meta',
      'meta',
      'hunk',
      undefined,
      'removed',
      'added',
    ]);
  });

  it('reads the file headers as headers, not as additions and removals', () => {
    // `---` and `+++` also start with `-` and `+`; getting this wrong tints the
    // header rows red and green, which is the most obvious way a diff view can
    // look broken.
    const lines = highlightDiff('--- a/a.ts\n+++ b/a.ts');
    expect(lines[0].diff).toBe('meta');
    expect(lines[1].diff).toBe('meta');
  });

  it('reaches the diff path through the file name', () => {
    const { language, lines } = highlightFile('theme.diff', '+added\n-removed');
    expect(language).toBe('diff');
    expect(lines[0].diff).toBe('added');
    expect(lines[1].diff).toBe('removed');
  });

  it('does not charge a diff the byte gate, since it never runs a grammar', () => {
    const big = Array.from({ length: 500 }, () => `+${'x'.repeat(300)}`).join('\n');
    expect(big.length).toBeGreaterThan(HIGHLIGHT_MAX_BYTES);
    const { language, skipped } = highlightFile('big.diff', big);
    expect(skipped).toBeNull();
    expect(language).toBe('diff');
  });
});

describe('plainFile', () => {
  // What the viewer paints on the frame the sheet opens, before the tokenizer
  // has run. It has to agree with the fallback `highlightFile` produces, or the
  // swap to colour would move every line.
  it('is line for line what the size fallback produces', () => {
    const big = `const x = ${'1 + '.repeat(HIGHLIGHT_MAX_BYTES / 4)}0;`;
    expect(plainFile(big).lines.map(textOf)).toEqual(
      highlightFile('big.ts', big).lines.map(textOf)
    );
  });

  it('claims no language and reports no fallback of its own', () => {
    const { language, skipped } = plainFile('a\nb');
    expect(language).toBeNull();
    expect(skipped).toBeNull();
  });

  it('gives an empty file one empty line, the way every other path does', () => {
    expect(plainFile('').lines).toEqual([{ spans: [] }]);
  });

  it('costs one split, whatever the file is', () => {
    // The whole reason this exists: it runs on the frame the sheet opens, at
    // sizes where `highlightFile` is tens of milliseconds. 200 KB is the size
    // from the report in card #661.
    const text = Array.from(
      { length: 8_000 },
      (_, index) => `line ${index} of a file the size of the one in the report`
    ).join('\n');
    expect(text.length).toBeGreaterThan(200 * 1024);
    const started = performance.now();
    const { lines } = plainFile(text);
    expect(performance.now() - started).toBeLessThan(50);
    expect(lines).toHaveLength(8_000);
  });
});
