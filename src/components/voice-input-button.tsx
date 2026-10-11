import { useLingui } from '@lingui/react/macro';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { useIsFocused } from 'expo-router';
import { Check, RotateCcw, Square, X } from 'lucide-react-native';
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
} from 'react-native';
import Animated, { useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { useResolvedLocale } from '@/i18n/provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { DURATION, fadeIn, fadeOut, timing } from '@/lib/motion';
import { VoiceInputError } from '@/lib/voice-input-session';
import { VoiceMeterHistory, VOICE_METER_SAMPLES } from '@/lib/voice-meter-history';
import { VoiceRecordingWaveform } from '@/components/voice-recording-waveform';
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
function LiveTranscript({ text }: { text: string }) {
  const theme = useThemeTokens();
  const scroll = useRef<ScrollView>(null);
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
        style={styles.liveText}>
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
}: {
  config: VoiceServiceConfig;
  language: string;
  onText: (text: string) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const [state, setState] = useState<VoiceState>('starting');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [partial, setPartial] = useState('');
  const { fontScale } = useWindowDimensions();
  const [height, setHeight] = useState(0);
  const compact = height < 96 * fontScale;
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
          if (text.trim()) setResult(text.trim());
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
        { appState: () => AppState.currentState, onBackground: () => latest().onClose() }
      )
  );
  useEffect(() => {
    session.setAppState(AppState.currentState);
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
  // The confirmation belongs to this recording attempt. Unmounting/cancelling
  // clears it, and the owner also checks identity before touching the draft.
  useEffect(() => {
    if (result === null || error) return;
    const timeout = setTimeout(() => latest().onText(result), reduced ? 0 : DURATION.long);
    return () => clearTimeout(timeout);
  }, [result, error, latest, reduced]);
  const status = error
    ? t`Try again`
    : result !== null
      ? t`Done`
      : state === 'starting'
        ? t`Preparing microphone…`
        : state === 'processing'
          ? t`Transcribing…`
          : t`Listening…`;
  const visualState = error
    ? 'error'
    : result !== null
      ? 'success'
      : state === 'starting'
        ? 'idle'
        : state;
  const recording = visualState === 'recording';
  const pending = !error && result === null && !recording;
  const busy = state !== 'recording' || result !== null;
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const indicator = error ? (
    <RotateCcw size={18} color={theme.colors.danger} />
  ) : result !== null ? (
    <Check size={20} color={theme.colors.success} />
  ) : state === 'processing' || state === 'starting' ? (
    reduced ? (
      <Text color={theme.colors.textMuted}>···</Text>
    ) : (
      <Spinner size="sm" color={theme.colors.primary} />
    )
  ) : null;
  const cancel = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Cancel`}
      testID="voice-recording-cancel"
      onPress={() => {
        void session.cancel();
        onClose();
      }}
      style={[styles.action, compact && styles.iconAction]}>
      <X size={18} color={theme.colors.textMuted} />
      {!compact && <Text weight="regular" color={theme.colors.textMuted}>{t`Cancel`}</Text>}
    </PressableScale>
  );
  const stop = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={error ? t`Try again` : t`Stop and transcribe`}
      accessibilityState={{ busy: busy && !error && result === null }}
      testID="voice-recording-stop"
      disabled={busy && !error}
      onPress={() => {
        if (error) onRetry();
        else void session.finish();
      }}
      style={[styles.action, compact && styles.iconAction, { opacity: busy && !error ? 0.45 : 1 }]}>
      {error ? (
        <RotateCcw size={18} color={theme.colors.primary} />
      ) : (
        <Square size={16} color={theme.colors.primary} />
      )}
      {!compact && (
        <Text weight="regular" color={theme.colors.primary}>
          {error ? t`Try again` : t`Stop and transcribe`}
        </Text>
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
      {pending ? (
        <>
          <Animated.View
            key={visualState}
            entering={enter}
            testID={`voice-visual-${visualState}`}
            style={[styles.pending, compact && styles.compactPending]}>
            <View testID="voice-processing-status" style={styles.pendingStatus}>
              {indicator}
              <Text
                weight="regular"
                style={styles.pendingLabel}
                color={theme.colors.text}
                accessibilityLiveRegion="polite">
                {status}
              </Text>
            </View>
            {!!partial && (
              <Text
                testID="voice-live-transcript"
                numberOfLines={compact ? 1 : 2}
                weight="regular"
                color={theme.colors.textMuted}
                style={styles.pendingTranscript}>
                {partial}
              </Text>
            )}
          </Animated.View>
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
          <View style={[styles.body, recording && compact && styles.compactRecordingBody]}>
            <View style={[styles.header, recording && styles.recordingHeader]}>
              {compact && indicator}
              {!recording && (
                <Text
                  numberOfLines={1}
                  weight="regular"
                  style={styles.status}
                  color={theme.colors.text}
                  accessibilityLiveRegion="polite">
                  {status}
                </Text>
              )}
              <Text
                weight="regular"
                color={theme.colors.textMuted}
                style={styles.elapsed}
                accessibilityLabel={recording ? `${status} ${elapsed}` : undefined}>
                {elapsed}
              </Text>
            </View>
            <Animated.View
              key={visualState}
              entering={enter}
              testID={`voice-visual-${visualState}`}
              style={styles.readout}>
              {!compact && indicator}
              {error ? (
                <ScrollView style={styles.readoutText} nestedScrollEnabled>
                  <Text weight="regular" color={theme.colors.danger} style={styles.detail}>
                    {error}
                  </Text>
                </ScrollView>
              ) : (
                <>
                  {state === 'recording' && result === null && (
                    <VoiceRecordingWaveform history={history} />
                  )}
                  {!!(result || partial) && <LiveTranscript text={result ?? partial} />}
                </>
              )}
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
}: {
  context?: string;
  onText: (text: string) => void;
  disabled: boolean;
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
      />
    ) : null,
  };
}

export function VoiceInputPanel({
  onText,
  onClose,
}: {
  onText: (text: string) => void;
  onClose: () => void;
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
  compactRecordingBody: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Equal insets center the loading group in the original composer rectangle,
  // independently of the timer/header and the different action-label widths.
  pending: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 40,
    gap: 8,
  },
  compactPending: { paddingHorizontal: 48, paddingVertical: 4, gap: 4 },
  pendingStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pendingLabel: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
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
  recordingHeader: { justifyContent: 'flex-end' },
  status: { fontSize: 14, lineHeight: 20, flex: 1 },
  elapsed: { fontSize: 12, fontVariant: ['tabular-nums'] },
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
    minHeight: 40,
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  iconAction: { width: 40, justifyContent: 'center' },
});
