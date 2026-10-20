import type { SharedValue } from 'react-native-reanimated';

import type { StageQuality } from '@/lib/home-stage-motion';
import type { StagePanelLook, StageSceneColors, StageTextureSource } from './stage-scene';

/** Drag and tilt, written on the UI thread and read by the scene each frame. */
export type StageInputs = {
  /** Horizontal drag as a fraction of the stage width; 0 at rest. */
  dragX: SharedValue<number>;
  /** Vertical drag as a fraction of the stage height; 0 at rest. */
  dragY: SharedValue<number>;
  /** 1 while a finger is on the stage. */
  dragging: SharedValue<number>;
  /** Smoothed device tilt, -1..1 per axis ([pitch, roll]); 0 when off. */
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
  looks: readonly StagePanelLook[];
  /** Selected card index; the scene plays a card move whenever it changes. */
  selected: number;
  colors: StageSceneColors;
  mode: 'light' | 'dark';
  surfaceOpacity: number;
  backdrop: StageTextureSource | null;
  character: StageTextureSource | null;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Home is off screen, under a sheet's route or the app is in the background. */
  paused: boolean;
  inputs: StageInputs;
  bridge: StageBridge;
  /** Frame times say the device cannot hold the stage at this quality. */
  onQualityDrop: (next: StageQuality) => void;
  /** WebGPU failed to start, or the device was lost: draw the static stage. */
  onError: () => void;
};
