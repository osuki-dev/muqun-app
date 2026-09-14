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
  'shell.background': [
    'src/app/settings.tsx',
    // The same wallpaper under every form sheet, from the component that owns
    // the order of its layers. Named here so it cannot be deleted back to a
    // flat surface without this guard noticing, which is how the sheets lost
    // the picture in the first place.
    'src/components/sheet-ground.tsx',
  ],
  'home.background': 'src/app/(drawer)/index.tsx',
  'home.decoration': 'src/app/(drawer)/index.tsx',
  'navigation.background': 'src/components/glass-chrome.tsx',
  'composer.background': 'src/components/glass-chrome.tsx',
  'actions.background': 'src/components/glass-chrome.tsx',
  'cards.decoration': 'src/components/settings-chrome.tsx',
  'buttons.primary.background': 'src/components/themed-button.tsx',
  'tabs.background': 'src/app/commands.tsx',
  'emptyState.illustration': [
    'src/app/(drawer)/index.tsx',
    'src/theme/launch-artwork.ts',
    // Reachable from Home as well, but only through an explicit reader choice.
    'src/theme/home-hero.ts',
  ],
  // The resolver rather than the screen: the hero is the one slot whose
  // visibility is a decision rather than a presence, and `home-hero.ts` is where
  // that decision is made. The test below holds the screen to mounting it.
  'home.hero': 'src/theme/home-hero.ts',
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

test('Home mounts the hero above its list and the empty card keeps its own picture', () => {
  const home = readFileSync('src/app/(drawer)/index.tsx', 'utf8');
  // Mounted, and mounted where the contract says: after the brand block and the
  // `home.decoration` banner, before anything that draws a server.
  expect(home).toContain('<HomeHero ');
  const heroAt = home.indexOf('<HomeHero ');
  expect(heroAt).toBeGreaterThan(home.indexOf('slot="home.decoration"'));
  expect(heroAt).toBeLessThan(home.indexOf('<ServerCard'));
  // And not while the empty state is up. Both pictures on one otherwise empty
  // screen is a gallery rather than an invitation, and the card's illustration
  // was composed for the card.
  expect(/records\.length > 0 \? \(\s*<HomeHero/.test(home)).toBe(true);
  expect(home).toContain('<ThemeArtwork slot="emptyState.illustration" />');

  // The iPad rail deliberately does not draw it. The rail is a persistent index
  // of machines beside a live terminal, not the top of a page, and a decoration
  // that cannot scroll away would sit there for the whole session.
  const rail = readFileSync('src/components/pad-server-rail.tsx', 'utf8');
  expect(rail).not.toContain('HomeHero');
});

test('both launch surfaces take their mark from the shared fallback chain', () => {
  // The slot names live in `launch-artwork.ts` and the order they imply --
  // the hero for the launch overlay only, then illustration, then Home logo,
  // then the bundled mark -- is tested there. What this holds is that neither
  // screen grows a second opinion: a lock screen that resolved the slot itself
  // could drift from the overlay, and the two are the first and last thing a
  // reader sees in a session.
  const launch = readFileSync('src/components/launch-brand.tsx', 'utf8');
  expect(launch).toContain("from '@/hooks/use-launch-artwork'");
  expect(launch).toContain('useLaunchHeroArtwork()');
  // The bundled mascot when a pack offers neither picture nor logo is the
  // compiled launch asset itself, so the launch takes it from the mirror.
  expect(launch).toContain('useSplashMirror()');
  expect(launch).toContain("kind === 'default'");

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
