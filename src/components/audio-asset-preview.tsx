import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Download, Pause, Play, RotateCcw } from 'lucide-react-native';
import { useFileActions } from '@/hooks/use-file-actions';
import { saveSessionAsset } from '@/lib/save-file';
import { useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { AppState, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useInlineMediaVisibility } from '@/hooks/use-inline-media-visibility';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { AudioProgress } from '@/components/audio-progress';
import { resolveAgentAudioAsset } from '@/lib/gateway-client';
import { audioWaveform } from '@/lib/audio-waveform';
import { AudioPlaybackContext } from '@/components/audio-playback-context';
import { createAudioPlaybackEntry } from '@/lib/audio-playback-pool';
import { audioPreviewRuntime, MAX_AUDIO_PREVIEW_BYTES } from '@/lib/audio-preview';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { formatAssetSize } from '@/lib/asset-display';
import type { SessionAsset } from '@/lib/session-assets';
import { useVoiceInput } from '@/stores/voice-input';

function audioTime(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

type AudioOptions = {
  visible?: boolean;
  resolve?: (signal: AbortSignal) => Promise<SessionAsset>;
};

export function InlineAudioFile({
  file,
  asid,
}: {
  file: { uri: string; mime?: string; name?: string };
  asid: string;
}) {
  const { ref, visible } = useInlineMediaVisibility();
  const asset = useMemo<SessionAsset>(
    () => ({
      id: file.uri,
      path: file.uri,
      name: file.name ?? file.uri.split('/').pop() ?? '',
      kind: 'audio',
      mime: file.mime ?? 'audio/mpeg',
      size: 0,
      modified_unix_ms: 0,
      previewable: true,
    }),
    [file.uri, file.name, file.mime]
  );
  return (
    <Animated.View ref={ref} style={styles.inlineWrap} testID="inline-audio-output">
      <AudioAssetPreview
        asset={asset}
        visible={visible}
        resolve={(signal) => resolveAgentAudioAsset(asid, file.uri, signal)}
      />
    </Animated.View>
  );
}

export function AudioAssetPreview({
  asset,
  visible = true,
  resolve,
}: { asset: SessionAsset } & AudioOptions) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const recording = useVoiceInput((state) => state.request !== null);
  const playback = useContext(AudioPlaybackContext);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => listener.remove();
  }, []);
  if (!voiceRecorderAvailable()) {
    return (
      <Text color={theme.colors.textMuted} style={styles.notice}>
        {t`Install an app build with audio support to preview this file.`}
      </Text>
    );
  }
  if (asset.size > MAX_AUDIO_PREVIEW_BYTES) {
    const ceiling = formatAssetSize(MAX_AUDIO_PREVIEW_BYTES);
    return (
      <Text color={theme.colors.textMuted} style={styles.notice}>
        {t`Audio preview supports files up to ${ceiling}.`}
      </Text>
    );
  }
  return (
    <AudioPlayer
      key={`${playback?.namespace ?? ''}:${asset.id}:${attempt}`}
      asset={asset}
      visible={active && !recording && visible}
      resolve={resolve}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  );
}

function AudioPlayer({
  asset,
  visible = true,
  resolve,
  onRetry,
}: { asset: SessionAsset; onRetry: () => void } & AudioOptions) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const fileActions = useFileActions(asset.name, async () => {
    const resolved = resolve ? await resolve(new AbortController().signal) : asset;
    await saveSessionAsset(resolved, false);
  });
  const playback = useContext(AudioPlaybackContext);
  const [draft, setDraft] = useState<number | null>(null);
  const [entry] = useState(() => {
    const runtime = (onPeaks: (peaks: number[] | null) => void) =>
      audioPreviewRuntime(asset, { resolve, onPrepared: (bytes) => onPeaks(audioWaveform(bytes)) });
    return playback
      ? playback.pool.acquire(playback.namespace, `${playback.row}:${asset.id}`, runtime)
      : createAudioPlaybackEntry(runtime);
  });
  const state = useStore(entry.store, (snapshot) => snapshot.playback);
  const peaks = useStore(entry.store, (snapshot) => snapshot.peaks);
  const session = entry.session;
  useEffect(
    () => () => {
      if (playback) void session.setVisible(false);
      else void session.close();
    },
    [playback, session]
  );
  useEffect(() => {
    void session.setVisible(visible);
  }, [session, visible]);
  const playing = state.phase === 'playing';
  const error = state.phase === 'error';
  const loading = state.phase === 'loading';
  const label = error
    ? t`Try again`
    : playing
      ? t`Pause audio`
      : state.phase === 'ended'
        ? t`Replay audio`
        : t`Play audio`;
  const failureText =
    state.failure === 'unsupported'
      ? t`Update the Gateway to preview audio output.`
      : t`Could not play this audio file.`;
  const progress = draft ?? (state.duration ? state.position / state.duration : 0);
  const timeline = (
    <View style={styles.inlineTimeline}>
      <AudioProgress
        peaks={peaks}
        playing={playing}
        label={t`Playback position`}
        value={progress}
        disabled={!visible || !state.duration || error || loading}
        onChange={setDraft}
        onCommit={(value) => {
          setDraft(null);
          void session.seek(value * state.duration);
        }}
      />
      <View style={styles.times}>
        <Text testID="audio-playback-elapsed" variant="caption" color={theme.colors.textMuted}>
          {audioTime(draft === null ? state.position : draft * state.duration)}
        </Text>
        <Text testID="audio-playback-duration" variant="caption" color={theme.colors.textMuted}>
          {audioTime(state.duration)}
        </Text>
      </View>
    </View>
  );
  const button = (
    <PressableScale
      testID="audio-playback-toggle"
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!visible || loading}
      onPress={() => {
        if (error) onRetry();
        else if (playing) void session.pause();
        else void session.play();
      }}
      style={[
        styles.inlineAction,
        { backgroundColor: theme.colors.primary, opacity: loading ? 0.45 : 1 },
      ]}>
      {playing ? (
        <Pause size={18} color={theme.colors.onPrimary} />
      ) : state.phase === 'ended' ? (
        <RotateCcw size={18} color={theme.colors.onPrimary} />
      ) : (
        <Play size={18} color={theme.colors.onPrimary} />
      )}
    </PressableScale>
  );
  return (
    <View
      style={[styles.inlinePlayer, { backgroundColor: theme.colors.surfaceRaised }]}
      testID="audio-asset-preview">
      {button}
      <View style={styles.inlineBody}>
        <Text variant="caption" numberOfLines={1}>
          {asset.name}
        </Text>
        {timeline}
        {fileActions.menu}
        {error && (
          <Text variant="caption" color={theme.colors.textMuted}>
            {failureText}
          </Text>
        )}
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t`Save file`}
        onPress={fileActions.show}
        style={styles.inlineAction}>
        <Download size={18} color={theme.colors.textMuted} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  inlineWrap: { width: '100%' },
  inlinePlayer: {
    width: '100%',
    padding: 12,
    borderRadius: 14,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inlineBody: { flex: 1, minWidth: 0 },
  inlineTimeline: { width: '100%' },
  inlineAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  notice: { padding: 24, textAlign: 'center' },
});
