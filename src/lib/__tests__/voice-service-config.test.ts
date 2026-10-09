import { expect, test } from 'bun:test';
import { normalizeVoiceConfig, parseVoiceConfig } from '../voice-service-config';

test('mode is explicit, keeps the exact endpoint, and leaves model/key optional', () => {
  const url = 'wss://speech.example/custom/live/?version=2&intent=transcription';
  expect(normalizeVoiceConfig(url, '', '', null, false, 'realtime')).toEqual({
    mode: 'realtime',
    url,
    apiKey: '',
    model: '',
    language: null,
    autoInsert: false,
  });
  expect(normalizeVoiceConfig(url, '', '')).toBe(null);
  expect(
    normalizeVoiceConfig('https://speech.example/transcribe', '', '', null, true, 'realtime')
  ).toBe(null);
  expect(normalizeVoiceConfig('ws://speech.example/live', '', '', null, true, 'realtime')).toBe(
    null
  );
  expect(
    normalizeVoiceConfig('https://speech.example/transcribe', '', '', null, true, 'guess')
  ).toBe(null);
});

test('unsafe endpoint credentials and multiline headers are rejected', () => {
  for (const url of ['wss://user:secret@speech.example/live', 'wss://speech.example/live#secret']) {
    expect(normalizeVoiceConfig(url, '', '', null, true, 'realtime')).toBe(null);
  }
  expect(
    normalizeVoiceConfig('wss://speech.example/live', 'key\nheader', '', null, true, 'realtime')
  ).toBe(null);
});

test('existing file configurations migrate without changing exact v2 endpoints', () => {
  const values = {
    url: 'https://speech.example/custom/?version=2',
    apiKey: '',
    model: '',
    autoInsert: false,
  };
  expect(parseVoiceConfig({ ...values, version: 2 })).toMatchObject({ ...values, mode: 'file' });
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
    true,
    'realtime'
  );
  expect(parseVoiceConfig(JSON.parse(JSON.stringify({ ...config, version: 3 })))).toEqual(config);
  expect(parseVoiceConfig(null)).toBe(null);
  expect(parseVoiceConfig({ mode: 'realtime' })).toBe(null);
});
