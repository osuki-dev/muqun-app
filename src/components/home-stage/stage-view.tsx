import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import {
  Blur,
  Canvas,
  Group,
  LinearGradient,
  Mask,
  Rect,
  RoundedRect,
  Image as SkiaImage,
  rect,
  vec,
} from 'react-native-skia';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MapErrorBoundary } from '@/components/computer-map/error-boundary';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemeRenderReady } from '@/hooks/use-theme-render-ready';
import {
  stageDefaultFloor,
  stageHeroPlacement,
  stageHostTarget,
  stagePaintingPlacement,
  stageSwipeTarget,
  type StageArtPlacement,
  type StageViewport,
} from '@/lib/home-stage-geometry';
import { heroFeatherGeometry } from '@/lib/hero-feather';
import { hasSeenStageHints, markStageHintsSeen } from '@/lib/home-stage-hints';
import type { StageComposition, StageLayer } from '@/lib/home-stage-layers';
import { useSharedSkiaImage } from '@/lib/skia-image-cache';
import { useAppSettings } from '@/stores/app-settings';
import {
  lowestStageQuality,
  stageEffects,
  STAGE_TILT_DEADBAND,
  STAGE_TILT_WAKE,
  type StageQuality,
} from '@/lib/home-stage-motion';
import type { StagePicture } from './stage-scene';
import { useStageTexture, type StageTextureState } from './stage-textures';
import { createStageBridge, type StageInputs, type StageOpener } from './types';

// An older binary, or web, keeps the static stage without evaluating the native module.
const GpuStage = lazy(() => import('./gpu-stage'));

/** Texture caps: the cover layers fill the screen; the art stands most of its height. */
const COVER_MAX_EDGE = 2048;
const HERO_MAX_EDGE = 1536;
/** Under a sky painting the wallpaper is only a faint base: a smaller texture does. */
const BASE_MAX_EDGE = 1024;
/** The camera's push into the art before a computer or an agent opens. */
const DIVE_MS = 520;

/** The lowest quality rung the stage has stepped down to this session; never raised. */
const session: { quality: StageQuality } = { quality: 'full' };

export type StageViewProps = {
  /** How many computers there are; a sideways swipe moves between them. */
  count: number;
  selectedIndex: number;
  /** Which picture is which layer, and how each is drawn (`useStageComposition`). */
  composition: StageComposition;
  /** The pictures the theme's reskin waits for. */
  wallpaperUri?: string;
  artworkUri?: string;
  /** The safe area's top inset, in points: the HUD starts below it. */
  inset: number;
  /**
   * How far above the view's bottom the HUD's foot rows (the agents, the
   * sessions, the composer) start, in points; 0 while unmeasured. The art
   * stands on them.
   */
  foot: number;
  /** Home is not on screen or the app is in the background: no frames. */
  paused: boolean;
  /** Bumped when a task completes. */
  burst: number;
  /** The HUD opens computers and agents through it, so the camera can push in first. */
  opener: StageOpener;
  onSelect: (index: number) => void;
  onNewTask: () => void;
};

/** How many fresh canvases a session tries after a GPU failure before staying static. */
const STAGE_GPU_RETRIES = 3;

/**
 * The full-screen depth window: the theme's own pictures at their depths, in
 * the WebGPU scene when the device has it, otherwise (and after a lost
 * device) the same layout drawn flat. Above either sits the new-task target
 * and its first-visit hint; everything else to read or press is the HUD's.
 * The scene itself is never focusable.
 */
