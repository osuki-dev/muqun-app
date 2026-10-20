import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { lazy, Suspense, useMemo, useState } from 'react';
import { Platform, StyleSheet, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { MapErrorBoundary } from '@/components/computer-map/error-boundary';
import { ThemeArtwork } from '@/components/theme-artwork';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { useThemeRenderReady } from '@/hooks/use-theme-render-ready';
import { connectionStatusDescription } from '@/i18n/labels';
import {
  stageCamera,
  stageLabelAnchor,
  stagePanelRect,
  stageRingOffset,
  stageSlotPose,
  stageSwipeStep,
  projectStagePoint,
} from '@/lib/home-stage-geometry';
import { stageEffects, type StageQuality } from '@/lib/home-stage-motion';
import type { StagePanel } from '@/lib/home-stage-panels';
import type { StagePanelLook } from './stage-scene';
import { useStageTexture } from './stage-textures';
import { createStageBridge, type StageInputs } from './types';

// An older binary, or web, keeps the static stage without evaluating the native module.
const GpuStage = lazy(() => import('./gpu-stage'));

/** Backdrop and art texture caps (§11.7). */
const BACKDROP_MAX_EDGE = 2048;
const ART_MAX_EDGE = 1536;

export type StageViewProps = {
  panels: readonly StagePanel[];
  selectedIndex: number;
  backdropUri?: string;
  backdropFocal?: { x: number; y: number };
  artworkUri?: string;
  /** Home is not on screen or the app is in the background: no frames. */
  paused: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onActions: (index: number) => void;
};

/**
 * The full-screen stage: the WebGPU scene when the device has it, otherwise
 * (and after a lost device or a slow device's last degrade step) the static
 * 2.5D composition. Above either sits one layer of 2D hit areas, projected
 * from the same geometry, which carries every touch target and every
 * accessibility element -- the scene itself is never focusable.
 */
export function StageView({
  panels,
  selectedIndex,
  backdropUri,
  backdropFocal,
  artworkUri,
  paused,
  onSelect,
  onOpen,
  onActions,
}: StageViewProps) {
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const reducedMotion = useReducedMotion();
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [quality, setQuality] = useState<StageQuality>('full');
  const [failed, setFailed] = useState(false);
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
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const inputs: StageInputs = useMemo(
    () => ({ dragX, dragY, dragging, tiltX, tiltY }),
    [dragX, dragY, dragging, tiltX, tiltY]
  );

  const dpr = Math.min(3, Math.max(1, window.scale));
  const backdropEdge = Math.min(BACKDROP_MAX_EDGE, Math.round(window.height * dpr * 0.9));
  const artEdge = Math.min(ART_MAX_EDGE, Math.round(window.height * dpr * 0.6));
  const backdropTexture = useStageTexture(effects.gpu ? backdropUri : undefined, backdropEdge);
  const artTexture = useStageTexture(effects.gpu ? artworkUri : undefined, artEdge);
  // A reskin holds its cover until the new pictures are textures (or failed).
  useThemeRenderReady(backdropUri, !effects.gpu || backdropTexture.status !== 'loading');
  useThemeRenderReady(artworkUri, !effects.gpu || artTexture.status !== 'loading');
  const backdrop = useMemo(
    () =>
      backdropTexture.status === 'ready'
        ? { ...backdropTexture.source, ...(backdropFocal ? { focal: backdropFocal } : {}) }
        : null,
    [backdropTexture, backdropFocal]
  );
  const character = artTexture.status === 'ready' ? artTexture.source : null;
  const looks: StagePanelLook[] = useMemo(
    () =>
      panels.map((panel) => ({
        tone: panel.tone,
        working: panel.working,
        attention: panel.attention,
      })),
    [panels]
  );
  const colors = useMemo(
    () => ({
      background: theme.colors.background,
      surface: theme.colors.surface,
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      danger: theme.colors.danger,
      muted: theme.colors.textMuted,
    }),
    [theme.colors]
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(10)
        .onStart(() => {
          dragging.set(1);
          scheduleOnRN(bridge.wake);
        })
        .onUpdate((event) => {
          dragX.set(size.width > 0 ? event.translationX / size.width : 0);
          dragY.set(size.height > 0 ? event.translationY / size.height : 0);
        })
        .onEnd((event) => {
          // Sideways moves the ring; up and down only pitches the camera.
          if (Math.abs(event.translationX) < Math.abs(event.translationY)) return;
          const step = stageSwipeStep(event.translationX, event.velocityX, size.width);
          if (step !== 0) scheduleOnRN(onSelect, selectedIndex + step);
        })
        .onFinalize(() => {
          dragging.set(0);
          dragX.set(0);
          dragY.set(0);
          scheduleOnRN(bridge.wake);
        }),
    [bridge, dragX, dragY, dragging, onSelect, selectedIndex, size.width, size.height]
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
          <MapErrorBoundary onError={() => setFailed(true)}>
            <Suspense fallback={null}>
              <GpuStage
                looks={looks}
                selected={selectedIndex}
                colors={colors}
                mode={resolvedMode}
                surfaceOpacity={surfaceOpacity}
                backdrop={backdrop}
                character={character}
                quality={quality}
                reducedMotion={reducedMotion}
                paused={paused}
                inputs={inputs}
                bridge={bridge}
                onQualityDrop={setQuality}
                onError={() => setFailed(true)}
              />
            </Suspense>
          </MapErrorBoundary>
        ) : (
          <StaticStage
            panels={panels}
            selectedIndex={selectedIndex}
            artworkUri={artworkUri}
            width={size.width}
            height={size.height}
            dragY={dragY}
            tiltX={tiltX}
            tiltY={tiltY}
          />
        )}
        {effects.tilt && !paused ? <StageTilt tiltX={tiltX} tiltY={tiltY} /> : null}
        <StageHitAreas
          panels={panels}
          selectedIndex={selectedIndex}
          width={size.width}
          height={size.height}
          onSelect={onSelect}
          onOpen={onOpen}
          onActions={onActions}
        />
      </View>
    </GestureDetector>
  );
}

