import { describe, expect, test } from 'bun:test';

import { createThemeAuthoringPrompt, createThemeStarter } from '@/theme/authoring';
import { compileTheme, resolveHomeIdentity, resolveThemeImage } from '@/theme/resolve';
import {
  parseThemeManifest,
  themeColorsSchema,
  themeJsonSchema,
  THEME_LIMITS,
} from '@/theme/schema';

const parse = (value: unknown) => parseThemeManifest(JSON.stringify(value));

describe('theme v1 contract', () => {
  test('starter is complete and stable across a JSON round trip', () => {
    const theme = createThemeStarter();
    expect(parse(theme)).toEqual(theme);
    expect(Object.keys(theme.variants.light.colors)).toHaveLength(17);
    expect(theme.variants.dark.terminal.ansi).toHaveLength(16);
    expect(theme.variants.light.colors.primarySubtle).toBe('#FF5A4A24');
  });

  for (const mode of ['light', 'dark'] as const) {
    test(`requires every ${mode} UI token`, () => {
      for (const key of Object.keys(themeColorsSchema.shape)) {
        const theme = JSON.parse(JSON.stringify(createThemeStarter()));
        delete theme.variants[mode].colors[key];
        expect(() => parse(theme)).toThrow(key);
      }
    });
    test(`requires ${mode} and exactly sixteen ANSI colors`, () => {
      const theme = createThemeStarter();
      expect(() =>
        parse({
          ...theme,
          variants: { [mode === 'light' ? 'dark' : 'light']: theme.variants[mode] },
        })
      ).toThrow(mode);
      for (const length of [0, 15, 17]) {
        expect(() =>
          parse({
            ...theme,
            variants: {
              ...theme.variants,
              [mode]: {
                ...theme.variants[mode],
                terminal: { ...theme.variants[mode].terminal, ansi: Array(length).fill('#123456') },
              },
            },
          })
        ).toThrow('ansi');
      }
    });
  }

  test('rejects unknown fields rather than pretending unsupported styling worked', () => {
    expect(() => parse({ ...createThemeStarter(), javascript: 'bad' })).toThrow();
    expect(() =>
      parse({ ...createThemeStarter(), decoration: { 'terminal.background': null } })
    ).toThrow();
    expect(() => parse({ ...createThemeStarter(), schemaVersion: 2 })).toThrow();
  });

  for (const color of ['red', '#fff', 'transparent', '#12345600', 'url(https://example.invalid)']) {
    test(`rejects nonopaque/invalid text color ${color}`, () => {
      const theme = createThemeStarter();
      theme.variants.light.colors.text = color;
      expect(() => parse(theme)).toThrow('text');
    });
  }

  test('bounds raw bytes before parsing, including multibyte UTF-8', () => {
    expect(() => parseThemeManifest(' '.repeat(THEME_LIMITS.manifestBytes + 1))).toThrow('256 KiB');
    expect(() => parseThemeManifest('🌸'.repeat(70_000))).toThrow('256 KiB');
    expect(() => parseThemeManifest('{')).toThrow('complete JSON');
  });

  for (const path of [
    '/tmp/a.png',
    'assets/../secret.png',
    'assets/a.svg',
    'assets/a.png/b',
    'assets/%2e%2e.png',
    'assets\\a.png',
  ]) {
    test(`rejects unsafe or unsupported asset path ${path}`, () => {
      expect(() => parse({ ...createThemeStarter(), assets: { paper: { path } } })).toThrow();
    });
  }

  test('validates all shared, mode, responsive and logo references', () => {
    for (const extra of [
      { decoration: { 'shell.background': { asset: 'missing' } } },
      { variantDecorations: { dark: { 'shell.background': { asset: 'missing' } } } },
      { decoration: { 'shell.background': { asset: 'paper', regular: { asset: 'missing' } } } },
      { homeIdentity: { logo: { mode: 'custom', asset: 'missing' } } },
    ]) {
      expect(() =>
        parse({
          ...createThemeStarter(),
          assets: { paper: { path: 'assets/paper.png' } },
          ...extra,
        })
      ).toThrow('Unknown asset');
    }
  });

  test('bounds resource count', () => {
    const assets = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [
        `asset-${index}`,
        { path: `assets/paper-${index}.png` },
      ])
    );
    expect(() => parse({ ...createThemeStarter(), assets })).toThrow('32 assets');
  });

  test('skill carries the exact current schema and a parseable complete template', () => {
    const prompt = createThemeAuthoringPrompt();
    expect(prompt).toContain(JSON.stringify(themeJsonSchema()));
    const template = prompt.split('```muqun-theme\n')[1].split('\n```')[0];
    expect(parseThemeManifest(template)).toEqual(createThemeStarter());
    expect(/[\p{Script=Han}]/u.test(prompt)).toBe(false);
  });
});

