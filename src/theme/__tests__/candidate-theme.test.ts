import { expect, test } from 'bun:test';

import { createThemeStarter } from '../authoring';
import {
  CANDIDATE_INSTALLATION_ID,
  resolveCandidateTheme,
  selectEffectiveCustomTheme,
} from '../candidate-theme';
import { themeOpacityPolicy } from '../opacity-policy';
import { compileTheme, type ResolvedCustomTheme } from '../resolve';
import type { InstalledTheme } from '../repository';

function installed(overrides: Partial<InstalledTheme> = {}): InstalledTheme {
  return { id: 'installed', manifest: createThemeStarter(), assets: {}, ...overrides };
}

test('a preview draws the candidate even while another theme is applied', () => {
  const applied = compileTheme(createThemeStarter(), 'applied');
  const candidateManifest = createThemeStarter();
  candidateManifest.name = 'Mochi Lab';
  const candidate = {
    theme: resolveCandidateTheme(candidateManifest),
    assets: { paper: 'file:///candidate/paper.png' },
  };

  const effective = selectEffectiveCustomTheme(candidate, applied, {
    paper: 'file:///applied/paper.png',
  });

  expect(effective.theme?.label).toBe('Mochi Lab');
  // The pair travels together: a candidate manifest must never be handed the
  // applied theme's files, which is how a preview would draw the wrong picture.
  expect(effective.assets).toEqual({ paper: 'file:///candidate/paper.png' });
});

test('everywhere outside a preview the answer is still the applied theme', () => {
  const applied = compileTheme(createThemeStarter(), 'applied');
  const assets = { paper: 'file:///applied/paper.png' };

  expect(selectEffectiveCustomTheme(null, applied, assets)).toEqual({ theme: applied, assets });
  // No custom theme at all is the built-in pack, which is the absence of one of
  // these rather than a theme of its own.
  expect(selectEffectiveCustomTheme(null, null, undefined)).toEqual({
    theme: null,
    assets: undefined,
  });
});

test('a candidate nobody has installed wears the author values, clamped', () => {
  const manifest = createThemeStarter();
  manifest.variants.light.surfaces = { backgroundOpacity: 0 };
  manifest.homeIdentity = { name: { mode: 'custom', text: 'Mochi Lab' } };
  const floor = themeOpacityPolicy(manifest.variants.light).surface.minimum;

  const theme = resolveCandidateTheme(manifest);

  // The readability floor answers "what may a pack someone else made impose on
  // a reader who never asked for it", and a preview is exactly that reader.
  expect(theme.manifest.variants.light.surfaces?.backgroundOpacity).toBe(floor);
  expect(theme.manifest.homeIdentity?.name).toEqual({ mode: 'custom', text: 'Mochi Lab' });
  // What `buildTheme` reads off the pack, so the nested provider paints this
  // candidate's colours rather than the applied theme's.
  expect(theme.light.colors).toEqual(manifest.variants.light.colors);
  expect(theme.dark.colors).toEqual(manifest.variants.dark.colors);
  expect(theme.installationId).toBe(CANDIDATE_INSTALLATION_ID);
  expect(theme.id).toBe(`custom-${CANDIDATE_INSTALLATION_ID}`);
});

test("an installed candidate wears its own reader preferences, not the author's", () => {
  const manifest = createThemeStarter();
  manifest.variants.light.surfaces = { backgroundOpacity: 1 };
  manifest.homeIdentity = { logo: { mode: 'default' } };

  const theme = resolveCandidateTheme(
    manifest,
    {},
    installed({ manifest, surfaceBackgroundOpacity: 0, hideHomeLogo: true })
  );

  // The slider on this screen writes the installation, and the screen has to
  // show what it did -- including all the way to zero, where the author's floor
  // has no standing over the reader's own device.
  expect(theme.manifest.variants.light.surfaces?.backgroundOpacity).toBe(0);
  expect(theme.manifest.variants.dark.surfaces?.backgroundOpacity).toBe(0);
  expect(theme.manifest.homeIdentity?.logo).toEqual({ mode: 'hidden' });
  expect(theme.installationId).toBe('installed');
});

test('resolving a candidate never mutates the manifest it was handed', () => {
  const manifest = createThemeStarter();
  manifest.variants.light.surfaces = { backgroundOpacity: 0 };
  const before = JSON.stringify(manifest);

  const theme: ResolvedCustomTheme = resolveCandidateTheme(manifest, {}, installed({ manifest }));

  expect(JSON.stringify(manifest)).toBe(before);
  expect(Object.isFrozen(theme.manifest)).toBe(true);
});
