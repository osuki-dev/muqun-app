import { z } from 'zod';

export const THEME_LIMITS = Object.freeze({
  manifestBytes: 256 * 1024,
  assets: 32,
  assetBytes: 8 * 1024 * 1024,
  packageBytes: 25 * 1024 * 1024,
  extractedBytes: 50 * 1024 * 1024,
  imagePixels: 16_000_000,
});

const opaque = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected an opaque #RRGGBB color');
const alpha = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'Expected a hex color');
const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const plainText = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\x00-\x1f\x7f<>]+$/);

export const themeColorsSchema = z.strictObject({
  background: opaque,
  surface: opaque,
  surfaceRaised: opaque,
  border: opaque,
  borderStrong: opaque,
  text: opaque,
  textMuted: opaque,
  textSubtle: opaque,
  textDisabled: opaque,
  primary: opaque,
  onPrimary: opaque,
  primarySubtle: alpha,
  danger: opaque,
  dangerSubtle: alpha,
  success: opaque,
  warning: opaque,
  info: opaque,
});

export const themeVariantSchema = z.strictObject({
  colors: themeColorsSchema,
  surfaces: z.strictObject({ backgroundOpacity: z.number().min(0).max(1).optional() }).optional(),
  terminal: z.strictObject({
    background: opaque,
    backgroundOpacity: z.number().min(0).max(1).optional(),
    foreground: opaque,
    cursor: opaque,
    link: opaque,
    selection: alpha,
    ansi: z.tuple([
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
      opaque,
    ]),
  }),
});

// Paths belong to an imported package, never to the host filesystem.
const assetPath = z
  .string()
  .max(160)
  .regex(/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/);
