import { File, Paths } from 'expo-file-system';
import { createSound } from 'react-native-nitro-sound';
import { readAssetBytes, type SessionAsset } from '@/lib/gateway-client';
import type { AudioPlaybackRuntime } from '@/lib/audio-playback-session';

// Matches the Gateway content endpoint's existing ceiling, including encrypted transport.
export const MAX_AUDIO_PREVIEW_BYTES = 10 * 1024 * 1024;
let fileSequence = 0;

export function audioPreviewRuntime(
  asset: SessionAsset,
  options: {
    resolve?: (signal: AbortSignal) => Promise<SessionAsset>;
    onPrepared?: (bytes: Uint8Array) => void;
  } = {}
): AudioPlaybackRuntime {
  const extension =
    {
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
    }[asset.mime] ?? 'audio';
  const file = new File(Paths.cache, `audio-preview-${Date.now()}-${fileSequence++}.${extension}`);
  let sound: ReturnType<typeof createSound> | undefined;
  return {
    async prepare(signal) {
      const resolved = options.resolve ? await options.resolve(signal) : asset;
      const bytes = await readAssetBytes(resolved, { signal, maxBytes: MAX_AUDIO_PREVIEW_BYTES });
      if (signal.aborted) throw new Error('Operation cancelled.');
      file.create();
      file.write(bytes);
      options.onPrepared?.(bytes);
    },
    async start(onProgress, onEnd) {
      sound ??= createSound();
      sound.setSubscriptionDuration(0.25);
      sound.addPlayBackListener(({ currentPosition, duration }) =>
        onProgress(currentPosition, duration)
      );
      sound.addPlaybackEndListener(({ duration }) => {
        onProgress(duration, duration);
        onEnd();
      });
      await sound.startPlayer(file.uri);
    },
    async pause() {
      await sound?.pausePlayer();
    },
    async resume() {
      await sound?.resumePlayer();
    },
    async seek(position) {
      await sound?.seekToPlayer(position);
    },
    async stop() {
      sound?.removePlayBackListener();
      sound?.removePlaybackEndListener();
      await sound?.stopPlayer();
    },
    release() {
      sound?.dispose();
      sound = undefined;
      if (file.exists) file.delete();
    },
  };
}
