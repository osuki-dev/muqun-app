/**
 * The theme pack's opacity and artwork, applied to every kit surface at once.
 *
 * The kit paints each of its fills through one decorator, so the reader's
 * "Interface background opacity" and the pack's per-slot artwork reach a kit
 * `Card`, `Button`, `Input` or `Tabs` without a wrapper around each one. The
 * app's own surfaces keep calling `useSurfaceBackground` and mount the same
 * artwork with the kit's `SurfaceDecoration`.
 */
import {
  SurfaceDecoratorProvider,
  type ButtonVariant,
  useThemeTokens,
  type SurfaceMeta,
} from '@osuki-dev/ui';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useWindowDimensions } from 'react-native';

import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { safeArtworkOpacity } from '@/theme/artwork-contrast';
import { jointArtworkOpacity } from '@/theme/opacity-policy';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { resolveThemeImage } from '@/theme/resolve';
import { surfaceBackgroundFill } from '@/theme/surface-background';
import { THEME_SLOTS, type ThemeSlot } from '@/theme/schema';

declare module '@osuki-dev/ui' {
  // The pack's own slots, painted on app surfaces through `Surface` and
  // `SurfaceDecoration`, and `cards.plain`: a kit `Card` that thins with the
  // slider but carries no pack artwork.
  // oxlint-disable-next-line typescript/no-empty-object-type -- module augmentation; the members come from `extends`
  interface SurfaceSlotRegistry extends Record<ThemeSlot | 'cards.plain', true> {}
}

/**
 * The kit fills that follow the reader's slider: exactly the ones the app has
 * always thinned (its cards and planes, buttons, fields and their error pill,
 * placeholders, toasts, and the pack's own slots). Every other kit fill --
 * tags, alerts, dialogs, sheets, segmented tracks and their selection, badges,
 * the settings tabs' solid track and selection -- keeps its authored colour, as
 * it did before the kit had a decorator.
 */
const TRANSLUCENT_SLOTS = new Set<string>([
  ...THEME_SLOTS,
  'cards.plain',
  'surfaces.surface',
  'surfaces.raised',
  'buttons.primary.background',
  'buttons.secondary.background',
  'buttons.ghost.background',
  'buttons.destructive.background',
  'inputs.background',
  'inputs.search',
  'inputs.error',
  'skeleton.fill',
  'toasts.background',
]);

/**
 * A pill `Tabs` in `segments` layering (`usePillTabsLayering`): each idle
 * trigger's track fill and the selected trigger's own surface are side by side,
 * not stacked, so both thin with the slider. The `overlay` layering's track and
 * selection stay solid marks.
 */
function isTabsSegment(meta: SurfaceMeta): boolean {
  return (
    (meta.slot === 'tabs.track' && meta.variant === 'segment') ||
    (meta.slot === 'tabs.selected' && meta.role === 'surface')
  );
}

const PACK_SLOTS = new Set<string>(THEME_SLOTS);

function packSlot(meta: SurfaceMeta): ThemeSlot | null {
  // A clear fill has nothing to hold artwork against.
  if (!meta.slot || meta.baseColor === 'transparent') return null;
  return PACK_SLOTS.has(meta.slot) ? (meta.slot as ThemeSlot) : null;
}

/**
 * The pack's artwork for one slot, at the most opacity the fill under it can
 * take before its text loses contrast. The kit places it in an absolute,
 * non-interactive layer clipped to the surface.
 */
function SlotArtwork({ slot, meta }: { slot: ThemeSlot; meta: SurfaceMeta }) {
  const { colors, components, mode } = useThemeTokens();
  const sliderOpacity = useSurfaceBackgroundOpacity();
  const { width } = useWindowDimensions();
  const { theme: active, assets } = useEffectiveCustomTheme();
  const artwork = active
    ? resolveThemeImage(active.manifest, slot, mode, width >= 768 ? 'regular' : 'compact')
    : null;
  const hasImage = Boolean(artwork && isRenderableThemeAsset(assets?.[artwork.asset]));
  // A button's artwork is held against its own label, anything else against
  // every text and accent ink the surface may carry.
  const button = meta.slot?.startsWith('buttons.')
    ? components.Button[meta.variant as ButtonVariant]
    : undefined;
  const inks = button
    ? [{ color: colors[button.foreground], minimum: 4.5 }]
    : [
        ...(['text', 'textMuted', 'textSubtle'] as const).map((key) => ({
          color: colors[key],
          minimum: 4.5,
        })),
        ...(['primary', 'danger', 'info', 'success', 'warning'] as const).map((key) => ({
          color: colors[key],
          minimum: 3,
        })),
      ];
  const opacity =
    !hasImage || meta.disabled || meta.selected
      ? 0
      : jointArtworkOpacity(
          safeArtworkOpacity(meta.baseColor, inks, 1),
          sliderOpacity,
          artwork?.opacity ?? 1
        );
  if (!active || !assets || opacity <= 0) return null;
  return (
    <ThemeArtworkLayer
      manifest={active.manifest}
      assets={assets}
      slot={slot}
      mode={mode}
      opacityLimit={opacity}
    />
  );
}

export function AppSurfaceDecorator({ children }: { children: ReactNode }) {
  const opacity = useSurfaceBackgroundOpacity();
  const { theme: active } = useEffectiveCustomTheme();
  // Recreated when the slider moves: the kit memoises fills on its identity.
  // An opaque theme needs no transform at all.
  const transformBackground = useMemo(
    () =>
      opacity === 1
        ? undefined
        : (color: string, meta: SurfaceMeta) =>
            meta.slot && (TRANSLUCENT_SLOTS.has(meta.slot) || isTabsSegment(meta))
              ? surfaceBackgroundFill(color, opacity)
              : color,
    [opacity]
  );
  const renderDecoration = useCallback(
    (meta: SurfaceMeta) => {
      const slot = active ? packSlot(meta) : null;
      return slot ? <SlotArtwork slot={slot} meta={meta} /> : null;
    },
    [active]
  );
  return (
    <SurfaceDecoratorProvider
      transformBackground={transformBackground}
      renderDecoration={renderDecoration}>
      {children}
    </SurfaceDecoratorProvider>
  );
}