const httpsUrl = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^\s]+$/);
const assetSchema = z.union([
  z.strictObject({
    path: assetPath,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  z.strictObject({
    url: httpsUrl,
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
]);

const imageSchema = z.strictObject({
  asset: identifier,
  fit: z.enum(['cover', 'contain', 'tile']).optional(),
  opacity: z.number().min(0).max(1).optional(),
  focalPoint: z
    .strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .optional(),
});
const slotSchema = imageSchema
  .extend({
    compact: imageSchema.nullable().optional(),
    regular: imageSchema.nullable().optional(),
  })
  .nullable()
  .optional();

/**
 * The chrome glyphs a pack may replace.
 *
 * Named for the role, not for the component that happens to draw it today: a
 * pack written against `chrome.back` keeps working when the header is rebuilt,
 * and a name is the one thing in a published theme that can never be corrected
 * later.
 *
 * The app reads only these names. The schema below deliberately accepts others.
 */
export const THEME_ICONS = ['chrome.back', 'chrome.send'] as const;
export type ThemeIconName = (typeof THEME_ICONS)[number];

const iconSchema = z.strictObject({
  asset: identifier,
  /**
   * `template` takes the glyph's shape from the image's alpha and its colour
   * from the theme, so one drawing serves light and dark. `original` keeps the
   * image's own colours, which a mark with fixed branding wants and a plain
   * arrow does not -- an arrow in fixed black disappears in dark mode.
   *
   * Explicit from the first release on purpose. Adding it later with a default
   * would silently change how every already-published pack renders.
   */
  render: z.enum(['template', 'original']).default('template'),
});

/**
 * Deliberately open, and the only part of this schema that is.
 *
 * Everything else is a `strictObject`, so an unknown key fails the whole
 * manifest -- which is right for colours, where a typo is a mistake, and wrong
 * here. Icons are the one part of a pack that is already defined to be optional:
 * a missing glyph falls back to the built-in one, silently. "A name this build
 * does not know" is therefore the same situation as "not supplied", and it is
 * the situation a reader is in whenever their app is older than the pack they
 * were sent. Rejecting the entire theme for it would make every new glyph a
 * breaking change for everyone who has not updated yet.
 *
 * `muqun-theme check` reports unrecognised names so an author still hears about
 * a typo -- just as a warning, where it belongs, rather than as a refusal.
 */
export const iconsSchema = z.record(z.string(), iconSchema.nullable().optional());

/**
 * The decoration slots this build draws.
 *
 * Same arrangement as {@link THEME_ICONS}: a closed list the app reads, over a
 * schema that deliberately accepts others. The list is what gives call sites
 * their spelling check -- `<ThemeArtwork slot="shel.background" />` is still a
 * type error -- while the schema stays forward compatible.
 */
export const THEME_SLOTS = [
  'shell.background',
  'home.background',
  'home.decoration',
  'navigation.background',
  'composer.background',
  'actions.background',
  'cards.decoration',
  'buttons.primary.background',
  'tabs.background',
  'emptyState.illustration',
] as const;
export type ThemeSlot = (typeof THEME_SLOTS)[number];

/**
 * Open, for the reason argued at {@link iconsSchema}.
 *
 * A slot is already optional and a missing one already means "do not decorate
 * there", so a slot name this build does not know is the situation the reader
 * is in whenever their app is older than the pack they were sent -- and it has
 * a correct answer that is not "your theme is invalid". Keeping this strict
 * made every future slot a breaking change for every installed app.
 *
 * `muqun-theme validate` names unrecognised slots as warnings, so an author
 * still hears about a typo before their readers do.
 */
export const decorationSchema = z.record(z.string(), slotSchema);

const visibilitySchema = z.union([
  z.strictObject({ mode: z.literal('default') }),
  z.strictObject({ mode: z.literal('hidden') }),
]);

export const THEME_MATERIALS = ['auto', 'solid', 'glass'] as const;
export const THEME_MATERIAL_SURFACES = ['default', 'navigation', 'composer', 'actions'] as const;
export type ThemeMaterialSurface = (typeof THEME_MATERIAL_SURFACES)[number];

/**
 * Open on both axes, and for the same reason as the two above: a pack may name
 * a surface this build does not paint, or a material it does not have.
 *
 * `.catch('auto')` is what makes the second half safe. A value outside the enum
 * would otherwise fail the record entry and take the manifest with it; caught,
 * it becomes `auto`, which is what `resolveThemeMaterial` already does with
 * anything that is not `solid` or `glass`. So an older app meeting a newer
 * material falls back to the platform default rather than refusing to install.
 */
const materialSchema = z.enum(THEME_MATERIALS).catch('auto');
export const themeMaterialsSchema = z.record(z.string(), materialSchema.optional());

/**
 * The highest `schemaVersion` this build understands.
 *
 * A pack above it is refused, but by {@link parseThemeManifest} with a sentence
 * that names the situation -- not by the schema with "expected 1". The
 * difference matters to the only person who ever sees it: a reader whose app is
 * older than the theme they were sent, who needs to be told to update, not told
 * their file is broken.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

const semver = z
  .string()
  .regex(/^\d+\.\d+\.\d+$/)
  .max(32);

/**
 * Structural schema only: references, download policy and contrast are separate
 * gates.
 *
 * `z.object` rather than `z.strictObject`: unknown keys are dropped instead of
 * fatal. Strictness here meant no field could ever be added without breaking
 * every installed app, which made the format unable to grow at all -- see
 * `docs/theme-contract.md`. Unknown keys are still reported, as warnings, by
 * `muqun-theme validate`.
 *
 * `colors` and `terminal` stay strict, deliberately. Every colour in them is
 * required and the set is complete, so an unknown key there is a typo with no
 * sensible fallback -- the one case where refusing is the kindest answer.
 */
export const themeManifestSchema = z.object({
  format: z.literal('muqun-theme'),
  schemaVersion: z.int().min(1),
  id: identifier,
  name: plainText(64),
  version: semver,
  author: plainText(100).optional(),
  license: plainText(100).optional(),
  source: httpsUrl.optional(),
  /**
   * What a pack needs from the app, so the app can say so.
   *
   * Present from the first release because it is the field that makes every
   * other future change survivable: without it, a pack built for a later Muqun
   * can only fail as a validation error that blames its author for the reader's
   * old install.
   */
  minAppVersion: semver.optional(),
  /** Gallery metadata. The app ignores all three; a gallery cannot invent them. */
  description: plainText(280).optional(),
  tags: z.array(identifier).max(12).optional(),
  preview: identifier.optional(),
  variants: z.strictObject({ light: themeVariantSchema, dark: themeVariantSchema }),
  materials: themeMaterialsSchema.optional(),
  assets: z.record(identifier, assetSchema).optional(),
  decoration: decorationSchema.optional(),
  icons: iconsSchema.optional(),
  variantDecorations: z
    .strictObject({
      light: decorationSchema.optional(),
      dark: decorationSchema.optional(),
    })
    .optional(),
  homeIdentity: z
    .strictObject({
      name: z
        .union([
          visibilitySchema,
          z.strictObject({ mode: z.literal('custom'), text: plainText(40) }),
        ])
        .optional(),
      logo: z
        .union([visibilitySchema, z.strictObject({ mode: z.literal('custom'), asset: identifier })])
        .optional(),
    })
    .optional(),
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;
export type ThemeDecoration = z.infer<typeof decorationSchema>;
export type ThemeImage = z.infer<typeof imageSchema>;

export function themeJsonSchema() {
  // Reuse shared light/dark, color, image and slot definitions. Inlining the
  // same contract at every occurrence consumes almost the entire send budget.
  return z.toJSONSchema(themeManifestSchema, { reused: 'ref' });
}

export class ThemeValidationError extends Error {
  constructor(readonly issues: readonly { path: string; message: string }[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ThemeValidationError';
  }
}

export function parseThemeManifest(text: string): ThemeManifest {
  // Bound both the pre-encoding allocation and the actual UTF-8 payload.
  if (
    text.length > THEME_LIMITS.manifestBytes ||
    new TextEncoder().encode(text).length > THEME_LIMITS.manifestBytes
  ) {
    throw new ThemeValidationError([{ path: '$', message: 'Theme manifest exceeds 256 KiB' }]);
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ThemeValidationError([
      { path: '$', message: 'Expected a complete JSON theme manifest' },
    ]);
  }
  // Asked before the schema runs, and off the raw input, so a pack from a later
  // format is told what is actually wrong with it rather than being walked
  // through the ways it fails to be a v1 manifest.
  if (
    input !== null &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    typeof input.schemaVersion === 'number' &&
    input.schemaVersion > SUPPORTED_SCHEMA_VERSION
  ) {
    throw new ThemeValidationError([
      {
        path: 'schemaVersion',
        message: `This theme needs a newer version of Muqun (it uses theme format ${input.schemaVersion}, this app reads ${SUPPORTED_SCHEMA_VERSION})`,
      },
    ]);
  }
  const parsed = themeManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ThemeValidationError(
      parsed.error.issues.slice(0, 20).map((issue) => ({
        path: issue.path.join('.') || '$',
        message: issue.message,
      }))
    );
  }
  const manifest = parsed.data;
  const assets = manifest.assets ?? {};
  const issues: { path: string; message: string }[] = [];
  if (Object.keys(assets).length > THEME_LIMITS.assets) {
    issues.push({ path: 'assets', message: 'At most 32 assets are allowed' });
  }
  const reference = (asset: string, path: string) => {
    if (!Object.hasOwn(assets, asset)) issues.push({ path, message: `Unknown asset: ${asset}` });
  };
  const decorations = (value: ThemeDecoration | undefined, path: string) => {
    for (const [key, slot] of Object.entries(value ?? {})) {
      if (!slot) continue;
      reference(slot.asset, `${path}.${key}.asset`);
      for (const width of ['compact', 'regular'] as const) {
        if (slot[width]) reference(slot[width].asset, `${path}.${key}.${width}.asset`);
      }
    }
  };
  decorations(manifest.decoration, 'decoration');
  decorations(manifest.variantDecorations?.light, 'variantDecorations.light');
  decorations(manifest.variantDecorations?.dark, 'variantDecorations.dark');
  if (manifest.homeIdentity?.logo?.mode === 'custom') {
    reference(manifest.homeIdentity.logo.asset, 'homeIdentity.logo.asset');
  }
  // The app never draws it, but a dangling reference is still a mistake, and an
  // author finds out here rather than from a gallery card with a hole in it.
  if (manifest.preview !== undefined) reference(manifest.preview, 'preview');
  if (issues.length) throw new ThemeValidationError(issues.slice(0, 20));
  return manifest;
}
