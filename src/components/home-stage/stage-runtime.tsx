import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import {
  stageCamera,
  stageMovePose,
  STAGE_DRAG_PITCH,
  STAGE_LOOK_YAW,
  STAGE_TILT_LIMIT,
  wrapStageIndex,
  type StagePanelPose,
} from '@/lib/home-stage-geometry';
import {
  initialStageDegrade,
  recordStageFrame,
  stageBreath,
  stageEffects,
  stageSelectionGlow,
  stageSpringAtRest,
  stepStageSpring,
  STAGE_CAMERA_SPRING,
  STAGE_CARD_SPRING,
  type StageDegradeState,
  type StageSpring,
} from '@/lib/home-stage-motion';
import { useStableHandler } from '@/hooks/use-render-refs';
import { createStageScene } from './stage-scene';
import type { StageSceneProps } from './types';

type Motion = {
  from: number;
  to: number;
  progress: StageSpring;
  /** A drag's pull towards a neighbour, springing back when let go without a move. */
  preview: StageSpring;
  previewTowards: number;
  pitch: StageSpring;
  tilt: [number, number];
  selectedAtMs: number;
  lastFrameMs: number;
  wasMoving: boolean;
  degrade: StageDegradeState;
  timer: ReturnType<typeof setTimeout> | null;
  startMs: number;
};

/** The preview a drag gives before release: the neighbour starts to come forward. */
const PREVIEW_LIMIT = 0.35;
const PLACEHOLDER = [
  { tone: 'unknown', working: false, attention: false, placeholder: true },
] as const;

/**
 * Lives inside the Fiber root. Owns the scene objects and the frame clock:
 * frames are drawn only while something moves (a card move, a drag, the
 * camera settling, tilt), at the idle breathing rate of 20 fps otherwise, and
 * not at all while Home is paused or under Reduce Motion at rest.
 */
