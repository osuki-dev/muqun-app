import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { sheetRoutePresentations } from '@/lib/route-presentation';

import { surfaceBackgroundFill } from '../surface-background';

/**
 * Every frame that draws a `presentation: 'formSheet'` route in
 * `src/app/_layout.tsx`, and therefore every frame that has to paint its own
 * ground: the route is transparent so the native sheet keeps its corners.
 *
 * A route added to `_layout.tsx` with `presentation: 'formSheet'` belongs in
 * this list, and the assertions below are what stop it being drawn some other
 * way.
 *
 * The eight agent sheets in the middle are the ones that were drawn some other
 * way: `<Modal transparent>` components with their own backdrop, their own
 * hand-drawn grabber and their own corner radius, none of which this file
 * could see because none of them was a route.
 *
 * The three at the end are the ones that were the other other way: full-screen
 * frames with a hand-drawn X circle, which is how the theme picker ended up
 * with no way out at all once the X went. They are sheets now, and
 * `SettingsSheet` -- the shared full-screen/form-sheet frame two of them wore
 * -- is gone with them.
 */
const SHEET_FRAMES = [
  'src/components/theme-browse-sheet.tsx',
  'src/app/commands.tsx',
  'src/components/session-map.tsx',
  'src/components/session-artifacts.tsx',
  'src/components/git-diff-view.tsx',
  'src/components/new-task-sheet.tsx',
  'src/components/open-web-service-sheet.tsx',
  'src/components/agent-sessions-sheet.tsx',
  'src/components/agent-model-sheet.tsx',
  'src/components/agent-mode-sheet.tsx',
  'src/components/agent-workspace-sheet.tsx',
  'src/components/agent-context-sheet.tsx',
  'src/components/agent-vcs-diff-sheet.tsx',
  'src/components/agent-tasks-sheet.tsx',
  'src/components/agent-background-tray.tsx',
  'src/components/opencode-guide-sheet.tsx',
  'src/components/settings-theme-sheet.tsx',
  'src/app/explore.tsx',
];

/**
 * A sheet is a route, and a route is not a `<Modal>`.
 *
 * React Native's `Modal` inside a native form sheet is a second window over
 * the first: it gets no sheet ground, no grabber, no detent and no dismissal
 * gesture, and on the agent screen it was drawing its own backdrop over the
 * screen it was supposed to be part of. The one exception the frames below may
 * still mount is the shared image lightbox, which is genuinely full-screen.
 */
test('a sheet frame presents itself as a route, never as a Modal', () => {
  for (const file of SHEET_FRAMES) {
    const text = code(readFileSync(file, 'utf8'));
    expect({ file, modal: text.includes('<Modal') }).toEqual({ file, modal: false });
    // No hand-drawn scrim either: a form sheet is dimmed natively, by
    // `sheetLargestUndimmedDetentIndex`.
    expect({ file, scrim: /backgroundColor: 'rgba\(0, ?0, ?0/.test(text) }).toEqual({
      file,
      scrim: false,
    });
  }
});

test('the sheet ground paints its wallpaper above its tint, never under it', () => {
  const text = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  const floor = text.indexOf('backgroundColor: theme.colors.background');
  const tint = text.indexOf('backgroundColor: surfaceBackground(');
  const artwork = text.indexOf('<ThemeArtwork slot="shell.background" />');
  expect(floor).toBeGreaterThan(-1);
  expect(tint).toBeGreaterThan(floor);
  expect(artwork).toBeGreaterThan(tint);

  // Why the order is the contract rather than a preference. The tint is opaque
  // at the default alpha, so a picture painted before it is a picture nobody
  // sees -- which is exactly what every sheet did until this component existed.
  expect(surfaceBackgroundFill('#1a1b26', 1)).toBe('#1a1b26');
  expect(surfaceBackgroundFill('#1a1b26', 0.6)).toBe('rgba(26, 27, 38, 0.6)');

  // Decoration, so it takes no touches and no accessibility nodes.
  expect(text).toContain('pointerEvents="none"');
  expect(text).toContain('importantForAccessibility="no-hide-descendants"');
  // The picture's own alpha, not a contrast clamp: `safeArtworkOpacity` answers
  // ~0 for real palettes, so a sheet that used it would draw nothing at all.
  // Readability is `useSheetGroundPlate`'s job instead.
  // Named in this file's docblock, which explains why; never rendered.
  expect(text).not.toContain('<ThemedSurfaceArtwork');
});

