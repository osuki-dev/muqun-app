import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
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
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemeRenderReady } from '@/hooks/use-theme-render-ready';
import { connectionStatusDescription } from '@/i18n/labels';
import {
  projectStagePoint,
  stageBillboardRect,
  stageCamera,
  stageDrawnScreens,
  stageRingRest,
  stageScreenPosition,
  stageSwipeStep,
  STAGE_FRONT_SCALE,
  STAGE_HOST_HEIGHT,
  STAGE_HOST_HINT,
  STAGE_PEDESTAL,
  STAGE_SCREEN_HEIGHT,
  STAGE_SCREEN_WIDTH,
  STAGE_SIDE_SCALE,
  type StageRect,
} from '@/lib/home-stage-geometry';
import { hasSeenStageHints, markStageHintsSeen } from '@/lib/home-stage-hints';
import { stageEffects, type StageQuality } from '@/lib/home-stage-motion';
import type { StagePanel } from '@/lib/home-stage-panels';
import type { StageScreenLook } from './stage-scene';
import { useStageFaces } from './stage-faces';
import { useStageTexture } from './stage-textures';
import { createStageBridge, type StageInputs } from './types';

// An older binary, or web, keeps the static stage without evaluating the native module.
const GpuStage = lazy(() => import('./gpu-stage'));

/** Backdrop and art texture caps (§11.7). */
const BACKDROP_MAX_EDGE = 2048;
const ART_MAX_EDGE = 1536;
/** The camera's flight into the front screen before its workspace opens. */
const DIVE_MS = 520;

export type StageViewProps = {
  panels: readonly StagePanel[];
  selectedIndex: number;
  backdropUri?: string;
  backdropFocal?: { x: number; y: number };
  artworkUri?: string;
  /** Home is not on screen or the app is in the background: no frames. */
  paused: boolean;
  /** Bumped when a task completes. */
  burst: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onActions: (index: number) => void;
  onNewTask: () => void;
};

/**
 * The full-screen world: the WebGPU scene when the device has it, otherwise
 * (and after a lost device or a slow device's last degrade step) the static
 * 2.5D composition. Above either sits one layer of 2D hit areas projected from
 * the same geometry, which carries every touch target, every accessibility
 * element and the first-visit hints -- the scene itself is never focusable.
 */
export function StageView({
  panels,
  selectedIndex,
  backdropUri,
  backdropFocal,
  artworkUri,
  paused,
  burst,
  onSelect,
  onOpen,
  onActions,
  onNewTask,
}: StageViewProps) {
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const reducedMotion = useReducedMotion();
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [quality, setQuality] = useState<StageQuality>('full');
  const [failed, setFailed] = useState(false);
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
  const tiltX = useSharedValue(0);
  const tiltY = useSharedValue(0);
  const inputs: StageInputs = useMemo(
    () => ({ dragX, dragY, dragging, tiltX, tiltY }),
    [dragX, dragY, dragging, tiltX, tiltY]
  );

  const dpr = Math.min(3, Math.max(1, window.scale));
  const backdropEdge = Math.min(BACKDROP_MAX_EDGE, Math.round(window.height * dpr));
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
  const drawn = stageDrawnScreens(selectedIndex, panels.length);
  const faces = useStageFaces(panels, effects.gpu ? drawn : [], {
    text: theme.colors.text,
    primary: theme.colors.primary,
    success: theme.colors.success,
    warning: theme.colors.warning,
    offline: theme.colors.textMuted,
  });
  const screens: StageScreenLook[] = panels.map((panel) => ({
    tone: panel.tone,
    working: panel.working,
    attention: panel.attention,
    faceSlot: faces.slots.get(panel.serverId) ?? -1,
  }));
  const colors = useMemo(
    () => ({
      background: theme.colors.background,
      surface: theme.colors.surface,
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      muted: theme.colors.textMuted,
    }),
    [theme.colors]
  );

  // Back on Home after a dive: the camera returns to the stage.
  useEffect(() => {
    if (!paused) setDiving(false);
  }, [paused]);
  const touched = useStableHandler(() => {
    if (!hints) return;
    setHints(false);
    markStageHintsSeen();
  });
  const openFront = useStableHandler((index: number) => {
    touched();
    if (!effects.gpu || reducedMotion) {
      onOpen(index);
      return;
    }
    setDiving(true);
    setTimeout(() => onOpen(index), DIVE_MS);
  });

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(10)
        .onStart(() => {
          dragging.set(1);
          scheduleOnRN(bridge.wake);
          scheduleOnRN(touched);
        })
        .onUpdate((event) => {
          dragX.set(size.width > 0 ? event.translationX / size.width : 0);
          dragY.set(size.height > 0 ? event.translationY / size.height : 0);
        })
        .onEnd((event) => {
          // Sideways turns the ring; up and down only looks around.
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
    [bridge, dragX, dragY, dragging, onSelect, selectedIndex, size.width, size.height, touched]
  );

  const hostAspect = character?.aspect ?? (artworkUri ? 1.5 : 0.6);
  const targets = useStageTargets(panels, selectedIndex, hostAspect, size.width, size.height);

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
                screens={screens}
                selected={selectedIndex}
                colors={colors}
                mode={resolvedMode}
                backdrop={backdrop}
                character={character}
                faces={faces.atlas}
                quality={quality}
                reducedMotion={reducedMotion}
                dive={diving}
                burst={burst}
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
            targets={targets}
            artworkUri={artworkUri}
            dragY={dragY}
            tiltX={tiltX}
            tiltY={tiltY}
          />
        )}
        {effects.tilt && !paused ? <StageTilt tiltX={tiltX} tiltY={tiltY} /> : null}
        <StageHitAreas
          panels={panels}
          targets={targets}
          hints={hints && !diving}
          onSelect={(index) => {
            touched();
            onSelect(index);
          }}
          onOpen={openFront}
          onActions={(index) => {
            touched();
            onActions(index);
          }}
          onNewTask={() => {
            touched();
            onNewTask();
          }}
        />
      </View>
    </GestureDetector>
  );
}

