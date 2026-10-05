import { Platform } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { create } from 'zustand';

type LaunchHandoffState = {
  /** The cover has started leaving; Home should be on screen. */
  revealing: boolean;
  /**
   * The launch snap's own progress (0..1), when the exit is the snap.
   *
   * Home's entrance follows it instead of running a clock of its own, so the
   * picture breaking apart and Home arriving through the gaps start on the
   * same frame and end together. Null under the cross-fade, where Home keeps
   * its own timing.
   */
  driver: SharedValue<number> | null;
  /** Home has rendered with `revealing` and a driver, and waits for it. */
  ready: boolean;
  /**
   * The cover is gone: the snap's last frame, or the end of the cross-fade.
   * Home's ambient effects wait for this, so they come in over a finished
   * page instead of competing with the sweep for the frame. True from the
   * start on the web, which has no launch cover.
   */
  settled: boolean;
  setRevealDriver: (driver: SharedValue<number> | null) => void;
  beginReveal: () => void;
  markReady: () => void;
  settle: () => void;
};

/** One-way signal from the launch cover to the Home content underneath it. */
export const useLaunchHandoff = create<LaunchHandoffState>((set) => ({
  revealing: false,
  driver: null,
  ready: false,
  settled: Platform.OS === 'web',
  setRevealDriver: (driver) => set({ driver }),
  beginReveal: () => set({ revealing: true }),
  markReady: () => set({ ready: true }),
  settle: () => set({ revealing: true, settled: true }),
}));
