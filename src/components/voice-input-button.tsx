import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
import { useIsFocused } from 'expo-router';
import { UndoIcon, StopIcon, CloseIcon } from '@/icons';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
} from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useResolvedLocale } from '@/i18n/provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { fadeIn, fadeOut, timing } from '@/lib/motion';
import { VoiceInputError } from '@/lib/voice-input-session';
import { VoiceMeterHistory, VOICE_METER_SAMPLES } from '@/lib/voice-meter-history';
import { VoiceLevelRing, VoiceRecordingWaveform } from '@/components/voice-recording-waveform';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { VoiceInputSession, type VoiceState } from '@/lib/voice-input';
import {
  loadVoiceSettings,
  useVoiceSettings,
  type VoiceServiceConfig,
} from '@/stores/voice-settings';
import {
  useVoiceInput,
  clearVoiceInput,
  claimVoiceInput,
  deliverVoiceInput,
} from '@/stores/voice-input';

const enter = fadeIn('short');
const exit = fadeOut('short');
const REALTIME_TOP_INSET = 28;
const REALTIME_BOTTOM_INSET = 48;
function LiveTranscript({
  text,
  onHeightChange,
}: {
  text: string;
  onHeightChange?: (height: number) => void;
}) {
  const theme = useThemeTokens();
  const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  return (
    <ScrollView
      ref={scroll}
      nestedScrollEnabled
      style={styles.liveTranscript}
      scrollEventThrottle={100}
      onScroll={({ nativeEvent }) => {
        following.current =
          nativeEvent.contentSize.height -
            nativeEvent.layoutMeasurement.height -
            nativeEvent.contentOffset.y <
          32;
      }}
      onContentSizeChange={() => {
        if (following.current) scroll.current?.scrollToEnd({ animated: false });
      }}>
      <Text
        testID="voice-live-transcript"
        weight="regular"
        color={theme.colors.text}
        style={styles.liveText}
        onTextLayout={({ nativeEvent }) => {
          // Measure the untruncated text, not the capped viewport, so the
          // composer can grow without feeding its own height back into itself.
          const bottom = nativeEvent.lines.reduce(
            (height, line) => Math.max(height, line.y + line.height),
            0
          );
          onHeightChange?.(Math.ceil(bottom));
        }}>
        {text}
      </Text>
    </ScrollView>
  );
}

