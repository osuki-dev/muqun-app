import { expect, test } from 'bun:test';
import { normalizeVoiceConfig, parseVoiceConfig } from '../voice-service-config';

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
