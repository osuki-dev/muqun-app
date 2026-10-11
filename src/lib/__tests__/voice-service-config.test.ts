import { expect, test } from 'bun:test';
import {
  normalizeVoiceConfig,
  parseVoiceConfig,
  VOICE_DEFAULTS,
  isOpenAiVoiceEndpoint,
  missingVoiceCredentials,
  voiceDraftForMode,
} from '../voice-service-config';

test('mode is explicit, keeps the exact endpoint, and leaves model/key optional', () => {
  const url = 'wss://speech.example/custom/live/?version=2&intent=transcription';
  expect(normalizeVoiceConfig(url, '', '', null, 'realtime')).toEqual({
    mode: 'realtime',
    url,
    apiKey: '',
    model: '',
    language: null,
  });
  expect(normalizeVoiceConfig(url, '', '')).toBe(null);
  expect(normalizeVoiceConfig('https://speech.example/transcribe', '', '', null, 'realtime')).toBe(
    null
  );
  expect(normalizeVoiceConfig('ws://speech.example/live', '', '', null, 'realtime')).toBe(null);
  expect(normalizeVoiceConfig('https://speech.example/transcribe', '', '', null, 'guess')).toBe(
    null
  );
});

test('unsafe endpoint credentials and multiline headers are rejected', () => {
  for (const url of ['wss://user:secret@speech.example/live', 'wss://speech.example/live#secret']) {
    expect(normalizeVoiceConfig(url, '', '', null, 'realtime')).toBe(null);
  }
  expect(
    normalizeVoiceConfig('wss://speech.example/live', 'key\nheader', '', null, 'realtime')
  ).toBe(null);
});

test('existing file configurations migrate without changing exact v2 endpoints', () => {
  const values = {
    url: 'https://speech.example/custom/?version=2',
    apiKey: '',
    model: '',
  };
  expect(parseVoiceConfig({ ...values, autoInsert: false, version: 2 })).toEqual({
    ...values,
    mode: 'file',
    language: null,
  });
  expect(parseVoiceConfig({ ...values, url: 'https://speech.example/v1' })?.url).toBe(
    'https://speech.example/v1/audio/transcriptions'
  );
  expect(
    parseVoiceConfig({ ...values, url: 'https://speech.example/v1/audio/transcriptions' })?.url
  ).toBe('https://speech.example/v1/audio/transcriptions');
});

test('saved realtime configuration round trips without adding a file upload path', () => {
  const config = normalizeVoiceConfig(
    'wss://speech.example/live?token=example',
    '',
    'custom-live',
    'auto',
    'realtime'
  );
  expect(parseVoiceConfig(JSON.parse(JSON.stringify({ ...config, version: 3 })))).toEqual(config);
  expect(parseVoiceConfig(null)).toBe(null);
  expect(parseVoiceConfig({ mode: 'realtime' })).toBe(null);
});

test('old review preference is dropped, while v4 preserves the exact speech endpoint', () => {
  const stored = {
    version: 3,
    url: 'https://speech.example/custom',
    apiKey: '',
    model: '',
    autoInsert: false,
  };
  const config = parseVoiceConfig(stored);
  expect(Object.keys(config ?? {})).not.toContain('autoInsert');
  expect(parseVoiceConfig({ ...config, version: 4 })).toEqual(config);
});

test('official speech services require an actual key and model, not placeholders', () => {
  for (const preset of Object.values(VOICE_DEFAULTS)) {
    expect(missingVoiceCredentials({ url: preset.url, apiKey: ' ', model: '' })).toEqual([
      'apiKey',
      'model',
    ]);
    expect(missingVoiceCredentials({ ...preset, apiKey: '' })).toEqual(['apiKey']);
    expect(missingVoiceCredentials({ url: preset.url, apiKey: 'test-key', model: '' })).toEqual([
      'model',
    ]);
    expect(missingVoiceCredentials({ ...preset, apiKey: 'test-key' })).toEqual([]);
  }
  expect(isOpenAiVoiceEndpoint('https://API.OPENAI.COM/v1/audio/transcriptions')).toBe(true);
  expect(isOpenAiVoiceEndpoint('https://api.openai.com.example/transcribe')).toBe(false);
  expect(
    missingVoiceCredentials({ url: 'https://speech.example/custom', apiKey: '', model: '' })
  ).toEqual([]);
});

test('switching an untouched preset updates its actual endpoint and model together', () => {
  expect(voiceDraftForMode(VOICE_DEFAULTS.file, 'file', 'realtime')).toEqual(
    VOICE_DEFAULTS.realtime
  );
  expect(voiceDraftForMode(VOICE_DEFAULTS.realtime, 'realtime', 'file')).toEqual(
    VOICE_DEFAULTS.file
  );
  expect(voiceDraftForMode({ url: '', model: '' }, 'file', 'realtime')).toEqual(
    VOICE_DEFAULTS.realtime
  );
});

test('changing mode does not replace custom URLs or models', () => {
  const custom = { url: 'https://speech.example/custom', model: 'my-model' };
  expect(voiceDraftForMode(custom, 'file', 'realtime')).toEqual(custom);
  const customUsingKnownModel = { url: custom.url, model: VOICE_DEFAULTS.file.model };
  expect(voiceDraftForMode(customUsingKnownModel, 'file', 'realtime')).toEqual(
    customUsingKnownModel
  );
  expect(
    voiceDraftForMode({ url: VOICE_DEFAULTS.file.url, model: 'my-model' }, 'file', 'realtime')
  ).toEqual({ url: VOICE_DEFAULTS.realtime.url, model: 'my-model' });
});

test('previous incomplete official settings remain editable rather than being discarded', () => {
  const config = parseVoiceConfig({
    version: 4,
    url: VOICE_DEFAULTS.file.url,
    apiKey: '',
    model: '',
  });
  expect(config?.url).toBe(VOICE_DEFAULTS.file.url);
  expect(config?.model).toBe('');
  expect(config && missingVoiceCredentials(config)).toEqual(['apiKey', 'model']);
});