export function StageView({
  count,
  selectedIndex,
  composition,
  wallpaperUri,
  artworkUri,
  inset,
  foot,
  paused,
  burst,
  opener,
  onSelect,
  onNewTask,
}: StageViewProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const reducedMotion = useReducedMotion();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: 0, height: 0 });
  // A rung the stage stepped down to holds for the rest of the session.
  const [quality, setQuality] = useState<StageQuality>(() => session.quality);
  const lowered = useStableHandler((next: StageQuality) => {
    session.quality = lowestStageQuality(session.quality, next);
    setQuality(session.quality);
  });
  const [failed, setFailed] = useState(false);
  // A GPU failure (a lost device, a surface the system took back while the
  // app was away) falls back to the static stage, but only until Home is
  // shown again: then a fresh canvas gets another try, a few times a session.
  const [attempt, setAttempt] = useState(0);
  const fail = useStableHandler(() => setFailed(true));
  useEffect(() => {
    if (paused || !failed || attempt >= STAGE_GPU_RETRIES) return;
    setFailed(false);
    setAttempt((tries) => tries + 1);
  }, [paused, failed, attempt]);
  const [diving, setDiving] = useState(false);
  const [hints, setHints] = useState(() => !hasSeenStageHints());
  const [gpuAvailable] = useState(
    () => Platform.OS !== 'web' && TurboModuleRegistry.get('WebGPUModule') !== null
  );
  const effects = stageEffects(quality, {
    gpuAvailable: gpuAvailable && !failed,
    reducedMotion,
  });
  const [bridge] = useState(createStageBridge);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const settle = useSharedValue(-1);
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const inputs: StageInputs = useMemo(
    () => ({ dragX, dragY, dragging, settle, tiltX, tiltY }),
    [dragX, dragY, dragging, settle, tiltX, tiltY]
  );

  const { role } = composition;
  const dpr = Math.min(3, Math.max(1, window.scale));
  const coverEdge = Math.min(COVER_MAX_EDGE, Math.round(window.height * dpr));
  const heroEdge = Math.min(HERO_MAX_EDGE, Math.round(window.height * dpr * 0.8));
  const gpuUri = (layer: StageLayer | null) => (effects.gpu ? layer?.uri : undefined);
  const backdropTexture = useStageTexture(
    gpuUri(composition.backdrop),
    role === 'sky' ? Math.min(BASE_MAX_EDGE, coverEdge) : coverEdge
  );
  const paintingTexture = useStageTexture(gpuUri(composition.painting), coverEdge);
  const heroTexture = useStageTexture(gpuUri(composition.hero), heroEdge);
  const frameTexture = useStageTexture(gpuUri(composition.frame), coverEdge);
  // A reskin holds its cover until the layers are chosen and their textures are in (or failed).
  const settled =
    composition.ready &&
    (!effects.gpu ||
      [backdropTexture, paintingTexture, heroTexture, frameTexture].every(
        (state) => state.status !== 'loading'
      ));
  useThemeRenderReady(artworkUri, settled);
  useThemeRenderReady(wallpaperUri, settled);
  const backdrop = usePicture(backdropTexture, composition.backdrop);
  const painting = usePicture(paintingTexture, composition.painting);
  const hero = usePicture(heroTexture, composition.hero);
  const frame = usePicture(frameTexture, composition.frame);
  const colors = useMemo(
    () => ({
      background: theme.colors.background,
      surface: theme.colors.surface,
      primary: theme.colors.primary,
    }),
    [theme.colors]
  );

  // The theme's ambient effect for this variant, resolved as the 2D layer
  // resolves it (`theme-artwork.tsx`): the variant's own, else the theme's.
  const { theme: customTheme } = useEffectiveCustomTheme();
  const effectsEnabled = useAppSettings((state) => state.themeEffectsEnabled);
  const manifest = customTheme?.manifest;
  const themeEffects = manifest
    ? (manifest.variants[resolvedMode]?.effects ?? manifest.effects ?? null)
    : null;
  const ambientEffects = effectsEnabled ? themeEffects : null;
  const ambientColors = useMemo(
    () => ({
      primary: theme.colors.primary,
      text: theme.colors.text,
      textMuted: theme.colors.textMuted,
      info: theme.colors.info,
      success: theme.colors.success,
      warning: theme.colors.warning,
    }),
    [theme.colors]
  );

  // Back on Home after a dive: the camera returns to the window.
  useEffect(() => {
    if (!paused) setDiving(false);
  }, [paused]);
  const touched = useStableHandler(() => {
    if (!hints) return;
    setHints(false);
    markStageHintsSeen();
  });
  /** Push into the art, then run `open`; straight away without the scene or its motion. */
  const diveThen = useStableHandler((open: () => void) => {
    touched();
    if (!effects.gpu || reducedMotion) {
      open();
      return;
    }
    setDiving(true);
    setTimeout(open, DIVE_MS);
  });
  useEffect(() => {
    opener.setOpener(diveThen);
    return () => opener.setOpener(null);
  }, [opener, diveThen]);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(10)
        .onStart(() => {
          settle.set(-1);
          dragging.set(1);
          scheduleOnRN(bridge.wake);
          scheduleOnRN(touched);
        })
        .onUpdate((event) => {
          dragX.set(size.width > 0 ? event.translationX / size.width : 0);
          dragY.set(size.height > 0 ? event.translationY / size.height : 0);
        })
        .onEnd((event) => {
          // Sideways moves between computers; up and down only looks around.
          if (Math.abs(event.translationX) < Math.abs(event.translationY)) return;
          const target = stageSwipeTarget(
            selectedIndex,
            count,
            event.translationX,
            event.velocityX,
            size.width
          );
          settle.set(target);
          if (target !== selectedIndex) scheduleOnRN(onSelect, target);
        })
        .onFinalize(() => {
          dragging.set(0);
          dragX.set(0);
          dragY.set(0);
          scheduleOnRN(bridge.wake);
        }),
    [
      bridge,
      count,
      dragX,
      dragY,
      dragging,
      onSelect,
      selectedIndex,
      settle,
      size.width,
      size.height,
      touched,
    ]
  );

  const floor = foot > 0 ? Math.max(0, size.height - foot) : stageDefaultFloor(size.height);
  const viewport = useMemo(
    () => ({ width: size.width, height: size.height, inset, floor }),
    [size.width, size.height, inset, floor]
  );
  const art = useStageArt(composition, viewport);
  const host = useMemo(
    () => (viewport.width > 0 && viewport.height > 0 ? stageHostTarget(art, viewport) : null),
    [art, viewport]
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        testID="home-stage"
        style={StyleSheet.absoluteFill}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setSize((previous) =>
            previous.width === width && previous.height === height ? previous : { width, height }
          );
        }}>
        {effects.gpu ? (
          <MapErrorBoundary key={attempt} onError={fail}>
            <Suspense fallback={null}>
              <GpuStage
                count={count}
                selected={selectedIndex}
                colors={colors}
                mode={resolvedMode}
                role={role}
                inset={inset}
                floor={floor}
                backdrop={backdrop}
                painting={painting}
                hero={hero}
                frame={frame}
                ambientEffects={ambientEffects}
                ambientColors={ambientColors}
                quality={quality}
                reducedMotion={reducedMotion}
                dive={diving}
                burst={burst}
                paused={paused}
                inputs={inputs}
                bridge={bridge}
                onQualityDrop={lowered}
                onError={fail}
              />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <StaticStage composition={composition} art={art} />
        )}
        {effects.gpu && effects.tilt && !paused ? (
          <StageTilt tiltX={tiltX} tiltY={tiltY} onMoved={bridge.wake} />
        ) : null}
        {host && host.rect.width > 0 && host.rect.height > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <PressableScale
              testID="home-stage-host"
              accessibilityRole="button"
              accessibilityLabel={t`Start a new task`}
              onPress={() => {
                touched();
                onNewTask();
              }}
              style={[
                styles.hit,
                {
                  left: host.rect.x,
                  top: host.rect.y,
                  width: host.rect.width,
                  height: host.rect.height,
                },
              ]}
            />
            {hints && !diving ? (
              <StageHint text={t`Tap · start a new task`} at={host.hint} />
            ) : null}
          </View>
        ) : null}
      </View>
    </GestureDetector>
  );
}

