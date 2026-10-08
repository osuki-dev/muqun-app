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
import { timing } from '@/lib/motion';
import { useVoiceInput, clearVoiceInput } from '@/stores/voice-input';
import { useRouter } from 'expo-router';
import { VoiceRecordingVisual } from '@/components/voice-recording-visual';
import { MicOff, Square, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AppState, Keyboard, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSharedValue, withTiming } from 'react-native-reanimated';
import { PressableScale } from '@/components/pressable-scale';
import { useLatestReader } from '@/hooks/use-render-refs';
import { VoiceInputError } from '@/lib/voice-input-session';
import { voiceRecorderAvailable } from '@/lib/voice-recorder-capability';
import { VoiceInputSession, type VoiceState } from '@/lib/voice-input';

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
            latest().onText(text.trim());
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
                  : t`Transcription failed. Check your speech service and try again.`
              : t`Recording failed.`
          )
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
  const busy = state !== 'recording';
  return (
    <View style={styles.recording}>
      <View style={styles.stage}>
        {error ? (
          <View style={[styles.errorIcon, { backgroundColor: theme.colors.surface }]}>
            <MicOff size={32} color={theme.colors.textMuted} />
          </View>
        ) : (
          <VoiceRecordingVisual level={level} processing={state !== 'recording'} />
        )}
      </View>
      <View style={styles.status}>
        <Text variant="label" color={theme.colors.text}>
          {error
            ? t`Try again`
            : state === 'starting'
              ? t`Preparing microphone…`
              : state === 'processing'
                ? t`Transcribing…`
                : t`Listening…`}
        </Text>
        <Text color={theme.colors.textMuted} style={styles.statusDetail}>
          {error || `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} / 2:00`}
        </Text>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={error ? t`Try again` : t`Stop and transcribe`}
        testID="voice-recording-stop"
        disabled={busy && !error}
        onPress={() => {
          if (error) onRetry();
          else void session.finish();
        }}
        style={[
          styles.recordingAction,
          { backgroundColor: theme.colors.primary, opacity: busy && !error ? 0.45 : 1 },
        ]}>
        {!error && (
          <Square size={14} fill={theme.colors.onPrimary} color={theme.colors.onPrimary} />
        )}
        <Text color={theme.colors.onPrimary}>{error ? t`Try again` : t`Stop and transcribe`}</Text>
      </PressableScale>
      <Text color={theme.colors.textMuted} style={styles.privacy}>
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
  stage: { width: 280, height: 196, alignItems: 'center', justifyContent: 'center' },
  errorIcon: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingAction: {
    minWidth: 220,
    minHeight: 48,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  status: { alignItems: 'center', gap: 8 },
  statusDetail: { textAlign: 'center' },
  privacy: { maxWidth: 320, textAlign: 'center' },
});
