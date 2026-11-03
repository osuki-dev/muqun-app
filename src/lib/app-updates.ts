import type { HotUpdaterInstance } from '@hot-updater/react-native';
import Constants from 'expo-constants';
import { getActiveLocale } from '../i18n/active-locale';
import { createLaunchHealth, type LaunchHealthStore } from './launch-health';
import { fetchOtaReleaseNotes } from './ota-release-notes';
import { fetchOtaDownloadSize } from './ota-download-size';
import { createOtaUpdateMetadata } from './ota-update-metadata';
import { drawUpdateCurtain } from './update-curtain';
import { Platform, TurboModuleRegistry } from 'react-native';
import { createMMKV } from 'react-native-mmkv';
import { create } from 'zustand';

import {
  createAppUpdateController,
  runningAppReleaseId,
  type UpdateClient,
  type UpdateSnapshot,
} from './app-update-controller';

export const useAppUpdateStore = create<UpdateSnapshot>(() => ({ phase: 'idle', progress: 0 }));

const settings = Constants.expoConfig?.extra?.hotUpdater;
const clientApiKey: string | undefined =
  typeof settings?.clientApiKey === 'string' && settings.clientApiKey
    ? settings.clientApiKey
    : undefined;
const metadata = createOtaUpdateMetadata();

/**
 * The SDK instance, wherever its native module is in the binary: it reads the
 * launch native prepared and can drop a bundle that cannot launch, which a
 * development build must do as a store build does. Web, Expo Go and binaries
 * predating the module get none and stay launchable. Checking for updates is
 * `createClient`'s, and stays off in development and when OTA is disabled.
 */
function createInstance(): HotUpdaterInstance | null {
  if (Platform.OS === 'web') return null;
  try {
    if (!TurboModuleRegistry.get('HotUpdater')) return null;
    const { HotUpdater } =
      // oxlint-disable-next-line typescript/no-require-imports -- the SDK enforces its native module at import time
      require('@hot-updater/react-native') as typeof import('@hot-updater/react-native');
    return HotUpdater.init({
      baseURL: 'https://updates.muqun.dev',
      ...(clientApiKey ? { requestHeaders: { 'x-api-key': clientApiKey } } : {}),
      requestTimeout: 5000,
      plugins: [metadata.plugin],
      onError: () => {
        /* Checks report failure through the controller; never block launch. */
      },
    });
  } catch {
    return null;
  }
}

const instance = createInstance();

function createClient(): UpdateClient | null {
  if (__DEV__ || settings?.enabled !== true || !clientApiKey || !instance) return null;
  try {
    return {
      checkForUpdate: (options) =>
        metadata.check(
          () => instance.checkForUpdate(options),
          instance.getManifest().bundleId,
          instance.getChannel()
        ),
      getReleaseNotes: (releaseId) =>
        fetchOtaReleaseNotes(releaseId, getActiveLocale(), clientApiKey),
      getDownloadSize: (releaseId) => {
        const target = metadata.getTarget(
          releaseId,
          instance.getManifest().bundleId,
          instance.getChannel()
        );
        return target ? fetchOtaDownloadSize(target, clientApiKey) : Promise.resolve(null);
      },
      addListener: instance.addListener,
      // The dialog's check mark and dissolve play first, within a fixed bound.
      reload: () => drawUpdateCurtain().then(() => instance.reload()),
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

/**
 * The launch record lives in MMKV, opened on first use. An over-the-air update
 * can reach a binary without MMKV, where opening it throws; the record's reads
 * and writes absorb that and the count lives for the process, so a bundle then
 * has to fail twice in one launch, which the boundary's retry still allows.
 */
let launchStore: LaunchHealthStore | undefined;
const openLaunchStore = () => (launchStore ??= createMMKV({ id: 'muqun.launch' }));

const launchHealth = createLaunchHealth({
  updater: instance && {
    // The manifest names the bundle this process runs; `getBundleId` can name a staged one.
    getBundleId: () => instance.getManifest().bundleId,
    getMinBundleId: instance.getMinBundleId,
    notifyAppReady: instance.notifyAppReady,
    resetChannel: instance.resetChannel,
    reload: instance.reload,
  },
  store: {
    getString: (key) => openLaunchStore().getString(key),
    set: (key, value) => openLaunchStore().set(key, value),
  },
  log: (message) => console.log(`[HotUpdater] ${message}`),
});
/** The first route has settled; see `launch-health.ts`. */
export const markLaunchHealthy = launchHealth.markHealthy;
/** `AppErrorBoundary` caught a render error. */
export const reportLaunchRenderFailure = launchHealth.reportRenderFailure;
