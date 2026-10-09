import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useResolvedLocale } from '@/i18n/provider';
import { withAlpha } from '@/lib/color';
import { FontedTextInput } from '@/components/fonted-text-input';
import { useInterfaceFontFamily } from '@/hooks/use-user-fonts';
import {
  loadVoiceSettings,
  useVoiceSettings,
  type VoiceServiceConfig,
} from '@/stores/voice-settings';
import { SheetHandle } from '@/components/sheet-route-frame';
import { SheetFrame } from '@/components/sheet-ground';
import { DURATION, timing } from '@/lib/motion';
import { useVoiceInput, clearVoiceInput } from '@/stores/voice-input';
import { useRouter } from 'expo-router';
import { VoiceRecordingVisual } from '@/components/voice-recording-visual';
import { Check, RotateCcw, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { PressableScale } from '@/components/pressable-scale';
import { useLatestReader } from '@/hooks/use-render-refs';
import { VoiceInputError } from '@/lib/voice-input-session';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { VoiceInputSession, type VoiceState } from '@/lib/voice-input';

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
        (next) => {
          setState(next);
        },
        (value, duration) => {
          level.set(withTiming(value, timing('button')));
          setSeconds(Math.floor(duration));
        },
        (text) => {
          if (text.trim()) {
            setResult(text.trim());
          } else {
            setError(t`No speech detected. Please try again.`);
          }
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
        setPartial
      )
  );
  useEffect(() => {
    void session.start();
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'background') {
        session.cancel();
        latest().onClose();
      }
    });
    return () => {
      listener.remove();
      session.cancel();
    };
  }, [session, latest]);
  // Give the completed visual one transition before delivering the draft. A
  // cancelled/unmounted sheet must never insert a late transcript.
  useEffect(() => {
    if (result === null || error) return;
    const timeout = setTimeout(() => latest().onText(result), DURATION.long);
    return () => clearTimeout(timeout);
  }, [result, error, latest]);
  const visualState = error
    ? 'error'
    : result !== null
      ? 'success'
      : state === 'starting'
        ? 'idle'
        : state;
  const busy = state !== 'recording' || result !== null;
  return (
    <View style={styles.recording}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={
          error
            ? t`Try again`
            : result !== null
              ? t`Done`
              : state === 'starting'
                ? t`Preparing microphone…`
                : state === 'processing'
                  ? t`Transcribing…`
                  : t`Stop and transcribe`
        }
        accessibilityState={{
          busy: state === 'starting' || (state === 'processing' && !error && result === null),
        }}
        testID="voice-recording-stop"
        disabled={busy && !error}
        onPress={() => {
          if (error) onRetry();
          else void session.finish();
        }}
        style={styles.stage}>
        <VoiceRecordingVisual level={level} state={visualState} />
        <View pointerEvents="none" style={styles.visualReadout}>
          {error ? (
            <RotateCcw size={22} color={theme.colors.danger} strokeWidth={1.5} />
          ) : result !== null ? (
            <Check size={24} color={theme.colors.success} strokeWidth={1.5} />
          ) : (
            <>
              <Text color={theme.colors.textMuted} style={styles.elapsed}>
                {`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}
              </Text>
              <Text color={theme.colors.textSubtle} style={styles.limit}>
                / 2:00
              </Text>
            </>
          )}
        </View>
      </PressableScale>
      {config.mode === 'realtime' && !!partial && !error && (
        <LiveTranscript text={result ?? partial} />
      )}
      {!!error && (
        <Text
          accessibilityLiveRegion="polite"
          color={theme.colors.textMuted}
          style={styles.statusDetail}>
          {error}
        </Text>
      )}
      <Text color={theme.colors.textSubtle} style={styles.privacy}>
        {t`Audio is sent to your configured speech service`}
      </Text>
    </View>
  );
}

export function useVoiceInputTrigger({
  context,
  onText,
  disabled,
}: {
  context?: string;
  onText: (text: string) => void;
  disabled: boolean;
}) {
  const router = useRouter();
  const [owner] = useState(() => ({}));
  const enabled = useVoiceSettings((state) => state.config !== null);
  const read = useLatestReader(onText);
  useEffect(() => {
    if (Platform.OS !== 'web') void loadVoiceSettings();
  }, []);
  useEffect(() => () => clearVoiceInput(owner), [owner, context]);
  if (!context || disabled || !voiceRecorderAvailable() || !enabled) return undefined;
  return () => {
    if (!useVoiceSettings.getState().config || useVoiceInput.getState().request) return;
    Keyboard.dismiss();
    useVoiceInput.setState({ request: { owner, deliver: (text) => read()(text) } });
    router.push('/voice-input');
  };
}

export function VoiceInputPanel({
  onText,
  onClose,
}: {
  onText: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const appLocale = useResolvedLocale();
  const [attempt, setAttempt] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [config] = useState(() => useVoiceSettings.getState().config);
  const fontFamily = useInterfaceFontFamily() ?? undefined;
  if (!config) return null;
  const retry = () => {
    setTranscript(null);
    setAttempt((value) => value + 1);
  };
  return (
    <ScrollView
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      <SheetFrame overdrawBottom={40} frosted>
        <View style={styles.content}>
          <SheetHandle />
          <View style={styles.panelHeader}>
            <Text variant="label">{t`Voice to text`}</Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Cancel`}
              testID="voice-recording-cancel"
              onPress={onClose}
              style={styles.mic}>
              <X size={22} color={theme.colors.textMuted} />
            </PressableScale>
          </View>
          {transcript !== null ? (
            <View style={styles.review}>
              <Text variant="label">{t`Transcript`}</Text>
              <FontedTextInput
                accessibilityLabel={t`Transcript`}
                multiline
                scrollEnabled
                value={transcript}
                onChangeText={setTranscript}
                style={[
                  styles.transcript,
                  {
                    color: theme.colors.text,
                    backgroundColor: withAlpha(theme.colors.surface, 0.98),
                    fontFamily,
                  },
                ]}
                selectionColor={theme.colors.primary}
              />
              <View style={styles.reviewActions}>
                <PressableScale accessibilityRole="button" onPress={retry} style={styles.action}>
                  <Text color={theme.colors.text}>{t`Record again`}</Text>
                </PressableScale>
                <PressableScale
                  accessibilityRole="button"
                  disabled={!transcript.trim()}
                  onPress={() => {
                    onText(transcript.trim());
                    onClose();
                  }}
                  style={[
                    styles.action,
                    {
                      backgroundColor: theme.colors.primary,
                      opacity: transcript.trim() ? 1 : 0.45,
                    },
                  ]}>
                  <Text color={theme.colors.onPrimary}>{t`Use text`}</Text>
                </PressableScale>
              </View>
            </View>
          ) : (
            <VoiceRecording
              key={attempt}
              config={config}
              language={config.language ?? appLocale}
              onText={(text) => {
                if (config.autoInsert) {
                  onText(text);
                  onClose();
                } else {
                  setTranscript(text);
                }
              }}
              onClose={onClose}
              onRetry={retry}
            />
          )}
        </View>
      </SheetFrame>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  liveTranscript: { width: '100%', maxWidth: 560, maxHeight: 160 },
  liveText: { fontSize: 18, lineHeight: 28, textAlign: 'center', paddingVertical: 8 },
  mic: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { alignItems: 'center', paddingTop: 12, paddingBottom: 24 },
  panelHeader: {
    width: '100%',
    maxWidth: 640,
    paddingLeft: 24,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  review: { width: '100%', maxWidth: 640, paddingHorizontal: 20, paddingTop: 48, gap: 16 },
  transcript: {
    minHeight: 120,
    maxHeight: 200,
    borderRadius: 16,
    padding: 16,
    fontSize: 17,
    lineHeight: 25,
    textAlignVertical: 'top',
  },
  reviewActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 12 },
  action: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 18, minHeight: 44 },
  recording: {
    width: '100%',
    alignItems: 'center',
    gap: 20,
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  stage: { width: 280, height: 260, alignItems: 'center', justifyContent: 'center' },
  visualReadout: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  elapsed: { fontSize: 19, lineHeight: 25, fontVariant: ['tabular-nums'] },
  limit: { fontSize: 11, lineHeight: 15, fontVariant: ['tabular-nums'] },
  statusDetail: { textAlign: 'center' },
  privacy: { maxWidth: 320, textAlign: 'center' },
});