/**
 * Device tilt as a smoothed offset from how the phone is being held, -1..1
 * per axis. The baseline follows the hand slowly, so any holding angle reads
 * as level and only movement looks around. Uses Reanimated's sensor, already
 * in the binary: no new native module.
 *
 * Changes under `STAGE_TILT_DEADBAND` are not written, so a phone held still
 * leaves the scene idle; a real movement wakes a scene that has stopped.
 */
function StageTilt({
  tiltX,
  tiltY,
  onMoved,
}: {
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
  onMoved: () => void;
}) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const baseX = useSharedValue<number | null>(null);
  const baseY = useSharedValue(0);
  const wokeX = useSharedValue(0);
  const wokeY = useSharedValue(0);
  useAnimatedReaction(
    () => sensor.sensor.get(),
    (gravity) => {
      const base = baseX.get();
      if (base === null) {
        baseX.set(gravity.x);
        baseY.set(gravity.y);
        return;
      }
      const nextX = base + (gravity.x - base) * 0.02;
      const nextY = baseY.get() + (gravity.y - baseY.get()) * 0.02;
      baseX.set(nextX);
      baseY.set(nextY);
      // About 2.5 m/s^2 of change (roughly 15 degrees) reaches the full look.
      // Clamped inline: React Compiler hoists a nested helper out of the
      // worklet, which then runs as a JS-thread function on the UI runtime.
      const lookX = Math.max(-1, Math.min(1, (gravity.y - nextY) / 2.5));
      const lookY = Math.max(-1, Math.min(1, (gravity.x - nextX) / 2.5));
      const nextTiltX = tiltX.get() + (lookX - tiltX.get()) * 0.3;
      const nextTiltY = tiltY.get() + (lookY - tiltY.get()) * 0.3;
      if (
        Math.abs(nextTiltX - tiltX.get()) < STAGE_TILT_DEADBAND &&
        Math.abs(nextTiltY - tiltY.get()) < STAGE_TILT_DEADBAND
      )
        return;
      tiltX.set(nextTiltX);
      tiltY.set(nextTiltY);
      if (
        Math.abs(nextTiltX - wokeX.get()) + Math.abs(nextTiltY - wokeY.get()) >=
        STAGE_TILT_WAKE
      ) {
        wokeX.set(nextTiltX);
        wokeY.set(nextTiltY);
        scheduleOnRN(onMoved);
      }
    }
  );
  return null;
}

