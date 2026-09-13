import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
import { auditThemeContrast, contrastRatio } from '@/theme/contrast';
import { ThemeRepository } from '@/theme/repository';
import { parseThemeManifest } from '@/theme/schema';
import { cloneThemeData } from '@/theme/clone';

/**
 * A second theme needs a second author id. Re-importing an id replaces the
 * installation it names, so two starters that differ only in their colours
 * would be one row, not two.
 */
function starterWithId(id: string): ReturnType<typeof createThemeStarter> {
  return { ...createThemeStarter(), id, name: id };
}

function setup() {
  let value: string | undefined;
  let fail = false;
  let sequence = 0;
  const storage = {
    read: () => value,
    write: (next: string) => {
      if (fail) throw new Error('Disk full');
      value = next;
    },
  };
  return {
    repository: new ThemeRepository(storage, () => `installed-${++sequence}`),
    storage,
    fail: () => {
      fail = true;
    },
  };
}

test('corrupt and unsupported hydration never grants garbage collection authority', () => {
  for (const value of ['', '{bad', JSON.stringify({ version: 99, themes: [] })]) {
    const repository = new ThemeRepository({ read: () => value, write: () => {} }, () => 'id');
    expect(repository.hasAuthoritativeAssetReferences()).toBe(false);
    expect(repository.hydrate().themes).toEqual([]);
    expect(repository.hasAuthoritativeAssetReferences()).toBe(false);
  }
  const { repository } = setup();
  repository.hydrate();
  expect(repository.hasAuthoritativeAssetReferences()).toBe(true);
});

test('filtered hydration preserves files until an actual successful metadata write', () => {
  const manifest = createThemeStarter();
  manifest.assets = { picture: { path: 'assets/picture.png' } };
  let value = JSON.stringify({
    version: 1,
    themes: [{ id: 'old', manifest, assets: { picture: 'file:///old.png' } }],
    selection: { kind: 'custom', id: 'old' },
    previous: null,
  });
  let fail = true;
  const repository = new ThemeRepository(
    {
      read: () => value,
      write: (next) => {
        if (fail) throw new Error('disk full');
        value = next;
      },
    },
    () => 'new',
    () => false
  );
  const before = value;
  expect(repository.hydrate().themes).toEqual([]);
  expect(repository.hasAuthoritativeAssetReferences()).toBe(false);
  expect(value).toBe(before);
  expect(() => repository.apply({ kind: 'builtin', id: 'osuki' })).toThrow('disk full');
  expect(repository.hasAuthoritativeAssetReferences()).toBe(false);
  expect(value).toBe(before);
  fail = false;
  repository.apply({ kind: 'builtin', id: 'osuki' });
  expect(repository.hasAuthoritativeAssetReferences()).toBe(true);
  expect(value).not.toBe(before);
});

test('successful complete hydration grants authority and later read failure revokes it', () => {
  let fail = false;
  const repository = new ThemeRepository(
    {
      read: () => {
        if (fail) throw new Error('read failed');
        return JSON.stringify({ version: 1, themes: [], selection: null, previous: null });
      },
      write: () => {},
    },
    () => 'id'
  );
  repository.hydrate();
  expect(repository.hasAuthoritativeAssetReferences()).toBe(true);
  fail = true;
  expect(() => repository.hydrate()).toThrow('read failed');
  expect(repository.hasAuthoritativeAssetReferences()).toBe(false);
});

test('JSON theme clones preserve valid data and detach every mutable layer', () => {
  const manifest = createThemeStarter();
  const copy = cloneThemeData(manifest);
  expect(copy).toEqual(manifest);
  expect(copy).not.toBe(manifest);
  expect(copy.variants.light.colors).not.toBe(manifest.variants.light.colors);
  copy.variants.light.colors.text = '#112233';
  expect(manifest.variants.light.colors.text).not.toBe('#112233');
});

test('a transient storage read failure is retryable and never overwrites the library', () => {
  const { repository, storage } = setup();
  const installed = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'custom', id: installed.id });
  const before = storage.read();
  let fail = true;
  const reopened = new ThemeRepository(
    {
      ...storage,
      read() {
        if (fail) throw new Error('Read unavailable');
        return storage.read();
      },
    },
    () => 'later'
  );
  expect(() => reopened.hydrate()).toThrow('Read unavailable');
  expect(storage.read()).toBe(before);
  fail = false;
  reopened.hydrate();
  expect(reopened.active()?.installationId).toBe(installed.id);
});

test('contrast calculation and complete starter readability', () => {
  expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
  expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBe(1);
  expect(auditThemeContrast(createThemeStarter())).toEqual([]);
});

