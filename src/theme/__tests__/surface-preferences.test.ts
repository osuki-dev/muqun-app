import { expect, test } from 'bun:test';
import { createThemeStarter } from '../starter';
import { resolveHomeIdentity } from '../resolve';
import {
  effectiveThemeManifest,
  homeArtworkPreference,
  ThemeRepository,
  type InstalledTheme,
} from '../repository';
import { parseThemeManifest } from '../schema';
import { packTheme, unpackTheme } from '../package';
import { clampThemeOpacity, themeOpacityPolicy } from '../opacity-policy';
const starterPolicies = Object.values(createThemeStarter().variants).map(themeOpacityPolicy);
const surfaceFloor = Math.max(...starterPolicies.map((policy) => policy.surface.minimum));

function setup() {
  let value: string | undefined;
  let failure = false;
  const storage = {
    read: () => value,
    write: (next: string) => {
      if (failure) throw new Error('disk full');
      value = next;
    },
  };
  return {
    storage,
    repo: new ThemeRepository(storage, () => 'theme'),
    fail: () => {
      failure = true;
    },
  };
}

test('reset is one durable write, restores author modes, and preserves every preference on failure', () => {
  let durable: string | undefined;
  let writes = 0;
  let reject = false;
  const repo = new ThemeRepository(
    {
      read: () => durable,
      write: (value) => {
        if (reject) throw new Error('disk full');
        writes += 1;
        durable = value;
      },
    },
    () => 'theme'
  );
  const manifest = createThemeStarter();
  manifest.variants.light.surfaces = { backgroundOpacity: 0.2 };
  manifest.variants.dark.surfaces = { backgroundOpacity: 0.8 };
  manifest.variants.light.terminal.backgroundOpacity = 0.4;
  manifest.homeIdentity = { logo: { mode: 'hidden' }, name: { mode: 'custom', text: 'Cloud' } };
  repo.save(JSON.stringify(manifest));
  repo.apply({ kind: 'custom', id: 'theme' });
  repo.setTerminalBackgroundOpacity('theme', 0);
  repo.setSurfaceBackgroundOpacity('theme', 0);
  repo.setHideHomeLogo('theme', false);
  repo.setHideHomeText('theme', true);
  repo.setHomeArtwork('theme', 'shown');
  const before = repo.snapshot();
  const cached = repo.active();
  const stored = durable;
  const count = writes;
  reject = true;
  expect(() => repo.resetAppearancePreferences('theme')).toThrow('disk full');
  expect(repo.snapshot()).toEqual(before);
  expect(repo.active()).toBe(cached);
  expect(durable).toBe(stored);
  expect(writes).toBe(count);
  reject = false;
  repo.resetAppearancePreferences('theme');
  expect(writes).toBe(count + 1);
  expect(repo.active()).not.toBe(cached);
  expect(repo.active()?.manifest).toEqual(clampThemeOpacity(manifest));
  const installed = repo.snapshot().themes[0];
  for (const key of [
    'terminalBackgroundOpacity',
    'surfaceBackgroundOpacity',
    'hideHomeLogo',
    'hideHomeText',
    'homeArtwork',
  ])
    expect(Object.hasOwn(installed, key)).toBe(false);
  repo.resetAppearancePreferences('theme');
  expect(writes).toBe(count + 1);
  expect(() => repo.resetAppearancePreferences('missing')).toThrow();
});

test('surface opacity is optional, mode-specific, finite, and independent of terminal alpha', () => {
  const manifest = createThemeStarter();
  expect(manifest.variants.light.surfaces?.backgroundOpacity ?? 1).toBe(1);
  manifest.variants.light.surfaces = { backgroundOpacity: 0 };
  manifest.variants.dark.surfaces = { backgroundOpacity: 0.75 };
  manifest.variants.dark.terminal.backgroundOpacity = 0.4;
  const parsed = parseThemeManifest(JSON.stringify(manifest));
  expect(parsed.variants.light.surfaces?.backgroundOpacity).toBe(0);
  expect(parsed.variants.dark.surfaces?.backgroundOpacity).toBe(0.75);
  for (const value of [NaN, Infinity, -1, 2]) {
    manifest.variants.light.surfaces.backgroundOpacity = value;
    expect(() => parseThemeManifest(JSON.stringify(manifest))).toThrow();
  }
});