/**
 * A layer's texture once it is in, with how the theme asks for it to be
 * drawn; the same object while neither changes, so a re-render of this view
 * does not re-render the scene.
 */
function usePicture<L extends StageLayer>(
  state: StageTextureState,
  layer: L | null
): StagePicture<L> | null {
  const texture = state.status === 'ready' ? state.source.texture : null;
  return useMemo(() => (texture && layer ? { texture, layer } : null), [texture, layer]);
}

/** The artwork laid out over the view, as the GPU scene lays it out; null for none. */
type StageArt = {
  kind: 'hero' | 'painting';
  layer: StageLayer;
  placement: StageArtPlacement;
  /** A framed picture dissolves at every edge rather than at its foot. */
  framed: boolean;
} | null;

function useStageArt(composition: StageComposition, viewport: StageViewport): StageArt {
  const { hero, painting } = composition;
  return useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return null;
    if (hero)
      return {
        kind: 'hero',
        layer: hero,
        placement: stageHeroPlacement(hero, viewport),
        framed: hero.feather === 'framed',
      };
    if (painting)
      return {
        kind: 'painting',
        layer: painting,
        placement: stagePaintingPlacement(painting, viewport),
        framed: false,
      };
    return null;
  }, [hero, painting, viewport]);
}

/** A chip hung from a point by a short leader line. */
function StageHint({ text, at }: { text: string; at: { x: number; y: number } }) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  // Hung by measured size: percentage transforms are not reliable on Android.
  const [box, setBox] = useState({ width: 0, height: 0 });
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setBox((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height }
        );
      }}
      style={[
        styles.hint,
        { left: at.x - box.width / 2, top: at.y - box.height, opacity: box.width > 0 ? 1 : 0 },
      ]}>
      <View
        style={[
          styles.hintChip,
          {
            backgroundColor: background(theme.colors.background),
            borderColor: theme.colors.primary,
          },
        ]}>
        <Text variant="caption" weight="semibold" numberOfLines={1}>
          {text}
        </Text>
      </View>
      <View style={[styles.hintLeader, { backgroundColor: theme.colors.primary }]} />
    </Animated.View>
  );
}