test('save does not apply, and re-importing an author ID replaces that installation', () => {
  const { repository } = setup();
  const text = JSON.stringify(createThemeStarter());
  const a = repository.save(text);
  const b = repository.save(text);
  // Re-importing is iteration, not a second theme: one row, one installation id.
  expect(b.id).toBe(a.id);
  expect(repository.snapshot().themes).toHaveLength(1);
  expect(repository.active()).toBeNull();
  repository.apply({ kind: 'custom', id: a.id });
  expect(repository.active()?.installationId).toBe(a.id);
  expect(repository.active()).toBe(repository.active());
});

test('a different author ID is still its own installation', () => {
  const { repository } = setup();
  const starter = createThemeStarter();
  const a = repository.save(JSON.stringify(starter));
  const b = repository.save(JSON.stringify({ ...starter, id: 'other-theme', name: 'Other' }));
  expect(b.id).not.toBe(a.id);
  expect(repository.snapshot().themes).toHaveLength(2);
});

test('replacing a theme carries its new manifest and drops the old images', () => {
  const { repository } = setup();
  const starter = createThemeStarter();
  const first = repository.save(JSON.stringify(starter));
  expect(first.manifest.name).toBe(starter.name);
  const renamed = { ...starter, name: 'Second draft' };
  const second = repository.save(JSON.stringify(renamed));
  expect(second.manifest.name).toBe('Second draft');
  expect(repository.snapshot().themes[0].manifest.name).toBe('Second draft');
  // The replacement's asset set is the new one outright, not a merge.
  expect(repository.snapshot().themes[0].assets).toEqual({});
});

test('a theme that is applied stays applied when it is re-imported', () => {
  const { repository } = setup();
  const starter = createThemeStarter();
  const installed = repository.save(JSON.stringify(starter));
  repository.apply({ kind: 'custom', id: installed.id });
  repository.save(JSON.stringify({ ...starter, name: 'Updated live' }));
  // The selection points at the installation, so an update lands on screen
  // rather than orphaning the choice the reader already made.
  expect(repository.active()?.installationId).toBe(installed.id);
  expect(repository.active()?.manifest.name).toBe('Updated live');
});

test('the reader appearance preferences survive a re-import', () => {
  const { repository } = setup();
  const starter = createThemeStarter();
  const installed = repository.save(JSON.stringify(starter));
  repository.setTerminalBackgroundOpacity(installed.id, 0.9);
  repository.setHideHomeLogo(installed.id, true);
  repository.save(JSON.stringify({ ...starter, name: 'Next' }));
  const [theme] = repository.snapshot().themes;
  // Opacity and home identity are the reader's choices about this theme, not
  // anything the author shipped, so a new version must not silently reset them.
  expect(theme.terminalBackgroundOpacity).toBe(0.9);
  expect(theme.hideHomeLogo).toBe(true);
  expect(theme.manifest.name).toBe('Next');
});

test('failed persistence never changes current appearance', () => {
  const { repository, fail } = setup();
  const installed = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'builtin', id: 'catppuccin' });
  const before = repository.snapshot();
  fail();
  expect(() => repository.apply({ kind: 'custom', id: installed.id })).toThrow('Disk full');
  expect(repository.snapshot()).toEqual(before);
});

test('selection survives hydration; undo restores the previous selection', () => {
  const { repository, storage } = setup();
  const installed = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'builtin', id: 'catppuccin' });
  repository.apply({ kind: 'custom', id: installed.id });
  const reopened = new ThemeRepository(storage, () => 'new-id');
  reopened.hydrate();
  expect(reopened.active()?.installationId).toBe(installed.id);
  reopened.undo();
  expect(reopened.snapshot().selection).toEqual({ kind: 'builtin', id: 'catppuccin' });
});

test('unreadable themes can be saved for repair but not activated', () => {
  const { repository } = setup();
  const theme = createThemeStarter();
  theme.variants.dark.colors.text = theme.variants.dark.colors.background;
  const installed = repository.save(JSON.stringify(theme));
  expect(() => repository.apply({ kind: 'custom', id: installed.id })).toThrow('contrast');
  expect(repository.active()).toBeNull();
});

