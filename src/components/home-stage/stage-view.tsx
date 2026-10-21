import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import {
  Blur,
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Mask,
  Path,
  RadialGradient,
  Rect,
  RoundedRect,
  Skia,
  Image as SkiaImage,
  rect,
  vec,
} from 'react-native-skia';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  TurboModuleRegistry,
  useWindowDimensions,
  View,
  type GestureResponderEvent,
} from 'react-native';
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
import { useEffectiveCustomTheme } from '@/components/theme-candidate';
import { useStableHandler } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useThemeRenderReady } from '@/hooks/use-theme-render-ready';
import { agentStatusWord, connectionStatusDescription } from '@/i18n/labels';
import { withAlpha } from '@/lib/color';
import {
  projectStagePoint,
  stageCamera,
  stageCore,
  stageCoreAnchor,
  stageCoreRect,
  stageDrawnScreens,
  stageHeroPlacement,
  stageHostTarget,
  stagePaintingPlacement,
  stageRingPoint,
  stageSwipeTarget,
  stageViewSize,
  STAGE_CORE_REACH,
  STAGE_HERO_DEPTH,
  STAGE_HUD_BOTTOM_PT,
  STAGE_PAINTING_DEPTH,
  type StageArtPlacement,
  type StageCore,
  type StageRect,
  type StageVec3,
  type StageViewport,
} from '@/lib/home-stage-geometry';
import { heroFeatherGeometry } from '@/lib/hero-feather';
import { hasSeenStageHints, markStageHintsSeen } from '@/lib/home-stage-hints';
import type { StageComposition, StageLayer, StageRole } from '@/lib/home-stage-layers';
import {
  stageBehindCore,
  stageChipPlacement,
  stageOrbAt,
  stageOrbRestPoint,
  stageOrbs,
  type StageOrb,
} from '@/lib/home-stage-orbs';
import { useSharedSkiaImage } from '@/lib/skia-image-cache';
import { calmFadeIn, calmFadeOut } from '@/lib/motion';
import { useAppSettings } from '@/stores/app-settings';
import {
  lowestStageQuality,
  stageEffects,
  STAGE_TILT_DEADBAND,
  STAGE_TILT_WAKE,
  type StageQuality,
} from '@/lib/home-stage-motion';
import type { StageAgentLine, StagePanel } from '@/lib/home-stage-panels';
import type { StagePicture, StageScreenLook } from './stage-scene';
import { useStageTexture, type StageTextureState } from './stage-textures';
import { createStageBridge, type StageBridge, type StageInputs } from './types';

// An older binary, or web, keeps the static stage without evaluating the native module.
const GpuStage = lazy(() => import('./gpu-stage'));

/** Texture caps: the cover layers fill the screen; the art stands at most half its height. */
const COVER_MAX_EDGE = 2048;
const HERO_MAX_EDGE = 1536;
/** Under a sky painting the wallpaper is only a faint base: a smaller texture does. */
const BASE_MAX_EDGE = 1024;
/** The camera's flight into the front core before its workspace opens. */
const DIVE_MS = 520;
/** How long an orb's chip stays after the finger lifts, or after a waiting agent first shows. */
const CHIP_LINGER_MS = 1600;
const CHIP_ARRIVAL_MS = 3200;
/** A chip stays above this share of the view's height: the session strip and the composer are below. */
const STAGE_CHIP_FLOOR = 0.76;

/** The lowest quality rung the stage has stepped down to this session; never raised. */
const session: { quality: StageQuality } = { quality: 'full' };
/** Waiting agents whose chip has shown this session, by computer and agent: each shows once. */
const announced = new Set<string>();

