// The markdown theme, checked against every palette the app ships.
//
// The renderer paints its own defaults for any key the style leaves out, and
// those defaults were mixed for a light page: a display formula came out on a
// light grey slab in the dark theme, and inline math in a grey that barely
// read. What is pinned here is the rule that would have caught it -- every
// fill and every ink in the style comes from the palette it was built from,
// and a formula sits on the same fill as a code block.
import * as bunTest from 'bun:test';

import { THEME_PACKS } from '@/constants/theme-packs';

const { describe, expect, test } = bunTest;
// `mock` is missing from the bun:test typings this project resolves, but the
// runtime has it. The style reads one constant off React Native, which cannot
// load in a bare bun process.
const { module: mockModule } = (
  bunTest as unknown as { mock: { module: (id: string, factory: () => unknown) => void } }
).mock;

// Identical to the fake `live-activity.test.ts` registers, on purpose:
// `mock.module` is process-wide and first-registration wins, so the two suites
// have to agree or whichever runs second gets a module missing what it imports.
mockModule('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
  StyleSheet: { hairlineWidth: 0.5 },
}));

const {
  createCompactMarkdownStyle,
  createMarkdownStyle,
  createThoughtMarkdownStyle,
  markdownImageStyle,
  MARKDOWN_IMAGE_MAX_HEIGHT_RATIO,
} = await import('../markdown-style');

type Colors = (typeof THEME_PACKS)[number]['dark']['colors'];

/** Every palette the app ships, labelled `pack/mode`. */
const PALETTES = THEME_PACKS.flatMap((pack) =>
  (['light', 'dark'] as const).map((mode) => [`${pack.id}/${mode}`, pack[mode].colors] as const)
);

/** The labels of the palettes `check` fails for, so a failure names them. */
function failingPalettes(check: (colors: Colors) => boolean): string[] {
  return PALETTES.filter(([, colors]) => !check(colors)).map(([label]) => label);
}

const colors = THEME_PACKS[0].dark.colors;

describe('createMarkdownStyle', () => {
  test('a formula sits on the code-block fill, in body ink, in every palette', () => {
    expect(
      failingPalettes((palette) => {
        const style = createMarkdownStyle(palette);
        return (
          style.math?.backgroundColor === palette.surfaceRaised &&
          style.math?.backgroundColor === style.codeBlock?.backgroundColor &&
          style.math?.color === palette.text &&
          style.inlineMath?.color === palette.text &&
          style.math?.color === style.codeBlock?.color
        );
      })
    ).toEqual([]);
  });

  test("a formula keeps the renderer's own size and alignment", () => {
    // Only the colours are overridden: the light theme has always shown the
    // renderer's defaults for the rest, and this keeps it that way.
    const style = createMarkdownStyle(colors);
    expect(Object.keys(style.math ?? {}).sort()).toEqual(['backgroundColor', 'color']);
    expect(Object.keys(style.inlineMath ?? {})).toEqual(['color']);
  });
});

// The compact style is what the transcript's chrome reads in -- a thought, a
// notice, a skill's text, a permission's note, a form's description, a
// checklist item, a structured failure -- and the three tones it is asked for
// are the only thing that varies between them. What is pinned is that a tone
// is a colour *from the palette*: a hard-coded grey would pass a glance in one
// theme pack and fail in the next, and a fill that did not come from the
// palette is how the display formula ended up on a light slab in the dark
// theme.
describe('createCompactMarkdownStyle', () => {
  const INKED = [
    'paragraph',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'list',
    'blockquote',
    'code',
    'codeBlock',
    'strong',
    'em',
    'strikethrough',
  ] as const;

  test("every tone inks from the palette and keeps the answer's fills and link", () => {
    expect(
      failingPalettes((palette) => {
        const prose = createMarkdownStyle(palette);
        return [palette.text, palette.textMuted, palette.danger].every((ink) => {
          const style = createCompactMarkdownStyle(palette, ink);
          return (
            INKED.every((key) => (style[key] as { color?: string } | undefined)?.color === ink) &&
            style.table?.headerTextColor === ink &&
            style.codeBlock?.backgroundColor === prose.codeBlock?.backgroundColor &&
            style.blockquote?.backgroundColor === prose.blockquote?.backgroundColor &&
            style.table?.headerBackgroundColor === prose.table?.headerBackgroundColor &&
            style.math?.backgroundColor === palette.surfaceRaised &&
            // The one ink a tone does not take over: a link that went muted
            // with the paragraph would stop looking like a link.
            style.link?.color === palette.info &&
            style.link?.color === prose.link?.color
          );
        });
      })
    ).toEqual([]);
  });

  test('it is set smaller than the answer, with no rule', () => {
    const prose = createMarkdownStyle(colors);
    const style = createCompactMarkdownStyle(colors, colors.textMuted);
    expect(style.paragraph?.fontSize).toBeLessThan(prose.paragraph?.fontSize ?? 0);
    expect(style.h1?.fontSize).toBeLessThan(prose.h1?.fontSize ?? 0);
    // A rule drawn across a card is the card's own edge again.
    expect(style.thematicBreak?.height).toBe(0);
  });

  test('a thought is the compact style, muted', () => {
    expect(createThoughtMarkdownStyle(colors)).toEqual(
      createCompactMarkdownStyle(colors, colors.textMuted)
    );
  });
});

