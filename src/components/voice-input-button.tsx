import { useLingui } from '@lingui/react/macro';
import { resolveFontStyle, useThemeTokens, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useIsFocused } from 'expo-router';
import { UndoIcon, StopIcon, CloseIcon } from '@/icons';
import { memo, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
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
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useResolvedLocale } from '@/i18n/provider';
import { useLatestReader } from '@/hooks/use-render-refs';
import { EASE_OUT, RISE_DISTANCE, fadeIn, fadeOut, timing } from '@/lib/motion';
import { VoiceInputError } from '@/lib/voice-input-session';
import { VoiceMeterHistory, VOICE_METER_SAMPLES } from '@/lib/voice-meter-history';
import {
  VoiceRecordingWaveform,
  VoiceTranscribingArc,
} from '@/components/voice-recording-waveform';
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
const WORD_ENTER_MS = 220;
const LIVE_WORD_LIMIT = 240;
const LIVE_LINE_HEIGHT = 20;
/** The subtitle grows to this many lines, then scrolls. */
const LIVE_MAX_LINES = 3;

/**
 * What a recording reports many times a second: the elapsed time and the
 * words so far. Held in a store rather than in `VoiceRecording`'s state, so a
 * clock tick or a new partial renders only the text that shows it -- not the
 * panel, its controls and its waveform around it.
 */
type RecordingReadout = StoreApi<{ seconds: number; partial: string }>;

function RecordingElapsed({
  readout,
  status,
  compact,
}: {
  readout: RecordingReadout;
  status: string;
  compact: boolean;
}) {
  const theme = useThemeTokens();
  const seconds = useStore(readout, (state) => state.seconds);
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <Text
      weight="regular"
      color={theme.colors.textMuted}
      style={[styles.elapsed, compact && styles.compactElapsed]}
      accessibilityLabel={`${status} ${elapsed}`}>
      {elapsed}
    </Text>
  );
}

function PartialText({
  readout,
  ...props
}: Omit<ComponentProps<typeof Text>, 'children'> & { readout: RecordingReadout }) {
  const partial = useStore(readout, (state) => state.partial);
  return <Text {...props}>{partial}</Text>;
}

/**
 * A word in the live transcript. It rises into place once, when it first
 * appears; words already on screen never move again, so the subtitle reads as
 * words arriving rather than the line being redrawn.
 */
const LiveWord = memo(function LiveWord({ word, face }: { word: string; face: TextStyle }) {
  return (
    <Animated.Text entering={wordEnter} style={[styles.liveText, face]}>
      {word}
    </Animated.Text>
  );
});

function wordEnter() {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: RISE_DISTANCE }] },
    animations: {
      opacity: withTiming(1, { duration: WORD_ENTER_MS, easing: EASE_OUT }),
      transform: [{ translateY: withTiming(0, { duration: WORD_ENTER_MS, easing: EASE_OUT }) }],
    },
  };
}

/**
 * Words for the subtitle: a CJK character (with any punctuation after it) on
 * its own, since those scripts wrap between characters, otherwise a word with
 * its trailing space, and a line break between the service's segments.
 */
const WORD =
  /\n|[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF][\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF1F]*|[^\s\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]+[^\S\n]*|[^\S\n]+/g;

