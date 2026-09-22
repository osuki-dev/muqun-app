import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { THEME_SLOTS } from '../schema';

// Contract guard, not a replacement for native screenshots or interaction QA.
// Every advertised slot must retain a real consumer rather than a schema-only promise.
//
// A list names every surface when artwork is consumed in more than one place.
// Empty-state art stays in its card; launch and Home foregrounds have dedicated slots.
const consumers = {
  'shell.wallpaper': [
    'src/app/settings.tsx',
    // The same wallpaper under every form sheet, from the component that owns
    // the order of its layers. Named here so it cannot be deleted back to a
    // flat surface without this guard noticing, which is how the sheets lost
    // the picture in the first place.
    'src/components/sheet-ground.tsx',
  ],
  'home.wallpaper': 'src/components/home-overview.tsx',
  'navigation.background': 'src/components/glass-chrome.tsx',
  'composer.background': 'src/components/glass-chrome.tsx',
  'actions.background': 'src/components/glass-chrome.tsx',
  'cards.decoration': 'src/components/settings-chrome.tsx',
  'buttons.primary.background': 'src/components/themed-button.tsx',
  // The control, not a screen. The commands sheet used to paint its own tab
  // strip, so the slot lived or died with that one screen; it is on
  // `SettingsSegmented` now, which is every tabbed control in the app.
  'tabs.background': 'src/components/settings-segmented.tsx',
  'empty.artwork': 'src/components/home-overview.tsx',
  'home.artwork': 'src/theme/home-artwork.ts',
  'launch.artwork': 'src/theme/launch-artwork.ts',
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

test('Home mounts profile-specific top artwork and the empty card keeps its own picture', () => {
  const home = readFileSync('src/components/home-overview.tsx', 'utf8');
  expect(home).toContain('resolveHomeArtworkAsset');
  expect(home).toContain('<HomeEditorialArtwork');
  const editorialArtwork = readFileSync('src/components/home-editorial-artwork.tsx', 'utf8');
  expect(editorialArtwork).toContain("colors={['white', 'white', 'transparent']}");
  expect(editorialArtwork).toContain("root: { width: '100%'");
  expect(editorialArtwork).not.toContain('RoundedRect');
  // Both layouts render the same foreground in their own composition.
  expect(home).toContain('<HomeArtwork ');
  const artworkAt = home.indexOf('<HomeArtwork ');
  expect(artworkAt).toBeLessThan(home.indexOf('<ServerCard'));
  expect(home).toContain('resolveHomeArtworkAsset');
  // The artwork is omitted while the empty state is up. Both pictures on one
  // otherwise empty screen is a gallery rather than an invitation, and the
  // card's illustration was composed for the card.
  expect(home).toContain('records.length > 0 && artworkResolution');
  expect(home).toContain('<ThemeArtwork slot="empty.artwork" />');

  // The iPad rail deliberately does not draw it. The rail is a persistent index
  // of machines beside a live terminal, not the top of a page, and a decoration
  // that cannot scroll away would sit there for the whole session.
  const rail = readFileSync('src/components/pad-server-rail.tsx', 'utf8');
  expect(rail).not.toContain('HomeArtwork');
});

test('both launch surfaces take their mark from the shared fallback chain', () => {
  // The slot names live in `launch-artwork.ts` and the order they imply --
  // explicit launch artwork, then primary Home artwork, then Home logo,
  // then the bundled mark -- is tested there. What this holds is that neither
  // screen grows a second opinion: a lock screen that resolved the slot itself
  // could drift from the overlay, and the two are the first and last thing a
  // reader sees in a session.
  // The launch overlay does not resolve the mark at all any more: its picture
  // *is* the frame the OS drew, handed over by the splash mirror, because the
  // opening's first rule is that nothing ever replaces the artwork the reader
  // is already looking at. The chain still decides which picture that is --
  // one launch earlier, in `use-launch-image-sync`, which is the only place
  // allowed to tell native what to draw. So the rule is not "the overlay calls
  // the chain" but "exactly one surface does, and the overlay mirrors it".
  const launch = readFileSync('src/components/launch-intro-scene.tsx', 'utf8');
  expect(launch).toContain('useSplashMirror()');
  expect(launch).not.toContain('useLaunchArtwork()');
  const sync = readFileSync('src/hooks/use-launch-image-sync.ts', 'utf8');
  expect(sync).toContain("from '@/hooks/use-launch-artwork'");
  expect(sync).toContain('useLaunchArtwork()');
  expect(sync).toContain("kind === 'default'");

  const lock = readFileSync('src/components/app-lock-gate.tsx', 'utf8');
  expect(lock).toContain("from '@/hooks/use-launch-artwork'");
  expect(lock).toContain('useLaunchArtwork()');
  // Still the bundled mascot when a pack offers neither picture nor logo.
  expect(lock).toContain("from '@/components/brand-mark'");
  expect(lock).toContain("kind === 'default'");

  // The applied theme, never a previewed one. Both surfaces draw the app
  // itself rather than a route -- the overlay covers everything while the
  // router is still starting, the lock gate sits above the whole stack -- so
  // neither can be inside a `CandidateThemeProvider` today, and neither should
  // follow one if a future screen puts it there. A splash wearing whichever
  // theme was last previewed would be the app showing a decision the reader
  // has not made.
  //
  // Asserted against the calls and the import rather than the text, since the
  // file's own docblock argues the point by naming the hook it does not use.
  const wiring = readFileSync('src/hooks/use-launch-artwork.ts', 'utf8');
  expect(wiring).toContain('useAppliedCustomTheme()');
  expect(wiring).not.toContain('useEffectiveCustomTheme(');
  expect(/import[^;]*useEffectiveCustomTheme/.test(wiring)).toBe(false);
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
  expect(source).toContain("useHasThemeArtwork('shell.wallpaper')");
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
