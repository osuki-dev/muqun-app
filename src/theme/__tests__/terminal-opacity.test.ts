import { expect, test } from 'bun:test';
import { createThemeStarter } from '../authoring';
import { effectiveThemeManifest, ThemeRepository } from '../repository';
import { parseThemeManifest } from '../schema';
import { packTheme, unpackTheme } from '../package';
import { themeOpacityPolicy } from '../opacity-policy';
const starterPolicies = Object.values(createThemeStarter().variants).map(themeOpacityPolicy);
const terminalFloor = Math.max(...starterPolicies.map((policy) => policy.terminal.minimum));

function setup() {
  let value: string | undefined;
  let fail = false;
  const storage = {
    read: () => value,
    write: (next: string) => {
      if (fail) throw new Error('disk full');
      value = next;
    },
  };
  return {
    storage,
    repo: new ThemeRepository(storage, () => 'installed'),
    fail: () => {
      fail = true;
    },
  };
}

test('older packs stay opaque by default and each mode can author its own finite opacity', () => {
  const manifest = createThemeStarter();
  expect(manifest.variants.light.terminal.backgroundOpacity ?? 1).toBe(1);
  expect(manifest.variants.dark.terminal.backgroundOpacity ?? 1).toBe(1);
  for (const opacity of [0, 0.25, 1]) {
    manifest.variants.light.terminal.backgroundOpacity = opacity;
    manifest.variants.dark.terminal.backgroundOpacity = 1 - opacity;
    const parsed = parseThemeManifest(JSON.stringify(manifest));
    expect(parsed.variants.light.terminal.backgroundOpacity).toBe(opacity);
    expect(parsed.variants.dark.terminal.backgroundOpacity).toBe(1 - opacity);
  }
  for (const opacity of [-0.1, 1.1, NaN, Infinity]) {
    manifest.variants.light.terminal.backgroundOpacity = opacity;
    expect(() => parseThemeManifest(JSON.stringify(manifest))).toThrow();
  }
});

test('override persists, invalidates active cache, and reset restores authored modes without mutation', () => {
  const { repo, storage } = setup();
  const manifest = createThemeStarter();
  manifest.variants.light.terminal.backgroundOpacity = 0.3;
  manifest.variants.dark.terminal.backgroundOpacity = 0.6;
  repo.save(JSON.stringify(manifest));
  repo.apply({ kind: 'custom', id: 'installed' });
  const original = repo.active();
  repo.setTerminalBackgroundOpacity('installed', 0);
  expect(repo.active()).not.toBe(original);
  expect(original?.manifest.variants.light.terminal.backgroundOpacity).toBe(
    Math.max(0.3, terminalFloor)
  );
  expect(repo.active()?.manifest.variants.light.terminal.backgroundOpacity).toBe(
    Math.max(0, terminalFloor)
  );
  expect(repo.active()?.manifest.variants.dark.terminal.backgroundOpacity).toBe(
    Math.max(0, terminalFloor)
  );
  expect(repo.snapshot().themes[0].manifest).toEqual(manifest);
  const reopened = new ThemeRepository(storage, () => 'later');
  reopened.hydrate();
  expect(reopened.snapshot().themes[0].terminalBackgroundOpacity).toBe(0);
  expect(reopened.active()?.manifest.variants.dark.terminal.backgroundOpacity).toBe(
    Math.max(0, terminalFloor)
  );
  reopened.setTerminalBackgroundOpacity('installed', undefined);
  expect(reopened.snapshot().themes[0].terminalBackgroundOpacity).toBeUndefined();
  expect(reopened.active()?.manifest.variants.light.terminal.backgroundOpacity).toBe(
    Math.max(0.3, terminalFloor)
  );
  expect(reopened.active()?.manifest.variants.dark.terminal.backgroundOpacity).toBe(
    Math.max(0.6, terminalFloor)
  );
});

test('failed and invalid preference writes preserve stored and compiled state', () => {
  const { repo, storage, fail } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  repo.apply({ kind: 'custom', id: 'installed' });
  const compiled = repo.active();
  const before = storage.read();
  for (const invalid of [-1, 2, NaN, Infinity])
    expect(() => repo.setTerminalBackgroundOpacity('installed', invalid)).toThrow();
  expect(() => repo.setTerminalBackgroundOpacity('missing', 0.5)).toThrow('no longer installed');
  fail();
  expect(() => repo.setTerminalBackgroundOpacity('installed', 0.5)).toThrow('disk full');
  expect(repo.active()).toBe(compiled);
  expect(storage.read()).toBe(before);
});

test('invalid persisted preferences are ignored without discarding valid themes or assets', () => {
  const { repo, storage } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  for (const invalid of [-1, 2, null, '0.5', {}]) {
    const raw = JSON.parse(storage.read()!);
    raw.themes[0].terminalBackgroundOpacity = invalid;
    const reopened = new ThemeRepository(
      { read: () => JSON.stringify(raw), write: () => {} },
      () => 'id'
    );
    reopened.hydrate();
    expect(reopened.snapshot().themes).toHaveLength(1);
    expect(reopened.snapshot().themes[0].terminalBackgroundOpacity).toBeUndefined();
    expect(reopened.hasAuthoritativeAssetReferences()).toBe(true);
  }
});

test('color and package exports carry effective override without rewriting author data', () => {
  const { repo } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  repo.setTerminalBackgroundOpacity('installed', 0.42);
  const installed = repo.snapshot().themes[0];
  const colors = parseThemeManifest(repo.exportColors('installed'));
  const packaged = unpackTheme(
    packTheme({ manifest: effectiveThemeManifest(installed), assets: {} })
  );
  for (const mode of ['light', 'dark'] as const) {
    expect(colors.variants[mode].terminal.backgroundOpacity).toBe(Math.max(0.42, terminalFloor));
    expect(packaged.manifest.variants[mode].terminal.backgroundOpacity).toBe(
      Math.max(0.42, terminalFloor)
    );
    expect(installed.manifest.variants[mode].terminal.backgroundOpacity).toBeUndefined();
  }
});
