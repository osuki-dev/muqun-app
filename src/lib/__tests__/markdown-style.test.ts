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

const { createCompactMarkdownStyle, createMarkdownStyle, createThoughtMarkdownStyle } =
  await import('../markdown-style');

const MODES = ['light', 'dark'] as const;

describe('createMarkdownStyle', () => {
  for (const pack of THEME_PACKS) {
    for (const mode of MODES) {
      const colors = pack[mode].colors;
      const style = createMarkdownStyle(colors);

      test(`${pack.id} ${mode}: a display formula sits on the code-block fill`, () => {
        expect(style.math?.backgroundColor).toBe(colors.surfaceRaised);
        expect(style.math?.backgroundColor).toBe(style.codeBlock?.backgroundColor);
      });

      test(`${pack.id} ${mode}: math is inked with the body colour`, () => {
        expect(style.math?.color).toBe(colors.text);
        expect(style.inlineMath?.color).toBe(colors.text);
        expect(style.math?.color).toBe(style.codeBlock?.color);
      });

      test(`${pack.id} ${mode}: a formula keeps the renderer's own size and alignment`, () => {
        // Only the colours are overridden: the light theme has always shown the
        // renderer's defaults for the rest, and this keeps it that way.
        expect(Object.keys(style.math ?? {}).sort()).toEqual(['backgroundColor', 'color']);
        expect(Object.keys(style.inlineMath ?? {})).toEqual(['color']);
      });
    }
  }
});

// A thought reads the same markdown as the answer, in the muted ink: every
// block that carries its own colour goes muted with the paragraph, while the
// fills a fragment needs to be legible on -- code, quote -- stay the answer's.
describe('createThoughtMarkdownStyle', () => {
  for (const pack of THEME_PACKS) {
    for (const mode of MODES) {
      const colors = pack[mode].colors;
      const prose = createMarkdownStyle(colors);
      const thought = createThoughtMarkdownStyle(colors);

      test(`${pack.id} ${mode}: every ink is the muted colour`, () => {
        for (const key of [
          'paragraph',
          'h1',
          'h2',
          'h3',
          'list',
          'blockquote',
          'code',
          'codeBlock',
          'strong',
          'em',
        ] as const) {
          expect((thought[key] as { color?: string } | undefined)?.color).toBe(colors.textMuted);
        }
      });

      test(`${pack.id} ${mode}: the fills are the answer's`, () => {
        expect(thought.codeBlock?.backgroundColor).toBe(prose.codeBlock?.backgroundColor);
        expect(thought.blockquote?.backgroundColor).toBe(prose.blockquote?.backgroundColor);
      });

      test(`${pack.id} ${mode}: it is set smaller than the answer`, () => {
        expect(thought.paragraph?.fontSize).toBeLessThan(prose.paragraph?.fontSize ?? 0);
        expect(thought.h1?.fontSize).toBeLessThan(prose.h1?.fontSize ?? 0);
      });
    }
  }
});

// Every variant, in every palette the app ships.
//
// The compact style is what the transcript's chrome reads in -- a thought, a
// notice, a skill's text, a permission's note, a form's description, a
// checklist item, a structured failure -- and the three tones it is asked for
// are the only thing that varies between them. What is pinned here is that a
// tone is a colour *from the palette*: a hard-coded grey would pass a glance
// in one theme pack and fail in the next eleven, and a fill that did not come
// from the palette is how the display formula ended up on a light slab in the
// dark theme.
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

  for (const pack of THEME_PACKS) {
    for (const mode of MODES) {
      const colors = pack[mode].colors;
      const prose = createMarkdownStyle(colors);
      const tones = {
        body: colors.text,
        muted: colors.textMuted,
        danger: colors.danger,
      } as const;

      for (const [tone, ink] of Object.entries(tones)) {
        const style = createCompactMarkdownStyle(colors, ink);

        test(`${pack.id} ${mode} ${tone}: every ink is that tone, from the palette`, () => {
          for (const key of INKED) {
            expect((style[key] as { color?: string } | undefined)?.color).toBe(ink);
          }
          expect(style.table?.headerTextColor).toBe(ink);
        });

        test(`${pack.id} ${mode} ${tone}: the fills stay the answer's`, () => {
          expect(style.codeBlock?.backgroundColor).toBe(prose.codeBlock?.backgroundColor);
          expect(style.blockquote?.backgroundColor).toBe(prose.blockquote?.backgroundColor);
          expect(style.table?.headerBackgroundColor).toBe(prose.table?.headerBackgroundColor);
          expect(style.math?.backgroundColor).toBe(colors.surfaceRaised);
        });

        test(`${pack.id} ${mode} ${tone}: it is set smaller than the answer, with no rule`, () => {
          expect(style.paragraph?.fontSize).toBeLessThan(prose.paragraph?.fontSize ?? 0);
          expect(style.h1?.fontSize).toBeLessThan(prose.h1?.fontSize ?? 0);
          // A rule drawn across a card is the card's own edge again.
          expect(style.thematicBreak?.height).toBe(0);
        });

        test(`${pack.id} ${mode} ${tone}: a link is still the palette's link colour`, () => {
          // The one ink a tone does not take over: a link that went muted with
          // the paragraph would stop looking like a link.
          expect(style.link?.color).toBe(colors.info);
          expect(style.link?.color).toBe(prose.link?.color);
        });
      }

      test(`${pack.id} ${mode}: a thought is the compact style, muted`, () => {
        expect(createThoughtMarkdownStyle(colors)).toEqual(
          createCompactMarkdownStyle(colors, colors.textMuted)
        );
      });
    }
  }
});

