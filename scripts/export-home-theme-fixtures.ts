import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveHomeArtwork } from '../src/theme/home-artwork';
import { resolveHomeIdentity, resolveThemeImage } from '../src/theme/resolve';
import type { ThemeImage, ThemeManifest, ThemeSlot } from '../src/theme/schema';

/**
 * Generate the App fixture with:
 *   bun scripts/export-home-theme-fixtures.ts
 * Check it without writing with:
 *   bun scripts/export-home-theme-fixtures.ts --check
 * Copy the same bytes to a consumer checkout explicitly with `--website PATH`
 * or to an exact file with `--output PATH`.
 */
const appRoot = fileURLToPath(new URL('../', import.meta.url));
const appFixturePath = resolve(appRoot, 'fixtures/home-theme-resolvers.json');

const sourceFiles = {
  app: ['src/theme/resolve.ts', 'src/theme/home-artwork.ts', 'src/theme/schema.ts'],
} as const;

type FixtureManifest = {
  format: 'muqun-theme';
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  decoration?: ThemeManifest['decoration'];
  variantDecorations?: ThemeManifest['variantDecorations'];
  homeIdentity?: ThemeManifest['homeIdentity'];
};

type Query = {
  id: string;
  mode: 'light' | 'dark';
  width: 'compact' | 'regular';
  preference?: 'theme' | 'shown' | 'hidden';
  decorationsEnabled?: boolean;
  directFallbackSlot?: ThemeSlot;
};

type FixtureCase = {
  id: string;
  manifest: FixtureManifest | null;
  queries: Query[];
};

type SourceRecord = { path: string; sha256: string };

type Fixture = {
  format: 'muqun-home-theme-resolvers';
  fixtureVersion: 1;
  themeSchemaVersion: 1;
  sources: { app: SourceRecord[] };
  cases: (FixtureCase & {
    expectedIdentity: ReturnType<typeof resolveHomeIdentity>;
    expected: {
      id: string;
      artwork: ReturnType<typeof resolveHomeArtwork>;
      directImage: ThemeImage | null;
    }[];
  })[];
};

function manifest(
  id: string,
  values: Pick<FixtureManifest, 'decoration' | 'variantDecorations' | 'homeIdentity'> = {}
): FixtureManifest {
  return {
    format: 'muqun-theme',
    schemaVersion: 1,
    id,
    name: id,
    version: '1.0.0',
    ...values,
  };
}

function query(
  id: string,
  mode: Query['mode'],
  width: Query['width'],
  options: Omit<Query, 'id' | 'mode' | 'width'> = {}
): Query {
  return { id, mode, width, ...options };
}

const cases: FixtureCase[] = [
  {
    id: 'no-custom-theme',
    manifest: null,
    queries: [
      query('theme-light-compact', 'light', 'compact'),
      query('shown-dark-regular', 'dark', 'regular', { preference: 'shown' }),
    ],
  },
  {
    id: 'omitted-identity',
    manifest: manifest('omitted-identity', {
      decoration: { 'home.artwork': { asset: 'artwork', fit: 'contain' } },
    }),
    queries: [
      query('theme-light-compact', 'light', 'compact'),
      query('theme-dark-regular', 'dark', 'regular'),
    ],
  },
  {
    id: 'custom-identity-and-mode',
    manifest: manifest('custom-identity-and-mode', {
      homeIdentity: {
        name: { mode: 'custom', text: 'Muqun Lab' },
        logo: { mode: 'custom', asset: 'brand' },
        artwork: { mode: 'default' },
      },
      decoration: {
        'home.artwork': {
          asset: 'artwork-light',
          fit: 'contain',
          regular: { asset: 'artwork-light-regular', opacity: 0.8 },
        },
      },
      variantDecorations: {
        dark: {
          'home.artwork': {
            asset: 'artwork-dark',
            fit: 'cover',
            regular: { asset: 'artwork-dark-regular' },
          },
        },
      },
    }),
    queries: [
      query('light-compact', 'light', 'compact'),
      query('light-regular', 'light', 'regular'),
      query('dark-compact', 'dark', 'compact'),
      query('dark-regular', 'dark', 'regular'),
    ],
  },
  {
    id: 'default-identity',
    manifest: manifest('default-identity', {
      homeIdentity: {
        name: { mode: 'default' },
        logo: { mode: 'default' },
        artwork: { mode: 'default' },
      },
      decoration: { 'home.artwork': { asset: 'artwork' } },
    }),
    queries: [query('theme-light-compact', 'light', 'compact')],
  },
  {
    id: 'hidden-identity-reader-override',
    manifest: manifest('hidden-identity-reader-override', {
      homeIdentity: {
        name: { mode: 'hidden' },
        logo: { mode: 'hidden' },
        artwork: { mode: 'hidden' },
      },
      decoration: { 'home.artwork': { asset: 'artwork' } },
    }),
    queries: [
      query('theme', 'light', 'compact'),
      query('shown', 'light', 'compact', { preference: 'shown' }),
      query('hidden', 'light', 'compact', { preference: 'hidden' }),
    ],
  },
  {
    id: 'empty-state-is-not-home-artwork',
    manifest: manifest('empty-state-is-not-home-artwork', {
      decoration: {
        'emptyState.illustration': { asset: 'empty', fit: 'contain' },
      },
    }),
    queries: [
      query('theme-no-fallback', 'light', 'compact'),
      query('shown-with-direct-fallback', 'light', 'compact', {
        preference: 'shown',
        directFallbackSlot: 'emptyState.illustration',
      }),
      query('shown-with-direct-fallback-regular', 'dark', 'regular', {
        preference: 'shown',
        directFallbackSlot: 'emptyState.illustration',
      }),
    ],
  },
  {
    id: 'responsive-null-and-disabled',
    manifest: manifest('responsive-null-and-disabled', {
      decoration: {
        'home.artwork': {
          asset: 'artwork-base',
          compact: null,
          regular: { asset: 'artwork-regular' },
        },
        'emptyState.illustration': { asset: 'empty' },
      },
      variantDecorations: {
        dark: { 'home.artwork': null },
      },
    }),
    queries: [
      query('light-compact-null', 'light', 'compact'),
      query('light-regular-object', 'light', 'regular'),
      query('dark-compact-explicit-null', 'dark', 'compact', {
        directFallbackSlot: 'emptyState.illustration',
      }),
      query('decorations-disabled', 'light', 'regular', {
        decorationsEnabled: false,
        directFallbackSlot: 'emptyState.illustration',
      }),
    ],
  },
];

