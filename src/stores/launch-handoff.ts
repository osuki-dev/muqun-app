import { Platform } from 'react-native';
import { create } from 'zustand';
import { createLaunchHandoffState } from '@/lib/launch-handoff';

/** One-way signal from the launch cover to the Home content underneath it. */
export const useLaunchHandoff = create(createLaunchHandoffState(Platform.OS === 'web'));
