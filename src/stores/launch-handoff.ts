import { create } from 'zustand';

type LaunchHandoffState = {
  revealing: boolean;
  beginReveal: () => void;
};

/** One-way signal from the launch cover to the Home content underneath it. */
export const useLaunchHandoff = create<LaunchHandoffState>((set) => ({
  revealing: false,
  beginReveal: () => set({ revealing: true }),
}));
