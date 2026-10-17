import { useThemeMode } from '@osuki-dev/ui';
import { useMemo } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { flattenStyle } from '@/lib/flatten-style';

import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { safeArtworkOpacity } from '@/theme/artwork-contrast';
import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeSlot } from '@/theme/schema';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { jointArtworkOpacity } from '@/theme/opacity-policy';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';

type ArtworkProps = {
  slot: ThemeSlot;
  /** Actual solid token underneath the shared background-alpha plane. */
  baseColor: string;
  /** State styling and interaction remain the caller's responsibility. */
  disabled?: boolean;
  selected?: boolean;
};

type ArtworkContrast = {
  /** The alpha the fill under the artwork is painted at. Defaults to the reader's slider. */
  baseAlpha?: number;
  /** The one label the artwork must keep legible, instead of every text and accent ink. */
  ink?: string;
};

/** Absolute, noninteractive decoration for an already positioned/clipped surface. */
export function ThemedSurfaceArtwork({
  slot,
  baseColor,
  disabled,
  selected,
  baseAlpha,
  ink,
}: ArtworkProps & ArtworkContrast) {
  const { resolvedMode } = useThemeMode();
  const sliderOpacity = useSurfaceBackgroundOpacity();
  const baseOpacity = baseAlpha ?? sliderOpacity;
  const { width } = useWindowDimensions();
  const { theme: active, assets } = useEffectiveCustomTheme();
  const artwork = active
    ? resolveThemeImage(active.manifest, slot, resolvedMode, width >= 768 ? 'regular' : 'compact')
    : null;
  const hasImage = Boolean(artwork && isRenderableThemeAsset(assets?.[artwork.asset]));
  const opacity = useMemo(() => {
    if (!active || !hasImage || disabled || selected) return 0;
    const { colors } = active.manifest.variants[resolvedMode];
    const opaqueMaximum = safeArtworkOpacity(
      baseColor,
      ink
        ? [{ color: ink, minimum: 4.5 }]
        : [
            ...(['text', 'textMuted', 'textSubtle'] as const).map((key) => ({
              color: colors[key],
              minimum: 4.5,
            })),
            ...(['primary', 'danger', 'info', 'success', 'warning'] as const).map((key) => ({
              color: colors[key],
              minimum: 3,
            })),
          ],
      1
    );
    return jointArtworkOpacity(opaqueMaximum, baseOpacity, artwork?.opacity ?? 1);
  }, [
    active,
    hasImage,
    disabled,
    selected,
    resolvedMode,
    baseColor,
    ink,
    artwork?.opacity,
    baseOpacity,
  ]);
  if (!active || !assets || !hasImage || opacity <= 0) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}>
      <ThemeArtworkLayer
        manifest={active.manifest}
        assets={assets}
        slot={slot}
        mode={resolvedMode}
        opacityLimit={opacity}
      />
    </View>
  );
}

/**
 * A View-compatible surface: no additional padding, height, hit targets or
 * content wrapper. The caller keeps its existing state colors and gestures.
 */
export function ThemedSurface({
  slot,
  baseColor,
  disabled,
  selected,
  style,
  children,
  accessibilityState,
  ...props
}: ViewProps & ArtworkProps) {
  const background = useSurfaceBackground();
  const override = flattenStyle<ViewStyle>(style)?.backgroundColor;
  const actualBase = typeof override === 'string' ? override : baseColor;
  return (
    <View
      {...props}
      accessibilityState={
        disabled === undefined && selected === undefined
          ? accessibilityState
          : {
              ...accessibilityState,
              ...(disabled === undefined ? {} : { disabled }),
              ...(selected === undefined ? {} : { selected }),
            }
      }
      style={[style, { backgroundColor: background(actualBase) }]}>
      <ThemedSurfaceArtwork
        slot={slot}
        baseColor={actualBase}
        disabled={disabled ?? accessibilityState?.disabled}
        selected={selected ?? accessibilityState?.selected}
      />
      {children}
    </View>
  );
}