export type StageViewProps = {
  panels: readonly StagePanel[];
  selectedIndex: number;
  /** Which picture is which layer, and how each is drawn (`useStageComposition`). */
  composition: StageComposition;
  /** The pictures the theme's reskin waits for. */
  wallpaperUri?: string;
  artworkUri?: string;
  /** The safe area's top inset, in points: the HUD starts below it. */
  inset: number;
  /** Home is not on screen or the app is in the background: no frames. */
  paused: boolean;
  /** Bumped when a task completes. */
  burst: number;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  /** An agent's orb: open its computer at the agent's pane, when known. */
  onOpenAgent: (index: number, paneId?: string) => void;
  onActions: (index: number) => void;
  onNewTask: () => void;
};

/** How many fresh canvases a session tries after a GPU failure before staying static. */
const STAGE_GPU_RETRIES = 3;

/** An orb's chip: which agent, what it says, and the point it hangs from. */
type StageChip = {
  serverId: string;
  key: string;
  at: { x: number; y: number };
  /** Lingers after the finger lifts, or goes on its own (a waiting agent's arrival). */
  until: number | null;
};

/**
 * The full-screen depth window: the WebGPU scene when the device has it,
 * otherwise (and after a lost device or a slow device's last degrade step)
 * the static 2.5D composition. Above either sits one layer of 2D hit areas
 * projected from the same geometry, which carries every touch target, every
 * accessibility element, the orbs' chips and the first-visit hints -- the
 * scene itself is never focusable.
 */
