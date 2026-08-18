// What `terminalFrameLinks` turns into a tap target, and — just as important —
// what it leaves as plain text. A wrong file link opens the wrong artifact, so
// the negative cases below are the point of this file.
import { describe, expect, test } from 'bun:test';
import { parseTerminalSnapshot, terminalFrameLinks } from '@/terminal/terminal-core';
import type { TerminalLink } from '@/terminal/types';

function linksOf(text: string): TerminalLink[] {
  return terminalFrameLinks(parseTerminalSnapshot(text));
}

function urisOf(text: string, kind: TerminalLink['kind']): string[] {
  return linksOf(text)
    .filter((link) => link.kind === kind)
    .map((link) => link.uri);
}

describe('URL links', () => {
  test('a bare http(s) URL is detected and tagged as a url', () => {
    const links = linksOf('open https://example.com/docs now');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ uri: 'https://example.com/docs', kind: 'url', row: 0 });
  });

  test('trailing sentence punctuation is not part of the URL', () => {
    expect(urisOf('see https://example.com/a.', 'url')).toEqual(['https://example.com/a']);
    expect(urisOf('(https://example.com/a)', 'url')).toEqual(['https://example.com/a']);
  });

  test('columns cover exactly the URL text', () => {
    const [link] = linksOf('go https://example.com');
    expect(link).toMatchObject({ startColumn: 3, endColumn: 3 + 'https://example.com'.length });
  });

  test('a document path inside a URL stays one url link, not a file link', () => {
    const links = linksOf('fetched https://example.com/reports/report.md');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      uri: 'https://example.com/reports/report.md',
      kind: 'url',
    });
  });
});

describe('file path links', () => {
  test('an absolute path with a previewable extension is a file link', () => {
    const links = linksOf('Wrote /Users/me/out/report.md');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      uri: '/Users/me/out/report.md',
      kind: 'file',
      row: 0,
      startColumn: 6,
      endColumn: 6 + '/Users/me/out/report.md'.length,
    });
  });

  test('a home-rooted path is a file link', () => {
    expect(urisOf('saved ~/screenshots/shot-01.png', 'file')).toEqual([
      '~/screenshots/shot-01.png',
    ]);
  });

  test('extensions are matched case-insensitively', () => {
    expect(urisOf('open /tmp/Chart.PNG', 'file')).toEqual(['/tmp/Chart.PNG']);
  });

  test('a path at the start of a row needs no leading whitespace', () => {
    expect(urisOf('/var/log/build.log failed', 'file')).toEqual(['/var/log/build.log']);
  });

  test('surrounding punctuation is trimmed off both ends', () => {
    expect(urisOf('Read(/Users/me/src/theme.ts)', 'file')).toEqual(['/Users/me/src/theme.ts']);
    expect(urisOf('updated /Users/me/app.json.', 'file')).toEqual(['/Users/me/app.json']);
    expect(urisOf('"/Users/me/a.txt"', 'file')).toEqual(['/Users/me/a.txt']);
    expect(urisOf('--out=/tmp/out.json', 'file')).toEqual(['/tmp/out.json']);
  });

  test('a shell prompt puts the path straight after a colon', () => {
    expect(urisOf('you@mac:~/code/muqun/src/theme.ts $ ', 'file')).toEqual([
      '~/code/muqun/src/theme.ts',
    ]);
  });

  test('several paths on one row each become their own link', () => {
    expect(urisOf('cp /tmp/a.png /tmp/b.png', 'file')).toEqual(['/tmp/a.png', '/tmp/b.png']);
  });

  test('paths on later rows carry their own row index', () => {
    const links = linksOf('first\nWrote /tmp/second.md');
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ uri: '/tmp/second.md', kind: 'file', row: 1 });
  });

  test('a file link survives colour styling around it', () => {
    expect(urisOf('[32m✓[0m built /tmp/bundle.js', 'file')).toEqual([
      '/tmp/bundle.js',
    ]);
  });
});

describe('file path links — what must NOT match', () => {
  test('an extensionless path is not a link', () => {
    expect(linksOf('check /etc/hosts and /usr/local/bin')).toEqual([]);
  });

  test('a relative path is not a link', () => {
    expect(linksOf('edit src/theme.ts')).toEqual([]);
    expect(linksOf('edit ./src/theme.ts')).toEqual([]);
  });

  test('a dotfile has no extension and is not a link', () => {
    expect(linksOf('wrote /Users/me/.env')).toEqual([]);
  });

  test('a domain-looking token is not a file link', () => {
    expect(linksOf('published example.com/index.html')).toEqual([]);
  });

  test('a date or fraction is not a file link', () => {
    expect(linksOf('12/25/2026 at 3/4 speed')).toEqual([]);
  });

  test('an unknown extension is left as plain text', () => {
    expect(linksOf('produced /tmp/archive.tar.gz')).toEqual([]);
    expect(linksOf('linked /usr/lib/libfoo.dylib')).toEqual([]);
  });

  test('a path glued to the preceding word is not a link', () => {
    expect(linksOf('Wrote/tmp/report.md')).toEqual([]);
  });

  test('a bare file name with no directory is not a link', () => {
    expect(linksOf('see report.md for details')).toEqual([]);
  });
});
