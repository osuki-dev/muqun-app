import { describe, expect, test } from 'bun:test';

import { directFontUrl, sniffFontFormat } from '@/theme/user-font-file';

describe('directFontUrl', () => {
  test('a GitHub file page becomes the raw file, escaped slashes and all', () => {
    expect(
      directFontUrl(
        'https://github.com/googlefonts/noto-cjk/blob/main/Serif%2FSubsetOTF%2FTC%2FNotoSerifTC-Light.otf'
      )
    ).toBe(
      'https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Serif/SubsetOTF/TC/NotoSerifTC-Light.otf'
    );
    expect(directFontUrl('https://github.com/o/r/raw/v1.2/fonts/My%20Font.ttf')).toBe(
      'https://raw.githubusercontent.com/o/r/v1.2/fonts/My%20Font.ttf'
    );
  });

  test('a GitLab blob and a Gitea src view become their raw forms', () => {
    expect(directFontUrl('https://gitlab.com/g/sub/r/-/blob/main/f/a.otf')).toBe(
      'https://gitlab.com/g/sub/r/-/raw/main/f/a.otf'
    );
    expect(directFontUrl('https://git.example.com/o/r/src/branch/main/f/a.ttf')).toBe(
      'https://git.example.com/o/r/raw/branch/main/f/a.ttf'
    );
  });

  test('anything else is left exactly as it came', () => {
    expect(directFontUrl('  https://example.com/fonts/a.ttf?v=2  ')).toBe(
      'https://example.com/fonts/a.ttf?v=2'
    );
    expect(directFontUrl('https://raw.githubusercontent.com/o/r/main/a.ttf')).toBe(
      'https://raw.githubusercontent.com/o/r/main/a.ttf'
    );
    expect(directFontUrl('not a url')).toBe('not a url');
  });
});

describe('sniffFontFormat', () => {
  const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

  test('a web page is named as one, not as an unknown file', () => {
    expect(sniffFontFormat(bytes('<!DOCTYPE html><html>'))).toBe('webpage');
    expect(sniffFontFormat(bytes('  <html lang="en">'))).toBe('webpage');
    expect(sniffFontFormat(bytes('PKxx zip archive bytes'))).toBe('unknown');
  });
});
