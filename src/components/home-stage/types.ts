import type { SharedValue } from 'react-native-reanimated';
import type { Texture } from 'three/webgpu';

import type { StageAmbientColors } from '@/lib/home-stage-ambient';
import type { StageHeroLayer, StageRole } from '@/lib/home-stage-layers';
import type { StageQuality } from '@/lib/home-stage-motion';
import type { ThemeEffects } from '@/theme/schema';
import type { StagePicture, StageSceneColors, StageScreenLook } from './stage-scene';

/** Drag and tilt, written on the UI thread and read by the scene each frame. */
export type StageInputs = {
  /** Horizontal drag as a fraction of the stage width; 0 at rest. */
  dragX: SharedValue<number>;
  /** Vertical drag as a fraction of the stage height; 0 at rest. */
  dragY: SharedValue<number>;
  /** 1 while a finger is on the stage. */
  dragging: SharedValue<number>;
  /** Where a released drag settles until the selection catches up; -1 otherwise. */
  settle: SharedValue<number>;
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
  /** One per computer, in pager order. */
  screens: readonly StageScreenLook[];
  /** The selected computer; the cover-flow brings it forward whenever it changes. */
  selected: number;
  colors: StageSceneColors;
  mode: 'light' | 'dark';
  /** How the theme is presented; see `stageComposition`. */
  role: StageRole;
  /** The safe area's top inset, in points: the HUD, and the art tucked under it, start below it. */
  inset: number;
  /** The deepest layer: a full-scene wallpaper. */
  backdrop: StagePicture | null;
  /** The sky role's painting, a band across the top. */
  painting: StagePicture | null;
  /** The figure or the inset picture. */
  hero: StagePicture<StageHeroLayer> | null;
  /** An edge-only wallpaper as the nearest layer. */
  frame: StagePicture | null;
  faces: Texture | null;
  /**
   * The theme's ambient effect for the current light or dark variant, as the
   * 2D layer resolves it; null when it has none or theme effects are off.
   */
  ambientEffects: ThemeEffects | null;
  ambientColors: StageAmbientColors;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Fly the camera to the selected pane (before opening it), or back. */
  dive: boolean;
  /** Bumped when a task completes: the motes flare. */
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
