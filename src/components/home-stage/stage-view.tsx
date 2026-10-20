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
import { useFrozenValue } from '@/hooks/use-frozen-value';
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { useAppSettings } from '@/stores/app-settings';
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
  STAGE_HOST_BASE_Y,
  stageHostSize,
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
import { useStageTexture } from './stage-textures';
import { createStageBridge, type StageInputs } from './types';

// An older binary, or web, keeps the static stage without evaluating the native module.
const GpuStage = lazy(() => import('./gpu-stage'));

/** Backdrop and art texture caps (§11.7). */
const BACKDROP_MAX_EDGE = 2048;
const ART_MAX_EDGE = 1536;
/** The camera's flight into the front screen before its workspace opens. */

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
  onOpenTasks: (index: number) => void;
  onAttention: () => void;
};

/**
 * The full-screen world: the WebGPU scene when the device has it, otherwise
 * (and after a lost device or a slow device's last degrade step) the static
 * 2.5D composition. Above either sits one layer of 2D hit areas projected from
 * the same geometry, which carries every touch target, every accessibility
 * element and the first-visit hints -- the scene itself is never focusable.
 */
export function StageView({
  panels: livePanels,
  selectedIndex: liveSelectedIndex,
  backdropUri: liveBackdropUri,
  backdropFocal,
  artworkUri: liveArtworkUri,
  paused,
  burst,
  onSelect,
  onOpen,
  onActions,
  onNewTask,
  onOpenTasks,
  onAttention,
}: StageViewProps) {
  const panels = useFrozenValue(livePanels, paused, null);
  const selectedIndex = useFrozenValue(liveSelectedIndex, paused, null);
  const backdropUri = useFrozenValue(liveBackdropUri, paused, null);
  const artworkUri = useFrozenValue(liveArtworkUri, paused, null);
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const reducedMotion = useReducedMotion();
  const customTheme = useEffectiveCustomTheme();
  const themeEffectsEnabled = useAppSettings((state) => state.themeEffectsEnabled);
  const ambient = themeEffectsEnabled
    ? (customTheme.theme?.manifest.variants[resolvedMode]?.effects ??
      customTheme.theme?.manifest.effects)
    : undefined;
  const measuredWindow = useWindowDimensions();
  const window = useFrozenValue(measuredWindow, paused, null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [quality, setQuality] = useState<StageQuality>('full');
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
  // A tiny CPU copy classifies the artwork even on the static fallback.
  const artTexture = useStageTexture(artworkUri, effects.gpu ? artEdge : 64);
  // A reskin holds its cover until the new pictures are textures (or failed).
  useThemeRenderReady(backdropUri, !effects.gpu || backdropTexture.status !== 'loading');
  useThemeRenderReady(artworkUri, !effects.gpu || artTexture.status !== 'loading');
  const wallpaper = useMemo(
    () =>
      backdropTexture.status === 'ready'
        ? {
            ...backdropTexture.source,
            ...(backdropFocal ? { focal: backdropFocal } : {}),
          }
        : null,
    [backdropTexture, backdropFocal]
  );
  const character = artTexture.status === 'ready' ? artTexture.source : null;
  const scenic = character?.kind === 'scene';
  const backdrop = scenic ? character : wallpaper;
  const screens: StageScreenLook[] = panels.map((panel) => ({
    tone: panel.tone,
    working: panel.working,
    attention: panel.attention,
    faceSlot: -1,
  }));
  const colors = useMemo(
    () => ({
      background: theme.colors.background,
      surface: theme.colors.surface,
      text: theme.colors.text,
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      muted: theme.colors.textMuted,
      info: theme.colors.info,
    }),
    [theme.colors]
  );

  useEffect(() => {
    setExpanded(false);
  }, [selectedIndex, paused]);
  const touched = useStableHandler(() => {
    if (!hints) return;
    setHints(false);
    markStageHintsSeen();
  });
  const openFront = useStableHandler(() => {
    if (paused) return;
    touched();
    setExpanded((value) => !value);
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
          if (expanded) return;
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
    [
      bridge,
      dragX,
      dragY,
      dragging,
      expanded,
      onSelect,
      selectedIndex,
      size.width,
      size.height,
      touched,
    ]
  );

  const hostAspect = character?.aspect ?? (artworkUri ? 1.5 : 0.6);
  const allTargets = useStageTargets(panels, selectedIndex, hostAspect, size.width, size.height);
  const targets = scenic ? allTargets.filter((target) => target.kind !== 'host') : allTargets;

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
                ambient={ambient}
                mode={resolvedMode}
                backdrop={backdrop}
                character={character}
                quality={quality}
                reducedMotion={reducedMotion}
                expanded={expanded}
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
            scenic={scenic}
            dragY={dragY}
            tiltX={tiltX}
            tiltY={tiltY}
          />
        )}
        {effects.tilt && !paused ? (
          <StageTilt tiltX={tiltX} tiltY={tiltY} wake={bridge.wake} />
        ) : null}
        <StageHitAreas
          panels={panels}
          targets={targets.filter((target) => target.kind === 'screen')}
          expanded={expanded}
          onEnter={onOpen}
          onOpenTasks={onOpenTasks}
          onAttention={onAttention}
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
function StageTilt({
  tiltX,
  tiltY,
  wake,
}: {
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
  wake: () => void;
}) {
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
      // About 2.5 m/s^2 of change (roughly 15 degrees) reaches the full look.
      // Clamped inline: React Compiler hoists a nested helper out of the
      // worklet, which then runs as a JS-thread function on the UI runtime.
      const lookX = Math.max(-1, Math.min(1, (gravity.y - nextY) / 2.5));
      const lookY = Math.max(-1, Math.min(1, (gravity.x - nextX) / 2.5));
      const deltaX = (lookX - tiltX.get()) * 0.3;
      const deltaY = (lookY - tiltY.get()) * 0.3;
      tiltX.set(tiltX.get() + deltaX);
      tiltY.set(tiltY.get() + deltaY);
      if (Math.abs(deltaX) + Math.abs(deltaY) > 0.008) scheduleOnRN(wake);
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
    const host = stageHostSize(hostAspect);
    // Only the figure's middle takes taps, not the empty sides of a wide picture.
    const hostCentre = [
      STAGE_PEDESTAL[0],
      STAGE_HOST_BASE_Y + host.height / 2,
      STAGE_PEDESTAL[2],
    ] as const;
    // Just above the host's head, at whatever size her art stands.
    const hostHint = projectStagePoint(
      [STAGE_PEDESTAL[0], STAGE_HOST_BASE_Y + host.height + 0.35, STAGE_PEDESTAL[2]],
      camera,
      width,
      height
    );
    const targets: StageTarget[] = [
      {
        kind: 'host',
        rect: stageBillboardRect(hostCentre, host.width, host.height, camera, width, height),
        hint: { x: hostHint.x, y: hostHint.y },
      },
    ];
    for (const index of stageDrawnScreens(selectedIndex, panels.length)) {
      const front = index === selectedIndex;
      const scale = front ? STAGE_FRONT_SCALE : STAGE_SIDE_SCALE;
      const centre = stageScreenPosition(index, panels.length, ring);
      // Just above this screen's own top edge, wherever the ring has put it.
      const hint = projectStagePoint(
        [centre[0], centre[1] + (STAGE_SCREEN_HEIGHT / 2) * scale + 0.25, centre[2]],
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
  expanded,
  onSelect,
  onOpen,
  onEnter,
  onOpenTasks,
  onAttention,
  onActions,
}: {
  panels: readonly StagePanel[];
  targets: readonly StageTarget[];
  expanded: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  onEnter: (index: number) => void;
  onOpenTasks: (index: number) => void;
  onAttention: () => void;
  onActions: (index: number) => void;
  onNewTask: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {targets.map((target) => {
        if (target.kind !== 'screen' || !target.rect.visible) return null;
        const panel = panels[target.index];
        if (!panel) return null;
        const { rect } = target;
        const status = _(connectionStatusDescription[panel.connection]);
        const box = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
        return (
          <View key={panel.serverId} pointerEvents="box-none" style={[styles.hit, box]}>
            <PressableScale
              testID={`home-stage-panel-${panel.serverId}`}
              accessibilityRole="button"
              accessibilityLabel={`${panel.label}, ${status}`}
              accessibilityHint={
                target.front ? t`Show computer controls` : t`Brings this computer forward.`
              }
              accessibilityState={{ selected: target.front, expanded: target.front && expanded }}
              onPress={() => (target.front ? onOpen(target.index) : onSelect(target.index))}
              onLongPress={() => onActions(target.index)}
              style={StyleSheet.absoluteFill}
            />
            {!target.front ? (
              <View
                pointerEvents="none"
                style={[styles.coreName, { backgroundColor: background(theme.colors.surface) }]}>
                <View
                  style={[
                    styles.flatDot,
                    {
                      backgroundColor:
                        panel.tone === 'online' ? theme.colors.success : theme.colors.textMuted,
                    },
                  ]}
                />
                <Text variant="caption" weight="semibold" numberOfLines={1}>
                  {panel.label}
                </Text>
              </View>
            ) : (
              <View
                pointerEvents="box-none"
                style={[styles.coreControls, { top: rect.height * 0.74 }]}>
                <View
                  pointerEvents="none"
                  style={[styles.coreTitle, { backgroundColor: background(theme.colors.surface) }]}>
                  <Text variant="body" weight="bold" numberOfLines={1}>
                    {panel.label}
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {expanded ? t`Drag to rotate` : t`Tap to expand`}
                  </Text>
                </View>
                {expanded ? (
                  <View style={styles.coreButtons}>
                    <PressableScale
                      testID="home-core-tasks"
                      accessibilityRole="button"
                      accessibilityLabel={t`Tasks`}
                      onPress={() => onOpenTasks(target.index)}
                      style={[
                        styles.coreButton,
                        {
                          backgroundColor: background(theme.colors.surface),
                          borderColor: theme.colors.border,
                        },
                      ]}>
                      <Text variant="caption" weight="semibold">{t`Tasks`}</Text>
                    </PressableScale>
                    {panel.attention ? (
                      <PressableScale
                        testID="home-core-attention"
                        accessibilityRole="button"
                        accessibilityLabel={t`Needs you`}
                        onPress={onAttention}
                        style={[
                          styles.coreButton,
                          {
                            backgroundColor: background(theme.colors.surface),
                            borderColor: theme.colors.warning,
                          },
                        ]}>
                        <Text
                          variant="caption"
                          weight="semibold"
                          color={theme.colors.warning}>{t`Needs you`}</Text>
                      </PressableScale>
                    ) : null}
                    <PressableScale
                      testID="home-core-enter"
                      accessibilityRole="button"
                      accessibilityLabel={t`Open computer`}
                      onPress={() => onEnter(target.index)}
                      style={[
                        styles.coreButton,
                        {
                          backgroundColor: theme.colors.primary,
                          borderColor: theme.colors.primary,
                        },
                      ]}>
                      <Text variant="caption" weight="semibold" color={theme.colors.onPrimary}>
                        {t`Open computer`} ↗
                      </Text>
                    </PressableScale>
                  </View>
                ) : null}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

function StaticStage({
  panels,
  targets,
  artworkUri,
  scenic,
  dragY,
  tiltX,
  tiltY,
}: {
  panels: readonly StagePanel[];
  targets: readonly StageTarget[];
  artworkUri?: string;
  scenic: boolean;
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
        {scenic && artworkUri ? (
          <Image
            source={{ uri: artworkUri }}
            contentFit="cover"
            style={StyleSheet.absoluteFill}
            accessible={false}
          />
        ) : (
          <ThemeArtwork slot="home.wallpaper" fallbackSlot="shell.wallpaper" opacityLimit={0.5} />
        )}
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
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                }}
              />
            ) : null;
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
  coreName: {
    position: 'absolute',
    bottom: -20,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    maxWidth: 120,
  },
  coreControls: { position: 'absolute', left: -8, right: -8, alignItems: 'center', gap: 8 },
  coreTitle: {
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 7,
    alignItems: 'center',
    gap: 2,
  },
  coreButtons: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
  coreButton: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hit: { position: 'absolute' },
  hint: { position: 'absolute', alignItems: 'center' },
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
