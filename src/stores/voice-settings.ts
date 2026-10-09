import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { parseVoiceConfig, type VoiceServiceConfig } from '@/lib/voice-service-config';
export { normalizeVoiceConfig } from '@/lib/voice-service-config';
export type { VoiceMode, VoiceServiceConfig } from '@/lib/voice-service-config';

const STORAGE_KEY = 'muqun-voice-service';
let loading: Promise<void> | undefined;

export const useVoiceSettings = create<{
  config: VoiceServiceConfig | null;
  ready: boolean;
  loadError: boolean;
}>(() => ({ config: null, ready: false, loadError: false }));

export function loadVoiceSettings() {
  loading ??= (async () => {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      const value: unknown = raw ? JSON.parse(raw) : null;
      const config = parseVoiceConfig(value);
      useVoiceSettings.setState({ config, ready: true, loadError: false });
    } catch {
      useVoiceSettings.setState({ ready: true, loadError: true });
    }
  })();
  return loading;
}

export async function saveVoiceSettings(config: VoiceServiceConfig | null) {
  await loadVoiceSettings();
  if (config) {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ ...config, version: 3 }), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }
  useVoiceSettings.setState({ config, ready: true, loadError: false });
}
