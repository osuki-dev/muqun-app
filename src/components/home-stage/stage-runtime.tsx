import { PixelRatio } from 'react-native';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { WebGPURenderer } from 'three/webgpu';

import { useStableHandler } from '@/hooks/use-render-refs';
import {
  stageCamera,
  stageDrawnScreens,
  stageRingRest,
  stageRingTarget,
  stageScreenPosition,
  STAGE_FRONT_SCALE,
  STAGE_SIDE_SCALE,
  wrapStageIndex,
} from '@/lib/home-stage-geometry';
import {
  initialStageDegrade,
  recordStageFrame,
  stageEffects,
  stageSpringAtRest,
  stepStageSpring,
  STAGE_CARD_SPRING,
  type StageDegradeState,
  type StageSpring,
} from '@/lib/home-stage-motion';
import { createStageScene, type StageScreenFrame } from './stage-scene';
import type { StageSceneProps } from './types';

type Motion = {
  selected: number;
  ringTarget: number;
  ring: StageSpring;
  dive: StageSpring;
  look: [number, number];
  scales: Map<number, number>;
  beam: number;
  burst: number;
  rise: number;
  burstRise: number;
  lastFrameMs: number;
  wasMoving: boolean;
  degrade: StageDegradeState;
  timer: ReturnType<typeof setTimeout> | null;
  startMs: number;
};

/** How far a horizontal drag turns the ring, as a share of one step, before release. */
const DRAG_TURN = 0.6;
const DIVE_SPRING = { stiffness: 90, damping: 17 };

/**
 * Lives inside the Fiber root. Owns the scene objects and the frame clock:
 * frames are drawn while something moves (the ring, a drag, the camera, a
 * dive, a burst), at the 20 fps idle rate for the breathing effects (grid
 * wave, sparks, pulse, beam head) otherwise, and not at all while Home is
 * paused or, under Reduce Motion, at rest.
 */
