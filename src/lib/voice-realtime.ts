import { fromByteArray } from 'react-native-quick-base64';
import type { VoiceServiceConfig } from '@/stores/voice-settings';
import { prepareRecordingAudio, releaseRecordingAudio } from './audio-playback-session';
import { VoiceInputError, type VoiceRecordingRuntime } from './voice-input-session';
import { VoiceRealtimeProtocol, type VoiceRealtimeSocket } from './voice-realtime-protocol';
import { VoicePcmEncoder } from './voice-pcm';

type ExpoAudio = typeof import('expo-audio');

function captureModule(): ExpoAudio {
  try {
    // oxlint-disable-next-line typescript/no-require-imports -- old binaries must retain file transcription when AudioStream is absent
    const audio = require('expo-audio') as ExpoAudio;
    if (!audio.AudioModule.AudioStream) throw new Error('AudioStream unavailable');
    return audio;
  } catch {
    throw new VoiceInputError('unsupported');
  }
}

export function realtimeRecordingRuntime(
  config: VoiceServiceConfig,
  language: string,
  onPartial: (text: string) => void
): VoiceRecordingRuntime {
  const owner = {};
  const encoder = new VoicePcmEncoder();
  let audio: ExpoAudio | undefined;
  let attemptedStart = false;
  let stream: import('expo-audio').AudioStream | undefined;
  let protocol: VoiceRealtimeProtocol | undefined;
  let stopped: Promise<void> | undefined;
  let signal: AbortSignal | undefined;
  let stopping = false;
  let bufferListener: { remove(): void } | undefined;
  let statusListener: { remove(): void } | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const checkAbort = () => {
    if (signal?.aborted) throw new Error('Operation cancelled.');
  };
  return {
    async start(abort, onMeter, onFailure) {
      signal = abort;
      checkAbort();
      audio = captureModule();
      await prepareRecordingAudio(owner);
      const permission = await audio.requestRecordingPermissionsAsync();
      checkAbort();
      if (!permission.granted) throw new VoiceInputError('permission');
      const Socket = WebSocket as unknown as new (
        url: string,
        protocols: undefined,
        options: { headers: Record<string, string> }
      ) => VoiceRealtimeSocket;
      // Preserve the full configured endpoint; credentials belong in headers.
      const socket = new Socket(config.url, undefined, {
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      });
      protocol = new VoiceRealtimeProtocol(
        socket,
        abort,
        config.model,
        language,
        (text) => {
          if (!abort.aborted) onPartial(text);
        },
        onFailure
      );
      await protocol.waitUntilReady();
      checkAbort();
      stream = new audio.AudioModule.AudioStream({
        sampleRate: 24000,
        channels: 1,
        encoding: 'float32',
      });
      const expectBuffer = () => {
        clearTimeout(watchdog);
        if (!stopping && !abort.aborted)
          watchdog = setTimeout(
            () => onFailure(new Error('Microphone capture interrupted.')),
            5000
          );
      };
      statusListener = stream.addListener('audioStreamStatus', ({ isStreaming }) => {
        if (!isStreaming && !stopping && !abort.aborted)
          onFailure(new Error('Microphone capture stopped.'));
      });
      bufferListener = stream.addListener('audioStreamBuffer', ({ data, sampleRate, channels }) => {
        if (abort.aborted) return;
        try {
          const { bytes, level } = encoder.push(data, sampleRate, channels);
          if (bytes.length) protocol?.append(fromByteArray(bytes), bytes.length / 2);
          onMeter(level, encoder.seconds);
          expectBuffer();
        } catch {
          onFailure(new Error('Microphone capture failed.'));
        }
      });
      expectBuffer();
      attemptedStart = true;
      await stream.start();
    },
    stop() {
      stopping = true;
      clearTimeout(watchdog);
      stopped ??= (async () => {
        stream?.stop();
        // Let already queued native buffers arrive before finalizing this turn.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        bufferListener?.remove();
        statusListener?.remove();
        if (!signal?.aborted) {
          const { bytes } = encoder.flush();
          if (bytes.length) protocol?.append(fromByteArray(bytes), bytes.length / 2);
        }
      })();
      return stopped;
    },
    async transcribe() {
      checkAbort();
      if (!protocol) throw new VoiceInputError('connection');
      return protocol.finish();
    },
    async release() {
      clearTimeout(watchdog);
      protocol?.dispose();
      bufferListener?.remove();
      statusListener?.remove();
      try {
        stream?.release();
        // A failed iOS start may have activated AVAudioSession before failing.
        if (attemptedStart && audio) await audio.setIsAudioActiveAsync(false);
      } finally {
        releaseRecordingAudio(owner);
      }
    },
  };
}
