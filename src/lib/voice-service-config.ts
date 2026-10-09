import { APP_LOCALES, type AppLocale } from '@/i18n/locale';

export type VoiceMode = 'file' | 'realtime';
export type VoiceServiceConfig = {
  mode?: VoiceMode;
  url: string;
  apiKey: string;
  model: string;
  language: AppLocale | 'auto' | null;
  autoInsert: boolean;
};

export function normalizeVoiceConfig(
  url: string,
  apiKey: string,
  model: string,
  language: unknown = null,
  autoInsert: unknown = true,
  mode: unknown = 'file'
): VoiceServiceConfig | null {
  try {
    const parsed = new URL(url.trim());
    if (mode !== 'file' && mode !== 'realtime') return null;
    if (
      parsed.protocol !== (mode === 'realtime' ? 'wss:' : 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      return null;
    const key = apiKey.trim();
    if (/[\r\n]/.test(apiKey) || /[\r\n]/.test(model)) return null;
    return {
      mode,
      url: url.trim(),
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

export function parseVoiceConfig(value: unknown): VoiceServiceConfig | null {
  return value &&
    typeof value === 'object' &&
    'url' in value &&
    'apiKey' in value &&
    typeof value.url === 'string' &&
    typeof value.apiKey === 'string' &&
    'model' in value &&
    typeof value.model === 'string'
    ? normalizeVoiceConfig(
        // Older configurations stored a base URL; new ones store the exact endpoint.
        'version' in value && (value.version === 2 || value.version === 3)
          ? value.url
          : `${value.url.replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '')}/audio/transcriptions`,
        value.apiKey,
        value.model,
        'language' in value ? value.language : null,
        'autoInsert' in value ? value.autoInsert : true,
        'mode' in value ? value.mode : 'file'
      )
    : null;
}
