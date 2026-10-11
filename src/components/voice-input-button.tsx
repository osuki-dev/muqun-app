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
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Text } from '@/components/text';
import { PressableScale } from '@/components/pressable-scale';
import { useResolvedLocale } from '@/i18n/provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { DURATION, fadeIn, timing } from '@/lib/motion';
import { VoiceInputError } from '@/lib/voice-input-session';
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
const BAR_WEIGHTS = [0.3, 0.55, 0.8, 0.45, 1, 0.7, 0.95, 0.6, 0.85, 0.4, 0.65, 0.35];

function MeterBar({
  level,
  weight,
  active,
}: {
  level: SharedValue<number>;
  weight: number;
  active: boolean;
}) {
  const theme = useThemeTokens();
  const reduced = useReducedMotion();
  const motion = useAnimatedStyle(() => ({
    transform: [
      {
        scaleY:
          active && !reduced
            ? 0.15 + Math.sqrt(Math.max(0, Math.min(1, level.get()))) * weight * 0.85
            : 0.25,
      },
    ],
  }));
  return (
    <Animated.View style={[styles.meterBar, { backgroundColor: theme.colors.primary }, motion]} />
  );
}

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
      <Text testID="voice-live-transcript" color={theme.colors.text} style={styles.liveText}>
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
  const level = useSharedValue(0);
  const latest = useLatestReader({ onText, onClose });
  const [session] = useState(
    () =>
      new VoiceInputSession(
        config,
        language,
        setState,
        (value, duration) => {
          level.set(withTiming(value, timing('button')));
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
  const busy = state !== 'recording' || result !== null;
  return (
    <Animated.View entering={enter} testID="voice-inline-panel" style={styles.recording}>
      <View style={styles.header}>
        <Text style={styles.status} color={theme.colors.text} accessibilityLiveRegion="polite">
          {status}
        </Text>
        <Text
          color={theme.colors.textMuted}
          style={
            styles.elapsed
          }>{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 2:00`}</Text>
      </View>
      <Animated.View
        key={visualState}
        entering={enter}
        testID={`voice-visual-${visualState}`}
        style={styles.readout}>
        {error ? (
          <RotateCcw size={22} color={theme.colors.danger} />
        ) : result !== null ? (
          <Animated.View entering={enter}>
            <Check size={24} color={theme.colors.success} />
          </Animated.View>
        ) : state === 'processing' || state === 'starting' ? (
          reduced ? (
            <Text color={theme.colors.textMuted}>···</Text>
          ) : (
            <Spinner size="sm" color={theme.colors.primary} />
          )
        ) : (
          <View testID="voice-recording-meter" style={styles.meter}>
            {BAR_WEIGHTS.map((weight, index) => (
              <MeterBar key={index} weight={weight} level={level} active={state === 'recording'} />
            ))}
          </View>
        )}
        <View style={styles.readoutText}>
          {error ? (
            <Text color={theme.colors.danger} style={styles.detail}>
              {error}
            </Text>
          ) : result || partial ? (
            <LiveTranscript text={result ?? partial} />
          ) : (
            <Text
              color={theme.colors.textMuted}
              style={styles.detail}>{t`Audio is sent to your configured speech service`}</Text>
          )}
        </View>
      </Animated.View>
      <View style={styles.actions}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Cancel`}
          testID="voice-recording-cancel"
          onPress={() => {
            void session.cancel();
            onClose();
          }}
          style={styles.action}>
          <X size={18} color={theme.colors.textMuted} />
          <Text color={theme.colors.textMuted}>{t`Cancel`}</Text>
        </PressableScale>
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
          style={[styles.action, { opacity: busy && !error ? 0.45 : 1 }]}>
          {error ? (
            <RotateCcw size={18} color={theme.colors.primary} />
          ) : (
            <Square size={16} color={theme.colors.primary} />
          )}
          <Text color={theme.colors.primary}>{error ? t`Try again` : t`Stop and transcribe`}</Text>
        </PressableScale>
      </View>
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
  recording: { width: '100%', paddingHorizontal: 12, paddingTop: 10, minHeight: 118, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  status: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
  elapsed: { fontSize: 12, fontVariant: ['tabular-nums'] },
  readout: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 38 },
  readoutText: { flex: 1 },
  liveTranscript: { maxHeight: 68 },
  liveText: { fontSize: 15, lineHeight: 22 },
  detail: { fontSize: 13, lineHeight: 19 },
  meter: { height: 32, flexDirection: 'row', alignItems: 'center', gap: 3 },
  meterBar: { width: 3, height: 30, borderRadius: 2 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  action: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
});