export function StageView({
  panels,
  selectedIndex,
  composition,
  wallpaperUri,
  artworkUri,
  inset,
  paused,
  burst,
  onSelect,
  onOpen,
  onOpenAgent,
  onActions,
  onNewTask,
}: StageViewProps) {
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
    setAttempt((count) => count + 1);
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
  const heroEdge = Math.min(HERO_MAX_EDGE, Math.round(window.height * dpr * 0.6));
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
  const orbs = useMemo(() => panels.map((panel) => stageOrbs(panel.agents)), [panels]);
  // By value: live agent data re-renders this view every few seconds, and the
  // scene re-renders only when what the cores show has changed.
  const screens = useStageScreens(panels, orbs);
  const colors = useMemo(
    () => ({
      background: theme.colors.background,
      surface: theme.colors.surface,
      text: theme.colors.text,
      primary: theme.colors.primary,
      success: theme.colors.success,
      warning: theme.colors.warning,
      offline: theme.colors.textDisabled,
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
  /** Fly into the front core, then run `open`; straight away without the scene or its motion. */
  const diveThen = useStableHandler((open: () => void) => {
    touched();
    if (!effects.gpu || reducedMotion) {
      open();
      return;
    }
    setDiving(true);
    setTimeout(open, DIVE_MS);
  });
  const openFront = useStableHandler((index: number) => diveThen(() => onOpen(index)));

  const count = panels.length;
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
          // Sideways moves the cores; up and down only looks around.
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

  const viewport = useMemo(
    () => ({ width: size.width, height: size.height, inset }),
    [size.width, size.height, inset]
  );
  const art = useStageArt(composition, viewport);
  const cores = useStageCores(panels, orbs, selectedIndex, role, viewport);
  const targets = useStageTargets(cores, art, viewport);

  // -- Orb chips -------------------------------------------------------------
  const [chip, setChip] = useState<StageChip | null>(null);
  const front = cores.find((core) => core.front) ?? null;
  const frontPanel = front ? panels[front.index] : undefined;
  /** The front orb under `touch`, where the scene last drew it (or at rest, without one). */
  const orbAt = (touch: { x: number; y: number }) => {
    if (!front || !frontPanel) return null;
    const placed = frontOrbs(front, bridge);
    const hit = stageOrbAt(
      touch,
      placed.points,
      placed.core,
      placed.camera,
      viewport.width,
      viewport.height
    );
    if (hit < 0) return null;
    const at = projectStagePoint(
      placed.points[hit]!,
      placed.camera,
      viewport.width,
      viewport.height
    );
    return { key: placed.keys[hit]!, at: { x: at.x, y: at.y } };
  };
  const showChip = useStableHandler(
    (key: string, at: { x: number; y: number }, until: number | null) => {
      if (frontPanel) setChip({ serverId: frontPanel.serverId, key, at, until });
    }
  );
  // A chip that lingers or arrived on its own goes when its time is up.
  useEffect(() => {
    if (!chip || chip.until === null) return;
    const timer = setTimeout(() => setChip(null), Math.max(0, chip.until - Date.now()));
    return () => clearTimeout(timer);
  }, [chip]);
  // A chip belongs to the front computer as it was: a swipe or leaving Home takes it away.
  const frontId = frontPanel?.serverId;
  useEffect(() => {
    if (paused) setChip(null);
  }, [paused]);
  useEffect(() => {
    setChip((current) => (current && current.serverId !== frontId ? null : current));
  }, [frontId]);
  // A waiting agent's orb, the first time it shows this session, names itself.
  const waitingKey = frontPanel?.agents.find(
    (agent) => agent.mark === 'needs-you' && !announced.has(`${frontPanel.serverId}:${agent.key}`)
  )?.key;
  const announce = useStableHandler((key: string) => {
    if (!front || !frontPanel || chip) return;
    announced.add(`${frontPanel.serverId}:${key}`);
    const placed = frontOrbs(front, bridge);
    const at = placed.keys.indexOf(key);
    if (at < 0) return;
    const point = projectStagePoint(
      placed.points[at]!,
      placed.camera,
      viewport.width,
      viewport.height
    );
    showChip(key, { x: point.x, y: point.y }, Date.now() + CHIP_ARRIVAL_MS);
  });
  // Never over another chip: it waits for the one showing to go.
  const chipShown = chip !== null;
  useEffect(() => {
    if (!waitingKey || chipShown || paused || diving || viewport.width <= 0) return;
    // After the frame that draws it, so the chip finds the orb where it is.
    const timer = setTimeout(() => announce(waitingKey), 250);
    return () => clearTimeout(timer);
  }, [waitingKey, chipShown, paused, diving, viewport.width, announce]);

  // The chip's orb as it is now: an agent that went away takes its chip with it.
  const chipIndex = chip ? panels.findIndex((panel) => panel.serverId === chip.serverId) : -1;
  const chipPanel = panels[chipIndex];
  const chipOrb = chip ? orbs[chipIndex]?.find((orb) => orb.key === chip.key) : undefined;
  const held = chipOrb !== undefined;

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
                screens={screens}
                selected={selectedIndex}
                held={held}
                colors={colors}
                mode={resolvedMode}
                role={role}
                inset={inset}
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
          <StaticStage
            panels={panels}
            cores={cores}
            composition={composition}
            art={art}
            dragY={dragY}
            tiltX={tiltX}
            tiltY={tiltY}
          />
        )}
        {effects.tilt && !paused ? (
          <StageTilt tiltX={tiltX} tiltY={tiltY} onMoved={bridge.wake} />
        ) : null}
        <StageHitAreas
          panels={panels}
          targets={targets}
          front={front}
          hints={hints && !diving}
          onSelect={(index) => {
            touched();
            onSelect(index);
          }}
          onOpen={openFront}
          onOpenAgent={(index, agent) =>
            diveThen(() => onOpenAgent(index, panels[index]?.agents[agent]?.paneId))
          }
          onActions={(index) => {
            touched();
            onActions(index);
          }}
          onNewTask={() => {
            touched();
            onNewTask();
          }}
          orbAt={orbAt}
          onOrbTouch={(orb) => {
            // A touch is interaction: the scene wakes (the orbits hold while the chip shows).
            touched();
            bridge.wake();
            showChip(orb.key, orb.at, null);
          }}
          onOrbRelease={() =>
            setChip((current) =>
              current && current.until === null
                ? { ...current, until: Date.now() + CHIP_LINGER_MS }
                : current
            )
          }
        />
        {chip && chipPanel && chipOrb ? (
          <StageOrbChip
            key={`${chip.serverId}:${chip.key}`}
            orb={chipOrb}
            agent={chipOrb.agent >= 0 ? chipPanel.agents[chipOrb.agent] : undefined}
            at={chip.at}
            coreY={front?.centre.y ?? chip.at.y}
            viewport={viewport}
          />
        ) : null}
      </View>
    </GestureDetector>
  );
}

