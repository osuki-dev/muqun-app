import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { WebGPURenderer } from 'three/webgpu';

import { useStableHandler } from '@/hooks/use-render-refs';
import {
  stageCamera,
  stageDiveCamera,
  stageDragPosition,
  stageDrawnScreens,
  stagePane,
  stagePaneAnchor,
  STAGE_PANE_REACH,
} from '@/lib/home-stage-geometry';
import { stageAmbient } from '@/lib/home-stage-ambient';
import {
  initialStageDegrade,
  recordStageFrame,
  stageEffects,
  stageIdleInterval,
  stageSpringAtRest,
  stepStageSpring,
  STAGE_CARD_SPRING,
  STAGE_WAKE_GAP_MS,
  type StageDegradeState,
  type StageSpring,
} from '@/lib/home-stage-motion';
import { createStageScene, type StagePaneFrame } from './stage-scene';
import type { StageSceneProps } from './types';

type Motion = {
  /** The cover-flow's fractional selection. */
  flow: StageSpring;
  dive: StageSpring;
  look: [number, number];
  burst: number;
  lastFrameMs: number;
  wasMoving: boolean;
  degrade: StageDegradeState;
  timer: ReturnType<typeof setTimeout> | null;
  /** The ambient clock: advances only on drawn frames, so a stop and resume never jumps. */
  ambientS: number;
  /** The last frame that moved, or that a wake drew after the scene had stopped. */
  activeMs: number;
};

const DIVE_SPRING = { stiffness: 90, damping: 17 };

/**
 * Lives inside the Fiber root. Owns the scene objects and the frame clock:
 * frames are drawn while something moves (the cover-flow, a drag, tilt, a
 * dive, a completion's flare); otherwise at the 20 fps idle rate for the
 * working pulse, the hero's bob and the motes' drift, for
 * `STAGE_AMBIENT_IDLE_MS` after the last activity, and then not at all until
 * something wakes the scene. Never while Home is paused or, under Reduce
 * Motion, at rest.
 */
