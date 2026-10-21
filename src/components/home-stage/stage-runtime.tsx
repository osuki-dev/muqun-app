import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import type { WebGPURenderer } from 'three/webgpu';

import { useStableHandler } from '@/hooks/use-render-refs';
import {
  stageCamera,
  stageCore,
  stageCoreAnchor,
  stageDiveCamera,
  stageDragPosition,
  stageDrawnScreens,
  stageRingPoint,
  STAGE_CORE_REACH,
} from '@/lib/home-stage-geometry';
import { stageOrbAngle, trackStageOrbs, type StageOrbTrack } from '@/lib/home-stage-orbs';
import { stageAmbient } from '@/lib/home-stage-ambient';
import {
  createStageFrameBudget,
  recordStageFrame,
  stageEffects,
  stageIdleInterval,
  stageSpringAtRest,
  stepStageSpring,
  STAGE_CARD_SPRING,
  STAGE_AMBIENT_IDLE_MS,
  type StageFrameBudget,
  type StageQuality,
  type StageSpring,
} from '@/lib/home-stage-motion';
import type { StageCoreFrame } from './stage-cores';
import { createStageScene, type StagePicture } from './stage-scene';
import type { StageProbe, StageSceneProps } from './types';

/**
 * The frame log (`stage-perf.ts`), in a Debug or Release profiling bundle
 * built with `EXPO_PUBLIC_STAGE_PERF=1` only. A `require` behind a condition
 * Metro folds: a store bundle never contains it.
 */
type StagePerfModule = typeof import('./stage-perf');
const stagePerf =
  process.env.EXPO_PUBLIC_STAGE_PERF === '1' &&
  (__DEV__ || process.env.EXPO_PUBLIC_RELEASE_PROFILER === '1')
    ? // oxlint-disable-next-line typescript/no-require-imports
      (require('./stage-perf') as StagePerfModule).createStagePerfLog()
    : null;

/**
 * Why a frame is drawn, which sets how soon the next may be: `touch` (a
 * finger, the cover-flow settling, a dive, orbs making room) at the
 * full rate, `glide` (tilt easing in, a completion's flare) at 30 fps, `idle`
 * (the ambient motion) at 20 fps, `content` once.
 */
type Pace = 'touch' | 'glide' | 'idle' | 'content';

type Motion = {
  /** The cover-flow's fractional selection. */
  flow: StageSpring;
  dive: StageSpring;
  /** Each drawn computer's orbs, by its key: their slots, travel and presence. */
  rings: Map<string, StageOrbTrack[]>;
  /** The front core as last drawn, for touches (`StageBridge.probe`). */
  probe: StageProbe | null;
  look: [number, number];
  burst: number;
  lastFrameMs: number;
  /** The last frame asked for the next at the full rate: the gap between them measures the device. */
  wasTouch: boolean;
  /** Whether the last frame moved anything; the ambient clock runs on through a move. */
  wasMoving: boolean;
  budget: StageFrameBudget;
  timer: ReturnType<typeof setTimeout> | null;
  /** The ambient clock: advances only on drawn frames, so a stop and resume never jumps. */
  ambientS: number;
  /**
   * The last interaction (a drag, swipe, tilt, dive, flare, return to Home or
   * new theme) or moving frame: the ambient motion runs for
   * `STAGE_AMBIENT_IDLE_MS` after it. A content change does not count.
   */
  activeMs: number;
};

const DIVE_SPRING = { stiffness: 90, damping: 17 };

/**
 * Lives inside the Fiber root. Owns the scene objects and the frame clock:
 * frames are drawn at the full rate while a finger, the cover-flow, a dive or
 * orbs making room move the scene, at 30 fps while only tilt or a
 * completion's flare does; otherwise at the 20 fps idle rate for the orbits,
 * a working core's breathing, the hero's bob and the motes' drift, for
 * `STAGE_AMBIENT_IDLE_MS` after the last activity, and
 * then not at all until something wakes the scene. Never while Home is paused
 * or, under Reduce Motion, at rest. It draws each frame itself, so it can
 * time it: a device that runs over its frame budget steps down the quality
 * ladder (`recordStageFrame`).
 */
