import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type ViewInstance } from 'react-native';
import { Image } from 'expo-image';
import { useThemeTokens } from '@osuki-dev/ui';
import { Canvas, Group, type SkImage } from 'react-native-skia';
import { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { SnapDust, SNAP_DUST_EFFECT } from '@/components/launch-snap';
import { DURATION, timing } from '@/lib/motion';
import type { PreviewImageSource } from '@/lib/gateway-image-previews';
import { disposeViewPhotograph, photographView } from '@/lib/view-photograph';

/** Start from the cached thumbnail, independently of the full-resolution download. */
export function ImagePreviewReveal({
  children,
  ready,
  thumbnail,
  openingCapture,
  width,
  height,
}: {
  children: ReactNode;
  ready: boolean;
  thumbnail?: PreviewImageSource;
  openingCapture?: Promise<SkImage | null>;
  width: number;
  height: number;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const enabled = !reduced && Boolean(SNAP_DUST_EFFECT) && Boolean(thumbnail || openingCapture);
  const ref = useRef<ViewInstance>(null);
  const progress = useSharedValue(0.82);
  const [decoded, setDecoded] = useState(false);
  const [snapshot, setSnapshot] = useState<SkImage | null>(null);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const captureWidth = openingCapture ? 0 : width;
  const captureHeight = openingCapture ? 0 : height;
  useEffect(() => {
    if ((!decoded && !openingCapture) || !enabled) return;
    let cancelled = false;
    let owned: SkImage | null = null;
    void (
      openingCapture ??
      photographView(ref, captureWidth, captureHeight, { zeroCopy: Platform.OS !== 'android' })
    )
      .then((image) => {
        if (cancelled) {
          if (image && !openingCapture) disposeViewPhotograph(image);
          return;
        }
        owned = image;
        if (image) setSnapshot(image);
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (owned && !openingCapture) disposeViewPhotograph(owned);
    };
  }, [decoded, enabled, captureWidth, captureHeight, openingCapture]);
  useEffect(() => {
    if (!enabled || snapshot) return;
    // A failed thumbnail or GPU must never block the actual image.
    const timer = setTimeout(() => setFailed(true), DURATION.long * 4);
    return () => clearTimeout(timer);
  }, [enabled, snapshot]);
  const revealing = enabled && !failed && !(done && ready);
  const scale = snapshot ? Math.min(width / snapshot.width(), height / snapshot.height()) : 1;
  const frameWidth = snapshot ? snapshot.width() * scale : width;
  const frameHeight = snapshot ? snapshot.height() * scale : height;
  return (
    <View style={styles.root}>
      <View style={[styles.root, { opacity: revealing ? 0 : 1 }]}>{children}</View>
      {revealing ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {!openingCapture && thumbnail ? (
            <View ref={ref} collapsable={false} style={StyleSheet.absoluteFill}>
              <Image
                source={thumbnail}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={0}
                onDisplay={() => setDecoded(true)}
                onError={() => setFailed(true)}
              />
            </View>
          ) : null}
          {/* Cover the capture surface before its first frame: no full-image flash. */}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]} />
          {snapshot ? (
            <Canvas style={StyleSheet.absoluteFill}>
              <Group
                transform={[
                  { translateX: (width - frameWidth) / 2 },
                  { translateY: (height - frameHeight) / 2 },
                ]}
                clip={{ x: 0, y: 0, width: frameWidth, height: frameHeight }}>
                <SnapDust
                  image={snapshot}
                  tint={theme.colors.primary}
                  width={frameWidth}
                  progress={progress}
                  onReady={() => {
                    progress.set(
                      withTiming(0, timing(DURATION.long + DURATION.medium), (finished) => {
                        if (finished) scheduleOnRN(setDone, true);
                      })
                    );
                  }}
                />
              </Group>
            </Canvas>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ root: { flex: 1, width: '100%' } });
