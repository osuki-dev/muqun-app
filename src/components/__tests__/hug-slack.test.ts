import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * The trailing slack that keeps an italic face's last glyph on the screen.
 *
 * Android lays a line out as the sum of its glyph advances and `TextView`
 * clips its drawing to that box, so a face that leans past its own advance
 * loses the overhang: the reader's wide italic font turned APPEARANCE into
 * APPEARANC, 未連線 into 未連, and shaved the corner off 前 in every timestamp.
 *
 * Only one thing moves that clip, and it is not a style: the *line* has to be
 * longer than the glyphs. `components/text.tsx` makes it so by putting a thin
 * space after the reader's copy. These are the four things about that which
 * are easy to undo by accident.
 */
const TEXT = 'src/components/text.tsx';

function source(): string {
  return readFileSync(TEXT, 'utf8');
}

test('the slack is a space with an advance, not a zero-width character', () => {
  // Read out of the file rather than imported: the module's first import is
  // the design system, whose own first import is react-native, which `bun
  // test` cannot load (its entry point is Flow, not TypeScript).
  const declared = /export const HUG_SLACK = '\\u([0-9a-f]{4})';/u.exec(source())?.[1];
  expect(declared).toBeDefined();
  const slack = String.fromCodePoint(Number.parseInt(declared ?? '0', 16));
  // The entire mechanism is the advance. U+200B ZERO WIDTH SPACE, U+FEFF and a
  // combining mark all "add a character" and widen the line by nothing at all,
  // which is the same as doing nothing.
  expect(slack).toBe('\u2009');
  expect(slack.length).toBe(1);
});

test('the slack is spent only on a reader-supplied face', () => {
  // Under the platform's own UI face nothing in the app changes by a single
  // character: that face is upright, overhangs nothing, and a fifth of an em
  // on every label in the app is a change nobody asked for.
  expect(source()).toContain("interfaceKind === 'file' ? HUG_SLACK : ''");
});

test('the slack does not nest, and does not invent a width', () => {
  const body = source();
  // Nested text is one line. A slack character inside it is not trailing --
  // it is a gap in the middle of a sentence between two runs -- so a `Text`
  // publishes an empty slack to its own children and only the outermost one
  // in a nest adds anything.
  expect(body).toContain(
    '<HugSlackContext.Provider value="">{children}</HugSlackContext.Provider>'
  );
  // `<Text>{maybe}</Text>` with nothing in it is a zero-width box, and rows
  // rely on that to disappear; a thin space would give it a width.
  expect(body).toContain('!hasContent(children)');
});

test('selectable copy is left exactly as the reader will paste it', () => {
  // A server URL, a session id, a path. The slack would ride into the
  // clipboard and break whatever it was pasted into.
  expect(source()).toContain('props.selectable');
});

test('the wrapper is the only door to the design system’s Text', () => {
  // Otherwise the fix is per-import rather than per-app, which is how the
  // padding version of this fix ended up living in one file for a month while
  // every other label in the app went on being clipped. The guard itself is in
  // `interface-font-reach.test.ts`; this pins the import it is guarding.
  expect(source()).toContain("import { Text as KitText, type TextProps } from '@osuki-dev/ui';");
});
