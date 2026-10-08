import { expect, test } from 'bun:test';
import { splitAudioMarkdown } from '../audio-markdown';

test('renders local download links in order without dropping surrounding prose', () => {
  const parts = splitAudioMarkdown(
    'Listen: [sample](./out/demo.wav)\n[voice](<file:///work/my voice.mp3>)'
  );
  expect(parts).toEqual([
    { kind: 'markdown', text: 'Listen: ', start: 0 },
    { kind: 'audio', uri: './out/demo.wav', name: 'sample', start: 8 },
    { kind: 'markdown', text: '\n', start: 32 },
    { kind: 'audio', uri: 'file:///work/my voice.mp3', name: 'voice', start: 33 },
  ]);
});

test('does not turn code examples, images, remote links or partial links into players', () => {
  for (const text of [
    '`[demo](./a.wav)`',
    '```md\n[demo](./a.wav)\n```',
    '~~~\n[demo](./a.wav)\n~~~',
    '```\n[demo](./a.wav)',
    '    [demo](./a.wav)',
    '![demo](./a.wav)',
    '\\[demo](./a.wav)',
    '[demo](https://example.com/a.wav)',
    '[demo](//example.com/a.wav)',
    '[demo](./a.wav',
  ])
    expect(splitAudioMarkdown(text)).toEqual([{ kind: 'markdown', text, start: 0 }]);
});

test('recognizes audio files linked by filename in an ordinary assistant reply', () => {
  const parts = splitAudioMarkdown(
    '试听 [MP3](test-audio.mp3) · [WAV](test-audio.wav) · [图](spectrum.png)'
  );
  expect(parts.flatMap((part) => (part.kind === 'audio' ? [part.uri] : []))).toEqual([
    'test-audio.mp3',
    'test-audio.wav',
  ]);
});

test('distinguishes a video preview from a downloadable document', () => {
  const parts = splitAudioMarkdown('[clip](out/clip.mp4) [report](out/report.pdf)');
  expect(parts.filter((part) => part.kind !== 'markdown')).toEqual([
    { kind: 'video', uri: 'out/clip.mp4', name: 'clip', start: 0 },
    { kind: 'file', uri: 'out/report.pdf', name: 'report', start: 21 },
  ]);
});
