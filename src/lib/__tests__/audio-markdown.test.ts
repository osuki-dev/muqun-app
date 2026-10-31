import { expect, test } from 'bun:test';
import { splitAudioMarkdown } from '../audio-markdown';

const files = (text: string) =>
  splitAudioMarkdown(text).flatMap((part) =>
    part.kind === 'file' ? [part.uri] : part.kind === 'theme' ? [`fence:${part.source}`] : []
  );

test('every form an agent prints a theme path in becomes one tappable file', () => {
  const reply = [
    '/home/me/themes/dusk.muqun-theme.json',
    '- `~/themes/dusk.muqun-theme`',
    'Saved to `themes/dusk.muqun-theme.json`, and ./a.muqun-theme.',
    '[pack](~/c.muqun-theme) and again /home/me/themes/dusk.muqun-theme.json',
  ].join('\n');
  expect(files(reply)).toEqual([
    '/home/me/themes/dusk.muqun-theme.json',
    '~/themes/dusk.muqun-theme',
    'themes/dusk.muqun-theme.json',
    './a.muqun-theme',
    '~/c.muqun-theme',
  ]);
  // The sentence the path sat in is kept, not swallowed by the chip.
  expect(
    splitAudioMarkdown(reply).some((part) => part.kind === 'markdown' && /Saved to/.test(part.text))
  ).toBe(true);
});

test('web URLs, placeholders and code blocks are not theme files', () => {
  expect(
    files(
      [
        'https://example.com/a.muqun-theme and <slug>.muqun-theme.json',
        '```sh',
        'cat /tmp/b.muqun-theme.json',
        '```',
        '    /tmp/indented.muqun-theme',
      ].join('\n')
    )
  ).toEqual([]);
});

test('only a closed muqun-theme fence offers its body for preview', () => {
  expect(files('```muqun-theme\n{"id":"x"}\n```\nafter')).toEqual(['fence:{"id":"x"}\n']);
  expect(files('```json\n{"id":"x"}\n```')).toEqual([]);
  expect(files('```muqun-theme\n{"id":"x"')).toEqual([]);
});

test('a Codex file citation becomes the file it cites, not raw markup', () => {
  const reply =
    'Done.\n:codex-file-citation{path="/home/me/output/report.pdf" purpose="output"}\n' +
    'See :codex-file-citation{path="/home/me/clip.mp4"} too.';
  const parts = splitAudioMarkdown(reply);
  expect(parts.filter((part) => part.kind !== 'markdown')).toEqual([
    { kind: 'file', uri: '/home/me/output/report.pdf', name: 'report.pdf', start: 6 },
    { kind: 'video', uri: '/home/me/clip.mp4', name: 'clip.mp4', start: 83 },
  ]);
  expect(parts.some((part) => part.kind === 'markdown' && part.text.includes('codex-file'))).toBe(
    false
  );
  // A citation with no usable path is left as it was written.
  expect(files(':codex-file-citation{purpose="output"}')).toEqual([]);
});

test('legacy video links share container hints without interpreting code, playlists or web URLs as local players', () => {
  const text =
    '[WebM](/tmp/clip.webm) [MKV](./clip.mkv) :codex-file-citation{path="/tmp/clip.3gp"}';
  expect(
    splitAudioMarkdown(text)
      .filter((part) => part.kind === 'video')
      .map((part) => part.uri)
  ).toEqual(['/tmp/clip.webm', './clip.mkv', '/tmp/clip.3gp']);
  expect(
    splitAudioMarkdown(
      '[code](/tmp/main.ts) [playlist](/tmp/list.m3u8) [web](https://host/clip.webm) `[/tmp/clip.webm](/tmp/clip.webm)`'
    ).filter((part) => part.kind === 'video')
  ).toEqual([]);
});

test('explicit file links do not require a filename extension allowlist', () => {
  expect(
    files(
      '[CSR](/tmp/request.certSigningRequest) [binary](~/Downloads/archive.unknown) [readme](./README)'
    )
  ).toEqual(['/tmp/request.certSigningRequest', '~/Downloads/archive.unknown', './README']);
  expect(
    files(
      '[web](https://example.com/file) [anchor](#section) [network](//host/file) [script](javascript:alert)'
    )
  ).toEqual([]);
  expect(files('`[CSR](/tmp/request.certSigningRequest)`')).toEqual([]);
});

test('local source links resolve the file without treating line locations as a filename', () => {
  expect(
    files(
      [
        '[source](/project/src/main.rs:10)',
        '[column](/project/src/main.rs:10:4)',
        '[range](<./project with spaces/main.ts#L12-L18>)',
        '[fragment](file:///project/main.ts#L12C4)',
      ].join(' ')
    )
  ).toEqual([
    '/project/src/main.rs',
    '/project/src/main.rs',
    './project with spaces/main.ts',
    'file:///project/main.ts',
  ]);
  expect(files('[literal](file:///project/report%3A10) [other](/project/report:latest)')).toEqual([
    'file:///project/report%3A10',
    '/project/report:latest',
  ]);
  expect(files('[web](https://host/main.ts#L12) `[code](/project/main.rs:10)`')).toEqual([]);
});
