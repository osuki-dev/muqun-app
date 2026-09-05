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

mockModule('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0' },
  StyleSheet: { hairlineWidth: 0.5 },
}));

const { createMarkdownStyle } = await import('../markdown-style');

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
