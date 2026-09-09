import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
import { themeFromDocument } from '@/theme/file-preview';

test('theme preview requires both the advertised extension and valid manifest', () => {
  const text = JSON.stringify(createThemeStarter());
  expect(themeFromDocument('bloom.muqun-theme.json', text)?.format).toBe('muqun-theme');
  expect(themeFromDocument('BLOOM.MUQUN-THEME.JSON', text)?.format).toBe('muqun-theme');
  for (const name of [
    'package.json',
    'theme.json',
    'bloom.muqun-theme',
    'bloom.muqun-theme.json.js',
  ])
    expect(themeFromDocument(name, text)).toBeNull();
  expect(themeFromDocument('bloom.muqun-theme.json', null)).toBeNull();
  expect(themeFromDocument('bloom.muqun-theme.json', '{}')).toBeNull();
  expect(themeFromDocument('bloom.muqun-theme.json', '{')).toBeNull();
});