describe('shared component resolution', () => {
  test('shell fallback applies only when home is absent, never when explicitly disabled', () => {
    const manifest = createThemeStarter();
    manifest.decoration = { 'shell.background': { asset: 'paper' } };
    const resolve = () =>
      resolveThemeImage(manifest, 'home.background', 'dark', 'compact', true, 'shell.background');
    expect(resolve()).toEqual({ asset: 'paper' });
    manifest.decoration['home.background'] = null;
    expect(resolve()).toBeNull();
    manifest.decoration['home.background'] = { asset: 'home', compact: null };
    expect(resolve()).toBeNull();
    manifest.variantDecorations = { dark: { 'home.background': null } };
    expect(resolve()).toBeNull();
    manifest.variantDecorations.dark = { 'home.background': { asset: 'night', compact: null } };
    expect(resolve()).toBeNull();
  });

  test('undefined inherits; null disables; responsive overrides are final', () => {
    const manifest = parse({
      ...createThemeStarter(),
      assets: { paper: { path: 'assets/paper.png' }, night: { path: 'assets/night.png' } },
      decoration: { 'shell.background': { asset: 'paper', regular: null } },
      variantDecorations: { dark: { 'shell.background': { asset: 'night', compact: null } } },
    });
    expect(resolveThemeImage(manifest, 'shell.background', 'light', 'compact')).toEqual({
      asset: 'paper',
    });
    expect(resolveThemeImage(manifest, 'shell.background', 'light', 'regular')).toBeNull();
    expect(resolveThemeImage(manifest, 'shell.background', 'dark', 'compact')).toBeNull();
    expect(resolveThemeImage(manifest, 'shell.background', 'dark', 'regular')).toEqual({
      asset: 'night',
    });
    expect(resolveThemeImage(manifest, 'shell.background', 'dark', 'regular', false)).toBeNull();
    expect(resolveThemeImage(manifest, 'home.decoration', 'dark', 'regular')).toBeNull();
  });

  test('hiding both home identity elements removes the brand block', () => {
    expect(resolveHomeIdentity()).toEqual({
      name: 'Muqun',
      logo: { mode: 'default' },
      showBrand: true,
    });
    for (const hideName of [false, true])
      for (const hideLogo of [false, true]) {
        const manifest = createThemeStarter();
        manifest.homeIdentity = {
          name: { mode: hideName ? 'hidden' : 'default' },
          logo: { mode: hideLogo ? 'hidden' : 'default' },
        };
        const identity = resolveHomeIdentity(manifest);
        expect(identity.showBrand).toBe(!(hideName && hideLogo));
        expect(identity.name).toBe(hideName ? null : 'Muqun');
        expect(identity.logo).toEqual(hideLogo ? null : { mode: 'default' });
      }
  });

  test('a custom asset named builtin cannot collide with the default logo', () => {
    const manifest = createThemeStarter();
    manifest.assets = { builtin: { path: 'assets/logo.png' } };
    manifest.homeIdentity = { logo: { mode: 'custom', asset: 'builtin' } };
    const identity = resolveHomeIdentity(parseThemeManifest(JSON.stringify(manifest)));
    expect(identity.logo).toEqual({ mode: 'custom', asset: 'builtin' });
  });

  test('compiled state owns immutable data, detached from an editable draft', () => {
    const draft = createThemeStarter();
    const compiled = compileTheme(draft, 'local-installation');
    draft.variants.light.colors.text = '#FFFFFF';
    expect(compiled.light.colors.text).not.toBe('#FFFFFF');
    expect(Object.isFrozen(compiled.dark.terminal.ansi)).toBe(true);
    expect(compiled.installationId).not.toBe(draft.id);
  });
});
