import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Guard layer wiring; actual compositing and readability still require native QA.
test('terminal opacity affects only the default fill, never the complete terminal view', () => {
  const renderer = readFileSync('src/components/skia-terminal.tsx', 'utf8');
  expect(renderer).toContain(
    'opaque={terminalBackgroundOpacity(paneTheme.backgroundOpacity) === 1}'
  );
  expect(renderer).toContain('<Fill color={terminalBackgroundFill(paneTheme)} />');
  expect(renderer).toContain(
    'paintsCellBackground(run.style, colors.background, terminalTheme.background)'
  );
  expect(renderer).toContain('if (run.style.hidden) return;');
  expect(renderer).not.toContain('backgroundColor: paneTheme.background');
  expect(renderer).not.toContain('opacity: paneTheme.backgroundOpacity');
  for (const file of ['server-terminal-workspace', 'ssh-terminal-workspace']) {
    const workspace = readFileSync(`src/components/${file}.tsx`, 'utf8');
    expect(workspace).toContain('<ThemeArtwork slot="shell.background" />');
  }
});

test('controlled theme switches retain their native parent during disabled opacity updates', () => {
  const toggle = readFileSync('src/components/toggle.tsx', 'utf8');
  expect(toggle).toContain('<View collapsable={false}');
});