export function StageRuntime(props: StageSceneProps) {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const setDpr = useThree((state) => state.setDpr);
  const [world] = useState(createStageScene);
  const motion = useRef<Motion | null>(null);
  const aspect = size.height > 0 ? size.width / size.height : 390 / 844;
  const {
    screens,
    selected,
    held,
    colors,
    mode,
    role,
    inset,
    backdrop,
    painting,
    hero,
    frame,
    ambientEffects,
    ambientColors,
    quality,
    reducedMotion,
    dive,
    burst,
    paused,
    inputs,
    bridge,
  } = props;

  const motionState = () => {
    if (motion.current) return motion.current;
    motion.current = {
      flow: { value: selected, velocity: 0 },
      dive: { value: 0, velocity: 0 },
      rings: new Map(),
      probe: null,
      look: [0, 0],
      burst: 0,
      lastFrameMs: 0,
      wasTouch: false,
      wasMoving: false,
      budget: createStageFrameBudget(quality),
      timer: null,
      ambientS: 0,
      activeMs: performance.now(),
    };
    return motion.current;
  };
  const stopTimer = () => {
    const state = motion.current;
    if (state?.timer) clearTimeout(state.timer);
    if (state) state.timer = null;
  };

  const release = useEffectEvent(() => {
    stopTimer();
    world.dispose();
  });
  useEffect(() => release, []);
  // Interaction: draw, and (re)start the idle-throttled ambient window.
  // A stable handler, since the gestures and tilt call it through the bridge.
  const activate = useStableHandler(() => {
    if (paused) return;
    motionState().activeMs = performance.now();
    invalidate();
  });
  useEffect(() => {
    bridge.setWaker(activate);
    bridge.setProber(() => motion.current?.probe ?? null);
    return () => {
      bridge.setWaker(null);
      bridge.setProber(null);
    };
  }, [bridge, activate]);
  // Content (agents, textures, the viewport): exactly one frame, and the
  // ambient window is left as it was -- live agent status arriving every few
  // seconds must not keep the scene animating. Nothing is drawn while Home is
  // off screen: a change that arrives then is drawn when Home comes back.
  const wake = useEffectEvent(() => {
    if (!paused) invalidate();
  });
  // The theme by value: the same colours after a parent re-render do nothing.
  const themeKey = JSON.stringify([colors, mode]);
  const applyTheme = useEffectEvent(() => {
    world.setTheme({ colors, mode }, scene, gl as unknown as WebGPURenderer);
    activate();
  });
  useEffect(() => applyTheme(), [world, themeKey, scene, gl]);
  useEffect(() => {
    world.setViewport({ width: size.width, height: size.height, inset });
    wake();
  }, [world, size.width, size.height, inset]);
  useEffect(() => {
    world.setRole(role);
    wake();
  }, [world, role]);
  const backdropKey = pictureKey(backdrop);
  const applyBackdrop = useEffectEvent(() => {
    world.setBackdrop(backdrop);
    wake();
  });
  useEffect(() => applyBackdrop(), [world, backdropKey]);
  const paintingKey = pictureKey(painting);
  const applyPainting = useEffectEvent(() => {
    world.setPainting(painting);
    wake();
  });
  useEffect(() => applyPainting(), [world, paintingKey]);
  const heroKey = pictureKey(hero);
  const applyHero = useEffectEvent(() => {
    world.setHero(hero);
    wake();
  });
  useEffect(() => applyHero(), [world, heroKey]);
  const frameKey = pictureKey(frame);
  const applyFrame = useEffectEvent(() => {
    world.setFrame(frame);
    wake();
  });
  useEffect(() => applyFrame(), [world, frameKey]);
  // A computer's state or its agents changed: one frame (more while its orbs make room).
  useEffect(() => wake(), [screens]);
  // The theme's effect, by value: a new effect is a theme change and starts
  // the ambient window; the same effect after a parent re-render does nothing.
  const ambientKey = JSON.stringify([ambientEffects, ambientColors, mode, aspect]);
  const applyAmbient = useEffectEvent(() => {
    world.setAmbient(stageAmbient(ambientEffects, ambientColors, mode, aspect));
    activate();
  });
  useEffect(() => applyAmbient(), [world, ambientKey]);
  // Only a new quality resets the budget, and sets the pixel ratio its rung allows.
  const applyQuality = useEffectEvent((next: StageQuality) => {
    motionState().budget = createStageFrameBudget(next);
    const { maxDpr } = stageEffects(next, { gpuAvailable: true, reducedMotion });
    setDpr(Math.min(PixelRatio.get(), maxDpr));
    wake();
  });
  useEffect(() => applyQuality(quality), [quality]);
  // The selection has caught up with a released drag: follow the selection again.
  const selectionMoved = useEffectEvent(() => {
    inputs.settle.set(-1);
    activate();
  });
  useEffect(() => selectionMoved(), [selected]);
  const bursted = useEffectEvent(() => {
    motionState().burst = 1;
    activate();
  });
  useEffect(() => {
    if (burst > 0) bursted();
  }, [burst]);
  // Pausing stops the clock; coming back to Home or a dive is interaction.
  const wakeFor = useEffectEvent((isPaused: boolean) => {
    if (isPaused) stopTimer();
    else activate();
  });
  useEffect(() => wakeFor(paused), [paused]);
  useEffect(() => wakeFor(false), [dive]);

  const qualityDropped = useStableHandler((next: StageQuality) => props.onQualityDrop(next));

  // Priority 1: this callback draws the frame itself, instead of Fiber.
  useFrame(() => {
    const state = motionState();
    const now = performance.now();
    const elapsedMs = state.lastFrameMs ? now - state.lastFrameMs : 1000 / 60;
    state.lastFrameMs = now;
    const dt = Math.min(0.05, elapsedMs / 1000);
    const effects = stageEffects(quality, { gpuAvailable: true, reducedMotion });
    // The ambient clock (orbits, breathing, motes, bob, a theme's effect) only
    // runs inside the window after an interaction: a content frame drawn
    // outside it shows the motion exactly where it stopped.
    const ambientOn = state.wasMoving || now - state.activeMs < STAGE_AMBIENT_IDLE_MS;
    if (effects.pulse && ambientOn) state.ambientS += dt;
    // The orbits also hold while a chip names one of their orbs.
    const orbitDt = effects.orbit && ambientOn && !held ? dt : 0;
    const count = screens.length;

    // A finger moves the cores directly; on release they spring to where the
    // drag settled until the selection catches up, then follow the selection.
    const dragging = inputs.dragging.get() === 1;
    const settle = inputs.settle.get();
    const flowGoal = dragging
      ? stageDragPosition(selected, count, inputs.dragX.get())
      : settle >= 0
        ? settle
        : selected;
    state.flow =
      dragging || reducedMotion
        ? { value: flowGoal, velocity: 0 }
        : stepStageSpring(state.flow, flowGoal, dt, STAGE_CARD_SPRING);
    state.dive = stepStageSpring(state.dive, dive ? 1 : 0, dt, DIVE_SPRING);

    // Tilt (when on) and a vertical drag both look around; the drag springs back.
    const lookGoal: [number, number] = [
      effects.tilt ? inputs.tiltY.get() : 0,
      -(effects.tilt ? inputs.tiltX.get() : 0) -
        (dragging ? Math.max(-1, Math.min(1, inputs.dragY.get() * 3)) : 0),
    ];
    const ease = Math.min(1, dt * 4);
    const before = state.look;
    state.look = [
      before[0] + (lookGoal[0] - before[0]) * ease,
      before[1] + (lookGoal[1] - before[1]) * ease,
    ];
    const looking =
      Math.abs(state.look[0] - lookGoal[0]) + Math.abs(state.look[1] - lookGoal[1]) > 0.003;

    // The cores hang from the tilted camera; a dive then flies it into the front one.
    const rest = stageCamera({ lookX: state.look[0], lookY: state.look[1] });
    const anchor = stageCoreAnchor(rest, aspect, role);
    const view = stageDiveCamera(rest, stageCore(0, anchor, aspect, role), state.dive.value);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateMatrixWorld();

    // Each drawn computer's orbs: evenly spaced, springing to make room when
    // one comes or goes (a content change: it draws until they settle and
    // starts no ambient motion), travelling only on the orbit clock.
    let settling = false;
    const cores: StageCoreFrame[] = [];
    const rings = new Map<string, StageOrbTrack[]>();
    state.probe = null;
    for (const index of stageDrawnScreens(selected, count)) {
      const look = screens[index];
      if (!look) continue;
      const known = state.rings.get(look.key);
      // A ring seen for the first time is drawn as it is, not grown into.
      const tracked = trackStageOrbs(known ?? [], look.orbs, dt, {
        orbitDt,
        still: reducedMotion || !known,
      });
      rings.set(look.key, tracked.tracks);
      if (tracked.moving) settling = true;
      const offset = index - state.flow.value;
      if (Math.abs(offset) >= STAGE_CORE_REACH) continue;
      const core = stageCore(offset, anchor, aspect, role);
      const orbs = tracked.tracks.map((track) => ({
        key: track.key,
        mark: track.mark,
        point: stageRingPoint(core, stageOrbAngle(track)),
        presence: track.presence.value,
        leaving: track.leaving,
      }));
      cores.push({ core, look, orbs });
      if (index === selected)
        state.probe = {
          look: [state.look[0], state.look[1]],
          core,
          orbs: orbs.filter((orb) => !orb.leaving),
        };
    }
    state.rings = rings;

    // A completion flares the motes; Reduce Motion keeps them still.
    state.burst = effects.pulse ? Math.max(0, state.burst - dt * 0.6) : 0;
    world.update({
      camera,
      cores,
      timeS: effects.pulse ? state.ambientS : 0,
      burst: effects.pulse ? state.burst : 0,
      motes: effects.particles,
      particleShare: effects.particleShare,
      pulse: effects.pulse,
      breathe: effects.orbit,
      fullGlow: effects.fullGlow,
    });
    // Fiber's loop never resets the renderer's counters: the log counts per frame.
    if (stagePerf) (gl as unknown as WebGPURenderer).info.reset();
    gl.render(scene, camera);
    const workMs = performance.now() - now;

    const touch =
      !stageSpringAtRest(state.flow, flowGoal) ||
      !stageSpringAtRest(state.dive, dive ? 1 : 0) ||
      dragging;
    const moving = touch || looking || state.burst > 0;
    const ambient = !moving && stageIdleInterval(effects, now - state.activeMs) !== null;
    // What this frame measured: its own work, and at the full rate also how
    // long the device took to come back for it. Content frames drawn once
    // are evidence of nothing.
    if (!reducedMotion && (state.wasMoving || moving || settling || ambient)) {
      const was = state.budget.quality;
      const next = recordStageFrame(state.budget, {
        nowMs: now,
        // Only the frame's own work: the gap to the next frame also measures
        // how the system scheduled us, which on a phone stepped the stage
        // down for nothing.
        frameMs: workMs,
      });
      if (next !== was) qualityDropped(next);
    }
    if (stagePerf) {
      const { render } = (gl as unknown as WebGPURenderer).info;
      stagePerf.record({
        nowMs: now,
        workMs,
        gapMs: elapsedMs,
        drawCalls: render.drawCalls,
        triangles: render.triangles,
        quality: state.budget.quality,
        dpr: (gl as unknown as WebGPURenderer).getPixelRatio(),
        pace: (touch || settling
          ? 'touch'
          : moving
            ? 'glide'
            : ambient
              ? 'idle'
              : 'content') satisfies Pace,
      });
    }
    state.wasMoving = moving;
    state.wasTouch = false;
    if (moving) state.activeMs = now;

    stopTimer();
    if (paused) return;
    if (moving || settling) {
      const interval = touch || settling ? effects.frameIntervalMs : effects.glideIntervalMs;
      if (interval > 0)
        state.timer = setTimeout(invalidate, Math.max(0, interval - (performance.now() - now)));
      else {
        state.wasTouch = true;
        invalidate();
      }
    } else {
      const idle = stageIdleInterval(effects, now - state.activeMs);
      if (idle !== null) state.timer = setTimeout(invalidate, idle);
    }
  }, 1);

  // oxlint-disable-next-line react/no-unknown-property -- Fiber's intrinsic `primitive` takes `object`.
  return <primitive object={world.root} />;
}

/** A layer by value: its texture and how the theme asks for it to be drawn. */
function pictureKey(picture: StagePicture | null): string {
  if (!picture) return '';
  return `${picture.texture.uuid}:${JSON.stringify(picture.layer)}`;
}
