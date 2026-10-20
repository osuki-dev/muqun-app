import type { ThemeEffects } from '@/theme/schema';
import type { SharedValue } from 'react-native-reanimated';

import type { StageQuality } from '@/lib/home-stage-motion';
import type { StageSceneColors, StageScreenLook, StageTextureSource } from './stage-scene';

/** Drag and tilt, written on the UI thread and read by the scene each frame. */
export type StageInputs = {
  /** Horizontal drag as a fraction of the stage width; 0 at rest. */
  dragX: SharedValue<number>;
  /** Vertical drag as a fraction of the stage height; 0 at rest. */
  dragY: SharedValue<number>;
  /** 1 while a finger is on the stage. */
  dragging: SharedValue<number>;
  /** Smoothed device tilt, -1..1 per axis; 0 when off. */
  tiltX: SharedValue<number>;
  tiltY: SharedValue<number>;
};

/** Lets the stage's gestures wake a scene that is idle (no frames scheduled). */
export type StageBridge = {
  wake: () => void;
  setWaker: (waker: (() => void) | null) => void;
};

export function createStageBridge(): StageBridge {
  let waker: (() => void) | null = null;
  return {
    wake: () => waker?.(),
    setWaker: (next) => {
      waker = next;
    },
  };
}

export type StageSceneProps = {
  /** One per computer, in ring order. */
  screens: readonly StageScreenLook[];
  /** The selected computer; the ring turns whenever it changes. */
  selected: number;
  colors: StageSceneColors;
  ambient?: ThemeEffects;
  mode: 'light' | 'dark';
  backdrop: StageTextureSource | null;
  character: StageTextureSource | null;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Fly the camera to the selected screen (before opening it), or back. */
  expanded: boolean;
  /** Bumped when a task completes: the sparks burst. */
  burst: number;
  /** Home is off screen or the app is in the background: no frames. */
  paused: boolean;
  inputs: StageInputs;
  bridge: StageBridge;
  /** Frame times say the device cannot hold the stage at this quality. */
  onQualityDrop: (next: StageQuality) => void;
  /** WebGPU failed to start, or the device was lost: draw the static stage. */
  onError: () => void;
};
