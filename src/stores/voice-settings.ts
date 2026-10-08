import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import { APP_LOCALES, type AppLocale } from '@/i18n/locale';

export type VoiceServiceConfig = {
  url: string;
  apiKey: string;
  model: string;
  language: AppLocale | 'auto' | null;
  autoInsert: boolean;
};
const STORAGE_KEY = 'muqun-voice-service';
let loading: Promise<void> | undefined;

export function normalizeVoiceConfig(
  url: string,
  apiKey: string,
  model: string,
  language: unknown = null,
  autoInsert: unknown = true
): VoiceServiceConfig | null {
  try {
    const parsed = new URL(url.trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const key = apiKey.trim();
    if (/[\r\n]/.test(apiKey) || /[\r\n]/.test(model)) return null;
    return {
      url: parsed.toString().replace(/\/+$/, ''),
      apiKey: key,
      model: model.trim(),
      language:
        language === 'auto' ? 'auto' : (APP_LOCALES.find((locale) => locale === language) ?? null),
      autoInsert: autoInsert !== false,
    };
  } catch {
    return null;
  }
}

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
      const config =
        value &&
        typeof value === 'object' &&
        'url' in value &&
        'apiKey' in value &&
        typeof value.url === 'string' &&
        typeof value.apiKey === 'string' &&
        'model' in value &&
        typeof value.model === 'string'
          ? normalizeVoiceConfig(
              value.url,
              value.apiKey,
              value.model,
              'language' in value ? value.language : null,
              'autoInsert' in value ? value.autoInsert : true
            )
          : null;
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
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(config), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }
  useVoiceSettings.setState({ config, ready: true, loadError: false });
}
