import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import Animated from 'react-native-reanimated';
import { VideoView, type VideoPlayer, type VideoViewRef } from 'react-native-video';
import { Download, Maximize2, Pause, Play } from 'lucide-react-native';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { AudioProgress } from '@/components/audio-progress';
import { useInlineMediaVisibility } from '@/hooks/use-inline-media-visibility';
import { useFileActions } from '@/hooks/use-file-actions';
import { saveSessionAsset } from '@/lib/save-file';
import { resolveAgentFileAsset } from '@/lib/gateway-client';
import type { SessionAsset } from '@/lib/session-assets';
import { AudioPlaybackSession, type AudioPlaybackState } from '@/lib/audio-playback-session';
import { videoPreviewRuntime } from '@/lib/video-preview';
import { useVoiceInput } from '@/stores/voice-input';

type VideoOptions = {
  asset: SessionAsset;
  visible?: boolean;
  resolve?: (signal: AbortSignal) => Promise<SessionAsset>;
  poster?: ImageSource;
};

export function InlineVideoFile({
  file,
  asid,
  poster,
}: {
  file: { uri: string; name?: string; mime?: string };
  asid: string;
  poster?: ImageSource;
}) {
  const { ref, visible } = useInlineMediaVisibility();
  const asset: SessionAsset = {
    id: file.uri,
    path: file.uri,
    name: file.name ?? file.uri.split('/').pop() ?? '',
    mime: file.mime ?? 'video/mp4',
    kind: 'video',
    size: 0,
    modified_unix_ms: 0,
    previewable: true,
  };
  return (
    <Animated.View ref={ref} testID="inline-video-output">
      <VideoAssetPreview
        asset={asset}
        visible={visible}
        poster={poster}
        resolve={(signal) => resolveAgentFileAsset(asid, file.uri, signal)}
      />
    </Animated.View>
  );
}

export function VideoAssetPreview({ asset, visible = true, resolve, poster }: VideoOptions) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const recording = useVoiceInput((state) => state.request !== null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, []);
  return (
    <VideoPlayerCard
      key={attempt}
      asset={asset}
      visible={active && !recording && visible}
      resolve={resolve}
      poster={poster}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function VideoPlayerCard({
  asset,
  visible = true,
  resolve,
  onRetry,
  poster,
}: VideoOptions & { onRetry: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const video = useRef<VideoViewRef>(null);
  const [player, setPlayer] = useState<VideoPlayer | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [state, setState] = useState<AudioPlaybackState>({
    phase: 'idle',
    position: 0,
    duration: 0,
  });
  const [draft, setDraft] = useState<number | null>(null);
  const [session] = useState(
    () =>
      new AudioPlaybackSession(
        videoPreviewRuntime(asset, { resolve, onPrepared: setPlayer }),
        setState
      )
  );
  const fileActions = useFileActions(asset.name, async () =>
    saveSessionAsset(resolve ? await resolve(new AbortController().signal) : asset, false)
  );
  useEffect(
    () => () => {
      void session.close();
    },
    [session]
  );
  useEffect(() => {
    void session.setVisible(visible);
  }, [session, visible]);
  useEffect(() => {
    if (Platform.OS !== 'android' || !fullscreen) return;
    // Subscribe when fullscreen opens so this takes priority over route back.
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      video.current?.exitFullscreen();
      return true;
    });
    return () => subscription.remove();
  }, [fullscreen]);
  const playing = state.phase === 'playing';
  const error = state.phase === 'error';
  const loading = state.phase === 'loading';
  const label = error ? t`Try again` : playing ? t`Pause` : t`Play`;
  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surfaceRaised }]}
      testID="video-asset-preview">
      {player && !error ? (
        <VideoView
          ref={video}
          player={player}
          controls={fullscreen}
          onFullscreenChange={setFullscreen}
          resizeMode="contain"
          surfaceType="texture"
          keepScreenAwake={playing}
          style={styles.video}
        />
      ) : (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!visible || loading}
          onPress={() => {
            if (error) onRetry();
            else void session.play();
          }}
          style={styles.poster}>
          {poster && <VideoPoster key={poster.uri} source={poster} />}
          <View style={styles.posterAction}>
            <Play size={32} color="white" />
          </View>
        </PressableScale>
      )}
      <View style={styles.controls}>
        <PressableScale
          testID="video-playback-toggle"
          accessibilityRole="button"
          accessibilityLabel={label}
          disabled={!visible || loading}
          onPress={() => {
            if (error) onRetry();
            else if (playing) void session.pause();
            else void session.play();
          }}
          style={styles.action}>
          {playing ? (
            <Pause size={20} color={theme.colors.primary} />
          ) : (
            <Play size={20} color={theme.colors.primary} />
          )}
        </PressableScale>
        <View style={styles.timeline}>
          <Text variant="caption" numberOfLines={1}>
            {asset.name}
          </Text>
          <AudioProgress
            value={draft ?? (state.duration ? state.position / state.duration : 0)}
            peaks={null}
            playing={playing}
            disabled={!visible || loading || !state.duration}
            label={t`Playback position`}
            onChange={setDraft}
            onCommit={(value) => {
              setDraft(null);
              void session.seek(value * state.duration);
            }}
          />
          <Text variant="caption">
            {Math.floor(state.position / 60000)}:
            {String(Math.floor(state.position / 1000) % 60).padStart(2, '0')} /{' '}
            {Math.floor(state.duration / 60000)}:
            {String(Math.floor(state.duration / 1000) % 60).padStart(2, '0')}
          </Text>
        </View>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Fullscreen`}
          disabled={!player || error}
          onPress={() => video.current?.enterFullscreen()}
          style={styles.action}>
          <Maximize2 size={18} color={theme.colors.textMuted} />
        </PressableScale>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Save file`}
          onPress={fileActions.show}
          style={styles.action}>
          <Download size={18} color={theme.colors.textMuted} />
        </PressableScale>
      </View>
      {error && (
        <Text variant="caption" color={theme.colors.textMuted} style={styles.error}>
          {state.failure === 'unsupported'
            ? t`Update the Gateway to preview video output.`
            : t`Could not play this video file.`}
        </Text>
      )}
      {fileActions.menu}
    </View>
  );
}
function VideoPoster({ source }: { source: ImageSource }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <Image
      source={source}
      contentFit="contain"
      style={StyleSheet.absoluteFill}
      testID={loaded ? 'video-poster-ready' : 'video-poster-loading'}
      onLoad={() => setLoaded(true)}
    />
  );
}
const styles = StyleSheet.create({
  card: { width: '100%', borderRadius: 14, overflow: 'hidden', gap: 8, paddingBottom: 8 },
  video: { width: '100%', aspectRatio: 16 / 9 },
  poster: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#08101d',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4 },
  timeline: { flex: 1, minWidth: 0 },
  action: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  posterAction: { backgroundColor: '#08101dbb', borderRadius: 32, padding: 14 },
  error: { paddingHorizontal: 56 },
});
