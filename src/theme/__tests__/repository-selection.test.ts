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

test('a library with more than fifty small themes survives persistence and relaunch', () => {
  let value: string | undefined;
  let sequence = 0;
  const storage = {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
  const repository = new ThemeRepository(
    storage,
    () => `installed-${++sequence}`,
    () => true
  );
  for (let index = 0; index < 51; index++) {
    const manifest = createThemeStarter();
    manifest.id = `theme-${index}`;
    repository.save(JSON.stringify(manifest));
  }
  const restored = new ThemeRepository(
    storage,
    () => 'unused',
    () => true
  ).hydrate();
  expect(restored.themes).toHaveLength(51);
  expect(restored.themes[50].manifest.id).toBe('theme-50');
});

test('a full library refuses the new import before changing memory or persisted themes', () => {
  let value: string | undefined;
  let oversized = false;
  let sequence = 0;
  const storage = {
    read: () => value,
    write: (next: string) => {
      value = next;
    },
  };
  const paths = {
    encode: (path: string) => (oversized ? 'x'.repeat(16 * 1024 * 1024) : path),
    decode: (path: string) => path,
  };
  const repository = new ThemeRepository(
    storage,
    () => `installed-${++sequence}`,
    () => true,
    paths
  );
  const manifest = createThemeStarter();
  manifest.assets = { picture: { path: 'assets/picture.png' } };
  repository.save(JSON.stringify(manifest), { picture: uri });
  const before = value;
  const snapshot = repository.snapshot();
  oversized = true;
  manifest.id = 'another-theme';
  expect(() => repository.save(JSON.stringify(manifest), { picture: uri })).toThrow(
    'Theme library is full'
  );
  expect(value).toBe(before);
  expect(repository.snapshot()).toEqual(snapshot);
  expect(
    new ThemeRepository(
      storage,
      () => 'unused',
      () => true,
      paths
    ).hydrate().themes
  ).toHaveLength(1);
});

test('an externally oversized record is never overwritten during recovery', () => {
  const value = 'x'.repeat(16 * 1024 * 1024 + 1);
  let writes = 0;
  const repository = new ThemeRepository(
    {
      read: () => value,
      write: () => {
        writes++;
      },
    },
    () => 'unused'
  );
  expect(repository.hydrate().themes).toEqual([]);
  expect(writes).toBe(0);
});
