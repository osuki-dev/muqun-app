import type { HotUpdaterInstance } from '@hot-updater/react-native';
import Constants from 'expo-constants';
import { Platform, TurboModuleRegistry } from 'react-native';
import { create } from 'zustand';

import { createAppUpdateController, type UpdateSnapshot } from './app-update-controller';

export const useAppUpdateStore = create<UpdateSnapshot>(() => ({ phase: 'idle', progress: 0 }));

function createClient(): HotUpdaterInstance | null {
  const settings = Constants.expoConfig?.extra?.hotUpdater;
  if (__DEV__ || Platform.OS === 'web' || settings?.enabled !== true) return null;
  if (typeof settings.clientApiKey !== 'string' || !settings.clientApiKey) return null;
  if (!TurboModuleRegistry.get('HotUpdater')) return null;
  try {
    // Keep web, Expo Go and binaries predating this native module launchable.
    const { HotUpdater } =
      // oxlint-disable-next-line typescript/no-require-imports -- the SDK enforces its native module at import time
      require('@hot-updater/react-native') as typeof import('@hot-updater/react-native');
    return HotUpdater.init({
      baseURL: 'https://updates.muqun.dev',
      requestHeaders: { 'x-api-key': settings.clientApiKey },
      requestTimeout: 5000,
      onError: () => {
        /* Checks report failure through the controller; never block launch. */
      },
    });
  } catch {
    return null;
  }
}

const client = createClient();
// Capture at launch: the SDK's selected ID can change when a later download is staged.
function hasDownloadedLaunch() {
  try {
    return client !== null && client.getBundleId() !== client.getMinBundleId();
  } catch {
    return false;
  }
}
export const isOtaLaunch = hasDownloadedLaunch();
const controller = createAppUpdateController(client, (snapshot) =>
  useAppUpdateStore.setState(snapshot)
);
export const checkForAppUpdate = controller.check;
