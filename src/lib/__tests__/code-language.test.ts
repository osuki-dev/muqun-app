import { describe, expect, test } from 'bun:test';

import { fenceLanguageForFile, fencedFile } from '@/lib/code-language';

describe('fenceLanguageForFile', () => {
  test('maps an extension to the word the package spells it with', () => {
    expect(fenceLanguageForFile('server.ts')).toBe('typescript');
    expect(fenceLanguageForFile('App.tsx')).toBe('tsx');
    expect(fenceLanguageForFile('main.rs')).toBe('rust');
    expect(fenceLanguageForFile('run.sh')).toBe('bash');
    expect(fenceLanguageForFile('main.go')).toBe('go');
    expect(fenceLanguageForFile('train.py')).toBe('python');
    expect(fenceLanguageForFile('Main.java')).toBe('java');
    expect(fenceLanguageForFile('ring.c')).toBe('c');
    expect(fenceLanguageForFile('coverage.json')).toBe('json');
    expect(fenceLanguageForFile('compose.yml')).toBe('yaml');
    expect(fenceLanguageForFile('README.md')).toBe('markdown');
    expect(fenceLanguageForFile('index.html')).toBe('html');
    expect(fenceLanguageForFile('theme.css')).toBe('css');
  });

  test('a diff is a diff, whatever the tool called the file', () => {
    // No grammar covers it, so this is a header and plain code -- but a header
    // that says "Diff" beats a bare fence that says nothing.
    expect(fenceLanguageForFile('theme.diff')).toBe('diff');
    expect(fenceLanguageForFile('0001-fix.patch')).toBe('diff');
    expect(fenceLanguageForFile('merge.rej')).toBe('diff');
  });

  test('reads a name with no extension', () => {
    expect(fenceLanguageForFile('Dockerfile')).toBe('dockerfile');
    expect(fenceLanguageForFile('.zshrc')).toBe('bash');
  });

  test('is case insensitive', () => {
    expect(fenceLanguageForFile('README.MD')).toBe('markdown');
    expect(fenceLanguageForFile('Main.PY')).toBe('python');
  });

  test('says nothing about a file it does not know', () => {
    // Null is the plain fence, which is the right answer for a log.
    expect(fenceLanguageForFile('run.log')).toBeNull();
    expect(fenceLanguageForFile('notes.txt')).toBeNull();
    expect(fenceLanguageForFile('notes')).toBeNull();
    expect(fenceLanguageForFile('archive.tar.gz')).toBeNull();
  });
});

describe('fencedFile', () => {
  test('names the language on the opening fence', () => {
    expect(fencedFile('const x = 1\n', 'typescript')).toBe('```typescript\nconst x = 1\n```');
  });

  test('an unnamed language leaves the info string empty', () => {
    expect(fencedFile('hello\n', null)).toBe('```\nhello\n```');
  });

  test('closes the fence on its own line even without a trailing newline', () => {
    expect(fencedFile('const x = 1', 'typescript')).toBe('```typescript\nconst x = 1\n```');
  });

  test('a file containing a fence cannot break out of one', () => {
    // The whole reason this function exists. Three backticks in the file and a
    // three-backtick fence around it means the second half of a README renders
    // as markdown inside a code viewer.
    const readme = 'text\n```\ncode\n```\nmore\n';
    const wrapped = fencedFile(readme, 'markdown');
    expect(wrapped).toBe('````markdown\ntext\n```\ncode\n```\nmore\n````');
  });

  test('the fence is always longer than the longest run in the file', () => {
    const nasty = 'a\n``````\nb\n';
    const wrapped = fencedFile(nasty, null);
    expect(wrapped.startsWith('```````\n')).toBe(true);
    expect(wrapped.endsWith('\n```````')).toBe(true);
  });

  test('an inline run counts too, not just one at the start of a line', () => {
    expect(fencedFile('x = "````" + y\n', 'python')).toBe('`````python\nx = "````" + y\n`````');
  });

  test('an empty file still produces a well formed block', () => {
    expect(fencedFile('', null)).toBe('```\n\n```');
  });
});
