import { describe, expect, test } from 'bun:test';

import { compileTheme, resolveHomeIdentity, resolveThemeImage } from '@/theme/resolve';
import {
  parseThemeManifest,
  themeColorsSchema,
  themeJsonSchema,
  THEME_LIMITS,
} from '@/theme/schema';

import { auditThemeContrast } from '@/theme/contrast';
import { themeOpacityPolicy } from '@/theme/opacity-policy';
import { createThemeStarter } from '@/theme/starter';

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

  test('tolerates what a newer app might add, and drops it rather than acting on it', () => {
    // The whole point of the change in `docs/theme-contract.md`: a pack written
    // against a later build installs here, minus the parts this build has never
    // heard of. Strictness made every added field a breaking change for every
    // app already in someone's hands.
    const withFuture = parse({
      ...createThemeStarter(),
      javascript: 'bad',
      decoration: { 'terminal.background': null },
    });
    // Dropped, not carried: an unknown key must not survive into the compiled
    // theme, or it becomes a thing the app is quietly storing on a reader's
    // device without knowing what it is.
    expect(Object.hasOwn(withFuture, 'javascript')).toBe(false);
  });

  test('a pack from a later format says so, instead of failing as a broken v1', () => {
    expect(() => parse({ ...createThemeStarter(), schemaVersion: 2 })).toThrow(
      'needs a newer version of Muqun'
    );
    expect(() => parse({ ...createThemeStarter(), schemaVersion: 0 })).toThrow('schemaVersion');
  });

  test('colours stay strict, because there a typo has no sensible fallback', () => {
    const theme = createThemeStarter();
    (theme.variants.light.colors as Record<string, string>).backgrnd = '#000000';
    expect(() => parse(theme)).toThrow();
  });

  test('an unknown material degrades to auto instead of failing the pack', () => {
    const theme = { ...createThemeStarter(), materials: { navigation: 'frosted' } };
    expect(parse(theme).materials?.navigation).toBe('auto');
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
      { decoration: { 'shell.wallpaper': { asset: 'missing' } } },
      { variantDecorations: { dark: { 'shell.wallpaper': { asset: 'missing' } } } },
      { decoration: { 'shell.wallpaper': { asset: 'paper', regular: { asset: 'missing' } } } },
      { homeIdentity: { logo: { mode: 'custom', asset: 'missing' } } },
      // The artwork is an ordinary slot, so it is held to the ordinary rule: an
      // asset it names has to be one the pack declares.
      { decoration: { 'home.artwork': { asset: 'missing', fit: 'contain' } } },
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

  describe('the Home artwork', () => {
    const withArtwork = (extra: Record<string, unknown>) =>
      parse({
        ...createThemeStarter(),
        assets: { crest: { path: 'assets/crest.png' } },
        decoration: { 'home.artwork': { asset: 'crest', fit: 'contain' } },
        ...extra,
      });

    test('is a decoration slot with the same controls as every other one', () => {
      const manifest = withArtwork({
        decoration: {
          'home.artwork': {
            asset: 'crest',
            fit: 'contain',
            opacity: 0.8,
            focalPoint: { x: 0.5, y: 0.25 },
            compact: { asset: 'crest' },
            regular: null,
          },
        },
      });
      expect(manifest.decoration?.['home.artwork']).toEqual({
        asset: 'crest',
        fit: 'contain',
        opacity: 0.8,
        focalPoint: { x: 0.5, y: 0.25 },
        compact: { asset: 'crest' },
        regular: null,
      });
    });

    test('the author default speaks homeIdentity\u2019s own vocabulary', () => {
      for (const mode of ['default', 'hidden'] as const) {
        expect(withArtwork({ homeIdentity: { artwork: { mode } } }).homeIdentity?.artwork).toEqual({
          mode,
        });
      }
      // `homeIdentity` is strict, so a value from a different vocabulary is a
      // typo with no sensible fallback and is refused rather than ignored.
      for (const artwork of [
        'shown',
        { mode: 'shown' },
        { mode: 'custom', asset: 'crest' },
        true,
      ]) {
        expect(() => withArtwork({ homeIdentity: { artwork } })).toThrow();
      }
    });

    test('saying nothing leaves the field absent rather than inventing a default', () => {
      expect(withArtwork({}).homeIdentity?.artwork).toBeUndefined();
    });
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
    manifest.decoration = { 'shell.wallpaper': { asset: 'paper' } };
    const resolve = () =>
      resolveThemeImage(manifest, 'home.wallpaper', 'dark', 'compact', true, 'shell.wallpaper');
    expect(resolve()).toEqual({ asset: 'paper' });
    manifest.decoration['home.wallpaper'] = null;
    expect(resolve()).toBeNull();
    manifest.decoration['home.wallpaper'] = { asset: 'home', compact: null };
    expect(resolve()).toBeNull();
    manifest.variantDecorations = { dark: { 'home.wallpaper': null } };
    expect(resolve()).toBeNull();
    manifest.variantDecorations.dark = { 'home.wallpaper': { asset: 'night', compact: null } };
    expect(resolve()).toBeNull();
  });

  test('undefined inherits; null disables; responsive overrides are final', () => {
    const manifest = parse({
      ...createThemeStarter(),
      assets: { paper: { path: 'assets/paper.png' }, night: { path: 'assets/night.png' } },
      decoration: { 'shell.wallpaper': { asset: 'paper', regular: null } },
      variantDecorations: { dark: { 'shell.wallpaper': { asset: 'night', compact: null } } },
    });
    expect(resolveThemeImage(manifest, 'shell.wallpaper', 'light', 'compact')).toEqual({
      asset: 'paper',
    });
    expect(resolveThemeImage(manifest, 'shell.wallpaper', 'light', 'regular')).toBeNull();
    expect(resolveThemeImage(manifest, 'shell.wallpaper', 'dark', 'compact')).toBeNull();
    expect(resolveThemeImage(manifest, 'shell.wallpaper', 'dark', 'regular')).toEqual({
      asset: 'night',
    });
    expect(resolveThemeImage(manifest, 'shell.wallpaper', 'dark', 'regular', false)).toBeNull();
    expect(resolveThemeImage(manifest, 'home.artwork', 'dark', 'regular')).toBeNull();
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
