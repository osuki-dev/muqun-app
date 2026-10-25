import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { File, FileMode } from 'expo-file-system';
import { VideoPlayer, VideoView } from 'react-native-video';
import { StartIcon } from '@/icons';
import { assertStandaloneVideo } from '@/lib/media-file';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/** A silent, paused first frame. Only visible staged files keep a decoder alive. */
export function StagedVideoThumbnail({
  uri,
  name,
  mime,
}: {
  uri: string;
  name: string;
  mime: string;
}) {
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  useEffect(() => {
    let cancelled = false;
    let current: VideoPlayer | undefined;
    const release = () => {
      current?.release();
      current = undefined;
    };
    const prepare = async () => {
      if (!/^(?:file|content):\/\//.test(uri)) return;
      const handle = new File(uri).open(FileMode.ReadOnly);
      const head = await settleAfter(
        () => handle.readBytes(1024),
        () => handle.close()
      );
      assertStandaloneVideo({ uri, name, mime }, head);
      if (cancelled) return;
      const next = new VideoPlayer({ uri, initializeOnCreation: false });
      current = next;
      next.muted = true;
      next.mixAudioMode = 'mixWithOthers';
      next.playInBackground = false;
      next.playWhenInactive = false;
      next.addEventListener('onError', () => {
        if (!cancelled) setPlayer(null);
        release();
      });
      setPlayer(next);
      await next.initialize();
      // Preparing a paused player paints the first frame without playing audio
      // or starting a timeline. The full preview owns playback after a tap.
    };
    void prepare().catch(() => {
      if (!cancelled) setPlayer(null);
      release();
    });
    return () => {
      cancelled = true;
      release();
    };
  }, [uri, name, mime]);
  return (
    <View pointerEvents="none" style={styles.frame} testID="staged-video-thumbnail">
      {player ? (
        <VideoView
          player={player}
          controls={false}
          keepScreenAwake={false}
          resizeMode="cover"
          surfaceType="texture"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={styles.play}>
        <StartIcon size={20} color="#FFFFFF" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#101820' },
  play: { padding: 4, borderRadius: 20, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
});
