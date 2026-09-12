import { useThemeMode } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Image as RepeatingImage, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useThemeLibrary } from '@/stores/theme-library';
import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeManifest, ThemeSlot } from '@/theme/schema';

/** Use only to choose native fallback content; rendered artwork still validates its URI. */
export function useHasThemeArtwork(slot: ThemeSlot, fallbackSlot?: ThemeSlot) {
  const { resolvedMode } = useThemeMode();
  const { width } = useWindowDimensions();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((entry) => entry.id === state.active?.installationId)?.assets
  );
  const image = active
    ? resolveThemeImage(
        active.manifest,
        slot,
        resolvedMode,
        width >= 768 ? 'regular' : 'compact',
        true,
        fallbackSlot
      )
    : null;
  return Boolean(image && assets?.[image.asset]?.startsWith('file:///'));
}

export function ThemeArtwork({
  slot,
  fallbackSlot,
  banner = false,
  opacityLimit = 1,
}: {
  slot: ThemeSlot;
  fallbackSlot?: ThemeSlot;
  banner?: boolean;
  opacityLimit?: number;
}) {
  const { resolvedMode } = useThemeMode();
  const active = useThemeLibrary((state) => state.active);
  const assets = useThemeLibrary(
    (state) =>
      state.library.themes.find((theme) => theme.id === state.active?.installationId)?.assets
  );
  if (!active || !assets) return null;
  return (
    <ThemeArtworkLayer
      manifest={active.manifest}
      assets={assets}
      slot={slot}
      fallbackSlot={fallbackSlot}
      mode={resolvedMode}
      banner={banner}
      opacityLimit={opacityLimit}
    />
  );
}

/** Artwork has no hit targets, accessibility nodes, network URLs or layout footprint. */
export function ThemeArtworkLayer({
  manifest,
  assets,
  slot,
  mode,
  fallbackSlot,
  banner = false,
  opacityLimit = 1,
  viewport,
}: {
  manifest: ThemeManifest;
  assets: Record<string, string>;
  slot: ThemeSlot;
  mode: 'light' | 'dark';
  fallbackSlot?: ThemeSlot;
  banner?: boolean;
  opacityLimit?: number;
  /** Preview cards model a compact screen independently of their parent window. */
  viewport?: 'compact' | 'regular';
}) {
  const { width } = useWindowDimensions();
  const [failed, setFailed] = useState<string | null>(null);
  const size = viewport ?? (width >= 768 ? 'regular' : 'compact');
  const image = resolveThemeImage(manifest, slot, mode, size, true, fallbackSlot);
  const uri = image ? assets[image.asset] : undefined;
  if (!image || !uri?.startsWith('file:///') || failed === uri) return null;
  const style = [StyleSheet.absoluteFill, { opacity: Math.min(image.opacity ?? 1, opacityLimit) }];
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={banner ? styles.banner : StyleSheet.absoluteFill}>
      {image.fit === 'tile' && !banner ? (
        // expo-image explicitly does not support repeat. Use RN's native tile path
        // only for this fit mode; both paths consume the same validated local file.
        <RepeatingImage
          source={{ uri }}
          resizeMode="repeat"
          accessible={false}
          style={style}
          onError={() => setFailed(uri)}
        />
      ) : (
        <Image
          source={{ uri }}
          contentFit={banner || image.fit === 'tile' ? 'contain' : (image.fit ?? 'cover')}
          contentPosition={
            image.focalPoint
              ? { left: `${image.focalPoint.x * 100}%`, top: `${image.focalPoint.y * 100}%` }
              : 'center'
          }
          cachePolicy="memory"
          autoplay={false}
          accessible={false}
          style={style}
          onError={() => setFailed(uri)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    width: '100%',
    maxWidth: 560,
    aspectRatio: 2,
    alignSelf: 'center',
    borderRadius: 20,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});