/**
 * The front core's orbs, as the scene last drew them (`StageBridge.probe`)
 * or, without a scene, at rest: their points, keys, the core and the camera
 * that saw them.
 */
function frontOrbs(front: StageCoreView, bridge: StageBridge) {
  const probe = bridge.probe();
  if (probe)
    return {
      core: probe.core,
      camera: stageCamera({ lookX: probe.look[0], lookY: probe.look[1] }),
      points: probe.orbs.map((orb) => orb.point),
      keys: probe.orbs.map((orb) => orb.key),
    };
  return {
    core: front.core,
    camera: stageCamera(),
    points: front.orbs.map((orb) => orb.point),
    keys: front.orbs.map((orb) => orb.orb.key),
  };
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

/** The cores' looks, the same array while nothing in them changes. */
function useStageScreens(
  panels: readonly StagePanel[],
  orbs: readonly (readonly StageOrb[])[]
): readonly StageScreenLook[] {
  const screens: StageScreenLook[] = panels.map((panel, index) => ({
    key: panel.serverId,
    tone: panel.tone,
    working: panel.working,
    attention: panel.attention,
    orbs: (orbs[index] ?? []).map((orb) => ({ key: orb.key, mark: orb.mark })),
  }));
  const key = JSON.stringify(screens);
  const [kept, setKept] = useState({ key, screens });
  if (kept.key !== key) {
    setKept({ key, screens });
    return screens;
  }
  return kept.screens;
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

/** A point on screen, in points, and how large a world length there is. */
type Projected = { x: number; y: number; depth: number; scale: number };

/** A drawn core at rest, projected: what the hit areas, the static stage and the chips use. */
type StageCoreView = {
  index: number;
  front: boolean;
  core: StageCore;
  rect: StageRect;
  centre: Projected;
  /** The ring, projected, a full turn from its right-hand point. */
  ring: { x: number; y: number; far: boolean }[];
  orbs: { orb: StageOrb; point: StageVec3; at: Projected; hidden: boolean }[];
};

const RING_STEPS = 48;

/** The cores the cover-flow shows around the selection, at rest, as the scene draws them. */
function useStageCores(
  panels: readonly StagePanel[],
  orbs: readonly (readonly StageOrb[])[],
  selectedIndex: number,
  role: StageRole,
  viewport: StageViewport
): StageCoreView[] {
  return useMemo(() => {
    const { width, height } = viewport;
    if (width <= 0 || height <= 0) return [];
    const aspect = width / height;
    const camera = stageCamera();
    const anchor = stageCoreAnchor(camera, aspect, role);
    const project = (point: StageVec3): Projected => {
      const at = projectStagePoint(point, camera, width, height);
      return {
        x: at.x,
        y: at.y,
        depth: at.depth,
        scale: height / stageViewSize(at.depth, 1).height,
      };
    };
    const views: StageCoreView[] = [];
    for (const index of stageDrawnScreens(selectedIndex, panels.length)) {
      const offset = index - selectedIndex;
      if (!panels[index] || Math.abs(offset) >= STAGE_CORE_REACH) continue;
      const core = stageCore(offset, anchor, aspect, role);
      const ring = Array.from({ length: RING_STEPS }, (_, step) => {
        const angle = (step / RING_STEPS) * Math.PI * 2;
        const at = project(stageRingPoint(core, angle));
        return { x: at.x, y: at.y, far: Math.sin(angle) > 0 };
      });
      const ringOrbs = orbs[index] ?? [];
      views.push({
        index,
        front: offset === 0,
        core,
        rect: stageCoreRect(core, camera, width, height),
        centre: project(core.position),
        ring,
        orbs: ringOrbs.map((orb, slot) => {
          const point = stageOrbRestPoint(core, slot, ringOrbs.length);
          return {
            orb,
            point,
            at: project(point),
            hidden: stageBehindCore(point, core, camera.position),
          };
        }),
      });
    }
    return views;
  }, [panels, orbs, selectedIndex, role, viewport]);
}

type StageTarget =
  | { kind: 'host'; rect: StageRect; hint: { x: number; y: number } }
  | {
      kind: 'core';
      index: number;
      front: boolean;
      rect: StageRect;
      hint: { x: number; y: number };
    };

/**
 * Every target's resting box on screen, far to near (so the nearer one wins
 * a tap): the new-task host -- the figure, the painting's band or, with no
 * artwork, the open band above the core -- and the cores the cover-flow
 * shows around the selection, each with its ring.
 */
function useStageTargets(
  cores: readonly StageCoreView[],
  art: StageArt,
  viewport: StageViewport
): StageTarget[] {
  return useMemo(() => {
    if (viewport.width <= 0 || viewport.height <= 0) return [];
    const host = stageHostTarget(art, viewport);
    const targets: StageTarget[] = [
      {
        kind: 'host',
        rect: {
          ...host.rect,
          depth: art?.kind === 'painting' ? STAGE_PAINTING_DEPTH : STAGE_HERO_DEPTH,
          visible: host.rect.width > 0 && host.rect.height > 0,
        },
        hint: host.hint,
      },
    ];
    for (const view of cores)
      targets.push({
        kind: 'core',
        index: view.index,
        front: view.front,
        rect: view.rect,
        // Just above the core's top.
        hint: { x: view.centre.x, y: view.centre.y - view.core.radius * view.centre.scale - 6 },
      });
    return targets.sort((a, b) => b.rect.depth - a.rect.depth);
  }, [cores, art, viewport]);
}

/** What an agent is doing, for its chip and its accessible name. */
function useAgentState() {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  return (agent: StageAgentLine) =>
    agent.mark === 'needs-you'
      ? (agent.activity ?? t`Needs you`)
      : agent.mark === 'working'
        ? (agent.activity ?? _(agentStatusWord.working))
        : _(agentStatusWord.idle);
}

/**
 * The 2D layer over the world: the host starts a new task; the front core
 * opens its computer, or the agent whose orb is under the finger (its chip
 * shows while the finger is down); a side core comes forward; a long press
 * on a core offers the computer's actions. The screen reader reads these
 * and an invisible list of the front computer's agents, never the scene.
 */
function StageHitAreas({
  panels,
  targets,
  front,
  hints,
  onSelect,
  onOpen,
  onOpenAgent,
  onActions,
  onNewTask,
  orbAt,
  onOrbTouch,
  onOrbRelease,
}: {
  panels: readonly StagePanel[];
  targets: readonly StageTarget[];
  front: StageCoreView | null;
  hints: boolean;
  onSelect: (index: number) => void;
  onOpen: (index: number) => void;
  /** `agent` is the index in the computer's agents. */
  onOpenAgent: (index: number, agent: number) => void;
  onActions: (index: number) => void;
  onNewTask: () => void;
  orbAt: (touch: { x: number; y: number }) => { key: string; at: { x: number; y: number } } | null;
  onOrbTouch: (orb: { key: string; at: { x: number; y: number } }) => void;
  onOrbRelease: () => void;
}) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const agentState = useAgentState();
  // The orb under the finger since it went down, if any.
  const pressed = useRef<string | null>(null);
  const frontTarget = targets.find((target) => target.kind === 'core' && target.front);
  const host = targets.find((target) => target.kind === 'host');
  const frontPanel = front ? panels[front.index] : undefined;
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
        const shared = {
          testID: `home-stage-panel-${panel.serverId}`,
          accessibilityRole: 'button' as const,
          accessibilityLabel: `${panel.label}, ${status}, ${sessions}, ${position}`,
          accessibilityHint: target.front
            ? t`Opens this computer.`
            : t`Brings this computer forward.`,
          accessibilityState: { selected: target.front },
          accessibilityActions: [{ name: 'longpress', label: t`Actions` }],
          onAccessibilityAction: (event: { nativeEvent: { actionName: string } }) => {
            if (event.nativeEvent.actionName === 'longpress') onActions(target.index);
          },
          style: [styles.hit, box],
        };
        if (!target.front)
          return (
            <PressableScale
              key={panel.serverId}
              {...shared}
              onPress={() => onSelect(target.index)}
              onLongPress={() => onActions(target.index)}
            />
          );
        const locate = (event: GestureResponderEvent) =>
          orbAt({
            x: rect.x + event.nativeEvent.locationX,
            y: rect.y + event.nativeEvent.locationY,
          });
        return (
          <Pressable
            key={panel.serverId}
            {...shared}
            onPressIn={(event) => {
              const orb = locate(event);
              pressed.current = orb?.key ?? null;
              if (orb) onOrbTouch(orb);
            }}
            onPressOut={() => {
              if (pressed.current !== null) onOrbRelease();
            }}
            onPress={() => {
              const key = pressed.current;
              pressed.current = null;
              const agent = key === null ? -1 : panel.agents.findIndex((line) => line.key === key);
              if (agent >= 0) onOpenAgent(target.index, agent);
              else onOpen(target.index);
            }}
            // A long press on an orb only names it; on the core, the computer's actions.
            onLongPress={() => {
              if (pressed.current === null) onActions(target.index);
            }}
          />
        );
      })}
      {front && frontPanel ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {frontPanel.agents.map((agent, index) => {
            const placed =
              front.orbs.find((orb) => orb.orb.agent === index) ??
              front.orbs.find((orb) => orb.orb.mark === 'more');
            const at = placed?.at ?? front.centre;
            return (
              <View
                key={agent.key}
                testID={`home-stage-agent-${agent.key}`}
                accessible
                accessibilityRole="button"
                accessibilityLabel={`${agent.name}, ${agentState(agent)}`}
                accessibilityHint={t`Opens this agent.`}
                accessibilityActions={[{ name: 'activate' }]}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === 'activate') onOpenAgent(front.index, index);
                }}
                style={[styles.agent, { left: at.x - 22, top: at.y - 22 }]}
              />
            );
          })}
        </View>
      ) : null}
      {hints && host ? <StageHint text={t`Tap · start a new task`} at={host.hint} /> : null}
      {hints && frontTarget ? <StageHint text={t`Tap · open`} at={frontTarget.hint} /> : null}
    </View>
  );
}