export function StageRuntime(props: StageSceneProps) {
  const invalidate = useThree((state) => state.invalidate);
  const setFrameloop = useThree((state) => state.setFrameloop);
  const setDpr = useThree((state) => state.setDpr);
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
    ambient,
    mode,
    backdrop,
    character,
    faces,
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
    const count = Math.max(1, screens.length);
    const rest = stageRingRest(selected, count);
    motion.current = {
      selected,
      ringTarget: rest,
      ring: { value: rest, velocity: 0 },
      dive: { value: 0, velocity: 0 },
      look: [0, 0],
      scales: new Map(),
      beam: 1,
      burst: 0,
      rise: 0,
      burstRise: 0,
      lastFrameMs: 0,
      wasMoving: false,
      degrade: initialStageDegrade(quality),
      timer: null,
      startMs: performance.now(),
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
    if (!paused)
      setDpr(
        Math.min(PixelRatio.get(), quality === 'full' ? 1.5 : quality === 'capped' ? 1 : 1.25)
      );
  }, [paused, quality, setDpr]);
  useEffect(() => {
    setFrameloop(paused ? 'never' : 'demand');
  }, [paused, setFrameloop]);
  useEffect(() => {
    bridge.setWaker(() => {
      if (!paused) invalidate();
    });
    return () => bridge.setWaker(null);
  }, [bridge, invalidate, paused]);
  useEffect(() => {
    if (paused) return;
    world.setTheme({ colors, mode }, scene, gl as unknown as WebGPURenderer);
    invalidate();
  }, [world, colors, mode, scene, gl, invalidate, paused]);
  useEffect(() => {
    if (paused) return;
    world.setBackdrop(backdrop);
    invalidate();
  }, [world, backdrop, invalidate, paused]);
  useEffect(() => {
    if (paused) return;
    world.setCharacter(character);
    invalidate();
  }, [world, character, invalidate, paused]);
  useEffect(() => {
    if (paused) return;
    world.setFaces(faces);
    invalidate();
  }, [world, faces, invalidate, paused]);
  useEffect(() => {
    if (paused) return;
    world.setAmbient(ambient, colors, reducedMotion, quality === 'full');
    invalidate();
  }, [world, ambient, colors, reducedMotion, quality, paused, invalidate]);
  // Only a new quality resets the ladder.
  const resetLadder = useEffectEvent((next: StageSceneProps['quality']) => {
    motionState().degrade = initialStageDegrade(next);
  });
  useEffect(() => resetLadder(quality), [quality]);
  // A selection change turns the ring the short way round.
  const turnTo = useEffectEvent((next: number) => {
    const state = motionState();
    if (state.selected === next) return;
    state.ringTarget = stageRingTarget(state.ringTarget, state.selected, next, screens.length);
    state.selected = next;
    state.beam = 1;
    invalidate();
  });
  useEffect(() => turnTo(selected), [selected]);
  const bursted = useEffectEvent(() => {
    motionState().burst = 1;
    invalidate();
  });
  useEffect(() => {
    if (burst > 0) bursted();
  }, [burst]);
  // Pausing only stops or restarts the clock; a dive change only needs a frame.
  const wakeFor = useEffectEvent((isPaused: boolean) => {
    if (isPaused) {
      stopTimer();
      if (motion.current) {
        motion.current.lastFrameMs = 0;
        motion.current.wasMoving = false;
      }
    } else invalidate();
  });
  useEffect(() => wakeFor(paused), [paused]);
  useEffect(() => wakeFor(paused), [dive, paused]);

  const qualityDropped = useStableHandler((next: StageDegradeState['quality']) =>
    props.onQualityDrop(next)
  );

  useFrame(() => {
    if (paused) return;
    const state = motionState();
    const now = performance.now();
    const elapsedMs = state.lastFrameMs ? now - state.lastFrameMs : 1000 / 60;
    const continuous = state.wasMoving && elapsedMs < 120;
    state.lastFrameMs = now;
    const dt = Math.min(0.05, elapsedMs / 1000);
    const effects = stageEffects(quality, { gpuAvailable: true, reducedMotion });
    const count = screens.length;

    const dragging = inputs.dragging.get() === 1;
    const dragX = inputs.dragX.get();
    const step = count > 1 ? (Math.PI * 2) / count : 0;
    const ringGoal = state.ringTarget + (dragging ? dragX * step * DRAG_TURN : 0);
    state.ring = stepStageSpring(state.ring, ringGoal, dt, STAGE_CARD_SPRING);
    state.dive = stepStageSpring(state.dive, dive ? 1 : 0, dt, DIVE_SPRING);

    // Tilt (when on) and a vertical drag both look around; the drag springs back.
    const lookGoal: [number, number] = [
      effects.tilt ? inputs.tiltY.get() : 0,
      (effects.tilt ? inputs.tiltX.get() : 0) +
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

    const chosen = count > 0 ? wrapStageIndex(state.selected, count) : -1;
    const chosenAt = chosen >= 0 ? stageScreenPosition(chosen, count, state.ring.value) : null;
    const view = stageCamera({
      lookX: state.look[0],
      lookY: state.look[1],
      dive: state.dive.value,
      diveTo: chosenAt ?? undefined,
      aspect,
    });
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    camera.lookAt(view.target[0], view.target[1], view.target[2]);
    camera.updateMatrixWorld();

    let scaling = false;
    const frames: StageScreenFrame[] = [];
    for (const index of stageDrawnScreens(chosen, count)) {
      const look = screens[index];
      if (!look) continue;
      const position = stageScreenPosition(index, count, state.ring.value);
      const front = index === chosen;
      const goal = front ? STAGE_FRONT_SCALE : STAGE_SIDE_SCALE;
      const current = state.scales.get(index) ?? goal;
      const eased = current + (goal - current) * Math.min(1, dt * 6);
      const settled = Math.abs(eased - goal) <= 0.002;
      if (!settled) scaling = true;
      state.scales.set(index, settled ? goal : eased);
      frames.push({
        position,
        scale: settled ? goal : eased,
        front,
        look,
        depth: Math.hypot(
          position[0] - view.position[0],
          position[1] - view.position[1],
          position[2] - view.position[2]
        ),
      });
    }

    const beamBefore = state.beam;
    state.beam = Math.max(0.25, state.beam - dt * 0.6);
    const sparks =
      effects.particles &&
      ambient?.ambient !== undefined &&
      ambient.ambient !== 'none' &&
      state.burst > 0;
    state.burst = Math.max(0, state.burst - dt * 0.45);
    if (!reducedMotion) state.rise += dt;
    if (sparks) state.burstRise += state.burst * 4 * dt;
    world.update({
      camera,
      screens: frames,
      beamTo: chosenAt,
      beam: state.beam,
      timeS: effects.pulse ? state.rise : 0,
      burst: sparks ? state.burst : 0,
      rise: state.rise,
      burstRise: state.burstRise,
      sparks,
      pulse: effects.pulse,
    });

    const moving =
      !stageSpringAtRest(state.ring, ringGoal) ||
      !stageSpringAtRest(state.dive, dive ? 1 : 0) ||
      dragging ||
      looking ||
      scaling ||
      state.burst > 0 ||
      beamBefore > 0.25;
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

    stopTimer();
    if (paused) return;
    if (moving) {
      if (effects.frameIntervalMs > 0)
        state.timer = setTimeout(
          invalidate,
          Math.max(0, effects.frameIntervalMs - (performance.now() - now))
        );
      else invalidate();
    } else if (
      effects.idleIntervalMs !== null &&
      (world.ambientAnimated() || screens.some((screen) => screen.working))
    ) {
      state.timer = setTimeout(invalidate, effects.idleIntervalMs);
    }
  });

  // oxlint-disable-next-line react/no-unknown-property -- Fiber's intrinsic `primitive` takes `object`.
  return <primitive object={world.root} />;
}
