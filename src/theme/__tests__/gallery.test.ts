import { expect, test } from 'bun:test';

import { loadThemeIndex, parseThemeIndex, THEME_GALLERY_BASE, themePackageUrl } from '../gallery';

/** The catalogue as muqun.dev actually serves it, reduced to one entry. */
const live = {
  format: 'muqun-themes-index',
  themes: [
    {
      id: 'one-piece-grand-voyage',
      name: 'One Piece — Grand Voyage',
      version: '1.0.0',
      author: 'Muqun custom theme · AI-assisted fan art',
      license: 'Unofficial fan art, no rights granted -- see CREDITS.md',
      description: 'Warm ocean-adventure fan art.',
      tags: ['anime', 'illustrated'],
      package: 'dist/one-piece-grand-voyage.muqun-theme',
      bytes: 4007258,
      sha256: 'e22a5b7769235aab6bef7c35cee81e7c716721f7ae1e780313d387004744e439',
      assets: 10,
    },
  ],
};

test('reads the catalogue muqun.dev serves', () => {
  const [entry] = parseThemeIndex(JSON.stringify(live));
  expect(entry?.id).toBe('one-piece-grand-voyage');
  expect(entry?.bytes).toBe(4007258);
  expect(entry?.tags).toEqual(['anime', 'illustrated']);
  // Kept relative. Resolving at parse time would put a URL in a field that
  // nothing re-screens afterwards; `themePackageUrl` is the one door.
  expect(entry?.package).toBe('dist/one-piece-grand-voyage.muqun-theme');
});

test('one malformed row does not lose the rest', () => {
  const entries = parseThemeIndex(
    JSON.stringify({
      format: 'muqun-themes-index',
      themes: [
        { id: 'no-package', name: 'x', version: '1.0.0', bytes: 1 },
        { id: 'no-bytes', name: 'x', version: '1.0.0', package: 'dist/x.muqun-theme' },
        {
          id: 'bytes-not-a-number',
          name: 'x',
          version: '1.0.0',
          package: 'dist/x.muqun-theme',
          bytes: '4',
        },
        null,
        'nonsense',
        live.themes[0],
      ],
    })
  );
  // A reader looking at a gallery should see the theme that is fine rather than
  // an error about the ones that are not.
  expect(entries.map((entry) => entry.id)).toEqual(['one-piece-grand-voyage']);
});

test('a document that is not the catalogue is refused rather than half-read', () => {
  expect(() => parseThemeIndex('not json')).toThrow('catalogue');
  expect(() => parseThemeIndex(JSON.stringify({ themes: [] }))).toThrow('catalogue');
  expect(() => parseThemeIndex(JSON.stringify({ format: 'something-else', themes: [] }))).toThrow(
    'catalogue'
  );
});

test('optional fields are carried only when they are the right shape', () => {
  const [entry] = parseThemeIndex(
    JSON.stringify({
      format: 'muqun-themes-index',
      themes: [
        {
          id: 'x',
          name: 'X',
          version: '1.0.0',
          package: 'dist/x.muqun-theme',
          bytes: 10,
          tags: ['keep', 7, { no: true }],
          sha256: 'not-a-digest',
          assets: 1.5,
          description: '',
        },
      ],
    })
  );
  expect(entry?.tags).toEqual(['keep']);
  expect(entry?.sha256).toBeUndefined();
  expect(entry?.assets).toBeUndefined();
  // An empty string is not a description; carrying it would draw a blank line.
  expect(entry?.description).toBeUndefined();
});

test('a package address has to stay on the catalogue', () => {
  expect(themePackageUrl({ package: 'dist/x.muqun-theme' })).toBe(
    `${THEME_GALLERY_BASE}dist/x.muqun-theme`
  );
  // The whole point of screening at the door: an entry cannot send this app to
  // a host the reader never chose, whether it says so absolutely...
  expect(() => themePackageUrl({ package: 'https://example.invalid/x.muqun-theme' })).toThrow();
  // ...or by climbing out with a relative path.
  expect(() => themePackageUrl({ package: '../../evil' })).toThrow('catalogue');
  expect(() => themePackageUrl({ package: 'http://muqun.dev/api/themes/x' })).toThrow();
});

test('a catalogue that answers with anything but 200 is an error, not an empty gallery', async () => {
  const transport = {
    get: async () => ({ status: 503, bytes: new Uint8Array() }),
  };
  await expect(loadThemeIndex(transport, new AbortController().signal)).rejects.toThrow(
    'not available'
  );
});

test('the index is read through the transport, bounded, at the published address', async () => {
  const seen: { url: string; maxBytes: number }[] = [];
  const transport = {
    get: async (url: string, options: { signal: AbortSignal; maxBytes: number }) => {
      seen.push({ url, maxBytes: options.maxBytes });
      return { status: 200, bytes: new TextEncoder().encode(JSON.stringify(live)) };
    },
  };
  const entries = await loadThemeIndex(transport, new AbortController().signal);
  expect(entries).toHaveLength(1);
  expect(seen[0]?.url).toBe(`${THEME_GALLERY_BASE}index.json`);
  expect(seen[0]?.maxBytes).toBeGreaterThan(0);
});

test('an already-aborted read never reaches the network', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  const transport = {
    get: async () => {
      called = true;
      return { status: 200, bytes: new Uint8Array() };
    },
  };
  await expect(loadThemeIndex(transport, controller.signal)).rejects.toThrow();
  expect(called).toBe(false);
});
