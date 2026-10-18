import { expect, test } from 'bun:test';
import { ThemeRepository } from '../repository';
import { createThemeStarter } from '../starter';

const uri = 'file:///data/user/0/dev.osuki.muqun/files/theme-assets-v1/picture.png';

function stored(selection: unknown, previous: unknown): string {
  const manifest = createThemeStarter();
  manifest.assets = { picture: { path: 'assets/picture.png' } };
  return JSON.stringify({
    version: 1,
    themes: [{ id: 'installed', manifest, assets: { picture: uri } }],
    selection,
    previous,
  });
}

function hydrate(value: string) {
  return new ThemeRepository(
    { read: () => value, write: () => {} },
    () => 'new',
    (path) => path === uri
  ).hydrate();
}

test('the built-in theme chosen after a custom one survives a relaunch', () => {
  // `resetToDefault` stores a null selection with the custom theme as `previous`.
  const library = hydrate(stored(null, { kind: 'custom', id: 'installed' }));
  expect(library.selection).toBeNull();
  expect(library.previous).toEqual({ kind: 'custom', id: 'installed' });
});

test('a selection that is no longer readable falls back to the one before it', () => {
  const library = hydrate(
    stored({ kind: 'custom', id: 'gone' }, { kind: 'custom', id: 'installed' })
  );
  expect(library.selection).toEqual({ kind: 'custom', id: 'installed' });
});
