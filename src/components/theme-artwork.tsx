import { useThemeMode } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Image as RepeatingImage, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useThemeLibrary } from '@/stores/theme-library';
import { resolveThemeImage } from '@/theme/resolve';
import type { ThemeManifest, ThemeSlot } from '@/theme/schema';

export function ThemeArtwork({
  slot,
  fallbackSlot,
}: {
  slot: ThemeSlot;
  fallbackSlot?: ThemeSlot;
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
}: {
  manifest: ThemeManifest;
  assets: Record<string, string>;
  slot: ThemeSlot;
  mode: 'light' | 'dark';
  fallbackSlot?: ThemeSlot;
}) {
  const { width } = useWindowDimensions();
  const [failed, setFailed] = useState<string | null>(null);
  const size = width >= 768 ? 'regular' : 'compact';
  const image =
    resolveThemeImage(manifest, slot, mode, size) ??
    (fallbackSlot ? resolveThemeImage(manifest, fallbackSlot, mode, size) : null);
  const uri = image ? assets[image.asset] : undefined;
  if (!image || !uri?.startsWith('file:///') || failed === uri) return null;
  const style = [StyleSheet.absoluteFill, { opacity: image.opacity ?? 1 }];
  return (
    <View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}>
      {image.fit === 'tile' ? (
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
          contentFit={image.fit ?? 'cover'}
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
