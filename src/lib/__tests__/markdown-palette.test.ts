import { describe, expect, it } from 'bun:test';

import { markdownPaletteKey } from '@/lib/markdown-palette';

const lightStyle = {
  paragraph: { color: '#1c1f24' },
  codeBlock: { backgroundColor: '#f6f8fa' },
};

describe('markdownPaletteKey', () => {
  it('is stable for the same palette', () => {
    expect(markdownPaletteKey(lightStyle)).toBe(markdownPaletteKey({ ...lightStyle }));
  });

  it('changes when the ink changes', () => {
    expect(markdownPaletteKey(lightStyle)).not.toBe(
      markdownPaletteKey({ ...lightStyle, paragraph: { color: '#e6edf3' } })
    );
  });

  it('changes when only a code-block background changes', () => {
    expect(markdownPaletteKey(lightStyle)).not.toBe(
      markdownPaletteKey({ ...lightStyle, codeBlock: { backgroundColor: '#161b22' } })
    );
  });

  it('changes when the reader installs an interface font', () => {
    // The symptom this prevents is a *split* transcript: without the family in
    // the key, blocks already on screen keep the old face and blocks that
    // arrive after the swap get the new one, in one scroller, with no way back
    // but killing the app. The native view reads `markdownStyle` when it is
    // created and never re-applies it.
    expect(markdownPaletteKey(lightStyle)).not.toBe(
      markdownPaletteKey({
        ...lightStyle,
        paragraph: { ...lightStyle.paragraph, fontFamily: 'MuqunUserInterface' },
      })
    );
  });

  it('changes when only the code face changes', () => {
    // A transcript is mostly prose with code in it, so a reader who changes
    // only the monospace slot changes nothing the paragraph colour can see.
    expect(markdownPaletteKey(lightStyle)).not.toBe(
      markdownPaletteKey({
        ...lightStyle,
        codeBlock: { ...lightStyle.codeBlock, fontFamily: 'MuqunUserMono' },
      })
    );
  });
  it('changes for accent-only and geometry changes without changing body ink or code fill', () => {
    for (const override of [
      { table: { headerBackgroundColor: '#a62f1b22', borderColor: '#a62f1b', borderRadius: 2 } },
      { link: { color: '#a62f1b' } },
      { blockquote: { borderColor: '#a62f1b' } },
      { codeBlock: { ...lightStyle.codeBlock, borderRadius: 2 } },
    ]) {
      expect(markdownPaletteKey({ ...lightStyle, ...override })).not.toBe(
        markdownPaletteKey(lightStyle)
      );
    }
  });
  it('does not remount text when viewport-dependent image sizing changes', () => {
    expect(markdownPaletteKey({ ...lightStyle, image: { maxHeight: 400, borderRadius: 8 } })).toBe(
      markdownPaletteKey({ ...lightStyle, image: { maxHeight: 200, borderRadius: 8 } })
    );
  });
});