function VoiceRecording({
  config,
  language,
  onText,
  onClose,
  onRetry,
  onHeightChange,
}: {
  config: VoiceServiceConfig;
  language: string;
  onText: (text: string) => void;
  onClose: () => void;
  onRetry: () => void;
  onHeightChange?: (height: number) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const [state, setState] = useState<VoiceState>('starting');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [partial, setPartial] = useState('');
  const { fontScale } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const compact = config.mode !== 'realtime' && height < 96 * fontScale;
  const [meter] = useState(() => new VoiceMeterHistory());
  const history = useSharedValue(Array<number>(VOICE_METER_SAMPLES).fill(0));
  const latest = useLatestReader({ onText, onClose });
  const [session] = useState(
    () =>
      new VoiceInputSession(
        config,
        language,
        setState,
        (value, duration) => {
          const samples = meter.push(value, duration);
          if (samples) history.set(reduced ? samples : withTiming(samples, timing('button')));
          setSeconds(Math.floor(duration));
        },
        (text) => {
          if (text.trim()) latest().onText(text.trim());
          else setError(t`No speech detected. Please try again.`);
        },
        (failure) =>
          setError(
            failure instanceof VoiceInputError
              ? failure.code === 'permission'
                ? t`Allow microphone access in system settings.`
                : failure.code === 'response'
                  ? t`The speech service returned an invalid transcript.`
                  : failure.code === 'unsupported'
                    ? t`Install an updated app build to use realtime transcription.`
                    : failure.code === 'connection'
                      ? t`Realtime transcription disconnected. Check your connection and speech service, then try again.`
                      : t`Transcription failed. Check your speech service and try again.`
              : t`Recording failed.`
          ),
        setPartial,
        {
          appState: () => AppState.currentState ?? 'unknown',
          onBackground: () => latest().onClose(),
        }
      )
  );
  useEffect(() => {
    session.setAppState(AppState.currentState ?? 'unknown');
    void session.start();
    const listener = AppState.addEventListener('change', (next) => {
      session.setAppState(next);
    });
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      void session.cancel();
      latest().onClose();
      return true;
    });
    return () => {
      listener.remove();
      back.remove();
      void session.cancel();
    };
  }, [session, latest]);
  const status = error
    ? t`Try again`
    : state === 'starting'
      ? t`Preparing microphone…`
      : state === 'processing'
        ? t`Transcribing…`
        : t`Listening…`;
  const recording = !error && state === 'recording';
  const busy = state !== 'recording';
  // Realtime transcription shows its words as they come, so the field is the
  // transcript's and the level moves onto the stop control; after-recording
  // transcription has no words to show and keeps the full-width waveform.
  const realtime = config.mode === 'realtime';
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const cancel = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Cancel`}
      testID="voice-recording-cancel"
      hitSlop={4}
      onPress={() => {
        void session.cancel();
        onClose();
      }}
      style={styles.action}>
      <CloseIcon size={18} color={theme.colors.textMuted} />
    </PressableScale>
  );
  const stop = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={error ? t`Try again` : t`Stop and transcribe`}
      accessibilityState={{ busy: busy && !error }}
      testID="voice-recording-stop"
      hitSlop={4}
      disabled={busy && !error}
      onPress={() => {
        if (error) onRetry();
        else void session.finish();
      }}
      style={[styles.action, { opacity: busy && !error ? 0.45 : 1 }]}>
      {error ? (
        <UndoIcon size={18} color={theme.colors.primary} />
      ) : (
        <>
          {realtime ? <VoiceLevelRing history={history} processing={!recording} /> : null}
          <StopIcon size={16} color={theme.colors.primary} />
        </>
      )}
    </PressableScale>
  );
  return (
    <Animated.View
      entering={enter}
      exiting={exit}
      testID="voice-inline-panel"
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={[styles.recording, compact && styles.compactRecording]}>
      {!error ? (
        <>
          {recording && (
            <Text
              weight="regular"
              color={theme.colors.textMuted}
              style={[styles.elapsed, styles.timer, compact ? styles.compactTimer : {}]}
              accessibilityLabel={`${status} ${elapsed}`}>
              {elapsed}
            </Text>
          )}
          <View
            testID={`voice-visual-${state === 'starting' ? 'idle' : state}`}
            accessible={!recording}
            accessibilityLabel={!recording ? status : undefined}
            accessibilityLiveRegion={!recording ? 'polite' : undefined}
            style={[
              styles.pending,
              compact && styles.compactPending,
              realtime && styles.realtimePending,
            ]}>
            {realtime ? (
              // The transcript, or until the first words the status, each
              // fading in over the other: the field is never bare and never
              // cut from one to the other.
              <Animated.View
                key={partial ? 'words' : 'status'}
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                style={styles.realtimeField}>
                <LiveTranscript
                  text={partial || status}
                  onHeightChange={(textHeight) =>
                    onHeightChange?.(textHeight + REALTIME_TOP_INSET + REALTIME_BOTTOM_INSET)
                  }
                />
              </Animated.View>
            ) : (
              <VoiceRecordingWaveform history={history} processing={!recording} compact={compact} />
            )}
            {!realtime && !recording && !compact && !!partial && (
              <Text
                testID="voice-processing-status"
                weight="regular"
                style={styles.pendingLabel}
                numberOfLines={1}
                color={theme.colors.textMuted}
                accessibilityLiveRegion="polite">
                {partial}
              </Text>
            )}
            {!realtime &&
              recording &&
              !!partial &&
              (compact ? (
                <Text
                  testID="voice-live-transcript"
                  numberOfLines={1}
                  weight="regular"
                  color={theme.colors.text}
                  style={styles.pendingTranscript}>
                  {partial}
                </Text>
              ) : (
                <View style={styles.transcriptArea}>
                  <LiveTranscript text={partial} />
                </View>
              ))}
          </View>
          <View
            pointerEvents="box-none"
            style={[styles.pendingActions, compact && styles.compactPendingActions]}>
            {cancel}
            {stop}
          </View>
        </>
      ) : (
        <>
          {compact && cancel}
          <View style={styles.body}>
            <View style={styles.header}>
              <Text
                numberOfLines={1}
                weight="regular"
                style={styles.status}
                color={theme.colors.text}
                accessibilityLiveRegion="polite">
                {status}
              </Text>
            </View>
            <Animated.View entering={enter} testID="voice-visual-error" style={styles.readout}>
              {!compact && <UndoIcon size={18} color={theme.colors.danger} />}
              <ScrollView style={styles.readoutText} nestedScrollEnabled>
                <Text weight="regular" color={theme.colors.danger} style={styles.detail}>
                  {error}
                </Text>
              </ScrollView>
            </Animated.View>
          </View>
          {compact ? (
            stop
          ) : (
            <View style={styles.actions}>
              {cancel}
              {stop}
            </View>
          )}
        </>
      )}
    </Animated.View>
  );
}

/** One inline recorder, owned by the exact composer/context that started it. */
export function useVoiceInputTrigger({
  context,
  onText,
  disabled,
  onHeightChange,
}: {
  context?: string;
  onText: (text: string) => void;
  disabled: boolean;
  onHeightChange?: (height: number) => void;
}) {
  const focused = useIsFocused();
  const [owner] = useState(() => ({}));
  const enabled = useVoiceSettings((state) => state.config !== null);
  const request = useVoiceInput((state) => state.request);
  const read = useLatestReader({ onText, context, disabled, focused });
  useEffect(() => {
    if (Platform.OS !== 'web') void loadVoiceSettings();
  }, []);
  useEffect(() => () => clearVoiceInput(owner), [owner, context]);
  useEffect(() => {
    if (!focused || disabled || !enabled) clearVoiceInput(owner);
  }, [focused, disabled, enabled, owner]);
  const allowed = !!context && focused && !disabled && voiceRecorderAvailable() && enabled;
  const current =
    allowed && request?.owner === owner && request.context === context ? request : null;
  return {
    open:
      allowed && !request
        ? () => {
            if (!useVoiceSettings.getState().config) return;
            if (
              claimVoiceInput(owner, context, (text) => {
                const latest = read();
                if (latest.context === context && !latest.disabled && latest.focused)
                  latest.onText(text);
              })
            )
              Keyboard.dismiss();
          }
        : undefined,
    panel: current ? (
      <VoiceInputPanel
        onText={(text) => deliverVoiceInput(current, text)}
        onClose={() => clearVoiceInput(owner)}
        onHeightChange={onHeightChange}
      />
    ) : null,
  };
}

export function VoiceInputPanel({
  onText,
  onClose,
  onHeightChange,
}: {
  onText: (text: string) => void;
  onClose: () => void;
  onHeightChange?: (height: number) => void;
}) {
  const appLocale = useResolvedLocale();
  const [attempt, setAttempt] = useState(0);
  const [config] = useState(() => useVoiceSettings.getState().config);
  if (!config) return null;
  return (
    <VoiceRecording
      key={attempt}
      config={config}
      language={config.language ?? appLocale}
      onText={onText}
      onClose={onClose}
      onRetry={() => setAttempt((value) => value + 1)}
      onHeightChange={onHeightChange}
    />
  );
}

const styles = StyleSheet.create({
  recording: { flex: 1, paddingHorizontal: 12, paddingTop: 8, overflow: 'hidden' },
  compactRecording: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 0,
    paddingHorizontal: 2,
  },
  body: { flex: 1, minHeight: 0, minWidth: 0, alignSelf: 'stretch' },
  // Equal insets center the loading group in the original composer rectangle,
  // independently of the timer/header and the action buttons.
  pending: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
    gap: 8,
  },
  compactPending: { paddingHorizontal: 48, paddingVertical: 4, gap: 4 },
  // Realtime: the transcript takes the field, clear of the timer at the top
  // right and of the cancel and stop controls at either side.
  realtimePending: {
    paddingTop: REALTIME_TOP_INSET,
    paddingBottom: REALTIME_BOTTOM_INSET,
    alignItems: 'stretch',
  },
  realtimeField: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
  pendingLabel: {
    position: 'absolute',
    top: '50%',
    marginTop: 22,
    left: 48,
    right: 48,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  pendingTranscript: { fontSize: 12, lineHeight: 17, textAlign: 'center', flexShrink: 1 },
  pendingActions: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  compactPendingActions: { top: 0, left: 2, right: 2 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { fontSize: 14, lineHeight: 20, flex: 1 },
  elapsed: { fontSize: 12, fontVariant: ['tabular-nums'] },
  timer: { position: 'absolute', top: 8, right: 16 },
  compactTimer: { top: 0, right: 46, fontSize: 10 },
  transcriptArea: { alignSelf: 'stretch', height: 36, flexShrink: 1 },
  readout: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  readoutText: { flex: 1, maxHeight: '100%' },
  liveTranscript: { flex: 1, maxHeight: '100%' },
  liveText: { fontSize: 14, lineHeight: 20 },
  detail: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  action: {
    width: 44,
    minHeight: 44,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
});
