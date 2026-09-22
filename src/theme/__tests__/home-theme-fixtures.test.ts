import { readFileSync } from 'node:fs';

import { expect, test } from 'bun:test';

import { resolveHomeArtwork } from '../home-artwork';
import { resolveHomeIdentity, resolveThemeImage } from '../resolve';
import type { ThemeManifest, ThemeSlot } from '../schema';

type Fixture = {
  format: string;
  fixtureVersion: number;
  themeSchemaVersion: number;
  sources: {
    app: { path: string; sha256: string }[];
  };
  cases: {
    id: string;
    manifest: unknown | null;
    queries: {
      id: string;
      mode: 'light' | 'dark';
      width: 'compact' | 'regular';
      preference?: 'theme' | 'shown' | 'hidden';
      decorationsEnabled?: boolean;
      directFallbackSlot?: ThemeSlot;
    }[];
    expectedIdentity: ReturnType<typeof resolveHomeIdentity>;
    expected: {
      id: string;
      artwork: ReturnType<typeof resolveHomeArtwork>;
      directImage: ReturnType<typeof resolveThemeImage>;
    }[];
  }[];
};

const fixture = JSON.parse(
  readFileSync(new URL('../../../fixtures/home-theme-resolvers.json', import.meta.url), 'utf8')
) as Fixture;

test('the exported Home theme fixture is generated from the App resolver contract', () => {
  expect(fixture.format).toBe('muqun-home-theme-resolvers');
  expect(fixture.fixtureVersion).toBe(1);
  expect(fixture.themeSchemaVersion).toBe(1);
  expect(fixture.sources.app.map((source) => source.path)).toEqual([
    'src/theme/resolve.ts',
    'src/theme/home-artwork.ts',
    'src/theme/schema.ts',
  ]);
  for (const item of fixture.cases) {
    const manifest = item.manifest === null ? undefined : (item.manifest as ThemeManifest);
    expect(resolveHomeIdentity(manifest)).toEqual(item.expectedIdentity);

    for (const expected of item.expected) {
      const input = item.queries.find((query) => query.id === expected.id);
      expect(input).toBeDefined();
      if (!input) continue;

      const decorationsEnabled = input.decorationsEnabled ?? true;
      expect(
        resolveHomeArtwork({
          manifest,
          mode: input.mode,
          width: input.width,
          preference: input.preference,
          decorationsEnabled,
        })
      ).toEqual(expected.artwork);

      const directImage = manifest
        ? resolveThemeImage(
            manifest,
            'home.artwork',
            input.mode,
            input.width,
            decorationsEnabled,
            input.directFallbackSlot
          )
        : null;
      expect(directImage).toEqual(expected.directImage);
    }
  }
});
