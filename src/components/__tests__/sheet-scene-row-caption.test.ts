import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * Which end of a caption survives, and who decides.
 *
 * A row's caption is prose or it is a path, and the two clip at opposite ends.
 * Prose says what it is about in its first words, so it wraps to two lines and
 * loses its tail. A path says what it is in its *last* segment: every workspace
 * on one machine shares a prefix, and two rows reading
 * `/Users/ryu/Work/muqun/app-worktre…` are two rows the reader cannot tell
 * apart -- which is exactly what the workspace switcher showed the owner.
 *
 * So `SheetSceneRow` takes a `captionKind`, and the sheets that list paths say
 * so. Not `numberOfLines`/`ellipsizeMode` at each call site: which end of a
 * path matters is a fact about paths, not a decision five sheets each get to
 * make differently.
 */

const SCENE = readFileSync('src/components/sheet-scene.tsx', 'utf8');

test('a path caption keeps its tail, on one line', () => {
  expect(SCENE).toContain("captionKind?: 'text' | 'path';");
  expect(SCENE).toContain("numberOfLines={captionKind === 'path' ? 1 : 2}");
  expect(SCENE).toContain("ellipsizeMode={captionKind === 'path' ? 'head' : undefined}");
  // The default is prose, so no existing sheet changed by gaining the prop.
  expect(SCENE).toContain("captionKind = 'text',");
});

test('the workspace switcher says its captions are paths', () => {
  const sheet = readFileSync('src/components/agent-workspace-sheet.tsx', 'utf8');

  // Both lists of paths: the directory suggestions and the known workspaces.
  // The row whose *caption* is `Open as a workspace` is prose and is left as
  // prose -- its path is the title, which is a different slot.
  expect(sheet.match(/captionKind="path"/g)).toHaveLength(2);
  expect(sheet).toContain('caption={item.path}');
  expect(sheet).toContain('caption={project.canonical}');
});

test('the scroller is the shape every long sheet uses', () => {
  // The structure react-native-screens lays a form sheet out around: the scene
  // holds a pinned head and one flex child, and that child is the scroller.
  // Asserted across the three so a fix to one cannot drift from the others.
  for (const file of [
    'src/components/agent-workspace-sheet.tsx',
    'src/components/agent-sessions-sheet.tsx',
    'src/components/agent-model-sheet.tsx',
  ]) {
    const text = readFileSync(file, 'utf8');
    expect({ file, scroller: text.includes('style={sheetSceneStyles.scroller}') }).toEqual({
      file,
      scroller: true,
    });
    expect({
      file,
      content: text.includes('contentContainerStyle={sheetSceneStyles.scrollerContent}'),
    }).toEqual({ file, content: true });
    expect({
      file,
      footer: text.includes('<SheetSceneFooter bottomInset={insets.bottom} />'),
    }).toEqual({ file, footer: true });
  }

  // And the flex child really is bounded: `flex: 1` with `minHeight: 0`, which
  // is what stops a column of rows measuring itself instead of the sheet.
  expect(SCENE).toContain("scroller: { flex: 1, minHeight: 0, overflow: 'hidden' },");
});
