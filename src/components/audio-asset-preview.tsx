import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Headphones, Pause, Play, RotateCcw } from 'lucide-react-native';
import { useContext, useEffect, useMemo, useState } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  measure,
  useAnimatedRef,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { AudioProgress } from '@/components/audio-progress';
import { DiagramVisibility } from '@/components/diagram-visibility';
import { resolveAgentAudioAsset } from '@/lib/gateway-client';
import { audioWaveform } from '@/lib/audio-waveform';
import { AudioPlaybackSession, type AudioPlaybackState } from '@/lib/audio-playback-session';
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
  compact?: boolean;
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
  const visible = useContext(DiagramVisibility);
  const { height } = useWindowDimensions();
  const ref = useAnimatedRef<Animated.View>();
  const lastCheck = useSharedValue(0);
  const measuredVisible = useSharedValue(true);
  const [inViewport, setInViewport] = useState(true);
  useFrameCallback((frame) => {
    if (!visible || frame.timeSinceFirstFrame - lastCheck.get() < 100) return;
    lastCheck.set(frame.timeSinceFirstFrame);
    const bounds = measure(ref);
    if (!bounds) return;
    const next = bounds.pageY + bounds.height > 0 && bounds.pageY < height;
    if (next !== measuredVisible.get()) {
      measuredVisible.set(next);
      scheduleOnRN(setInViewport, next);
    }
  });
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
        compact
        visible={visible && inViewport}
        resolve={(signal) => resolveAgentAudioAsset(asid, file.uri, signal)}
      />
    </Animated.View>
  );
}

export function AudioAssetPreview({
  asset,
  compact = false,
  visible = true,
  resolve,
}: { asset: SessionAsset } & AudioOptions) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const recording = useVoiceInput((state) => state.request !== null);
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
  return active && !recording && visible ? (
    <AudioPlayer
      key={`${asset.id}:${attempt}`}
      asset={asset}
      compact={compact}
      resolve={resolve}
      onRetry={() => setAttempt((value) => value + 1)}
    />
  ) : (
    <View style={styles.offscreen}>
      <Text variant="caption" numberOfLines={1}>
        {asset.name}
      </Text>
      <Play size={18} color={theme.colors.textMuted} />
    </View>
  );
}

function AudioPlayer({
  asset,
  compact,
  resolve,
  onRetry,
}: { asset: SessionAsset; onRetry: () => void } & AudioOptions) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [state, setState] = useState<AudioPlaybackState>({
    phase: 'idle',
    position: 0,
    duration: 0,
  });
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [draft, setDraft] = useState<number | null>(null);
  const [session] = useState(
    () =>
      new AudioPlaybackSession(
        audioPreviewRuntime(asset, {
          resolve,
          onPrepared: (bytes) => setPeaks(audioWaveform(bytes)),
        }),
        setState
      )
  );
  useEffect(
    () => () => {
      void session.close();
    },
    [session]
  );
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
    <View style={compact ? styles.inlineTimeline : styles.timeline}>
      <AudioProgress
        peaks={peaks}
        playing={playing}
        label={t`Playback position`}
        value={progress}
        disabled={!state.duration || error || loading}
        onChange={setDraft}
        onCommit={(value) => {
          setDraft(null);
          void session.seek(value * state.duration);
        }}
      />
      <View style={styles.times}>
        <Text variant="caption" color={theme.colors.textMuted}>
          {audioTime(draft === null ? state.position : draft * state.duration)}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted}>
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
      disabled={loading}
      onPress={() => {
        if (error) onRetry();
        else if (playing) void session.pause();
        else void session.play();
      }}
      style={[
        compact ? styles.inlineAction : styles.action,
        { backgroundColor: theme.colors.primary, opacity: loading ? 0.45 : 1 },
      ]}>
      {playing ? (
        <Pause size={18} color={theme.colors.onPrimary} />
      ) : state.phase === 'ended' ? (
        <RotateCcw size={18} color={theme.colors.onPrimary} />
      ) : (
        <Play size={18} color={theme.colors.onPrimary} />
      )}
      {!compact && (
        <Text color={theme.colors.onPrimary}>{loading ? t`Loading audio…` : label}</Text>
      )}
    </PressableScale>
  );
  return compact ? (
    <View
      style={[styles.inlinePlayer, { backgroundColor: theme.colors.surfaceRaised }]}
      testID="audio-asset-preview">
      {button}
      <View style={styles.inlineBody}>
        <Text variant="caption" numberOfLines={1}>
          {asset.name}
        </Text>
        {timeline}
        {error && (
          <Text variant="caption" color={theme.colors.textMuted}>
            {failureText}
          </Text>
        )}
      </View>
    </View>
  ) : (
    <View style={styles.player} testID="audio-asset-preview">
      <View style={[styles.icon, { backgroundColor: theme.colors.surfaceRaised }]}>
        <Headphones size={32} color={theme.colors.primary} />
      </View>
      <Text variant="label">{t`Audio preview`}</Text>
      {timeline}
      {button}
      {error && (
        <Text color={theme.colors.textMuted} style={styles.notice}>
          {failureText}
        </Text>
      )}
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
  offscreen: {
    minHeight: 110,
    padding: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  player: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 24 },
  icon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  timeline: { width: '100%', maxWidth: 440 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  action: {
    minWidth: 180,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  notice: { padding: 24, textAlign: 'center' },
});
