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

export const decorationSchema = z.strictObject({
  'shell.background': slotSchema,
  'home.background': slotSchema,
  'home.decoration': slotSchema,
  'navigation.background': slotSchema,
  'composer.background': slotSchema,
  'actions.background': slotSchema,
  'cards.decoration': slotSchema,
  'buttons.primary.background': slotSchema,
  'tabs.background': slotSchema,
  'emptyState.illustration': slotSchema,
});

const visibilitySchema = z.union([
  z.strictObject({ mode: z.literal('default') }),
  z.strictObject({ mode: z.literal('hidden') }),
]);

const materialSchema = z.enum(['auto', 'solid', 'glass']);
export const themeMaterialsSchema = z.strictObject({
  default: materialSchema.optional(),
  navigation: materialSchema.optional(),
  composer: materialSchema.optional(),
  actions: materialSchema.optional(),
});

/** Structural schema only: references, download policy and contrast are separate gates. */
export const themeManifestSchema = z.strictObject({
  format: z.literal('muqun-theme'),
  schemaVersion: z.literal(1),
  id: identifier,
  name: plainText(64),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .max(32),
  author: plainText(100).optional(),
  license: plainText(100).optional(),
  source: httpsUrl.optional(),
  variants: z.strictObject({ light: themeVariantSchema, dark: themeVariantSchema }),
  materials: themeMaterialsSchema.optional(),
  assets: z.record(identifier, assetSchema).optional(),
  decoration: decorationSchema.optional(),
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
export type ThemeSlot = keyof ThemeDecoration;
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
  if (issues.length) throw new ThemeValidationError(issues.slice(0, 20));
  return manifest;
}