/** A chip hung from a projected 3D point by a short leader line. */
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
 * An orb's chip: "claude · running tests", in the orb's colour, beside the
 * orb on the side away from its core (`stageChipPlacement`), kept on screen
 * and clear of the HUD and the session strip. The screen reader has the
 * agents' list instead.
 */
function StageOrbChip({
  orb,
  agent,
  at,
  coreY,
  viewport,
}: {
  orb: StageOrb;
  agent: StageAgentLine | undefined;
  at: { x: number; y: number };
  /** The core's centre on screen: the chip goes on the orb's far side from it. */
  coreY: number;
  viewport: StageViewport;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const background = useSurfaceBackground();
  const agentState = useAgentState();
  const [box, setBox] = useState({ width: 0, height: 0 });
  const tone =
    orb.mark === 'needs-you'
      ? theme.colors.warning
      : orb.mark === 'working'
        ? theme.colors.primary
        : theme.colors.textMuted;
  const place = stageChipPlacement(at, box, {
    width: viewport.width,
    ceiling: viewport.inset + STAGE_HUD_BOTTOM_PT,
    floor: viewport.height * STAGE_CHIP_FLOOR,
    coreY,
  });
  return (
    <Animated.View
      entering={calmFadeIn('micro')}
      exiting={calmFadeOut('short')}
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
        styles.orbChip,
        {
          left: place.left,
          top: place.top,
          opacity: box.width > 0 ? 1 : 0,
          backgroundColor: background(theme.colors.background),
          borderColor: withAlpha(tone, 0.7),
        },
      ]}>
      <View style={[styles.orbDot, { backgroundColor: tone }]} />
      {agent ? (
        <Text variant="caption" numberOfLines={1} style={styles.orbText}>
          <Text variant="caption" weight="semibold">
            {agent.name}
          </Text>
          {` · ${agentState(agent)}`}
        </Text>
      ) : (
        <Text variant="caption" weight="semibold" numberOfLines={1}>
          {t`${plural(orb.more, { one: '# more agent', other: '# more agents' })}`}
        </Text>
      )}
    </Animated.View>
  );
}