/**
 * The stage drawn flat: the same layout as the scene at rest -- the
 * wallpaper at its authored fit, focal point and opacity, the painting's
 * band or the figure in its box with the same fades, the frame -- without
 * parallax. Drawn without WebGPU or after a lost device.
 */
function StaticStage({ composition, art }: { composition: StageComposition; art: StageArt }) {
  const theme = useThemeTokens();
  const { backdrop, frame } = composition;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      {backdrop ? <StaticWallpaper layer={backdrop} /> : null}
      {art ? <StaticArt art={art} /> : null}
      {frame ? <StaticWallpaper layer={frame} /> : null}
    </View>
  );
}

/** A wallpaper as the 2D Home draws it: its fit, focal point (CSS object-position) and opacity. */
function StaticWallpaper({ layer }: { layer: StageLayer }) {
  return (
    <Image
      source={{ uri: layer.uri }}
      contentFit={layer.fit === 'contain' ? 'contain' : 'cover'}
      contentPosition={{ left: `${layer.focal.x * 100}%`, top: `${layer.focal.y * 100}%` }}
      cachePolicy="memory"
      accessible={false}
      style={[StyleSheet.absoluteFill, { opacity: layer.opacity }]}
    />
  );
}

/** The painting's band or the figure in its box, clipped and faded as the GPU scene draws it. */
function StaticArt({ art }: { art: NonNullable<StageArt> }) {
  const image = useSharedSkiaImage(art.layer.uri);
  const { plane, drawn, fade } = art.placement;
  if (!image || plane.width <= 0 || plane.height <= 0) return null;
  const feather = art.framed
    ? heroFeatherGeometry({ container: { width: plane.width, height: plane.height } })
    : null;
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      <Group clip={rect(plane.x, plane.y, plane.width, plane.height)}>
        <Mask
          mode="alpha"
          mask={
            feather ? (
              <RoundedRect
                x={plane.x + feather.mask.x}
                y={plane.y + feather.mask.y}
                width={feather.mask.width}
                height={feather.mask.height}
                r={feather.radius}
                color="white">
                <Blur blur={feather.blur} mode="decal" />
              </RoundedRect>
            ) : (
              <Rect x={plane.x} y={plane.y} width={plane.width} height={plane.height}>
                <LinearGradient
                  start={vec(0, plane.y)}
                  end={vec(0, plane.y + plane.height)}
                  colors={['white', 'white', 'transparent']}
                  positions={[0, Math.min(1, fade.from), Math.min(1, Math.max(fade.from, fade.to))]}
                />
              </Rect>
            )
          }>
          <SkiaImage
            image={image}
            x={drawn.x}
            y={drawn.y}
            width={drawn.width}
            height={drawn.height}
            fit="fill"
            opacity={art.layer.opacity}
          />
        </Mask>
      </Group>
    </Canvas>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute' },
  hint: { position: 'absolute', alignItems: 'center' },
  hintChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintLeader: { width: 1, height: 14, opacity: 0.7 },
});
