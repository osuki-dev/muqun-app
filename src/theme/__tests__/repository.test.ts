import { expect, test } from 'bun:test';

import { createThemeStarter } from '@/theme/authoring';
import { auditThemeContrast, contrastRatio } from '@/theme/contrast';
import { ThemeRepository } from '@/theme/repository';
import { parseThemeManifest } from '@/theme/schema';
import { cloneThemeData } from '@/theme/clone';

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

test('save does not apply, duplicate author IDs create independent installations', () => {
  const { repository } = setup();
  const text = JSON.stringify(createThemeStarter());
  const a = repository.save(text);
  const b = repository.save(text);
  expect(a.id).not.toBe(b.id);
  expect(repository.active()).toBeNull();
  repository.apply({ kind: 'custom', id: a.id });
  expect(repository.active()?.installationId).toBe(a.id);
  expect(repository.active()).toBe(repository.active());
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
  const theme = createThemeStarter();
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
  const theme = createThemeStarter();
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
  const theme = createThemeStarter();
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
});

test('removal and corrupt persistence fall back without discarding unrelated valid themes', () => {
  const { repository, storage } = setup();
  const a = repository.save(JSON.stringify(createThemeStarter()));
  const b = repository.save(JSON.stringify(createThemeStarter()));
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
