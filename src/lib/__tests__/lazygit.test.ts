import { expect, test } from 'bun:test';

import { isFullScreenTuiPane, isLazygitPane } from '@/lib/terminal-keys';
test('the foreground Git TUI overrides a stale shell title and profile', () => {
  expect(isFullScreenTuiPane('shell', 'zsh', '/usr/bin/lazygit')).toBe(true);
  expect(isLazygitPane('lazygit', null, null)).toBe(true);
  expect(isLazygitPane(undefined, 'lazygit', null)).toBe(true);
  expect(isLazygitPane('shell', 'lazygit', 'zsh')).toBe(false);
  expect(isFullScreenTuiPane('shell', 'lazygit', 'zsh')).toBe(false);
  expect(isLazygitPane('editor', 'nvim', 'nvim')).toBe(false);
  expect(isLazygitPane(null, 'claude lazygit', null)).toBe(false);
});