test('preferences persist independently, invalidate active state, and reset to author modes', () => {
  const { repo, storage } = setup();
  const manifest = createThemeStarter();
  manifest.variants.light.surfaces = { backgroundOpacity: 0.2 };
  manifest.variants.dark.surfaces = { backgroundOpacity: 0.8 };
  repo.save(JSON.stringify(manifest));
  repo.apply({ kind: 'custom', id: 'theme' });
  const original = repo.active();
  repo.setTerminalBackgroundOpacity('theme', 0.7);
  repo.setSurfaceBackgroundOpacity('theme', 0.3);
  repo.setHideHomeLogo('theme', true);
  repo.setHideHomeText('theme', false);
  expect(repo.active()).not.toBe(original);
  expect(repo.snapshot().themes[0].manifest).toEqual(manifest);
  const reopened = new ThemeRepository(storage, () => 'unused');
  reopened.hydrate();
  // Verbatim, not raised to the contrast floor. The floor governs what an
  // author may impose on a reader; this is the reader's own preference on
  // their own device, and 0.3 is below `surfaceFloor` on purpose so this test
  // fails if the clamp ever creeps back over it.
  for (const mode of ['light', 'dark'] as const) {
    expect(reopened.active()?.manifest.variants[mode].surfaces?.backgroundOpacity).toBe(0.3);
    expect(reopened.active()?.manifest.variants[mode].terminal.backgroundOpacity).toBe(0.7);
  }
  expect(reopened.active()?.manifest.homeIdentity?.logo?.mode).toBe('hidden');
  expect(reopened.active()?.manifest.homeIdentity?.name?.mode).toBe('default');
  reopened.setSurfaceBackgroundOpacity('theme', undefined);
  reopened.setHideHomeLogo('theme', undefined);
  reopened.setHideHomeText('theme', undefined);
  expect(reopened.active()?.manifest.variants.light.surfaces?.backgroundOpacity).toBe(
    Math.max(0.2, surfaceFloor)
  );
  expect(reopened.active()?.manifest.variants.dark.surfaces?.backgroundOpacity).toBe(
    Math.max(0.8, surfaceFloor)
  );
  expect(reopened.snapshot().themes[0].hideHomeLogo).toBeUndefined();
  expect(reopened.snapshot().themes[0].hideHomeText).toBeUndefined();
});

test('hide/show/follow-author retain custom identity and restore defaults from authored hidden', () => {
  const manifest = createThemeStarter();
  manifest.homeIdentity = {
    name: { mode: 'custom', text: 'My sky' },
    logo: { mode: 'custom', asset: 'logo' },
  };
  const installed: InstalledTheme = { id: 'theme', manifest, assets: {} };
  expect(effectiveThemeManifest(installed).homeIdentity).toEqual(manifest.homeIdentity);
  expect(
    effectiveThemeManifest({ ...installed, hideHomeLogo: true, hideHomeText: true }).homeIdentity
  ).toEqual({ name: { mode: 'hidden' }, logo: { mode: 'hidden' } });
  expect(
    effectiveThemeManifest({ ...installed, hideHomeLogo: false, hideHomeText: false }).homeIdentity
  ).toEqual(manifest.homeIdentity);
  manifest.homeIdentity = { name: { mode: 'hidden' }, logo: { mode: 'hidden' } };
  expect(
    effectiveThemeManifest({ ...installed, hideHomeLogo: false, hideHomeText: false }).homeIdentity
  ).toEqual({ name: { mode: 'default' }, logo: { mode: 'default' } });
  expect(effectiveThemeManifest(installed).homeIdentity).toEqual(manifest.homeIdentity);
});

test('invalid and failed writes cannot change appearance or durable preferences', () => {
  const { repo, storage, fail } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  repo.apply({ kind: 'custom', id: 'theme' });
  const before = storage.read();
  const active = repo.active();
  for (const value of [-1, 2, NaN, Infinity])
    expect(() => repo.setSurfaceBackgroundOpacity('theme', value)).toThrow();
  expect(() => repo.setHideHomeLogo('missing', true)).toThrow();
  fail();
  expect(() => repo.setSurfaceBackgroundOpacity('theme', 0)).toThrow('disk full');
  expect(() => repo.setHideHomeLogo('theme', true)).toThrow('disk full');
  expect(() => repo.setHideHomeText('theme', true)).toThrow('disk full');
  expect(repo.active()).toBe(active);
  expect(storage.read()).toBe(before);
});

test('malformed persisted preferences recover without discarding valid installations', () => {
  const { repo, storage } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  const raw = JSON.parse(storage.read()!);
  Object.assign(raw.themes[0], {
    surfaceBackgroundOpacity: -1,
    hideHomeLogo: 'yes',
    hideHomeText: 1,
    homeArtwork: 'maybe',
  });
  const reopened = new ThemeRepository(
    { read: () => JSON.stringify(raw), write: () => {} },
    () => 'id'
  );
  reopened.hydrate();
  expect(reopened.snapshot().themes).toHaveLength(1);
  expect(reopened.snapshot().themes[0].surfaceBackgroundOpacity).toBeUndefined();
  expect(reopened.snapshot().themes[0].hideHomeLogo).toBeUndefined();
  expect(reopened.snapshot().themes[0].hideHomeText).toBeUndefined();
  expect(reopened.snapshot().themes[0].homeArtwork).toBeUndefined();
  expect(reopened.hasAuthoritativeAssetReferences()).toBe(true);
});