test('every form sheet is built in the one shared frame', () => {
  for (const file of SHEET_FRAMES) {
    const text = readFileSync(file, 'utf8');
    // `SheetFrame`, or `SheetScene`, which is the furniture built on top of it
    // -- never a `SheetGround` mounted by hand. One frame is what makes the
    // ground a single place to change rather than sixteen.
    expect({ file, framed: text.includes('<SheetFrame') || text.includes('<SheetScene') }).toEqual({
      file,
      framed: true,
    });
    expect(text).not.toContain('<SheetGround');
    // And none of them paints a second surface of its own over it. The scroll
    // root keeps an opaque floor or nothing; the tint belongs to the ground.
    expect(text).not.toContain('styles.sheet, { backgroundColor: surfaceBackground(');
  }
  // The frame is the only thing that mounts the ground.
  const ground = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  expect(ground).toContain('<SheetGround testID={testID} tint={tint} frosted={frosted} />');
});

test('text drawn straight onto a sheet ground takes the plate the shell gives it', () => {
  const ground = readFileSync('src/components/sheet-ground.tsx', 'utf8');
  // The plate is only there when there is a picture to be protected from.
  expect(ground).toContain("useHasThemeArtwork('shell.background')");

  // One plate, and this is the file that decides what it is. `SettingsSection`
  // used to mix its own from `colors.background`, which is right on the
  // settings page and a visibly different grey on a `surface`-tinted sheet --
  // two mechanisms plating the same labels. The settings label now asks here.
  const chrome = readFileSync('src/components/settings-chrome.tsx', 'utf8');
  expect(chrome).toContain("import { useSheetGroundPlate } from '@/components/sheet-ground'");
  expect(chrome).toContain('const plate = useSheetGroundPlate();');
  expect(chrome).not.toContain("useHasThemeArtwork('shell.background')");

  // And the geometry is the settings page's, which is the one that was already
  // shipping: `LADDER.gap` across, `LADDER.tight` down, radius 8.
  expect(ground).toContain('export const SHEET_GROUND_PLATE_RADIUS = 18;');
  expect(ground).toContain('export const SHEET_GROUND_PLATE_PADDING_HORIZONTAL = 8;');
  expect(ground).toContain('export const SHEET_GROUND_PLATE_PADDING_VERTICAL = 4;');

  // The tint is the ground's, taken from the frame rather than defaulted to
  // `surface` wherever the hook happens to be called.
  expect(ground).toContain('createContext<SheetGroundTint>');
  expect(ground).toContain('<SheetGroundTintContext.Provider value={tint ?? ');
  expect(ground).toContain('sheetGroundTintColor(theme.colors, tint ?? ground)');

  // Every sheet has at least one label with nothing under it: a header, a
  // section eyebrow, or a day heading. It takes the plate directly, or it is a
  // `SectionLabel`, which takes the same plate from the same frame.
  for (const file of SHEET_FRAMES) {
    const text = readFileSync(file, 'utf8');
    const direct = text.includes('useSheetGroundPlate(') && text.includes(', plate]');
    const viaLabel = text.includes('<SectionLabel');
    // A frosted ground is the other answer, and the better one: `SheetScene`
    // frosts itself, and a sheet that frosts its own frame has said the same
    // thing. Either way the reader is not asked to read text on a photograph.
    const viaScene = SCENE_ROOT.test(text);
    const viaFrost = text.includes('frosted');
    expect({ file, plated: direct || viaLabel || viaScene || viaFrost }).toEqual({
      file,
      plated: true,
    });
  }

  // And the furniture really does protect what it draws, so `viaScene` above is
  // a fact rather than an exemption -- by frosting the ground rather than by
  // plating each run, which is the thing this system is not.
  const scene = readFileSync('src/components/sheet-scene.tsx', 'utf8');
  expect(scene).toContain('<SheetFrame testID={testID} tint="surface" frosted>');
  expect(scene).not.toContain('useSheetGroundPlate');

  // The frost is a floor the reader's opacity slider cannot take a sheet below.
  expect(ground).toContain('export const SHEET_FROST_ALPHA = 0.82;');
  expect(ground).toContain('frosted && hasShell');
});

/**
 * The sheet system's own rules, from `sheet-design.md`.
 *
 * A sheet is one frosted ground with nothing boxed on it. The three things that
 * make it the SaaS card kit again -- a second surface inside the sheet, a radio
 * or a tick marking the selection, and an X circle repeating the grabber -- are
 * checked here rather than left to review, because every one of them arrived by
 * being locally reasonable.
 */
/** `<SheetScene>` itself, not `<SheetSceneHeading>` and friends. */
const SCENE_ROOT = /<SheetScene[\s>]/;

