import { expect, test } from 'bun:test';

import { extractThemeFromOutput, themeNeedsImages } from '@/theme/agent-output';
import { createThemeStarter } from '@/theme/authoring';

const starter = createThemeStarter();
const fence = (manifest: unknown) => '```muqun-theme\n' + JSON.stringify(manifest) + '\n```';

test('a fenced manifest in agent output is read back', () => {
  const theme = extractThemeFromOutput(`Here you go.\n\n${fence(starter)}\n\nEnjoy.`);
  expect(theme?.id).toBe(starter.id);
});

test('the reply wins over the starter the prompt echoed above it', () => {
  // The authoring prompt embeds the starter in a fence of this very name, and
  // an agent pane commonly still shows the task. Scanning forwards would
  // return the starter every time.
  const reply = { ...starter, id: 'mario', name: 'Mario' };
  const pane = [
    '## Complete starter manifest',
    fence(starter),
    'Assistant: done, here is the theme you asked for.',
    fence(reply),
  ].join('\n\n');
  const theme = extractThemeFromOutput(pane);
  expect(theme?.id).toBe('mario');
  expect(theme?.name).toBe('Mario');
});

test('a half-printed final block falls back to the last complete one', () => {
  const good = { ...starter, id: 'complete' };
  const pane = `${fence(good)}\n\n\`\`\`muqun-theme\n{"format":"muqun-th`;
  expect(extractThemeFromOutput(pane)?.id).toBe('complete');
});

test('output with no fence is not an error', () => {
  expect(extractThemeFromOutput('I could not build a theme, sorry.')).toBeNull();
  expect(extractThemeFromOutput('')).toBeNull();
});

test('a fence holding something that is not a manifest is ignored', () => {
  expect(extractThemeFromOutput('```muqun-theme\n{"hello":"world"}\n```')).toBeNull();
  expect(extractThemeFromOutput('```muqun-theme\nnot json at all\n```')).toBeNull();
});

test('a fence larger than the manifest limit is never parsed', () => {
  const huge = '```muqun-theme\n' + 'x'.repeat(300 * 1024) + '\n```';
  expect(extractThemeFromOutput(huge)).toBeNull();
});

test('a different language tag is not treated as a theme', () => {
  expect(extractThemeFromOutput('```json\n' + JSON.stringify(starter) + '\n```')).toBeNull();
});

test('the starter itself declares no images, so it installs from text alone', () => {
  expect(themeNeedsImages(starter)).toBe(false);
});

test('a manifest naming images cannot install from text alone', () => {
  const withArt = {
    ...starter,
    assets: { scene: { path: 'assets/scene.png' } },
    decoration: { 'shell.background': { asset: 'scene' } },
  };
  const theme = extractThemeFromOutput(fence(withArt));
  expect(theme).not.toBeNull();
  expect(themeNeedsImages(theme!)).toBe(true);
});
