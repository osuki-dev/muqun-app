import { File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';
import { PermissionsAndroid, Platform } from 'react-native';
import type { VoiceServiceConfig } from '@/stores/voice-settings';
import { prepareRecordingAudio, releaseRecordingAudio } from '@/lib/audio-playback-session';
import {
  AudioEncoderAndroidType,
  AVEncoderAudioQualityIOSType,
  AudioSourceAndroidType,
  createSound,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';

import {
  VoiceInputError,
  VoiceRecordingSession,
  type VoiceRecordingRuntime,
} from '@/lib/voice-input-session';
export type { VoiceState } from '@/lib/voice-input-session';

function recordingRuntime(config: VoiceServiceConfig, language: string): VoiceRecordingRuntime {
  let sound: ReturnType<typeof createSound> | undefined;
  const audioOwner = {};
  const file = new File(Paths.cache, `dictation-${Date.now()}.m4a`);
  return {
    async start(signal, onMeter) {
      if (signal.aborted) throw new Error('Operation cancelled.');
      await prepareRecordingAudio(audioOwner);
      if (Platform.OS === 'android') {
        const permission = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO
        );
        if (signal.aborted) throw new Error('Operation cancelled.');
        if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
          throw new VoiceInputError('permission');
        }
      }
      if (signal.aborted) throw new Error('Operation cancelled.');
      sound = createSound();
      sound.setSubscriptionDuration(0.08);
      sound.addRecordBackListener(({ currentMetering = -60, currentPosition }) => {
        onMeter(Math.min(1, Math.max(0, (currentMetering + 55) / 55)), currentPosition / 1000);
      });
      try {
        await sound.startRecorder(
          file.uri.replace(/^file:\/\//, ''),
          {
            AVFormatIDKeyIOS: 'aac',
            AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
            AVModeIOS: 'measurement',
            AudioSourceAndroid: AudioSourceAndroidType.VOICE_RECOGNITION,
            OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
            AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
            AudioChannels: 1,
            AudioSamplingRate: 16000,
            AudioEncodingBitRate: 64000,
          },
          true
        );
      } catch (error) {
        if (error instanceof Error && /permission denied/i.test(error.message)) {
          throw new VoiceInputError('permission');
        }
        throw error;
      }
    },
    async stop() {
      sound?.removeRecordBackListener();
      await sound?.stopRecorder();
    },
    async transcribe(signal) {
      const body = new FormData();
      body.append('file', file, 'dictation.m4a');
      body.append('model', config.model);
      body.append('response_format', 'json');
      if (language !== 'auto') body.append('language', language.split('-')[0]);
      try {
        const response = await fetch(`${config.url}/audio/transcriptions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}` },
          redirect: 'error',
          body,
          signal,
        });
        if (!response.ok) throw new VoiceInputError('transcription');
        const result: unknown = await response.json().catch(() => {
          throw new VoiceInputError('response');
        });
        if (
          typeof result !== 'object' ||
          result === null ||
          !('text' in result) ||
          typeof result.text !== 'string'
        ) {
          throw new VoiceInputError('response');
        }
        return result.text;
      } catch (error) {
        throw error instanceof VoiceInputError ? error : new VoiceInputError('transcription');
      }
    },

    release() {
      sound?.removeRecordBackListener();
      sound?.dispose();
      sound = undefined;
      releaseRecordingAudio(audioOwner);
      if (file.exists) file.delete();
    },
  };
}

export class VoiceInputSession extends VoiceRecordingSession {
  constructor(
    config: VoiceServiceConfig,
    language: string,
    onState: ConstructorParameters<typeof VoiceRecordingSession>[1],
    onMeter: ConstructorParameters<typeof VoiceRecordingSession>[2],
    onText: ConstructorParameters<typeof VoiceRecordingSession>[3],
    onError: ConstructorParameters<typeof VoiceRecordingSession>[4]
  ) {
    super(recordingRuntime(config, language), onState, onMeter, onText, onError);
  }
}