/**
 * Device tilt as a smoothed offset from how the phone is being held, -1..1
 * per axis. The baseline follows the hand slowly, so any holding angle reads
 * as level and only movement looks around. Uses Reanimated's sensor, already
 * in the binary: no new native module.
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
      // About 2.5 m/s^2 of change (roughly 15 degrees) reaches the full look.
      tiltX.set(tiltX.get() + (clamp((gravity.y - nextY) / 2.5) - tiltX.get()) * 0.3);
      tiltY.set(tiltY.get() + (clamp((gravity.x - nextX) / 2.5) - tiltY.get()) * 0.3);
    }
  );
  return null;
}

type StageTarget =
  | { kind: 'host'; rect: StageRect; hint: { x: number; y: number } }
  | {
      kind: 'screen';
      index: number;
      front: boolean;
      rect: StageRect;
      hint: { x: number; y: number };
    };

/** Every 3D target's resting box on screen, far to near (so the nearer one wins a tap). */
function useStageTargets(
  panels: readonly StagePanel[],
  selectedIndex: number,
  hostAspect: number,
  width: number,
  height: number
): StageTarget[] {
  return useMemo(() => {
    if (width <= 0 || height <= 0) return [];
    const camera = stageCamera({ aspect: width / height });
    const ring = stageRingRest(selectedIndex, panels.length);
    let hostHeight = STAGE_HOST_HEIGHT;
    let hostWidth = hostHeight * hostAspect;
    if (hostWidth > 4.2) {
      hostWidth = 4.2;
      hostHeight = hostWidth / hostAspect;
    }
    // Only the figure's middle third takes taps, not the empty sides of a wide picture.
    const hostCentre = [STAGE_PEDESTAL[0], 0.215 + hostHeight / 2, STAGE_PEDESTAL[2]] as const;
    const hostHint = projectStagePoint(STAGE_HOST_HINT, camera, width, height);
    const targets: StageTarget[] = [
      {
        kind: 'host',
        rect: stageBillboardRect(
          hostCentre,
          Math.min(hostWidth, 1.6),
          hostHeight,
          camera,
          width,
          height
        ),
        hint: { x: hostHint.x, y: hostHint.y },
      },
    ];
    for (const index of stageDrawnScreens(selectedIndex, panels.length)) {
      const front = index === selectedIndex;
      const scale = front ? STAGE_FRONT_SCALE : STAGE_SIDE_SCALE;
      const centre = stageScreenPosition(index, panels.length, ring);
      const hint = projectStagePoint(
        [centre[0], centre[1] + 0.85, centre[2]],
        camera,
        width,
        height
      );
      targets.push({
        kind: 'screen',
        index,
        front,
        rect: stageBillboardRect(
          centre,
          STAGE_SCREEN_WIDTH * scale,
          STAGE_SCREEN_HEIGHT * scale,
          camera,
          width,
          height
        ),
        hint: { x: hint.x, y: hint.y },
      });
    }
    return targets.sort((a, b) => b.rect.depth - a.rect.depth);
  }, [panels.length, selectedIndex, hostAspect, width, height]);
}

/**
 * The 2D layer over the world: the host starts a new task; the front screen
 * opens its computer, a side screen comes forward, a long press offers the
 * computer's actions. The screen reader reads these, never the scene.
 */