test('the Home artwork preference stores two answers and spells the third as none at all', () => {
  const { repo } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  repo.apply({ kind: 'custom', id: 'theme' });
  const stored = () => repo.snapshot().themes[0];

  expect(homeArtworkPreference(stored())).toBe('theme');
  for (const value of ['shown', 'hidden'] as const) {
    repo.setHomeArtwork('theme', value);
    expect(stored().homeArtwork).toBe(value);
    expect(homeArtworkPreference(stored())).toBe(value);
  }

  // Back to following the author is the key going away, not a third stored
  // value, so a reset and a deliberate return to `theme` leave the same record.
  const active = repo.active();
  repo.setHomeArtwork('theme', 'theme');
  expect(Object.hasOwn(stored(), 'homeArtwork')).toBe(false);
  // It is a preference like any other, so it also drops the compiled theme.
  expect(repo.active()).not.toBe(active);

  expect(() => repo.setHomeArtwork('theme', 'maybe' as never)).toThrow('home artwork');
  expect(() => repo.setHomeArtwork('missing', 'shown')).toThrow();
});

test('the Home artwork preference never leaks into the manifest a pack exports', () => {
  // The two Home switches are folded into `homeIdentity` by
  // `effectiveThemeManifest`; this one deliberately is not, because `shown`
  // means more than the manifest can say. What that must not become is a
  // reader's private choice travelling inside a theme they share.
  const { repo } = setup();
  const manifest = createThemeStarter();
  manifest.homeIdentity = { artwork: { mode: 'hidden' } };
  repo.save(JSON.stringify(manifest));
  repo.setHomeArtwork('theme', 'shown');
  expect(effectiveThemeManifest(repo.snapshot().themes[0]).homeIdentity?.artwork).toEqual({
    mode: 'hidden',
  });
});

test('package export resolves all preferences; colors-only export still excludes identity', () => {
  const { repo } = setup();
  repo.save(JSON.stringify(createThemeStarter()));
  repo.setSurfaceBackgroundOpacity('theme', 0.15);
  repo.setHideHomeLogo('theme', true);
  repo.setHideHomeText('theme', true);
  const exported = unpackTheme(
    packTheme({ manifest: effectiveThemeManifest(repo.snapshot().themes[0]), assets: {} })
  ).manifest;
  expect(exported.homeIdentity?.logo?.mode).toBe('hidden');
  expect(exported.homeIdentity?.name?.mode).toBe('hidden');
  // The reader's own setting travels with the export as they set it. Their
  // 0.15 is below `surfaceFloor`, which is the point: the floor clamps the
  // author's value, not theirs.
  expect(exported.variants.dark.surfaces?.backgroundOpacity).toBe(0.15);
  const colors = parseThemeManifest(repo.exportColors('theme'));
  expect(colors.homeIdentity).toBeUndefined();
  expect(colors.variants.light.surfaces?.backgroundOpacity).toBe(0.15);
});

test('custom themes default to no Home branding without overwriting explicit choices', () => {
  const manifest = createThemeStarter();
  const installed: InstalledTheme = { id: 'personal', manifest, assets: {} };
  const identity = (value: InstalledTheme) => resolveHomeIdentity(effectiveThemeManifest(value));
  expect(identity(installed)).toEqual({ name: null, logo: null, showBrand: false });
  expect(identity({ ...installed, hideHomeLogo: false, hideHomeText: false })).toEqual({
    name: 'Muqun',
    logo: { mode: 'default' },
    showBrand: true,
  });
  manifest.homeIdentity = {
    name: { mode: 'custom', text: 'My workspace' },
    logo: { mode: 'custom', asset: 'personal-mark' },
  };
  expect(identity(installed)).toEqual({
    name: 'My workspace',
    logo: { mode: 'custom', asset: 'personal-mark' },
    showBrand: true,
  });
  expect(identity({ ...installed, hideHomeLogo: true })).toEqual({
    name: 'My workspace',
    logo: null,
    showBrand: true,
  });
  expect(identity({ ...installed, hideHomeText: true })).toEqual({
    name: null,
    logo: { mode: 'custom', asset: 'personal-mark' },
    showBrand: true,
  });
  manifest.homeIdentity = { logo: { mode: 'default' }, name: { mode: 'default' } };
  expect(identity(installed)).toEqual({
    name: 'Muqun',
    logo: { mode: 'default' },
    showBrand: true,
  });
  expect(resolveHomeIdentity().showBrand).toBe(true);
});