/**
 * The reader's own faces, through the style and into every block that should
 * carry them. A family does not vary by pack, so one palette is enough.
 */
describe('a reader-supplied face', () => {
  const INTERFACE = 'MuqunUserInterface';
  const MONO = 'MuqunUserMono';
  const both = { prose: INTERFACE, mono: MONO };

  /** Every block that is prose, and therefore takes the interface face. */
  const PROSE_KEYS = [
    'paragraph',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'list',
    'blockquote',
    'table',
  ] as const;

  test('no choice draws exactly what the app drew before the slots existed', () => {
    const plain = createMarkdownStyle(colors);
    // A default argument that changed one key would be a silent restyle of
    // every transcript for readers who never opened the Font sheet.
    expect(createMarkdownStyle(colors, {})).toEqual(plain);
    expect(createMarkdownStyle(colors, { prose: null, mono: null })).toEqual(plain);
    // `'monospace'` is the floor and is never given up: it is the platform's
    // own answer to "draw this as code".
    expect(plain.code?.fontFamily).toBe('monospace');
    expect(plain.codeBlock?.fontFamily).toBe('monospace');
    expect(plain.paragraph?.fontFamily).toBeUndefined();
  });

  test('prose blocks take the interface face and code the monospace one', () => {
    const style = createMarkdownStyle(colors, both);
    for (const key of PROSE_KEYS) {
      expect({ key, family: style[key]?.fontFamily }).toEqual({ key, family: INTERFACE });
    }
    expect(style.code?.fontFamily).toBe(MONO);
    expect(style.codeBlock?.fontFamily).toBe(MONO);
    // `enriched-markdown` resolves a span's family from the block it sits in;
    // naming it again on a span is one more place for the app to disagree.
    expect(style.strong?.fontFamily).toBeUndefined();
    expect(style.em?.fontFamily).toBeUndefined();
    expect(style.link?.fontFamily).toBeUndefined();
  });

  test('the two slots are independent, so one face never leaks into the other', () => {
    const proseOnly = createMarkdownStyle(colors, { prose: INTERFACE });
    expect(proseOnly.paragraph?.fontFamily).toBe(INTERFACE);
    // A reader who set only the interface font still reads code in the
    // platform's monospace, not in their body face.
    expect(proseOnly.codeBlock?.fontFamily).toBe('monospace');

    const monoOnly = createMarkdownStyle(colors, { mono: MONO });
    expect(monoOnly.codeBlock?.fontFamily).toBe(MONO);
    expect(monoOnly.paragraph?.fontFamily).toBeUndefined();
  });

  test('the compact and thought variants inherit both faces', () => {
    const compact = createCompactMarkdownStyle(colors, colors.textMuted, both);
    expect(compact.paragraph?.fontFamily).toBe(INTERFACE);
    expect(compact.h1?.fontFamily).toBe(INTERFACE);
    expect(compact.codeBlock?.fontFamily).toBe(MONO);
    expect(createThoughtMarkdownStyle(colors, both)).toEqual(compact);
  });
});

describe('markdownImageStyle', () => {
  test('fits the width at the image aspect ratio, contained under a viewport cap', () => {
    // `maxHeight` without `aspectRatio` is the renderer's intrinsic-size mode;
    // `contain` keeps it from cropping inside the cap.
    expect(markdownImageStyle(1000, 12)).toEqual({
      maxHeight: 1000 * MARKDOWN_IMAGE_MAX_HEIGHT_RATIO,
      resizeMode: 'contain',
      borderRadius: 12,
      marginTop: 8,
      marginBottom: 8,
    });
  });

  test('a tiny or unmeasured viewport still leaves room for an image', () => {
    expect(markdownImageStyle(0, 0).maxHeight).toBe(160);
    expect(markdownImageStyle(333, 0).maxHeight).toBe(200);
  });
});