test('hydration discards an unreadable undo target without deleting the saved theme', () => {
  const { repository, storage } = setup();
  const theme = starterWithId('unreadable-theme');
  theme.variants.dark.colors.text = theme.variants.dark.colors.background;
  const unreadable = repository.save(JSON.stringify(theme));
  const current = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'custom', id: current.id });
  const raw = repository.snapshot();
  raw.previous = { kind: 'custom', id: unreadable.id };
  storage.write(JSON.stringify(raw));

  const reopened = new ThemeRepository(storage, () => 'new-id');
  const restored = reopened.hydrate();
  expect(restored.themes).toHaveLength(2);
  expect(restored.previous).toBeNull();
  expect(reopened.active()?.installationId).toBe(current.id);
  expect(reopened.undo().selection).toBeNull();
  expect(reopened.active()).toBeNull();
});

test('an unreadable persisted selection recovers to a readable previous selection', () => {
  const { repository, storage } = setup();
  const theme = starterWithId('unreadable-theme');
  theme.variants.light.colors.text = theme.variants.light.colors.background;
  const unreadable = repository.save(JSON.stringify(theme));
  const previous = repository.save(JSON.stringify(createThemeStarter()));
  const raw = repository.snapshot();
  raw.selection = { kind: 'custom', id: unreadable.id };
  raw.previous = { kind: 'custom', id: previous.id };
  storage.write(JSON.stringify(raw));

  repository.hydrate();
  expect(repository.active()?.installationId).toBe(previous.id);
  expect(repository.snapshot().themes).toHaveLength(2);
});

test('removing the active theme cannot restore an unreadable persisted previous theme', () => {
  const { repository, storage } = setup();
  const theme = starterWithId('unreadable-theme');
  theme.variants.dark.colors.text = theme.variants.dark.colors.background;
  const unreadable = repository.save(JSON.stringify(theme));
  const current = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'custom', id: current.id });
  const raw = repository.snapshot();
  raw.previous = { kind: 'custom', id: unreadable.id };
  storage.write(JSON.stringify(raw));

  repository.hydrate();
  expect(repository.remove(current.id).selection).toBeNull();
  expect(repository.snapshot().themes.map((theme) => theme.id)).toEqual([unreadable.id]);
});

test('failed undo persistence preserves both the active selection and the undo target', () => {
  const { repository, storage, fail } = setup();
  const installed = repository.save(JSON.stringify(createThemeStarter()));
  repository.apply({ kind: 'builtin', id: 'catppuccin' });
  repository.apply({ kind: 'custom', id: installed.id });
  const before = repository.snapshot();
  const persisted = storage.read();
  fail();

  expect(() => repository.undo()).toThrow('Disk full');
  expect(repository.snapshot()).toEqual(before);
  expect(storage.read()).toBe(persisted);
  expect(repository.active()?.installationId).toBe(installed.id);
});

test('unresolved remote images cannot enter the installed library', () => {
  const { repository } = setup();
  const theme = {
    ...createThemeStarter(),
    assets: { paper: { url: 'https://example.invalid/paper.png' } },
  };
  expect(() => repository.save(JSON.stringify(theme))).toThrow('installed locally');
  expect(() =>
    repository.save(JSON.stringify(theme), { paper: 'https://example.invalid/paper.png' })
  ).toThrow('installed locally');
});

test('color export is parseable and excludes image paths, source links and home identity', () => {
  const { repository } = setup();
  const theme = {
    ...createThemeStarter(),
    source: 'https://example.invalid/theme?private=1',
    materials: { default: 'solid' },
    assets: { paper: { path: 'assets/paper.png' } },
    decoration: { 'shell.background': { asset: 'paper' } },
  };
  const installed = repository.save(JSON.stringify(theme), {
    paper: 'file:///app-owned/theme/paper.png',
  });
  const exported = parseThemeManifest(repository.exportColors(installed.id));
  expect(exported.variants).toEqual(theme.variants);
  expect(exported.assets).toBeUndefined();
  expect(exported.source).toBeUndefined();
  expect(exported.homeIdentity).toBeUndefined();
  expect(exported.materials).toBeUndefined();
});

test('removal and corrupt persistence fall back without discarding unrelated valid themes', () => {
  const { repository, storage } = setup();
  const a = repository.save(JSON.stringify(createThemeStarter()));
  const b = repository.save(JSON.stringify(starterWithId('second-theme')));
  repository.apply({ kind: 'custom', id: a.id });
  repository.apply({ kind: 'custom', id: b.id });
  repository.remove(b.id);
  expect(repository.active()?.installationId).toBe(a.id);
  const raw = JSON.parse(storage.read()!);
  raw.themes.push({ id: 'broken', manifest: {}, assets: {} });
  storage.write(JSON.stringify(raw));
  repository.hydrate();
  expect(repository.snapshot().themes).toHaveLength(1);
  storage.write('{');
  expect(repository.hydrate().selection).toBeNull();
});