async function sha256(root: string, relativePath: string): Promise<string> {
  const bytes = await readFile(resolve(root, relativePath));
  return createHash('sha256').update(bytes).digest('hex');
}

async function sourceManifest(): Promise<Fixture['sources']> {
  return {
    app: await Promise.all(
      sourceFiles.app.map(async (path) => ({ path, sha256: await sha256(appRoot, path) }))
    ),
  };
}

function toManifest(value: FixtureManifest | null): ThemeManifest | undefined {
  return value === null ? undefined : (value as unknown as ThemeManifest);
}

function buildFixture(sources: Fixture['sources']): Fixture {
  return {
    format: 'muqun-home-theme-resolvers',
    fixtureVersion: 1,
    themeSchemaVersion: 1,
    sources,
    cases: cases.map((item) => {
      const input = toManifest(item.manifest);
      return {
        ...item,
        expectedIdentity: resolveHomeIdentity(input),
        expected: item.queries.map((itemQuery) => {
          const decorationsEnabled = itemQuery.decorationsEnabled ?? true;
          const directImage = input
            ? resolveThemeImage(
                input,
                'home.artwork',
                itemQuery.mode,
                itemQuery.width,
                decorationsEnabled,
                itemQuery.directFallbackSlot
              )
            : null;
          return {
            id: itemQuery.id,
            artwork: resolveHomeArtwork({
              manifest: input,
              mode: itemQuery.mode,
              width: itemQuery.width,
              preference: itemQuery.preference,
              decorationsEnabled,
            }),
            directImage,
          };
        }),
      };
    }),
  };
}

function serialized(value: Fixture): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeOrCheck(path: string, content: string, check: boolean): Promise<boolean> {
  let current: string | null = null;
  try {
    current = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (check) return current === content;
  await mkdir(resolve(path, '..'), { recursive: true });
  if (current !== content) await writeFile(path, content);
  return true;
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

const websiteRoot = optionValue('--website');
const outputPath = optionValue('--output');
if (websiteRoot && outputPath) throw new Error('Use either --website or --output, not both');

const fixture = buildFixture(await sourceManifest());
const content = serialized(fixture);
const check = process.argv.includes('--check');
const outputPaths = [
  appFixturePath,
  ...(websiteRoot
    ? [resolve(websiteRoot, 'fixtures/home-theme-resolvers.json')]
    : outputPath
      ? [resolve(appRoot, outputPath)]
      : []),
];
const results = await Promise.all(outputPaths.map((path) => writeOrCheck(path, content, check)));

if (check && results.some((result) => !result)) {
  console.error(
    'Home theme resolver fixtures are stale. Run: bun scripts/export-home-theme-fixtures.ts'
  );
  process.exit(1);
}

if (!check) console.log(`Wrote ${outputPaths.join(' and ')}`);