/**
 * Device tilt as a smoothed offset from how the phone is being held, -1..1
 * per axis. The baseline follows the hand slowly, so holding the phone at
 * any angle reads as level and only movement parallaxes. Uses Reanimated's
 * sensor, already in the binary: no new native module.
 */
function StageTilt({ tiltX, tiltY }: { tiltX: SharedValue<number>; tiltY: SharedValue<number> }) {
  const sensor = useAnimatedSensor(SensorType.GRAVITY, { interval: 33 });
  const baseX = useSharedValue<number | null>(null);
  const baseY = useSharedValue(0);
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
      const clamp = (value: number) => Math.max(-1, Math.min(1, value));
      // About 2.5 m/s^2 of change (roughly 15 degrees) reaches the ±3 degree limit.
      tiltX.set(tiltX.get() + (clamp((gravity.y - nextY) / 2.5) - tiltX.get()) * 0.3);
      tiltY.set(tiltY.get() + (clamp((gravity.x - nextX) / 2.5) - tiltY.get()) * 0.3);
    }
  );
  return null;
}

function useRestingRects(
  panels: readonly StagePanel[],
  selectedIndex: number,
  width: number,
  height: number
) {
  return useMemo(() => {
    if (width <= 0 || height <= 0) return [];
    const camera = stageCamera(0, 0, 0, width / height);
    return panels.map((panel, index) => {
      const pose = stageSlotPose(stageRingOffset(index, selectedIndex, panels.length));
      const rect = stagePanelRect(pose, camera, width, height);
      const label = projectStagePoint(stageLabelAnchor(pose), camera, width, height);
      return { panel, index, rect, label, front: index === selectedIndex };
    });
  }, [panels, selectedIndex, width, height]);
}

