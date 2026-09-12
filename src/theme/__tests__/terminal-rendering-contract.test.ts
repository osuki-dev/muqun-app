import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// Guard layer wiring; actual compositing and readability still require native QA.
test('terminal opacity affects only the default fill, never the complete terminal view', () => {
  const renderer = readFileSync('src/components/skia-terminal.tsx', 'utf8');
  // The canvas keeps the opaque fast path whenever nothing patterned is behind
  // it, and the fill carries the blend in that case. Both halves are derived
  // together so they cannot disagree about which path is being taken; that they
  // are derived from these two inputs, and only these, is the contract.
  expect(renderer).toContain('const canvasIsOpaque = paneOpacity === 1 || !wallpaperBehind;');
  expect(renderer).toContain(
    'blendedTerminalFill(paneTheme.background, theme.colors.background, paneOpacity)'
  );
  expect(renderer).toContain(': terminalBackgroundFill(paneTheme);');
  expect(renderer).toContain('<Canvas opaque={canvasIsOpaque}');
  expect(renderer).toContain('<Fill color={canvasFill} />');
  expect(renderer).toContain(
    'paintsCellBackground(run.style, colors.background, terminalTheme.background)'
  );
  expect(renderer).toContain('if (run.style.hidden) return;');
  expect(renderer).not.toContain('backgroundColor: paneTheme.background');
  expect(renderer).not.toContain('opacity: paneTheme.backgroundOpacity');
  // Both terminal screens show the shell wallpaper; they get it from different
  // places, and which place matters. The gateway workspace is wrapped in
  // `AppDrawer`, which already draws it -- drawing a second copy there put a
  // full-screen image behind an opaque fill, where nothing could see it and
  // HWUI still decoded and drew it every frame. The SSH workspace is a root
  // stack screen with no drawer above it, so it draws its own.
  const drawer = readFileSync('src/components/app-drawer.tsx', 'utf8');
  expect(drawer).toContain('<ThemeArtwork slot="shell.background" />');

  const gateway = readFileSync('src/components/server-terminal-workspace.tsx', 'utf8');
  expect(gateway).toContain('<AppDrawer');
  expect(gateway).not.toContain('<ThemeArtwork slot="shell.background" />');

  const ssh = readFileSync('src/components/ssh-terminal-workspace.tsx', 'utf8');
  expect(ssh).toContain('<ThemeArtwork slot="shell.background" />');
});

test('controlled theme switches retain their native parent during disabled opacity updates', () => {
  const toggle = readFileSync('src/components/toggle.tsx', 'utf8');
  expect(toggle).toContain('<View collapsable={false}');
});