/**
 * The sheets whose tick is not a selection mark, and what it is instead.
 *
 * `<Check>` on a sheet with rows is normally the radio this system removed --
 * the answer to "which one is this" should be readable from the shape of the
 * column, not from a control. Pairing is the one place both meanings are on
 * screen at once: its SSH hosts are scene rows with the left rule, and its two
 * ticks are verbs rather than states.
 */
const TICK_ALLOWLIST: Record<string, string> = {
  'src/app/explore.tsx':
    'two ticks, neither a selection: the copy button answers a clipboard write nothing else can acknowledge, and the success step draws one over the paired server as confirmation that the pairing landed',
};

test('a sheet exempted from the no-tick rule still says what its tick is', () => {
  for (const [file, reason] of Object.entries(TICK_ALLOWLIST)) {
    const text = code(readFileSync(file, 'utf8'));
    // The exemption is only worth anything while the file really has both.
    expect({ file, rows: text.includes('<SheetSceneRow') }).toEqual({ file, rows: true });
    expect({ file, tick: /<Check\b/.test(text) }).toEqual({ file, tick: true });
    expect(reason.length).toBeGreaterThan(20);
  }
});

test('a sheet built on the scene has no cards, no radios and no close button', () => {
  const sceneSheets = SHEET_FRAMES.filter((file) => SCENE_ROOT.test(readFileSync(file, 'utf8')));
  // The agent surface is what the spec calibrates against, so it is what has to
  // be covered: if this list empties, the rules below stopped being enforced.
  expect(sceneSheets.length).toBeGreaterThanOrEqual(6);

  for (const file of sceneSheets) {
    const text = code(readFileSync(file, 'utf8'));
    // No second surface: the sheet's ground is the only one.
    expect({
      file,
      cards: text.includes('<SettingsCard') || text.includes('<ThemedSurface'),
    }).toEqual({ file, cards: false });
    // The selection mark is the scene's left rule, not a control to read. Asked
    // only of a sheet that has rows, and with one exemption per file, because
    // a tick is not always a selection: the setup sheet's is a "copied"
    // confirmation on a button, which is a different word entirely.
    if (text.includes('<SheetSceneRow') && !(file in TICK_ALLOWLIST)) {
      expect({ file, radio: /\bindicatorDot\b|<Check\b/.test(text) }).toEqual({
        file,
        radio: false,
      });
    }
    // The grabber and the swipe are the close.
    expect({ file, closeButton: text.includes('<X ') }).toEqual({ file, closeButton: false });
  }
});

/**
 * The only routes still presented full-screen, and why each one is not a sheet.
 *
 * The list used to be five. `settings-theme`, `settings-theme-browse` and
 * `explore` were full-screen frames with a hand-drawn X circle in the corner,
 * and when the sheets went to one system the X went with it -- which left the
 * theme picker with no way out at all, reported by the owner as "how do I close
 * this page". A full-screen route has no grabber to inherit instead, so the
 * answer was not to draw the button again: the three of them are form sheets,
 * and the grabber and the swipe are the close.
 *
 * What remains is two routes that were never sheets. A sheet is a panel over
 * the scene the reader is leaving, and neither of these is.
 */
const FULLSCREEN_ALLOWLIST: Record<string, string> = {
  'custom-theme':
    'a whole app screen wearing the theme being judged -- floor, wallpaper and header glass -- which a panel over the previous theme cannot be; its sliders and long editor column also pan vertically, which is the gesture a form sheet reads as dismiss',
  simfarm: 'a Skia canvas that takes every touch on it, edge to edge',
};

test('the fullscreen allowlist is two routes, and both say why', () => {
  const fullscreen = Object.entries(sheetRoutePresentations)
    .filter(([, presentation]) => presentation === 'fullscreen')
    .map(([route]) => route)
    .sort();
  expect(fullscreen).toEqual(Object.keys(FULLSCREEN_ALLOWLIST).sort());
  for (const reason of Object.values(FULLSCREEN_ALLOWLIST)) {
    expect(reason.length).toBeGreaterThan(20);
  }

  // The three that left. Named rather than merely absent from the list above,
  // so a revert that puts one back full-screen fails here and says which.
  for (const route of ['settings-theme', 'settings-theme-browse', 'explore']) {
    expect({ route, presentation: sheetRoutePresentations[route] }).toEqual({
      route,
      presentation: 'sheet',
    });
  }
});

