import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

import { HOME_RECENTS_STORAGE_KEY } from '@/lib/home-recents';
import { createHomeRecentsState, type HomeRecentsState } from '@/lib/home-recents-state';

/** React-facing adapter for the Home recent-target index. */
export const useHomeRecentsStore = create<HomeRecentsState>(
  createHomeRecentsState({
    load: () => SecureStore.getItemAsync(HOME_RECENTS_STORAGE_KEY),
    save: (serialized) =>
      SecureStore.setItemAsync(HOME_RECENTS_STORAGE_KEY, serialized, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
  })
);

export type { HomeRecentsState } from '@/lib/home-recents-state';