/** Every card's 2D target: tap the front to open, a side card to select; long press for actions. */
function StageHitAreas({
  panels,
  selectedIndex,
  width,
  height,
  onSelect,
  onOpen,
  onActions,
}: {
  panels: readonly StagePanel[];
  selectedIndex: number;
  width: number;
  height: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onActions: (index: number) => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const rects = useRestingRects(panels, selectedIndex, width, height);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {rects.map(({ panel, index, rect, label, front }) => {
        if (!rect.visible) return null;
        const status = _(connectionStatusDescription[panel.connection]);
        const count = panel.sessionCount;
        const sessions = t`${plural(count, { one: '# session', other: '# sessions' })}`;
        const position = front ? t`selected` : t`${index + 1} of ${panels.length}`;
        return (
          <PressableScale
            key={panel.serverId}
            testID={`home-stage-panel-${panel.serverId}`}
            accessibilityRole="button"
            accessibilityLabel={`${panel.label}, ${status}, ${sessions}, ${position}`}
            accessibilityHint={front ? t`Opens this computer.` : t`Brings this computer forward.`}
            accessibilityState={{ selected: front }}
            accessibilityActions={[{ name: 'longpress', label: t`Actions` }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'longpress') onActions(index);
            }}
            onPress={() => (front ? onOpen(index) : onSelect(index))}
            onLongPress={() => onActions(index)}
            style={[
              styles.hit,
              { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
            ]}>
            {front ? null : (
              <View
                pointerEvents="none"
                style={[
                  styles.tag,
                  { top: Math.max(0, label.y - rect.y) + 2, maxWidth: Math.max(64, rect.width) },
                ]}>
                <Text variant="caption" numberOfLines={1} color={theme.colors.textMuted}>
                  {panel.label}
                </Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * The 2.5D stage: the same composition as flat layers -- wallpaper, art and
 * the cards at their projected places -- with only parallax for motion. Drawn
 * without WebGPU, after a lost device, or as a slow device's last step.
 */
function StaticStage({
  panels,
  selectedIndex,
  artworkUri,
  width,
  height,
  dragY,
  tiltX,
  tiltY,
}: {
  panels: readonly StagePanel[];
  selectedIndex: number;
  artworkUri?: string;
  width: number;
  height: number;
  dragY: SharedValue<number>;
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
}) {
  const theme = useThemeTokens();
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  const rects = useRestingRects(panels, selectedIndex, width, height);
  const far = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltY.get() * 6 },
      { translateY: tiltX.get() * 6 + dragY.get() * 10 },
    ],
  }));
  const near = useAnimatedStyle(() => ({
    transform: [
      { translateX: tiltY.get() * -10 },
      { translateY: tiltX.get() * -10 + dragY.get() * -16 },
    ],
  }));
  const toneColor = {
    online: theme.colors.success,
    offline: theme.colors.textMuted,
    unknown: theme.colors.textMuted,
    warning: theme.colors.warning,
  } as const;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.bleed, far]}>
        <ThemeArtwork slot="home.wallpaper" fallbackSlot="shell.wallpaper" />
      </Animated.View>
      {artworkUri ? (
        <Image
          source={{ uri: artworkUri }}
          contentFit="contain"
          contentPosition="bottom"
          cachePolicy="memory"
          accessible={false}
          style={[styles.art, { top: height * 0.16, height: height * 0.5 }]}
        />
      ) : null}
      <Animated.View style={[StyleSheet.absoluteFill, near]}>
        {rects.map(({ panel, rect, front }) =>
          rect.visible ? (
            <View
              key={panel.serverId}
              style={[
                styles.flatPanel,
                {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  borderColor: front ? theme.colors.primary : theme.colors.border,
                  shadowColor: toneColor[panel.tone],
                  backgroundColor: theme.colors.surface,
                  opacity: (front ? 1 : 0.6) * (0.55 + surfaceOpacity * 0.4),
                },
              ]}
            />
          ) : null
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute', alignItems: 'center' },
  tag: { position: 'absolute', alignSelf: 'center' },
  bleed: { position: 'absolute', top: -12, bottom: -12, left: -12, right: -12 },
  art: { position: 'absolute', left: 0, right: 0 },
  flatPanel: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 10,
    borderCurve: 'continuous',
    shadowOpacity: 0.6,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
