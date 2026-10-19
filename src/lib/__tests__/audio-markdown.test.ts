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
