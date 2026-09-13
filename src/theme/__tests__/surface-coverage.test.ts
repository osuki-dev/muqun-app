import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { THEME_SLOTS } from '../schema';

// Contract guard, not a replacement for native screenshots or interaction QA.
// Every advertised slot must retain a real consumer rather than a schema-only promise.
//
// A list rather than a single file wherever a slot is drawn in more than one
// place. `emptyState.illustration` is the slot that made that necessary: it is
// the pack's one square, self-contained picture, so besides the "Pair your
// first server" card it is now also what the launch overlay and the lock
// screen show in place of the app's mark. Naming only the card would let the
// other two be deleted without this guard noticing, which is the whole job.
const consumers = {
  'shell.background': 'src/app/settings.tsx',
  'home.background': 'src/app/(drawer)/index.tsx',
  'home.decoration': 'src/app/(drawer)/index.tsx',
  'navigation.background': 'src/components/glass-chrome.tsx',
  'composer.background': 'src/components/glass-chrome.tsx',
  'actions.background': 'src/components/glass-chrome.tsx',
  'cards.decoration': 'src/components/settings-chrome.tsx',
  'buttons.primary.background': 'src/components/themed-button.tsx',
  'tabs.background': 'src/app/commands.tsx',
  'emptyState.illustration': ['src/app/(drawer)/index.tsx', 'src/theme/launch-artwork.ts'],
} as const;

test('every supported artwork slot has a named runtime consumer', () => {
  // `THEME_SLOTS` rather than the schema's keys: the schema accepts any slot
  // name now, so the closed list is the only place "what this build draws" is
  // written down, and it is what this test exists to hold to account.
  const slots: string[] = [...THEME_SLOTS];
  expect(slots.sort()).toEqual(Object.keys(consumers).sort());
  for (const [slot, named] of Object.entries(consumers)) {
    for (const file of typeof named === 'string' ? [named] : named) {
      const source = readFileSync(file, 'utf8');
      if (file.endsWith('glass-chrome.tsx')) {
        expect(source).toContain('`${surface}.background`');
      } else {
        expect(source).toContain(slot);
      }
    }
  }
});

test('both launch surfaces take their mark from the shared fallback chain', () => {
  // The slot name lives in `launch-artwork.ts` and the order it implies --
  // illustration, then Home logo, then the bundled mark -- is tested there.
  // What this holds is that neither screen grows a second opinion: a lock
  // screen that resolved the slot itself could drift from the overlay, and
  // the two are the first and last thing a reader sees in a session.
  for (const file of ['src/components/animated-icon.tsx', 'src/components/app-lock-gate.tsx']) {
    const source = readFileSync(file, 'utf8');
    expect(source).toContain("from '@/hooks/use-launch-artwork'");
    expect(source).toContain('useLaunchArtwork()');
    // Still the bundled mark when a pack offers neither picture nor logo.
    expect(source).toContain('loading-mark.png');
    expect(source).toContain("kind === 'default'");
  }
});

test('the SSH status line keeps a readable plate wherever the shell wallpaper is bare', () => {
  // This line is the only text on that screen drawn straight onto
  // `shell.background`: the header pills carry their own chrome and the
  // terminal paints over everything below it. `textMuted` is proven against
  // the theme's surfaces, never against an author's photograph.
  const source = readFileSync('src/components/ssh-terminal-workspace.tsx', 'utf8');
  const line = source.match(/styles\.statusIdentity,[\s\S]*?\]}>/)?.[0];
  expect(line).toBeDefined();
  expect(line).toContain('hasShell');
  expect(line).toContain('backgroundColor: surfaceBackground(theme.colors.background)');
  expect(source).toContain("useHasThemeArtwork('shell.background')");
  // There must be no strip of bare wallpaper between the header and the
  // terminal at all. This used to be guarded by requiring a fade at the
  // terminal's top edge, which softened the straight line the strip ended in
  // rather than removing it -- the picture still ran vivid above and washed
  // out below. The chrome now floats over a terminal that fills the page, the
  // arrangement the gateway screen always had, so the guard is that the header
  // is an overlay and the canvas is told what it covers.
  expect(source).toContain('styles.headerOverlay');
  expect(source).toContain('topInset={insets.top + NAV_HEADER_TOP_GAP + 54}');
  expect(source).not.toContain('terminalTopFade');
});

test('the send button carries the primary-button artwork, not just the plain buttons', () => {
  // It is the one primary action that is not a `<Button>`, so the slot has to be
  // wired here separately or a pack that themes its buttons misses the control
  // the reader presses most.
  const composer = readFileSync('src/components/terminal-composer.tsx', 'utf8');
  expect(composer).toContain(
    '<ThemedSurfaceArtwork slot="buttons.primary.background" baseColor={armedFill} />'
  );
});

test('theme operation messages retain a shared readable surface without fading their text', () => {
  const source = readFileSync('src/components/custom-theme-library.tsx', 'utf8');
  const message = source.match(/testID="theme-status-message"[\s\S]*?<\/View>/)?.[0];
  expect(message).toBeDefined();
  expect(message).toContain('backgroundColor: background(colors.surfaceRaised)');
  expect(message).toContain('accessibilityRole="alert"');
  expect(message).toContain('accessibilityLiveRegion="polite"');
  expect(message).toContain('{error}');
  expect(message).toContain('{notice}');
  expect(/\bopacity\s*:/.test(message ?? '')).toBe(false);
});
