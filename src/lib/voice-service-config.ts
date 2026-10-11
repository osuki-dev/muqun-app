import { APP_LOCALES, type AppLocale } from '@/i18n/locale';

export type VoiceMode = 'file' | 'realtime';
export type VoiceServiceConfig = {
  mode?: VoiceMode;
  url: string;
  apiKey: string;
  model: string;
  language: AppLocale | 'auto' | null;
};

export const VOICE_DEFAULTS = {
  file: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'gpt-4o-mini-transcribe' },
  realtime: {
    url: 'wss://api.openai.com/v1/realtime?intent=transcription',
    model: 'gpt-live-transcribe',
  },
} as const;

export function isOpenAiVoiceEndpoint(url: string): boolean {
  try {
    return new URL(url.trim()).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

/** Only the official service has requirements we can validate locally. */
export function missingVoiceCredentials(
  config: Pick<VoiceServiceConfig, 'url' | 'apiKey' | 'model'>
): ('apiKey' | 'model')[] {
  if (!isOpenAiVoiceEndpoint(config.url)) return [];
  const missing: ('apiKey' | 'model')[] = [];
  if (!config.apiKey.trim()) missing.push('apiKey');
  if (!config.model.trim()) missing.push('model');
  return missing;
}

/** Follow the built-in preset only; never rewrite a custom endpoint or model. */
export function voiceDraftForMode(
  draft: { url: string; model: string },
  from: VoiceMode,
  to: VoiceMode
) {
  if (draft.url.trim() && draft.url !== VOICE_DEFAULTS[from].url) return draft;
  return {
    url: VOICE_DEFAULTS[to].url,
    model:
      !draft.model.trim() || draft.model === VOICE_DEFAULTS[from].model
        ? VOICE_DEFAULTS[to].model
        : draft.model,
  };
}

export function normalizeVoiceConfig(
  url: string,
  apiKey: string,
  model: string,
  language: unknown = null,
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
        'version' in value && (value.version === 2 || value.version === 3 || value.version === 4)
          ? value.url
          : `${value.url.replace(/\/+$/, '').replace(/\/audio\/transcriptions$/, '')}/audio/transcriptions`,
        value.apiKey,
        value.model,
        'language' in value ? value.language : null,
        'mode' in value ? value.mode : 'file'
      )
    : null;
}
