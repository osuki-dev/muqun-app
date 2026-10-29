import type { SharedValue } from 'react-native-reanimated';

import type { StageAmbientColors } from '@/lib/home-stage-ambient';
import type { StageHeroLayer, StageRole } from '@/lib/home-stage-layers';
import type { StageQuality } from '@/lib/home-stage-motion';
import type { ThemeEffects } from '@/theme/schema';
import type { StagePicture, StageSceneColors } from './stage-scene';

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

/** Between the stage's 2D layer and its scene: gestures wake a scene that is idle (no frames scheduled). */
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

/**
 * Between the HUD and the stage: whatever opens a computer or an agent runs
 * it through the stage, which pushes the camera into the art first when it
 * can. Without a stage it runs straight away.
 */
export type StageOpener = {
  open: (run: () => void) => void;
  setOpener: (opener: ((run: () => void) => void) | null) => void;
};

export function createStageOpener(): StageOpener {
  let opener: ((run: () => void) => void) | null = null;
  return {
    open: (run) => (opener ? opener(run) : run()),
    setOpener: (next) => {
      opener = next;
    },
  };
}

export type StageSceneProps = {
  /** Chosen composition and texture conversions are ready for scene compilation. */
  resourcesReady?: boolean;
  /** How many computers there are, and the selected one: the camera pans between them. */
  count: number;
  selected: number;
  colors: StageSceneColors;
  mode: 'light' | 'dark';
  /** How the theme is presented; see `stageComposition`. */
  role: StageRole;
  /** The safe area's top inset, in points: the HUD, and the art tucked under it, start below it. */
  inset: number;
  leftInset?: number;
  rightInset?: number;
  /** Where the HUD's foot rows start, in points from the top: the art stands on it. */
  floor: number;
  /** The deepest layer: a full-scene wallpaper. */
  backdrop: StagePicture | null;
  /** The sky role's painting, a band across the top. */
  painting: StagePicture | null;
  /** The figure or the inset picture. */
  hero: StagePicture<StageHeroLayer> | null;
  /** An edge-only wallpaper as the nearest layer. */
  frame: StagePicture | null;
  /**
   * The theme's ambient effect for the current light or dark variant, as the
   * 2D layer resolves it; null when it has none or theme effects are off.
   */
  ambientEffects: ThemeEffects | null;
  ambientColors: StageAmbientColors;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Push the camera into the art (before a computer or an agent opens), or back. */
  dive: boolean;
  /** Bumped when a task completes: the motes flare. */
  burst: number;
  /** Home is off screen or the app is in the background: no frames. */
  paused: boolean;
  inputs: StageInputs;
  bridge: StageBridge;
  /** Frame times say the device cannot hold the stage at this quality. */
  onQualityDrop: (next: StageQuality) => void;
  /** Frame times say this quality has met the budget long enough to keep (`StageFrameBudget.held`). */
  onQualityHeld?: (quality: StageQuality) => void;
  /** A native canvas is mounted or resized and needs its own first frame. */
  onSurfaceReset?: () => void;
  /** A complete scene has been submitted to the native surface. */
  onPresented?: () => void;
  /** WebGPU failed to start or to draw, or the device was lost: draw the static stage. */
  onError: (error?: unknown) => void;
};
