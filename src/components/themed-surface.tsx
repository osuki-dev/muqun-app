import { useThemeMode } from '@osuki-dev/ui';
import { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View, type ViewProps } from 'react-native';

import { ThemeArtworkLayer } from '@/components/theme-artwork';
import { useThemeLibrary } from '@/stores/theme-library';
import { safeArtworkOpacity } from '@/theme/artwork-contrast';
import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeSlot } from '@/theme/schema';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { jointArtworkOpacity } from '@/theme/opacity-policy';

type ArtworkProps = {
  slot: ThemeSlot;
  /** Actual solid token underneath the shared background-alpha plane. */
  baseColor: string;
  /** State styling and interaction remain the caller's responsibility. */
  disabled?: boolean;
  selected?: boolean;
};

/** Absolute, noninteractive decoration for an already positioned/clipped surface. */
export function ThemedSurfaceArtwork({ slot, baseColor, disabled, selected }: ArtworkProps) {
  const { resolvedMode } = useThemeMode();
  const baseOpacity = useSurfaceBackgroundOpacity();
  const { width } = useWindowDimensions();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const artwork = active
    ? resolveThemeImage(active.manifest, slot, resolvedMode, width >= 768 ? 'regular' : 'compact')
    : null;
  const hasImage = Boolean(artwork && assets?.[artwork.asset]?.startsWith('file:///'));
  const opacity = useMemo(() => {
    if (!active || !hasImage || disabled || selected) return 0;
    const { colors } = active.manifest.variants[resolvedMode];
    const opaqueMaximum = safeArtworkOpacity(
      baseColor,
      [
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
  const override = StyleSheet.flatten(style)?.backgroundColor;
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
