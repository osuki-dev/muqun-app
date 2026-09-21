/**
 * The wiring a reader-supplied font depends on, held in place.
 *
 * Everything asserted here is a fact about *source* rather than about a value,
 * because every one of them is a line that can be deleted without breaking a
 * type, a test or a build -- and whose absence shows up only on a device that
 * has a custom font installed, which is no device any of us develops on.
 *
 * Read as a list of ways this feature quietly stops working:
 *
 *  - the launch gate goes, and Android's markdown typeface cache is poisoned
 *    with the system font for the life of the process;
 *  - `buildTheme` stops taking the slot, and the app's own text never changes;
 *  - the terminal goes back to the bundled `require`, and the mono slot only
 *    reaches code blocks;
 *  - the bundled font is deleted as "unused", and a bad file is a black
 *    terminal instead of a fallback.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { sheetRouteDetents, sheetRoutePresentations } from '@/lib/route-presentation';
import { FONT_SLOT_IDS, USER_FONT_ALIAS } from '@/theme/user-font-file';

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

test('the router does not mount until the fonts have been registered', () => {
  const layout = read('src/app/_layout.tsx');
  // The gate itself. `LaunchOverlay` lives inside `RootContent`, so holding it
  // keeps the native splash up rather than showing a blank frame -- which is
  // the only reason gating the whole subtree is affordable.
  expect(layout).toContain('const fontsReady = useUserFontsReady();');
  expect(layout).toContain('{fontsReady ? <RootContent /> : null}');

  const hook = read('src/hooks/use-user-fonts.ts');
  // Settings hydration is inside the same effect as the registration: as two
  // independent effects the registration raced the read it depends on.
  expect(hook).toContain('await useAppSettings.getState().hydrate()');
  expect(hook).toContain('registerUserFonts(slots)');
  // And the wait is bounded. A missing file or a face that will not register
  // must not leave a reader on a splash screen they cannot get past.
  expect(hook).toContain('USER_FONT_REGISTRATION_TIMEOUT_MS');
  expect(hook).toContain('open({ timedOut: true })');
});

test('the kit theme takes the interface slot for every role, captions included', () => {
  const theme = read('src/constants/theme.ts');
  expect(theme).toContain("slotFontFamily(interfaceFont, 'interface')");
  // The three roles are no longer spelled out here. They are
  // `theme/interface-font-registry.ts`'s list, checked against the kit's own
  // `typeStyles` by `__tests__/interface-font-registry.test.ts` -- which also
  // checks the thing this spelling could not: that each role answers with the
  // reader's family at *every* weight, and never at 700, where Android stops
  // finding a registered typeface and hands back its own font.
  expect(theme).toContain('...preset.fonts, ...userFontRegistry(interfaceFamily)');

  // And the slot is in the palette memo's deps, or a font installed while the
  // app is running would be stored, re-render every reader of the setting, and
  // change nothing.
  const hook = read('src/hooks/use-theme-pack.ts');
  expect(hook).toContain(
    'buildTheme(pack, interfaceFont, profile), [pack, interfaceFont, profile]'
  );
});

test('markdown takes both faces, and keeps the platform monospace as its floor', () => {
  const style = read('src/lib/markdown-style.ts');
  expect(style).toContain("return fonts?.mono ?? 'monospace'");
  expect(style).toContain('...(fonts?.prose ? { fontFamily: fonts.prose } : {})');

  // Every surface that renders markdown asks one hook what the reader's font
  // is. A surface that built its own style without it would be the one block
  // on screen in the wrong face.
  for (const file of [
    'src/components/pane-chat-blocks.tsx',
    'src/components/asset-viewer.tsx',
    'src/components/agent-reasoning-block.tsx',
  ]) {
    expect({ file, wired: read(file).includes('useMarkdownFonts()') }).toEqual({
      file,
      wired: true,
    });
  }

  // The palette key sees both families, or a font installed mid-transcript
  // gives a split rendering the reader cannot undo without killing the app.
  const palette = read('src/lib/markdown-palette.ts');
  expect(palette).toContain('style.paragraph?.fontFamily');
  expect(palette).toContain('style.codeBlock?.fontFamily');
});

test('the terminal reads the mono slot and never loses the bundled face', () => {
  const terminal = read('src/components/skia-terminal.tsx');
  expect(terminal).toContain('useAppSettings((state) => state.monoFont)');
  expect(terminal).toContain('userFontUri(monoFontSlot)');
  // The floor. Deleting the bundled font would turn a file Skia rejects into a
  // terminal that draws nothing at all.
  expect(terminal).toContain("require('../../assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf')");
  expect(terminal).toContain('const fontUri = userFontUriInUse ?? bundledFontUri;');
  // A reader's face that fails at load time falls back rather than blanking.
  expect(terminal).toContain('setMonoFontRejected(true)');

  // The glyph cache is keyed on the typeface. This is the one assertion here
  // that stands in for a real bug rather than a missing feature: the cache
  // stores a glyph *id*, so a hit across a swap draws the new font's glyph at
  // the old font's index. `terminal/glyph-cache.test.ts` proves the behaviour;
  // this proves the renderer still goes through it.
  expect(terminal).toContain("from '@/terminal/glyph-cache'");
  const cache = read('src/terminal/glyph-cache.ts');
  expect(cache).toContain('glyphCacheKey(renderingIdentity(font), fontSize, grapheme)');

  // The PTY's first-frame estimate is about the font that is actually loaded.
  const workspace = read('src/components/ssh-terminal-workspace.tsx');
  expect(workspace).toContain('slotAdvanceRatio(monoFontSlot, TERMINAL_ADVANCE_RATIO)');
  expect(workspace).toContain('advanceRatio: monoAdvanceRatio');
});

test('the Font row and its sheet are wired the way every other sheet is', () => {
  // A route, not a `<Modal>`: the grabber, the detent, the hardware back and
  // `freezeOnBlur` all come from being one. `sheet-scene-contract.test.ts`
  // holds the sheet itself to the scene's rules.
  expect(sheetRoutePresentations['settings-font']).toBe('sheet');
  // Both halves of the wiring now come from the one route table, so the layout
  // names the route rather than indexing the presentations map by hand.
  expect(read('src/app/_layout.tsx')).toContain("sheetRouteOptions('settings-font')");
  expect(sheetRouteDetents['settings-font']).toBe('expandable');
  expect(read('src/components/settings-appearance.tsx')).toContain("router.push('/settings-font')");
  expect(read('src/app/settings-font.tsx')).toContain('<SettingsFontSheet');
});

test('the aliases are stable names, and nothing reaches past them for a family', () => {
  // The whole point of an alias: `Font.loadAsync` registers a face under the
  // name it is given, so a swap changes the bytes behind the name and no style
  // in the app has to be rewritten. A consumer that used the face's own family
  // name instead would break on every change of file.
  expect(USER_FONT_ALIAS.interface).toBe('MuqunUserInterface');
  expect(USER_FONT_ALIAS.mono).toBe('MuqunUserMono');
  expect([...FONT_SLOT_IDS]).toEqual(['interface', 'mono']);

  // Every consumer asks `slotFontFamily`, which answers `null` for the system
  // slot. Naming an alias directly would keep drawing in a font the reader has
  // removed -- the registration cannot be undone, so the app stops *referring*
  // to it instead.
  for (const file of [
    'src/constants/theme.ts',
    'src/hooks/use-user-fonts.ts',
    'src/components/skia-terminal.tsx',
  ]) {
    const text = read(file);
    expect({ file, viaHelper: text.includes('slotFontFamily(') }).toEqual({
      file,
      viaHelper: true,
    });
    expect({ file, literal: text.includes("'MuqunUser") }).toEqual({ file, literal: false });
  }
});

test('the e2e flow that covers the sheet is registered with the gate tag', () => {
  // A flow without `full` is a flow the gate does not run, which is a flow
  // that cannot fail and therefore is not enforcing anything.
  const suite = JSON.parse(read('e2e/agent-device/suite.json')) as {
    flows: { name: string; program: string; tags: string[] }[];
    programs: Record<string, unknown[]>;
  };
  const flow = suite.flows.find((entry) => entry.name === 'settings-font');
  expect(flow?.tags).toContain('full');
  expect(suite.programs[flow?.program ?? '']).toBeDefined();
});

test('every phase the font row draws is a step the install actually takes', () => {
  // The rule this holds in place: no step is a timer, and no step is inferred
  // from another one. Each of the four below is reported at the line that
  // starts the work it names, so a row that says "Checking" is a row whose
  // file is being read. Deleting any of these calls breaks nothing that a
  // type or a build would notice -- the row simply stops moving, on a device
  // with a slow connection, which is not where any of us develops.
  const module = read('src/theme/user-fonts.ts');
  expect(module).toContain("onStep?.('connecting');");
  expect(module).toContain("onStep?.('copying');");
  expect(module).toContain("onStep?.('checking');");
  // `checking` belongs to the checks, not to the download: an import runs the
  // same three and must report them too.
  const accept = module.split('async function acceptStagedFont')[1]?.split('\n}')[0] ?? '';
  expect(accept).toContain("onStep?.('checking');");
  expect(accept.indexOf("onStep?.('checking')")).toBeLessThan(accept.indexOf('checkFontSize'));
  // And both ways in hand the callback down to them.
  expect(module).toContain(
    'return acceptStagedFont(downloaded, slot, url.trim(), previous, onStep, signal);'
  );
  expect(module).toContain('return acceptStagedFont(staged, slot, source.name, previous, onStep);');

  const sheet = read('src/components/settings-font-sheet.tsx');
  // The one step the module cannot report, because it happens in the sheet.
  expect(sheet).toContain("emit(id, { kind: 'step', phase: 'registering' });");
  // The progress the sheet draws is the download's own bytes and the steps
  // above, never a ramp standing in for them.
  expect(sheet).toContain("onStep: (phase) => emit(id, { kind: 'step', phase })");
  expect(sheet).toContain("emit(id, { kind: 'bytes', bytesWritten, totalBytes })");
});

test('a cancelled download leaves nothing behind, in either place it can land', () => {
  const module = read('src/theme/user-fonts.ts');
  const download = module.split('export async function downloadUserFont')[1] ?? '';
  // The transfer itself rejecting.
  expect(download).toContain('discard(staged);');
  // And the abort that arrives after it resolved, where nothing else would
  // ever have rejected and the `.part` file would have stayed on disk.
  expect(download).toContain('discard(downloaded);');
  expect(download.split('discard(downloaded);')[0]).toContain('if (signal?.aborted) {');
  // And the checks stop for an abort before anything is moved into place, so a
  // reader who left the sheet during a slow parse does not come back to a font
  // they had already changed their mind about.
  const accept = module.split('async function acceptStagedFont')[1]?.split('\n}')[0] ?? '';
  expect(accept).toContain("if (signal?.aborted) throw new UserFontError({ kind: 'cancelled' });");
});
