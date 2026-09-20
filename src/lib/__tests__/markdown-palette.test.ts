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

  it('tells two different faces apart', () => {
    const inter = markdownPaletteKey({
      ...lightStyle,
      paragraph: { ...lightStyle.paragraph, fontFamily: 'MuqunUserInterface' },
      codeBlock: { ...lightStyle.codeBlock, fontFamily: 'MuqunUserMono' },
    });
    const system = markdownPaletteKey({
      ...lightStyle,
      codeBlock: { ...lightStyle.codeBlock, fontFamily: 'monospace' },
    });
    expect(inter).not.toBe(system);
  });

  it('survives a style with nothing set', () => {
    expect(markdownPaletteKey({})).toBe('|||');
  });
});
