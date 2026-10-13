import type { HotUpdaterInstance } from '@hot-updater/react-native';
import Constants from 'expo-constants';
import { getActiveLocale } from '../i18n/active-locale';
import { fetchOtaReleaseNotes } from './ota-release-notes';
import { Platform, TurboModuleRegistry } from 'react-native';
import { create } from 'zustand';

import {
  createAppUpdateController,
  runningAppReleaseId,
  type UpdateClient,
  type UpdateSnapshot,
} from './app-update-controller';

export const useAppUpdateStore = create<UpdateSnapshot>(() => ({ phase: 'idle', progress: 0 }));

function createClient(): UpdateClient | null {
  const settings = Constants.expoConfig?.extra?.hotUpdater;
  if (__DEV__ || Platform.OS === 'web' || settings?.enabled !== true) return null;
  if (typeof settings.clientApiKey !== 'string' || !settings.clientApiKey) return null;
  try {
    if (!TurboModuleRegistry.get('HotUpdater')) return null;
    // Keep web, Expo Go and binaries predating this native module launchable.
    const { HotUpdater } =
      // oxlint-disable-next-line typescript/no-require-imports -- the SDK enforces its native module at import time
      require('@hot-updater/react-native') as typeof import('@hot-updater/react-native');
    const instance: HotUpdaterInstance = HotUpdater.init({
      baseURL: 'https://updates.muqun.dev',
      requestHeaders: { 'x-api-key': settings.clientApiKey },
      requestTimeout: 5000,
      onError: () => {
        /* Checks report failure through the controller; never block launch. */
      },
    });
    return {
      checkForUpdate: instance.checkForUpdate,
      getReleaseNotes: (releaseId) =>
        fetchOtaReleaseNotes(releaseId, getActiveLocale(), settings.clientApiKey),
      addListener: instance.addListener,
      reload: instance.reload,
      getRunningReleaseId: async () =>
        runningAppReleaseId(
          await instance.getActiveUpdateState(),
          instance.getManifest().bundleId,
          instance.getChannel()
        ),
    };
  } catch {
    return null;
  }
}

const client = createClient();
const controller = createAppUpdateController(client, (snapshot) =>
  useAppUpdateStore.setState(snapshot, true)
);
export const checkForAppUpdate = controller.check;
export const checkForAppUpdateOnLaunch = controller.checkOnLaunch;

export const updateAppNow = controller.updateNow;
export const deferAppUpdate = controller.defer;