function StageHitAreas({
  panels,
  targets,
  hints,
  onSelect,
  onOpen,
  onActions,
  onNewTask,
}: {
  panels: readonly StagePanel[];
  targets: readonly StageTarget[];
  hints: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onActions: (index: number) => void;
  onNewTask: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const front = targets.find((target) => target.kind === 'screen' && target.front);
  const host = targets.find((target) => target.kind === 'host');
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {targets.map((target) => {
        const { rect } = target;
        if (!rect.visible) return null;
        const box = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
        if (target.kind === 'host')
          return (
            <PressableScale
              key="host"
              testID="home-stage-host"
              accessibilityRole="button"
              accessibilityLabel={t`Start a new task`}
              onPress={onNewTask}
              style={[styles.hit, box]}
            />
          );
        const panel = panels[target.index];
        if (!panel) return null;
        const status = _(connectionStatusDescription[panel.connection]);
        const count = panel.sessionCount;
        const sessions = t`${plural(count, { one: '# session', other: '# sessions' })}`;
        const position = target.front ? t`selected` : t`${target.index + 1} of ${panels.length}`;
        return (
          <PressableScale
            key={panel.serverId}
            testID={`home-stage-panel-${panel.serverId}`}
            accessibilityRole="button"
            accessibilityLabel={`${panel.label}, ${status}, ${sessions}, ${position}`}
            accessibilityHint={
              target.front ? t`Opens this computer.` : t`Brings this computer forward.`
            }
            accessibilityState={{ selected: target.front }}
            accessibilityActions={[{ name: 'longpress', label: t`Actions` }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'longpress') onActions(target.index);
            }}
            onPress={() => (target.front ? onOpen(target.index) : onSelect(target.index))}
            onLongPress={() => onActions(target.index)}
            style={[styles.hit, box]}
          />
        );
      })}
      {hints && host ? <StageHint text={t`Tap · start a new task`} at={host.hint} /> : null}
      {hints && front ? <StageHint text={t`Tap · open`} at={front.hint} /> : null}
    </View>
  );
}

/** A first-visit chip hung from a projected 3D point by a short leader line. */
function StageHint({ text, at }: { text: string; at: { x: number; y: number } }) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <Animated.View
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.hint, { left: at.x, top: at.y }]}>
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
 * The 2.5D stage: the same composition as flat layers -- wallpaper sky, the
 * host and the screens at their projected places -- with only parallax for
 * motion. Drawn without WebGPU, after a lost device, or as a slow device's
 * last degrade step.
 */
function StaticStage({
  panels,
  targets,
  artworkUri,
  dragY,
  tiltX,
  tiltY,
}: {
  panels: readonly StagePanel[];
  targets: readonly StageTarget[];
  artworkUri?: string;
  dragY: SharedValue<number>;
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
}) {
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
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
        <ThemeArtwork slot="home.wallpaper" fallbackSlot="shell.wallpaper" opacityLimit={0.5} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, near]}>
        {targets.map((target) => {
          if (!target.rect.visible) return null;
          const { rect } = target;
          if (target.kind === 'host')
            return artworkUri ? (
              <Image
                key="host"
                source={{ uri: artworkUri }}
                contentFit="contain"
                contentPosition="bottom"
                cachePolicy="memory"
                accessible={false}
                style={{
                  position: 'absolute',
                  left: rect.x - rect.width,
                  top: rect.y,
                  width: rect.width * 3,
                  height: rect.height,
                }}
              />
            ) : (
              <View
                key="host"
                style={[
                  styles.crystal,
                  {
                    left: rect.x + rect.width * 0.3,
                    top: rect.y + rect.height * 0.2,
                    width: rect.width * 0.4,
                    height: rect.height * 0.5,
                    backgroundColor: theme.colors.primary,
                  },
                ]}
              />
            );
          const panel = panels[target.index];
          if (!panel) return null;
          return (
            <View
              key={panel.serverId}
              style={[
                styles.flatScreen,
                {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  borderColor:
                    panel.tone === 'offline' ? theme.colors.border : theme.colors.primary,
                  backgroundColor: background(theme.colors.surface),
                  opacity: target.front ? 1 : 0.7,
                },
              ]}>
              <Text variant="bodySmall" weight="semibold" numberOfLines={1}>
                {panel.label}
              </Text>
              <View style={[styles.flatDot, { backgroundColor: toneColor[panel.tone] }]} />
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute' },
  hint: {
    position: 'absolute',
    alignItems: 'center',
    transform: [{ translateX: '-50%' }, { translateY: '-100%' }],
  },
  hintChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintLeader: { width: 1, height: 14, opacity: 0.7 },
  bleed: { position: 'absolute', top: -12, bottom: -12, left: -12, right: -12 },
  crystal: {
    position: 'absolute',
    borderRadius: 8,
    transform: [{ rotate: '45deg' }],
    opacity: 0.8,
  },
  flatScreen: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 12,
    borderCurve: 'continuous',
    padding: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  flatDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
});
