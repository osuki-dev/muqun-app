import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUILTIN_THEME_INSTALLATION_ID,
  ThemeRepository,
  type InstalledTheme,
} from '@/theme/repository';
import { parseThemeManifest } from '@/theme/schema';
import { createThemeStarter } from '@/theme/starter';
import { compareThemeVersions } from '@/theme/version';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const bundled = parseThemeManifest(
  readFileSync(join(root, 'assets', 'themes', 'cover-courier', 'theme.json'), 'utf8')
);

function builtin(): InstalledTheme {
  return {
    id: BUILTIN_THEME_INSTALLATION_ID,
    manifest: bundled,
    assets: Object.fromEntries(
      Object.keys(bundled.assets ?? {}).map((id) => [id, `bundled-${id}`])
    ),
  };
}

/** A gallery copy of the same pack, written before the slot rename. */
function galleryCopy(version: string) {
  return JSON.stringify({
    ...createThemeStarter(),
    id: bundled.id,
    name: bundled.name,
    version,
    assets: { paper: { path: 'assets/paper.webp' } },
    variantDecorations: {
      light: { 'shell.background': { asset: 'paper', fit: 'cover', opacity: 0.5 } },
      dark: {},
    },
  });
}

function setup() {
  let value: string | undefined;
  let sequence = 0;
  const repository = new ThemeRepository(
    { read: () => value, write: (next) => void (value = next) },
    () => `installed-${++sequence}`,
    undefined,
    undefined,
    builtin()
  );
  repository.hydrate();
  return repository;
}

test('an older installed copy of the bundled pack is worn as the bundled version', () => {
  const repository = setup();
  const installed = repository.save(galleryCopy('1.0.5'), { paper: 'file:///paper.webp' });
  repository.apply({ kind: 'custom', id: installed.id });
  repository.setTerminalBackgroundOpacity(installed.id, 0.4);

  const worn = repository.activeInstalled();
  expect(worn?.id).toBe(installed.id);
  expect(worn?.manifest.version).toBe(bundled.version);
  expect(worn?.manifest.variantDecorations?.light?.['shell.wallpaper']).toBeDefined();
  expect(worn?.assets).toEqual(builtin().assets);
  expect(worn?.terminalBackgroundOpacity).toBe(0.4);
  expect(repository.active()?.installationId).toBe(installed.id);
  expect(repository.active()?.manifest.version).toBe(bundled.version);
});

test('the stored record is left as the reader installed it', () => {
  const repository = setup();
  const installed = repository.save(galleryCopy('1.0.5'), { paper: 'file:///paper.webp' });
  repository.apply({ kind: 'custom', id: installed.id });
  const stored = repository.snapshot().themes[0];
  expect(stored.manifest.version).toBe('1.0.5');
  expect(stored.assets).toEqual({ paper: 'file:///paper.webp' });
});

test("an installed copy newer than the bundled one stays the reader's", () => {
  const repository = setup();
  const [major, minor, patch] = bundled.version.split('.').map(Number);
  const newer = `${major}.${minor}.${patch + 1}`;
  const installed = repository.save(galleryCopy(newer), { paper: 'file:///paper.webp' });
  repository.apply({ kind: 'custom', id: installed.id });
  expect(repository.activeInstalled()?.manifest.version).toBe(newer);
  expect(repository.activeInstalled()?.assets).toEqual({ paper: 'file:///paper.webp' });
});

test('another pack is never confused with the bundled one', () => {
  const repository = setup();
  const other = JSON.stringify({ ...createThemeStarter(), id: 'other-pack', version: '0.0.1' });
  const installed = repository.save(other, {});
  repository.apply({ kind: 'custom', id: installed.id });
  expect(repository.activeInstalled()?.manifest.id).toBe('other-pack');
});

test('versions order by their three numbers, then release over pre-release', () => {
  expect(compareThemeVersions('1.0.6', '1.0.5')).toBeGreaterThan(0);
  expect(compareThemeVersions('1.0.5', '1.0.6')).toBeLessThan(0);
  expect(compareThemeVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
  expect(compareThemeVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
  expect(compareThemeVersions('1.0.6', '1.0.6')).toBe(0);
  expect(compareThemeVersions('1.0.6', '1.0.6-beta.1')).toBeGreaterThan(0);
  expect(compareThemeVersions('1.0.6-alpha', '1.0.6-beta')).toBeLessThan(0);
  expect(compareThemeVersions('1.0.6-beta.10', '1.0.6-beta.2')).toBeGreaterThan(0);
  expect(compareThemeVersions('1.0.6-rc-2', '1.0.6-rc-1')).toBeGreaterThan(0);
});