export function StageRuntime(props: StageSceneProps) {
  const invalidate = useThree((state) => state.invalidate);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [scene] = useState(createStageScene);
  const motion = useRef<Motion | null>(null);
  const aspect = size.height > 0 ? size.width / size.height : 1;
  const {
    looks,
    selected,
    colors,
    mode,
    surfaceOpacity,
    backdrop,
    character,
    quality,
    reducedMotion,
    paused,
    inputs,
    bridge,
  } = props;

  const motionState = () => {
    const now = performance.now();
    if (motion.current) return motion.current;
    motion.current = {
      from: selected,
      to: selected,
      progress: { value: 1, velocity: 0 },
      preview: { value: 0, velocity: 0 },
      previewTowards: 1,
      pitch: { value: 0, velocity: 0 },
      tilt: [0, 0],
      selectedAtMs: -Infinity,
      lastFrameMs: 0,
      wasMoving: false,
      degrade: initialStageDegrade(quality),
      timer: null,
      startMs: now,
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
    scene.dispose();
  });
  useEffect(() => release, []);
  useEffect(() => {
    bridge.setWaker(() => {
      if (!paused) invalidate();
    });
    return () => bridge.setWaker(null);
  }, [bridge, invalidate, paused]);
  useEffect(() => {
    scene.setTheme({ colors, mode, surfaceOpacity });
    invalidate();
  }, [scene, colors, mode, surfaceOpacity, invalidate]);
  useEffect(() => {
    scene.setBackdrop(backdrop);
    invalidate();
  }, [scene, backdrop, invalidate]);
  useEffect(() => {
    scene.setCharacter(character);
    invalidate();
  }, [scene, character, invalidate]);
  useEffect(() => {
    const view = stageCamera(0, 0, 0, aspect);
    const [x, y, z] = view.position;
    scene.setViewport(aspect, view.fov, Math.hypot(x, y, z));
    invalidate();
  }, [scene, aspect, invalidate]);
  // Only a new quality resets the ladder.
  const resetLadder = useEffectEvent((next: StageSceneProps['quality']) => {
    motionState().degrade = initialStageDegrade(next);
  });
  useEffect(() => resetLadder(quality), [quality]);
  // A selection change starts one card move.
  const startMove = useEffectEvent((next: number) => {
    const state = motionState();
    if (state.to === next) return;
    // A drag already brought this neighbour part-way: the move continues from there.
    const count = Math.max(1, looks.length);
    const continues =
      state.preview.value > 0.001 &&
      stageSpringAtRest(state.progress, 1) &&
      wrapStageIndex(state.to + state.previewTowards, count) === next;
    state.from = state.to;
    state.to = next;
    state.progress = { value: continues ? state.preview.value : 0, velocity: 0 };
    state.preview = { value: 0, velocity: 0 };
    state.selectedAtMs = performance.now();
    invalidate();
  });
  useEffect(() => startMove(selected), [selected]);
  // Pausing only stops or restarts the clock.
  const pauseClock = useEffectEvent((isPaused: boolean) => {
    if (isPaused) stopTimer();
    else invalidate();
  });
  useEffect(() => pauseClock(paused), [paused]);

  // Read from the frame loop, which is neither an Effect nor an Event.
  const qualityDropped = useStableHandler((next: StageDegradeState['quality']) =>
    props.onQualityDrop(next)
  );

  useFrame(() => {
    const state = motionState();
    const now = performance.now();
    const elapsedMs = state.lastFrameMs ? now - state.lastFrameMs : 1000 / 60;
    const continuous = state.wasMoving && elapsedMs < 120;
    state.lastFrameMs = now;
    const dt = elapsedMs / 1000;
    const effects = stageEffects(quality, { gpuAvailable: true, reducedMotion });

    state.progress = stepStageSpring(state.progress, 1, dt, STAGE_CARD_SPRING);
    const dragging = inputs.dragging.get() === 1;
    const dragX = inputs.dragX.get();
    const pitchTarget = dragging
      ? Math.max(-1, Math.min(1, inputs.dragY.get() * 2.4)) * STAGE_DRAG_PITCH
      : 0;
    state.pitch = stepStageSpring(state.pitch, pitchTarget, dt, STAGE_CAMERA_SPRING);
    const tiltTarget: [number, number] = effects.tilt
      ? [inputs.tiltX.get(), inputs.tiltY.get()]
      : [0, 0];
    const tiltBefore = state.tilt;
    state.tilt = [
      tiltBefore[0] + (tiltTarget[0] - tiltBefore[0]) * 0.25,
      tiltBefore[1] + (tiltTarget[1] - tiltBefore[1]) * 0.25,
    ];
    const tiltMoving =
      Math.abs(state.tilt[0] - tiltTarget[0]) + Math.abs(state.tilt[1] - tiltTarget[1]) > 0.004;

    const drawnLooks = looks.length > 0 ? looks : PLACEHOLDER;
    const count = drawnLooks.length;
    const settled = stageSpringAtRest(state.progress, 1);
    if (dragging && count > 1 && settled) {
      if (Math.abs(dragX) > 0.01) state.previewTowards = dragX < 0 ? 1 : -1;
      state.preview = { value: Math.min(PREVIEW_LIMIT, Math.abs(dragX) * 0.9), velocity: 0 };
    } else {
      state.preview = stepStageSpring(state.preview, 0, dt, STAGE_CARD_SPRING);
    }
    const previewing = settled && state.preview.value > 0.001;
    const poses: StagePanelPose[] = [];
    for (let index = 0; index < count; index += 1) {
      poses.push(
        previewing
          ? stageMovePose(
              index,
              state.to,
              wrapStageIndex(state.to + state.previewTowards, count),
              count,
              state.preview.value
            )
          : stageMovePose(index, state.from, state.to, count, state.progress.value)
      );
    }
    const front = poses[wrapStageIndex(state.to, count)];
    // The character's head-plane follows the card coming to the front.
    const lookYaw = STAGE_LOOK_YAW * Math.max(-1, Math.min(1, (front?.position[0] ?? 0) / 1.6));

    const view = stageCamera(
      state.pitch.value,
      state.tilt[0] * STAGE_TILT_LIMIT,
      state.tilt[1] * STAGE_TILT_LIMIT,
      aspect
    );
    camera.position.set(view.position[0], view.position[1], view.position[2]);
    // The field of view is the root's (`STAGE_CAMERA_FOV`); only the pose moves.
    camera.lookAt(view.target[0], view.target[1], view.target[2]);

    const sinceSelect = now - state.selectedAtMs;
    const selectionGlow = reducedMotion ? 1 : stageSelectionGlow(sinceSelect);
    scene.update({
      poses,
      looks: drawnLooks,
      selected: looks.length > 0 ? wrapStageIndex(state.to, count) : -1,
      lookYaw,
      timeS: effects.pulse ? (now - state.startMs) / 1000 : 0,
      breath: effects.pulse ? stageBreath(now) : 1,
      selectionGlow,
      tilt: state.tilt,
      particles: effects.particles,
      shimmer: effects.shimmer,
      pulse: effects.pulse,
    });

    const moving =
      !stageSpringAtRest(state.progress, 1) ||
      !stageSpringAtRest(state.preview, 0) ||
      !stageSpringAtRest(state.pitch, pitchTarget) ||
      dragging ||
      tiltMoving ||
      sinceSelect < 420;
    if (!reducedMotion) {
      const before = state.degrade.quality;
      state.degrade = recordStageFrame(state.degrade, {
        nowMs: now,
        frameMs: elapsedMs,
        continuous,
      });
      if (state.degrade.quality !== before) qualityDropped(state.degrade.quality);
    }
    state.wasMoving = moving;

    stopTimer();
    if (paused) return;
    if (moving) {
      if (effects.frameIntervalMs > 0)
        state.timer = setTimeout(invalidate, Math.max(0, effects.frameIntervalMs - elapsedMs));
      else invalidate();
    } else if (effects.idleIntervalMs !== null) {
      state.timer = setTimeout(invalidate, effects.idleIntervalMs);
    }
  });

  // oxlint-disable-next-line react/no-unknown-property -- Fiber's intrinsic `primitive` takes `object`.
  return <primitive object={scene.root} />;
}