function LiveTranscript({
  readout,
  fallback = '',
  onHeightChange,
}: {
  readout: RecordingReadout;
  /** Shown until the first words arrive. */
  fallback?: string;
  onHeightChange?: (height: number) => void;
}) {
  const partial = useStore(readout, (state) => state.partial);
  const theme = useThemeTokens();
  const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  // Only the newest words are laid out one by one; earlier ones have long
  // scrolled up out of the subtitle, and the full text lands in the composer.
  const words = partial.match(WORD) ?? [];
  // Each word is its own Animated.Text, outside the theme's Text, so it takes
  // the theme's face and colour here, as the fallback's Text does.
  const face = useMemo(
    () => ({
      ...resolveFontStyle(theme.fonts, theme.typeStyles.body.fontFamily, 'regular', {
        fontSize: styles.liveText.fontSize,
      }),
      color: theme.colors.text,
    }),
    [theme.fonts, theme.typeStyles.body.fontFamily, theme.colors.text]
  );
  const first = Math.max(0, words.length - LIVE_WORD_LIMIT);
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
      onContentSizeChange={(_, height) => {
        // A new line scrolls the subtitle up rather than cutting to it.
        if (following.current) scroll.current?.scrollToEnd({ animated: true });
        onHeightChange?.(Math.ceil(Math.min(height, LIVE_MAX_LINES * LIVE_LINE_HEIGHT)));
      }}>
      {partial ? (
        <View
          testID="voice-live-transcript"
          accessible
          accessibilityLabel={partial}
          style={styles.liveWords}>
          {words.slice(first).map((word, index) =>
            // Keyed by position and text: a word the service revises rises in
            // again, and the words before it stay where they are.
            word === '\n' ? (
              <View key={`${first + index}:break`} style={styles.liveBreak} />
            ) : (
              <LiveWord key={`${first + index}:${word}`} word={word} face={face} />
            )
          )}
        </View>
      ) : (
        <Text weight="regular" color={theme.colors.text} style={styles.liveText}>
          {fallback}
        </Text>
      )}
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
  const profile = useAppearanceProfile();
  const [state, setState] = useState<VoiceState>('starting');
  const [error, setError] = useState('');
  // A press on Stop starts the hand-over to transcribing at once, rather than
  // when the recorder reports it.
  const [finishing, setFinishing] = useState(false);
  const [readout] = useState<RecordingReadout>(() =>
    createStore(() => ({ seconds: 0, partial: '' }))
  );
  const hasPartial = useStore(readout, (current) => current.partial.length > 0);
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
          // Raw: the waveform slides and eases between samples on the UI thread.
          if (samples) history.set(samples);
          readout.setState({ seconds: Math.floor(duration) });
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
        (partial) => readout.setState({ partial }),
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
  const recording = !error && state === 'recording' && !finishing;
  const busy = state !== 'recording' || finishing;
  const transcribing = !error && (finishing || state === 'processing');
  const status = error
    ? t`Try again`
    : state === 'starting'
      ? t`Preparing microphone…`
      : transcribing
        ? t`Transcribing…`
        : t`Listening…`;
  // Realtime transcription shows its words as they come, so the field is the
  // transcript's and the level moves onto the stop control; after-recording
  // transcription has no words to show and keeps the full-width waveform.
  const realtime = config.mode === 'realtime';
  // The two controls take the profile's round-control corner, as Send beside
  // them does, so an angular theme does not get round recorder buttons.
  const actionShape = {
    borderRadius: profile.chrome.roundControl,
    borderCurve: 'continuous' as const,
  };
  // Stop waits out the starting and transcribing phases; it dims into that
  // wait and back rather than switching opacity between two frames. Into
  // transcribing, the square also cross-fades down under the turning arc.
  const stopDimmed = busy && !error;
  const stopDim = useSharedValue(stopDimmed ? 1 : 0);
  const stopAway = useSharedValue(transcribing ? 1 : 0);
  useEffect(() => {
    stopDim.set(withTiming(stopDimmed ? 1 : 0, timing('button')));
  }, [stopDimmed, stopDim]);
  useEffect(() => {
    stopAway.set(withTiming(transcribing ? 1 : 0, timing('short')));
  }, [transcribing, stopAway]);
  const stopDimStyle = useAnimatedStyle(() => ({ opacity: 1 - stopDim.get() * 0.55 }));
  const stopSquareStyle = useAnimatedStyle(() => ({
    opacity: 1 - stopAway.get() * 0.45,
    transform: [{ scale: reduced ? 1 : 1 - stopAway.get() * 0.25 }],
  }));
  const cancel = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t`Discard recording`}
      testID="voice-recording-cancel"
      hitSlop={4}
      onPress={() => {
        void session.cancel();
        onClose();
      }}
      style={[styles.action, actionShape]}>
      <CloseIcon size={18} color={theme.colors.textMuted} />
    </PressableScale>
  );
  const stop = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={error ? t`Try again` : t`Stop and transcribe`}
      accessibilityState={{ busy: stopDimmed, disabled: stopDimmed }}
      testID="voice-recording-stop"
      // One light tap through the app's haptics setting; the kit's default
      // selection tick on top of it made Stop buzz twice.
      feedback={error ? 'selection' : 'light'}
      hitSlop={4}
      disabled={stopDimmed}
      onPress={() => {
        if (error) {
          onRetry();
          return;
        }
        setFinishing(true);
        void session.finish();
      }}
      style={[styles.action, actionShape]}>
      {error ? (
        <Animated.View style={[styles.actionGlyph, stopDimStyle]}>
          <UndoIcon size={18} color={theme.colors.primary} />
        </Animated.View>
      ) : (
        <>
          <View pointerEvents="none" style={styles.actionGlyph}>
            <VoiceTranscribingArc processing={transcribing} />
          </View>
          <Animated.View style={[styles.actionGlyph, stopDimStyle]}>
            <Animated.View style={stopSquareStyle}>
              <StopIcon size={16} color={theme.colors.primary} />
            </Animated.View>
          </Animated.View>
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
            <Animated.View
              entering={fadeIn('micro')}
              exiting={fadeOut('micro')}
              style={[styles.timer, compact && styles.compactTimer]}>
              <RecordingElapsed readout={readout} status={status} compact={compact} />
            </Animated.View>
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
                key={hasPartial ? 'words' : 'status'}
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                style={styles.realtimeField}>
                <LiveTranscript
                  readout={readout}
                  fallback={status}
                  onHeightChange={(textHeight) =>
                    onHeightChange?.(textHeight + REALTIME_TOP_INSET + REALTIME_BOTTOM_INSET)
                  }
                />
              </Animated.View>
            ) : (
              <VoiceRecordingWaveform history={history} processing={!recording} compact={compact} />
            )}
            {!realtime && !recording && !compact && hasPartial && (
              <Animated.View
                entering={fadeIn('micro')}
                exiting={fadeOut('micro')}
                style={styles.pendingLabel}>
                <PartialText
                  readout={readout}
                  testID="voice-processing-status"
                  weight="regular"
                  style={styles.pendingLabelText}
                  numberOfLines={1}
                  color={theme.colors.textMuted}
                  accessibilityLiveRegion="polite"
                />
              </Animated.View>
            )}
            {!realtime &&
              recording &&
              hasPartial &&
              (compact ? (
                <PartialText
                  readout={readout}
                  testID="voice-live-transcript"
                  numberOfLines={1}
                  weight="regular"
                  color={theme.colors.text}
                  style={styles.pendingTranscript}
                />
              ) : (
                <View style={styles.transcriptArea}>
                  <LiveTranscript readout={readout} />
                </View>
              ))}
          </View>
          <View
            pointerEvents="box-none"
            style={[styles.pendingActions, compact && styles.compactPendingActions]}>
            {cancel}
            {realtime ? (
              // The transcript has the field, so the voice runs along the
              // bottom between the two controls.
              <View style={styles.realtimeMeter}>
                <VoiceRecordingWaveform history={history} processing={!recording} compact />
              </View>
            ) : null}
            {stop}
          </View>
        </>
      ) : (
        <>
          {compact && <Animated.View entering={enter}>{cancel}</Animated.View>}
          <Animated.View entering={enter} style={styles.body}>
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
            <View testID="voice-visual-error" style={styles.readout}>
              {!compact && <UndoIcon size={18} color={theme.colors.danger} />}
              <ScrollView style={styles.readoutText} nestedScrollEnabled>
                <Text weight="regular" color={theme.colors.danger} style={styles.detail}>
                  {error}
                </Text>
              </ScrollView>
            </View>
          </Animated.View>
          {compact ? (
            <Animated.View entering={enter}>{stop}</Animated.View>
          ) : (
            <Animated.View entering={enter} style={styles.actions}>
              {cancel}
              {stop}
            </Animated.View>
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
  },
  pendingLabelText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  pendingTranscript: { fontSize: 12, lineHeight: 17, textAlign: 'center', flexShrink: 1 },
  realtimeMeter: { flex: 1, height: 44, justifyContent: 'center', paddingHorizontal: 8 },
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
  compactTimer: { top: 0, right: 46 },
  compactElapsed: { fontSize: 10 },
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
  liveText: { fontSize: 14, lineHeight: LIVE_LINE_HEIGHT },
  liveWords: { flexDirection: 'row', flexWrap: 'wrap', alignContent: 'flex-start' },
  liveBreak: { width: '100%', height: 0 },
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
  actionGlyph: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