/**
 * The reader's own faces, through the style and into every block that should
 * carry them.
 *
 * One palette is enough here: this is about which family each key gets, and a
 * family does not vary by pack. What does have to hold for every pack is that
 * *nothing* changes when the reader has chosen nothing, which is the first
 * test below.
 */
describe('a reader-supplied face', () => {
  const colors = THEME_PACKS[0].dark.colors;
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
    for (const pack of THEME_PACKS) {
      for (const mode of MODES) {
        const plain = createMarkdownStyle(pack[mode].colors);
        // Not merely "the same colours": the same object. A default argument
        // that changed one key would be a silent restyle of every transcript
        // in the app for readers who never opened the Font sheet.
        expect(createMarkdownStyle(pack[mode].colors, {})).toEqual(plain);
        expect(createMarkdownStyle(pack[mode].colors, { prose: null, mono: null })).toEqual(plain);
        // `'monospace'` is the floor and is never given up: it is the
        // platform's own answer to "draw this as code".
        expect(plain.code?.fontFamily).toBe('monospace');
        expect(plain.codeBlock?.fontFamily).toBe('monospace');
        expect(plain.paragraph?.fontFamily).toBeUndefined();
      }
    }
  });

  test('prose blocks take the interface face, all of them', () => {
    const style = createMarkdownStyle(colors, both);
    for (const key of PROSE_KEYS) {
      expect({ key, family: style[key]?.fontFamily }).toEqual({ key, family: INTERFACE });
    }
  });

  test('code takes the monospace face, inline and fenced', () => {
    const style = createMarkdownStyle(colors, both);
    expect(style.code?.fontFamily).toBe(MONO);
    expect(style.codeBlock?.fontFamily).toBe(MONO);
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

  test('inline spans are left without a family, to inherit their block', () => {
    // `enriched-markdown` resolves a span's family from the block it sits in,
    // so naming it again on each of these would be three more places for the
    // app to disagree with itself -- and a bold run in a paragraph would be
    // the one thing on the page in a different face if one of them drifted.
    const style = createMarkdownStyle(colors, both);
    expect(style.strong?.fontFamily).toBeUndefined();
    expect(style.em?.fontFamily).toBeUndefined();
    expect(style.link?.fontFamily).toBeUndefined();
  });

  test('the compact and thought variants inherit both faces', () => {
    // A thought, a notice, a skill's text, a permission's note: all of them
    // are the compact style, and a reader who changed their font did not mean
    // "except in the quiet parts".
    const compact = createCompactMarkdownStyle(colors, colors.textMuted, both);
    expect(compact.paragraph?.fontFamily).toBe(INTERFACE);
    expect(compact.h1?.fontFamily).toBe(INTERFACE);
    expect(compact.blockquote?.fontFamily).toBe(INTERFACE);
    expect(compact.code?.fontFamily).toBe(MONO);
    expect(compact.codeBlock?.fontFamily).toBe(MONO);

    expect(createThoughtMarkdownStyle(colors, both)).toEqual(compact);
  });
});
