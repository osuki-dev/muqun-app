import type { SharedValue } from 'react-native-reanimated';
import type { StateCreator } from 'zustand';

export type LaunchHandoffState = {
  /** The launch cover has started leaving; Home may arrive underneath it. */
  revealing: boolean;
  /** The snap's 0..1 clock; null when Home owns its cross-fade. */
  driver: SharedValue<number> | null;
  /** Home has mounted beneath the snap and acknowledged its driver. */
  ready: boolean;
  /** The cover is gone. Initially true on web, which has no launch overlay. */
  settled: boolean;
  setRevealDriver: (driver: SharedValue<number> | null) => void;
  beginReveal: () => void;
  markReady: () => void;
  settle: () => void;
};

/** Once the cover is gone, its unfinished animation must no longer hide Home. */
export function createLaunchHandoffState(settled: boolean): StateCreator<LaunchHandoffState> {
  return (set) => ({
    revealing: settled,
    driver: null,
    ready: false,
    settled,
    setRevealDriver: (driver) => set((state) => (state.settled ? state : { driver })),
    beginReveal: () => set({ revealing: true }),
    markReady: () => set({ ready: true }),
    // SplashOverlay can finish through its safety timeout without the snap
    // reaching 1. Release that clock as well as notifying ambient effects.
    settle: () => set({ revealing: true, settled: true, driver: null }),
  });
}

/** A settled cover is visible even if the last snap frame never arrived. */
export function launchEntryProgress(progress: number, settled: boolean): number {
  'worklet';
  if (settled) return 1;
  if (progress < 0) return -1;
  const t = Math.min(1, Math.max(0, progress));
  return 1 - (1 - t) * (1 - t);
}