/**
 * The 2.5D stage: the same roles flat -- the wallpaper at its authored fit,
 * focal point and opacity, the painting's band or the figure in its box with
 * the same fades, the frame, the cores at their projected places with their
 * rings and orbs at rest -- with only parallax for motion. Drawn without
 * WebGPU, after a lost device, or as a slow device's last degrade step.
 */
function StaticStage({
  panels,
  cores,
  composition,
  art,
  dragY,
  tiltX,
  tiltY,
}: {
  panels: readonly StagePanel[];
  cores: readonly StageCoreView[];
  composition: StageComposition;
  art: StageArt;
  dragY: SharedValue<number>;
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
}) {
  const theme = useThemeTokens();
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
  const { backdrop, frame } = composition;
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.bleed, far]}>
        {backdrop ? <StaticWallpaper layer={backdrop} /> : null}
      </Animated.View>
      {art?.kind === 'painting' ? (
        <Animated.View style={[StyleSheet.absoluteFill, far]}>
          <StaticArt art={art} />
        </Animated.View>
      ) : null}
      {art?.kind === 'hero' ? (
        <Animated.View style={[StyleSheet.absoluteFill, near]}>
          <StaticArt art={art} />
        </Animated.View>
      ) : null}
      {/* The frame sits between the art and the cores: it never covers a computer. */}
      {frame ? <StaticWallpaper layer={frame} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, near]}>
        <StaticCores panels={panels} cores={cores} />
      </Animated.View>
    </View>
  );
}

