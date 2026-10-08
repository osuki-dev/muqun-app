import { File, Paths } from 'expo-file-system';
import { VideoPlayer } from 'react-native-video';
import { readAssetBytes, type SessionAsset } from '@/lib/gateway-client';
import type { AudioPlaybackRuntime } from '@/lib/audio-playback-session';

let sequence = 0;
/** The shared media session owns the player, download and cache file together. */
export function videoPreviewRuntime(
  asset: SessionAsset,
  options: {
    resolve?: (signal: AbortSignal) => Promise<SessionAsset>;
    onPrepared: (player: VideoPlayer) => void;
  }
): AudioPlaybackRuntime {
  const file = new File(
    Paths.cache,
    `video-preview-${Date.now()}-${sequence++}.${asset.mime === 'video/quicktime' ? 'mov' : 'mp4'}`
  );
  let player: VideoPlayer | undefined;
  let subscriptions: { remove: () => void }[] = [];
  return {
    async prepare(signal) {
      const resolved = options.resolve ? await options.resolve(signal) : asset;
      const bytes = await readAssetBytes(resolved, { signal, maxBytes: 10 * 1024 * 1024 });
      if (signal.aborted) throw new Error('Operation cancelled');
      file.create();
      file.write(bytes);
      player = new VideoPlayer({ uri: file.uri, initializeOnCreation: false });
      options.onPrepared(player);
    },
    async start(onProgress, onEnd, onError) {
      if (!player) throw new Error('Video player unavailable');
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [
        player.addEventListener('onProgress', ({ currentTime }) =>
          onProgress(currentTime * 1000, (player?.duration ?? 0) * 1000)
        ),
        player.addEventListener('onEnd', onEnd),
        player.addEventListener('onError', onError),
      ];
      await player.initialize();
      player.play();
    },
    async pause() {
      player?.pause();
    },
    async resume() {
      player?.play();
    },
    async seek(position) {
      player?.seekTo(position / 1000);
    },
    async stop() {
      player?.pause();
      player?.seekTo(0);
    },
    release() {
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions = [];
      player?.release();
      player = undefined;
      if (file.exists) file.delete();
    },
  };
}
