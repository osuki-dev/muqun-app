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

  it('survives a style with nothing set', () => {
    expect(markdownPaletteKey({})).toBe('|');
  });
});
