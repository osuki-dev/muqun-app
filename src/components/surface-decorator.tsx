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
  type SurfaceSlot,
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
  /** The pack's own slots, painted on app surfaces through `SurfaceDecoration`. */
  // oxlint-disable-next-line typescript/no-empty-object-type -- module augmentation; the members come from `extends`
  interface SurfaceSlotRegistry extends Record<ThemeSlot, true> {}
}

/**
 * Fills that keep their authored colour whatever the slider says.
 *
 * - Marks (badges, toggle tracks) carry meaning by their colour.
 * - Selection controls: a segmented track says where the choices are and which
 *   side you are not on, and has to stay legible against any wallpaper; the
 *   selected pill over it is solid for the same reason, so the chosen side does
 *   not go muddy with the track showing through it. Two opaque fills, one mark.
 * - Floors: a dialog or a sheet body is the single opaque base of what it
 *   presents, or the screen underneath shows through.
 */
const AUTHORED_SLOTS = new Set<SurfaceSlot>([
  'tabs.track',
  'tabs.selected',
  'segmented.track',
  'segmented.selected',
  'dialogs.background',
  'sheets.background',
  'sheets.action',
  'screens.page',
]);

function keepsAuthoredFill(meta: SurfaceMeta): boolean {
  return meta.role === 'mark' || (meta.slot !== undefined && AUTHORED_SLOTS.has(meta.slot));
}

/** Kit slots that draw a pack slot of another name. */
const PACK_SLOT_ALIASES: Partial<Record<SurfaceSlot, ThemeSlot>> = {
  'tabs.track': 'tabs.background',
  'segmented.track': 'tabs.background',
};

const PACK_SLOTS = new Set<string>(THEME_SLOTS);

function packSlot(slot: SurfaceSlot | undefined): ThemeSlot | null {
  if (!slot) return null;
  return PACK_SLOT_ALIASES[slot] ?? (PACK_SLOTS.has(slot) ? (slot as ThemeSlot) : null);
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
  const baseAlpha = keepsAuthoredFill(meta) ? 1 : sliderOpacity;
  const opacity =
    !hasImage || meta.disabled || meta.selected
      ? 0
      : jointArtworkOpacity(
          safeArtworkOpacity(meta.baseColor, inks, 1),
          baseAlpha,
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
            keepsAuthoredFill(meta) ? color : surfaceBackgroundFill(color, opacity),
    [opacity]
  );
  // Always mounted, so a kit control lays itself out the same way whether or
  // not the theme has artwork (the kit's SegmentedControl uses the system
  // widget on iOS only when nothing decorates fills).
  const renderDecoration = useCallback(
    (meta: SurfaceMeta) => {
      const slot = active ? packSlot(meta.slot) : null;
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