test("no route declares fullScreenModal behind the route table's back", () => {
  const layout = code(readFileSync('src/app/_layout.tsx', 'utf8'));
  // One mention per allowlisted route, and it comes from
  // `sheetPresentationOptions` rather than a hand-written options object --
  // which is what makes the table above the single place a presentation is
  // decided.
  expect(layout).not.toContain("presentation: 'fullScreenModal'");
  for (const route of Object.keys(FULLSCREEN_ALLOWLIST)) {
    expect({ route, wired: layout.includes(`sheetRoutePresentations['${route}']`) }).toEqual({
      route,
      wired: true,
    });
  }
  // And nothing paints a sheet ground on a full-screen route any more: the
  // frame that did is gone, and with it the branch that chose between the two.
  expect(layout).not.toContain('FullscreenSheetFrame');
});

/**
 * The only surfaces in `src/app` and `src/components` allowed to mount a
 * react-native `Modal`, and why.
 *
 * A `Modal` is a second window over the app's own. It gets no sheet ground, no
 * corner radius, no detent, no grabber and no dismissal gesture, and it cannot
 * be reached by a link or dismissed by the hardware back button unless its
 * author remembers to wire it. Everything shaped like a sheet is a route
 * through `sheetPresentationOptions`, which is where those all come from.
 *
 * Neither of these two is a sheet. Each entry is the reason it stays.
 */
const MODAL_ALLOWLIST: Record<string, string> = {
  'src/components/image-preview-modal.tsx':
    'a lightbox: full-bleed over everything, with its own pinch, pan and drag-to-dismiss',
  'src/components/asset-viewer.tsx':
    'opened from inside the files form sheet, where a route would be a third subview of a layout that lays out two -- see session-artifacts.tsx',
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

/**
 * Comments in this tree say `<Modal>` all over the place, and rightly -- it is
 * what most of these files stopped being. The question is what a file
 * *renders*, so the prose comes out before it is asked.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('nothing new mounts a react-native Modal without saying why', () => {
  const offenders: string[] = [];
  for (const dir of ['src/app', 'src/components']) {
    for (const file of sourceFiles(dir)) {
      if (file in MODAL_ALLOWLIST) continue;
      if (code(readFileSync(file, 'utf8')).includes('<Modal')) offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});

test('every allowlisted modal still exists and still is one, so the list cannot rot', () => {
  for (const [file, reason] of Object.entries(MODAL_ALLOWLIST)) {
    const text = code(readFileSync(file, 'utf8'));
    expect({ file, modal: text.includes('<Modal') }).toEqual({ file, modal: true });
    expect(reason.length).toBeGreaterThan(20);
  }
});

/**
 * Every sheet announces itself the same way.
 *
 * One heading component, `SheetSceneHeading`, rendered by `SheetScene` or by
 * itself -- so "the app has one sheet" is a fact the gate holds rather than a
 * habit the next sheet can break. A sheet that rolls its own title is how the
 * agent surface drifted in the first place. The `SheetHeading` alias the
 * pre-scene sheets imported went with the last of them.
 *
 * One exemption left, and it is not a sheet at all.
 *
 * The other was the diff, on the grounds that its pinned bar carried the
 * branch, the refresh and the staged/unstaged segments and so could not be a
 * heading. It carries all three inside the scene now -- the branch is the
 * caption, the refresh is the heading's quiet control, the segments are the
 * scene's pinned header -- so the exemption was describing a layout rather than
 * a reason, and it has gone with the layout.
 */
const HEADING_EXEMPT: Record<string, string> = {
  'src/components/asset-viewer.tsx':
    'a full-bleed document viewer, not a sheet: it is a Modal opened from inside the files sheet and has no grabber to pair a heading with',
};

test('every sheet frame announces itself with the one heading', () => {
  const offenders: string[] = [];
  for (const file of SHEET_FRAMES) {
    if (file in HEADING_EXEMPT) continue;
    const text = code(readFileSync(file, 'utf8'));
    const heads = SCENE_ROOT.test(text) || text.includes('<SheetSceneHeading');
    if (!heads) offenders.push(file);
  }
  expect(offenders).toEqual([]);

  // And one component to render it: no alias that is a second one agreeing
  // today. `sheet-heading.tsx` re-exported the scene's heading for the four
  // sheets that predated the scene, and there are none of those left.
  expect(existsSync('src/components/sheet-heading.tsx')).toBe(false);

  for (const [file, reason] of Object.entries(HEADING_EXEMPT)) {
    expect(readFileSync(file, 'utf8').length).toBeGreaterThan(0);
    expect(reason.length).toBeGreaterThan(20);
  }
});