export function StageRuntime(props: StageSceneProps) {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const size = useThree((state) => state.size);
  const [world] = useState(createStageScene);
  const motion = useRef<Motion | null>(null);
  const aspect = size.height > 0 ? size.width / size.height : 390 / 844;
  const {
    screens,
    selected,
    colors,
    mode,
    backdrop,
    hero,
    frame,
    faces,
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
      look: [0, 0],
      burst: 0,
      lastFrameMs: 0,
      wasMoving: false,
      degrade: initialStageDegrade(quality),
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
  useEffect(() => {
    bridge.setWaker(() => {
      if (!paused) invalidate();
    });
    return () => bridge.setWaker(null);
  }, [bridge, invalidate, paused]);
  // Nothing is drawn while Home is off screen: a change that arrives then (a
  // new theme, new textures, new faces) is drawn when Home comes back.
  const wake = useEffectEvent(() => {
    if (!paused) invalidate();
  });
  useEffect(() => {
    world.setTheme({ colors, mode }, scene, gl as unknown as WebGPURenderer);
    wake();
  }, [world, colors, mode, scene, gl]);
  useEffect(() => {
    world.setViewport(aspect);
    wake();
  }, [world, aspect]);
  useEffect(() => {
    world.setBackdrop(backdrop);
    wake();
  }, [world, backdrop]);
  useEffect(() => {
    world.setHero(hero);
    wake();
  }, [world, hero]);
  useEffect(() => {
    world.setFrame(frame);
    wake();
  }, [world, frame]);
  useEffect(() => {
    world.setFaces(faces);
    wake();
  }, [world, faces]);
  useEffect(() => {
    world.setAmbient(stageAmbient(ambientEffects, ambientColors, mode, aspect));
    wake();
  }, [world, ambientEffects, ambientColors, mode, aspect]);
  // Only a new quality resets the ladder.
  const resetLadder = useEffectEvent((next: StageSceneProps['quality']) => {
    motionState().degrade = initialStageDegrade(next);
  });
  useEffect(() => resetLadder(quality), [quality]);
  // The selection has caught up with a released drag: follow the selection again.
  const selectionMoved = useEffectEvent(() => {
    inputs.settle.set(-1);
    wake();
  });
  useEffect(() => selectionMoved(), [selected]);
  const bursted = useEffectEvent(() => {
    motionState().burst = 1;
    wake();
  });
  useEffect(() => {
    if (burst > 0) bursted();
  }, [burst]);
  // Pausing only stops or restarts the clock; a dive change only needs a frame.
  const wakeFor = useEffectEvent((isPaused: boolean) => {
    if (isPaused) stopTimer();
    else invalidate();
  });
  useEffect(() => wakeFor(paused), [paused]);
  useEffect(() => wakeFor(false), [dive]);

  const qualityDropped = useStableHandler((next: StageDegradeState['quality']) =>
    props.onQualityDrop(next)
  );

  useFrame(() => {
    const state = motionState();
    const now = performance.now();
    const elapsedMs = state.lastFrameMs ? now - state.lastFrameMs : 1000 / 60;
    const continuous = state.wasMoving && elapsedMs < 120;
    state.lastFrameMs = now;
    const dt = Math.min(0.05, elapsedMs / 1000);
    const effects = stageEffects(quality, { gpuAvailable: true, reducedMotion });
    // Woken after a stop: whatever woke it is activity, so the ambient motion resumes.
    if (elapsedMs > STAGE_WAKE_GAP_MS) state.activeMs = now;
    if (effects.pulse) state.ambientS += dt;
    const count = screens.length;

    // A finger moves the panes directly; on release they spring to where the
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

    // The panes hang from the tilted camera; a dive then flies it to the front one.
    const rest = stageCamera({ lookX: state.look[0], lookY: state.look[1] });
    const anchor = stagePaneAnchor(rest, aspect);
    const view = stageDiveCamera(rest, anchor, state.dive.value);
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateMatrixWorld();

    const panes: StagePaneFrame[] = [];
    for (const index of stageDrawnScreens(selected, count)) {
      const look = screens[index];
      const offset = index - state.flow.value;
      if (!look || Math.abs(offset) >= STAGE_PANE_REACH) continue;
      const pane = stagePane(offset, anchor, aspect);
      panes.push({
        position: pane.position,
        width: pane.width,
        yaw: pane.yaw,
        side: pane.side,
        offset,
        look,
      });
    }

    // A completion flares the motes; Reduce Motion keeps them still.
    state.burst = effects.pulse ? Math.max(0, state.burst - dt * 0.6) : 0;
    world.update({
      camera,
      panes,
      timeS: effects.pulse ? state.ambientS : 0,
      tilt: state.look[0],
      burst: effects.particles && effects.pulse ? state.burst : 0,
      motes: effects.particles,
      shimmer: effects.shimmer,
      pulse: effects.pulse,
    });

    const moving =
      !stageSpringAtRest(state.flow, flowGoal) ||
      !stageSpringAtRest(state.dive, dive ? 1 : 0) ||
      dragging ||
      looking ||
      state.burst > 0;
    if (!reducedMotion) {
      const was = state.degrade.quality;
      state.degrade = recordStageFrame(state.degrade, {
        nowMs: now,
        frameMs: elapsedMs,
        continuous,
      });
      if (state.degrade.quality !== was) qualityDropped(state.degrade.quality);
    }
    state.wasMoving = moving;
    if (moving) state.activeMs = now;

    stopTimer();
    if (paused) return;
    if (moving) {
      if (effects.frameIntervalMs > 0)
        state.timer = setTimeout(invalidate, Math.max(0, effects.frameIntervalMs - elapsedMs));
      else invalidate();
    } else {
      const idle = stageIdleInterval(effects, now - state.activeMs);
      if (idle !== null) state.timer = setTimeout(invalidate, idle);
    }
  });

  // oxlint-disable-next-line react/no-unknown-property -- Fiber's intrinsic `primitive` takes `object`.
  return <primitive object={world.root} />;
}