/**
 * The cores flat, as the scene draws them at rest: the halo, the ring's far
 * half, the orbs behind, the sphere (a radial body with a bright heart and
 * a highlight), the ring's near half and the orbs in front.
 */
function StaticCores({
  panels,
  cores,
}: {
  panels: readonly StagePanel[];
  cores: readonly StageCoreView[];
}) {
  const theme = useThemeTokens();
  const { resolvedMode } = useThemeMode();
  const light = resolvedMode === 'light';
  const { primary, warning, textDisabled: offlineColor, text } = theme.colors;
  return (
    <Canvas style={StyleSheet.absoluteFill}>
      {[...cores]
        .sort((a, b) => b.centre.depth - a.centre.depth)
        .map((view) => {
          const panel = panels[view.index];
          if (!panel) return null;
          const offline = panel.tone === 'offline' || panel.tone === 'unknown';
          const warn = !offline && (panel.attention || panel.tone === 'warning');
          const fade = view.front ? 1 : 0.6;
          const tint = offline ? offlineColor : primary;
          const r = view.core.radius * view.centre.scale;
          const { x, y } = view.centre;
          const halves = [true, false].map((far) => {
            const path = Skia.PathBuilder.Make();
            let open = false;
            view.ring.forEach((point, step) => {
              const next = view.ring[(step + 1) % view.ring.length]!;
              if (point.far !== far || next.far !== far) {
                open = false;
                return;
              }
              if (!open) path.moveTo(point.x, point.y);
              path.lineTo(next.x, next.y);
              open = true;
            });
            return path.detach();
          });
          const orbDot = (entry: StageCoreView['orbs'][number]) => {
            const color =
              entry.orb.mark === 'needs-you'
                ? warning
                : entry.orb.mark === 'working'
                  ? primary
                  : entry.orb.mark === 'more'
                    ? text
                    : withAlpha(primary, 0.6);
            const size =
              view.core.orbRadius *
              entry.at.scale *
              (entry.orb.mark === 'needs-you' ? 1.2 : entry.orb.mark === 'idle' ? 0.85 : 1);
            return (
              <Group key={entry.orb.key} opacity={fade}>
                {entry.orb.mark === 'more' ? null : (
                  <Circle
                    cx={entry.at.x}
                    cy={entry.at.y}
                    r={size * 2.4}
                    color={withAlpha(color, light ? 0.25 : 0.35)}>
                    <BlurMask blur={size * 1.2} style="normal" />
                  </Circle>
                )}
                <Circle
                  cx={entry.at.x}
                  cy={entry.at.y}
                  r={entry.orb.mark === 'more' ? size * 0.85 : size}
                  color={color}
                  style={entry.orb.mark === 'more' ? 'stroke' : 'fill'}
                  strokeWidth={1.5}
                />
              </Group>
            );
          };
          const behind = view.orbs.filter((entry) => entry.hidden || entry.at.y < y);
          const before = view.orbs.filter((entry) => !(entry.hidden || entry.at.y < y));
          return (
            <Group key={panel.serverId} opacity={offline ? 0.7 : 1}>
              {offline ? null : (
                <Circle cx={x} cy={y} r={r * 2.8}>
                  <RadialGradient
                    c={vec(x, y)}
                    r={r * 2.8}
                    colors={[
                      withAlpha(warn ? warning : primary, (light ? 0.35 : 0.45) * fade),
                      withAlpha(warn ? warning : primary, 0),
                    ]}
                    positions={[0.3, 1]}
                  />
                </Circle>
              )}
              <Path
                path={halves[0]!}
                style="stroke"
                strokeWidth={1}
                color={withAlpha(tint, 0.45 * fade)}
              />
              {behind.map(orbDot)}
              <Circle cx={x} cy={y} r={r} opacity={fade}>
                <RadialGradient
                  c={vec(x - r * 0.2, y - r * 0.25)}
                  r={r * 1.25}
                  colors={
                    offline
                      ? [withAlpha(offlineColor, 0.9), withAlpha(offlineColor, 0.55)]
                      : light
                        ? ['#ffffff', withAlpha(primary, 0.85), primary]
                        : [withAlpha('#ffffff', 0.95), primary, withAlpha(primary, 0.45)]
                  }
                  positions={offline ? [0, 1] : [0, 0.45, 1]}
                />
              </Circle>
              <Path
                path={halves[1]!}
                style="stroke"
                strokeWidth={1.25}
                color={withAlpha(tint, 0.8 * fade)}
              />
              {before.map(orbDot)}
            </Group>
          );
        })}
    </Canvas>
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
  agent: { position: 'absolute', width: 44, height: 44 },
  hint: { position: 'absolute', alignItems: 'center' },
  hintChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintLeader: { width: 1, height: 14, opacity: 0.7 },
  orbChip: {
    position: 'absolute',
    maxWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  orbDot: { width: 6, height: 6, borderRadius: 3 },
  orbText: { flexShrink: 1 },
  bleed: { position: 'absolute', top: -12, bottom: -12, left: -12, right: -12 },
});
