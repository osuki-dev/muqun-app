import type { SharedValue } from 'react-native-reanimated';

import type { StageAmbientColors } from '@/lib/home-stage-ambient';
import type { StageCore, StageVec3 } from '@/lib/home-stage-geometry';
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

/**
 * The front core as the scene last drew it: the camera's look, the core and
 * where its orbs were. A touch is resolved against it, so it lands on the
 * orb the reader saw, wherever its orbit had taken it.
 */
export type StageProbe = {
  look: readonly [number, number];
  core: StageCore;
  orbs: readonly { key: string; point: StageVec3 }[];
};

/**
 * Between the stage's 2D layer and its scene: gestures wake a scene that is
 * idle (no frames scheduled), and a touch asks where the front orbs are.
 */
export type StageBridge = {
  wake: () => void;
  setWaker: (waker: (() => void) | null) => void;
  probe: () => StageProbe | null;
  setProber: (prober: (() => StageProbe | null) | null) => void;
};

export function createStageBridge(): StageBridge {
  let waker: (() => void) | null = null;
  let prober: (() => StageProbe | null) | null = null;
  return {
    wake: () => waker?.(),
    setWaker: (next) => {
      waker = next;
    },
    probe: () => prober?.() ?? null,
    setProber: (next) => {
      prober = next;
    },
  };
}

export type StageSceneProps = {
  /** One per computer, in pager order. */
  screens: readonly StageScreenLook[];
  /** The selected computer; the cover-flow brings it forward whenever it changes. */
  selected: number;
  /** An orb's chip is showing: the orbits hold still, so the orb stays under its chip. */
  held: boolean;
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
  /**
   * The theme's ambient effect for the current light or dark variant, as the
   * 2D layer resolves it; null when it has none or theme effects are off.
   */
  ambientEffects: ThemeEffects | null;
  ambientColors: StageAmbientColors;
  quality: StageQuality;
  reducedMotion: boolean;
  /** Fly the camera into the selected core (before opening it), or back. */
  dive: boolean;
  /** Bumped when a task completes: the motes and the front core flare. */
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
