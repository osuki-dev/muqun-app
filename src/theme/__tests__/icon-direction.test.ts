import { describe, expect, test } from 'bun:test';

import { resolveThemeIcon } from '../icon-direction';

const usable = (uri: string | undefined): uri is string =>
  typeof uri === 'string' && uri.startsWith('file:///') && uri !== 'file:///broken.png';
const choices = [{ name: 'chrome.conversation' }, { name: 'home.arrow', direction: 'up' }] as const;
const assets = {
  bubble: 'file:///bubble.png',
  arrow: 'file:///arrow.png',
  broken: 'file:///broken.png',
  remote: 'https://example.com/arrow.png',
};

describe('resolveThemeIcon', () => {
  test('prefers the named glyph', () => {
    const manifest = {
      icons: {
        'chrome.conversation': { asset: 'bubble', render: 'template' as const },
        'home.arrow': { asset: 'arrow', render: 'template' as const },
      },
      iconDirections: { 'home.arrow': 'right' as const },
    };
    expect(resolveThemeIcon(manifest, assets, choices, usable)).toEqual({
      name: 'chrome.conversation',
      uri: 'file:///bubble.png',
      render: 'template',
      rotation: 0,
    });
  });

  test('turns the alternate arrow to point up from its drawn direction', () => {
    const manifest = {
      icons: { 'home.arrow': { asset: 'arrow', render: 'original' as const } },
      iconDirections: { 'home.arrow': 'right' as const },
    };
    expect(resolveThemeIcon(manifest, assets, choices, usable)).toMatchObject({
      name: 'home.arrow',
      rotation: 270,
      render: 'original',
    });
  });

  test('skips an arrow whose drawn direction is unknown', () => {
    const manifest = { icons: { 'home.arrow': { asset: 'arrow', render: 'template' as const } } };
    expect(resolveThemeIcon(manifest, assets, choices, usable)).toBeNull();
  });

  test('skips glyphs that cannot be drawn and falls through to the next', () => {
    const manifest = {
      icons: {
        'chrome.conversation': { asset: 'broken', render: 'template' as const },
        'home.arrow': { asset: 'arrow', render: 'template' as const },
      },
      iconDirections: { 'home.arrow': 'up' as const },
    };
    expect(resolveThemeIcon(manifest, assets, choices, usable)?.name).toBe('home.arrow');
    const remote = {
      icons: { 'chrome.conversation': { asset: 'remote', render: 'template' as const } },
    };
    expect(resolveThemeIcon(remote, assets, choices, usable)).toBeNull();
    const missing = {
      icons: { 'chrome.conversation': { asset: 'absent', render: 'template' as const } },
    };
    expect(resolveThemeIcon(missing, assets, choices, usable)).toBeNull();
  });

  test('draws the app glyph without a theme', () => {
    expect(resolveThemeIcon(undefined, undefined, choices, usable)).toBeNull();
  });
});
