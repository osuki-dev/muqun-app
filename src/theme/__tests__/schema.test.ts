import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  createThemeAuthoringPrompt,
  createThemeStarter,
  THEME_SKILL_VERSION,
} from '@/theme/authoring';
import { compileTheme, resolveHomeIdentity, resolveThemeImage } from '@/theme/resolve';
import {
  parseThemeManifest,
  themeColorsSchema,
  themeJsonSchema,
  THEME_LIMITS,
} from '@/theme/schema';

import { auditThemeContrast } from '@/theme/contrast';
import { themeOpacityPolicy } from '@/theme/opacity-policy';

const parse = (value: unknown) => parseThemeManifest(JSON.stringify(value));

describe('theme v1 contract', () => {
  test('starter is complete and stable across a JSON round trip', () => {
    const theme = createThemeStarter();
    expect(parse(theme)).toEqual(theme);
    expect(Object.keys(theme.variants.light.colors)).toHaveLength(17);
    expect(theme.variants.dark.terminal.ansi).toHaveLength(16);
    // An alpha-carrying hex is the one colour form a round trip could drop.
    expect(/^#[\da-fA-F]{8}$/.test(theme.variants.light.colors.primarySubtle)).toBe(true);
  });

  test('the starter can actually be applied, which is what three places promise', () => {
    // `theme init` says "already passes the contrast gate", the spec says
    // "complete, valid ... adapt it", and `authoring.ts` says the seed meets the
    // gate. All three were wrong: the palette came from a built-in, and built-ins
    // are never put through `auditThemeContrast` -- only custom packs are, on
    // apply. The seed failed in seventeen places and could not be applied at all,
    // so the documented first step of authoring handed back something unusable.
    expect(auditThemeContrast(createThemeStarter())).toEqual([]);
  });

  test('neither mode is pinned at full opacity', () => {
    // A baseline failure forces the floor to 1 and the slider to nothing. This
    // is the same property as above read through the policy, and it is the one
    // an author sees first.
    const starter = createThemeStarter();
    for (const mode of ['light', 'dark'] as const) {
      const policy = themeOpacityPolicy(starter.variants[mode]);
      expect(policy.surface.baselineIssues).toEqual([]);
      expect(policy.terminal.baselineIssues).toEqual([]);
    }
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
    // Headroom, not a hard edge: the delivered task is capped at 64 KiB
    // (`collaborationTaskText`), and this prompt is only one part of it -- the
    // reader's own words, the terminal context and any reference JSON share
    // that budget. 16 KiB keeps three quarters of it free.
    expect(new TextEncoder().encode(prompt).length).toBeLessThan(16 * 1024);
    expect(prompt).toContain(JSON.stringify(themeJsonSchema()));
    const template = prompt.split('```muqun-theme\n')[1].split('\n```')[0];
    expect(parseThemeManifest(template)).toEqual(createThemeStarter());
    expect(/[\p{Script=Han}]/u.test(prompt)).toBe(false);
  });

  test('generated skill and command carry the same complete contract and starter', () => {
    const skill = readFileSync(
      new URL('../../../skills/muqun-theme/SKILL.md', import.meta.url),
      'utf8'
    );
    expect(skill).toContain(`version: ${THEME_SKILL_VERSION}`);
    expect(JSON.parse(skill.split('```json\n')[1].split('\n```')[0])).toEqual(themeJsonSchema());
    expect(parseThemeManifest(skill.split('```muqun-theme\n')[1].split('\n```')[0])).toEqual(
      createThemeStarter()
    );
    for (const content of [skill, createThemeAuthoringPrompt()]) {
      expect(content).toContain('Public HTTPS images download after link review');
      expect(content).toContain('Do not auto-apply');
      expect(content).toContain('Report only checks actually run');
    }
  });

  test('compact schema references resolve locally without dropping the shared variant contract', () => {
    const schema = themeJsonSchema();
    let references = 0;
    function visit(value: unknown) {
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.$ref === 'string') {
        references += 1;
        expect(record.$ref.startsWith('#/')).toBe(true);
        let target: unknown = schema;
        for (const segment of record.$ref.slice(2).split('/')) {
          target = (target as Record<string, unknown>)[
            segment.replace(/~1/g, '/').replace(/~0/g, '~')
          ];
        }
        expect(target).not.toBeUndefined();
      }
      for (const child of Object.values(record)) visit(child);
    }
    visit(schema);
    expect(references > 0).toBe(true);
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
