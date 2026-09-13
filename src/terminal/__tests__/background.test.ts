import { expect, test } from 'bun:test';
import {
  paintsCellBackground,
  terminalBackgroundFill,
  terminalBackgroundOpacity,
} from '../background';
import { createTerminalTheme, terminalPaneTheme } from '../palette';
import { resolveThemePack } from '@/constants/theme-packs';
import type { TerminalStyle } from '../types';

const style: TerminalStyle = {
  foreground: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  hidden: false,
  link: null,
};

test('valid terminal alpha is preserved; missing or malformed alpha stays opaque', () => {
  for (const value of [0, 0.3, 1]) expect(terminalBackgroundOpacity(value)).toBe(value);
  for (const value of [undefined, NaN, Infinity, -1, 1.1])
    expect(terminalBackgroundOpacity(value)).toBe(1);
  expect(terminalBackgroundFill({ background: '#102030', backgroundOpacity: 0.25 })).toBe(
    'rgba(16, 32, 48, 0.25)'
  );
  expect(terminalBackgroundFill({ background: '#102030' })).toBe('rgba(16, 32, 48, 1)');
});

test('default null backgrounds stay transparent while explicit and inverse cells paint', () => {
  expect(paintsCellBackground(style, '#102030', '#102030')).toBe(false);
  expect(paintsCellBackground({ ...style, background: '#102030' }, '#102030', '#102030')).toBe(
    true
  );
  expect(paintsCellBackground({ ...style, inverse: true }, '#102030', '#102030')).toBe(true);
  expect(paintsCellBackground(style, '#abcdef', '#102030')).toBe(true);
});

test('null program surface preserves chosen opacity even when adopting dark defaults', () => {
  const pack = resolveThemePack('osuki');
  for (const mode of ['light', 'dark'] as const) {
    const app = { ...createTerminalTheme(pack, mode), backgroundOpacity: 0.35 };
    expect(terminalPaneTheme(pack, app, { background: null, verbatim: false }, true)).toBe(app);
    expect(
      terminalPaneTheme(pack, app, { background: null, verbatim: true }, true).backgroundOpacity
    ).toBe(0.35);
    expect(terminalPaneTheme(pack, app, { background: '#ffffff', verbatim: true }, false)).toBe(
      app
    );
  }
});

test('explicit program surfaces remain opaque including the exact app background color', () => {
  const pack = resolveThemePack('osuki');
  const app = { ...createTerminalTheme(pack, 'dark'), backgroundOpacity: 0 };
  for (const background of [app.background, '#FFFFFF', '#123456']) {
    const result = terminalPaneTheme(pack, app, { background, verbatim: true }, true);
    expect(result.background).toBe(background);
    expect(result.backgroundOpacity).toBe(1);
    expect(result).not.toBe(app);
  }
  expect(app.backgroundOpacity).toBe(0);
});
