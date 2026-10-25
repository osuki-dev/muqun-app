import type { HomeComposerOutset } from '@/theme/home-composer-outset';
import { useVoiceInputTrigger } from '@/components/voice-input-button';
import { useLingui } from '@lingui/react/macro';
import { useLatestReader } from '@/hooks/use-render-refs';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Spinner, useThemeTokens, type TextFieldProps } from '@osuki-dev/ui';
import { ComposerTextInput } from '@/components/composer-text-input';
import { PressableScale } from '@/components/pressable-scale';
import { MicrophoneIcon, MessageSendIcon } from '@/icons';
import { Canvas, Group, Path, Skia } from 'react-native-skia';
import { scheduleOnRN } from 'react-native-worklets';
import { useEffect, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import {
  StyleSheet,
  View,
  useWindowDimensions,
  type TextInputInstance,
  type TextStyle,
} from 'react-native';
import { flattenStyle } from '@/lib/flatten-style';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { ThemeIcon } from '@/components/theme-icon';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { timing } from '@/lib/motion';
import { composerLongPress } from '@/lib/composer-long-press';

/**
 * The line field at the bottom of a terminal: the app's only raw `TextInput`,
 * with the button that sends what is in it.
 *
 * It began life inline on the gateway screen, and the two things that make it
 * a terminal composer rather than a chat box are still all it knows: the
 * field is monospaced and multiline, and Send is a button rather than the
 * return key, so a line can be pasted or shaped before it is run. Everything
 * else the gateway hangs on it -- the paperclip, the slash popup, the mention
 * picker -- comes in through `leading` and `inputProps`, so the same field
 * serves an SSH shell that has none of those.
 *
 * The colours are the theme's, resolved here rather than passed in: every
 * other field in the app is an `<Input>` that reads the same tokens, and one
 * place turning them into a fill and a placeholder tint is what keeps this
 * one from drifting away from the rest.
 */

type AnimatedViewProps = ComponentProps<typeof Animated.View>;
const VOICE_HOLD_MS = 500;
const COMPOSER_ACTION_SIZE = 44;
/** The recorder's field height: at least the room for its controls, at most five lines. */
const clampVoiceHeight = (height: number) => Math.min(190, Math.max(96, height));
const voiceHoldCenter = COMPOSER_ACTION_SIZE / 2;
const voiceHoldRing = Skia.PathBuilder.Make()
  .addCircle(voiceHoldCenter, voiceHoldCenter, 17)
  .detach();

export interface TerminalComposerSend {
  accessibilityLabel: string;
  /** There is something to send, and somewhere to send it. */
  armed: boolean;
  sending: boolean;
  disabled: boolean;
  onPress: () => void;
  /** Defaults to `composer-send`; a second composer on screen names its own. */
  testID?: string;
}

export interface TerminalComposerProps {
  voiceContext?: string;
  /** A control in front of the field: the gateway's paperclip. */
  leading?: ReactNode;
  /** Noninteractive artwork; clipped by the field and hidden during dictation. */
  fieldBackground?: ReactNode;
  /** Persistent context above the draft, inside the same input surface. */
  fieldHeader?: ReactNode;
  /** An already resolved fill for a field without an enclosing material plate. */
  fieldBackgroundColor?: string;
  /** Optional bounded artwork overflow; the field and its controls remain clipped. */
  fieldBackgroundOutset?: HomeComposerOutset;
  /** Noninteractive Home artwork allowed to extend above the clipped field. */
  fieldDecoration?: ReactNode;
  /** Moves tall-field text down by borrowing its bottom padding, not adding height. */
  fieldTextTopInset?: number;
  /**
   * A `boxShadow` cast by the field's plate, for a field that is the dock's
   * only painted surface (Home). Drawn on a transparent layer behind the
   * shell rather than on the shell itself, which clips to its shape -- and
   * Android clips an outset shadow with it. A box shadow paints only outside
   * its box, so a translucent, pack-tinted plate shows none of it through.
   */
  fieldShadow?: string;
  onVoiceActiveChange?: (active: boolean) => void;
  inputRef?: Ref<TextInputInstance>;
  /** The field's own props: value, placeholder, editability, test id. */
  inputProps: TextFieldProps;
  send: TerminalComposerSend;
  /** Home's field sits on the keyboard, so only its top corners stay rounded. */
  squareBottom?: boolean;
  /** A bar is joined to the field's top (Home's reply bar): only its bottom corners round. */
  squareTop?: boolean;
  entering?: AnimatedViewProps['entering'];
  exiting?: AnimatedViewProps['exiting'];
  layout?: AnimatedViewProps['layout'];
  /** Home's bar: the field box at its one-line height, no padding around it. */
  compact?: boolean;
  /** How many lines the field is tall while empty; it grows from there to its max. */
  minLines?: number;
  /** The draft as nested spans in the native field. */
  spans?: ReactNode;
}

export function TerminalComposer({
  voiceContext,
  leading,
  fieldBackground,
  fieldHeader,
  fieldBackgroundColor,
  fieldBackgroundOutset,
  fieldDecoration,
  fieldTextTopInset = 0,
  fieldShadow,
  onVoiceActiveChange,
  inputRef,
  inputProps,
  send,
  entering,
  exiting,
  layout,
  compact = false,
  minLines,
  spans,
  squareBottom = false,
  squareTop = false,
}: TerminalComposerProps) {
  const readInput = useLatestReader(inputProps);
  const { t } = useLingui();
  const [voiceHeight, setVoiceHeight] = useState(0);
  const voice = useVoiceInputTrigger({
    context: voiceContext,
    // Clamped here rather than only where it is drawn: the transcript reports
    // its height on every layout, and past the cap a new line must not render
    // the composer again for a height it will not use.
    onHeightChange: (height) => setVoiceHeight(clampVoiceHeight(height)),
    disabled: send.sending || inputProps.editable === false,
    onText: (transcript) => {
      const current = readInput();
      const value = current.value ?? '';
      current.onChangeText?.(value + (value && !/\s$/.test(value) ? ' ' : '') + transcript);
    },
  });
  const voiceActive = voice.panel !== null;
  useEffect(() => {
    onVoiceActiveChange?.(voiceActive);
    if (!voiceActive) setVoiceHeight(0);
  }, [voiceActive, onVoiceActiveChange]);
  // The draft and the recorder cross-fade over the same beat in both
  // directions: the draft used to vanish on the frame the recorder started
  // fading in, which flashed an empty field between the two.
  const contentReveal = useSharedValue(1);
  useEffect(() => {
    contentReveal.set(withTiming(voiceActive ? 0 : 1, timing('short')));
  }, [voiceActive, contentReveal]);
  const contentRevealStyle = useAnimatedStyle(() => ({ opacity: contentReveal.get() }));
  const profile = useAppearanceProfile();
  const cornerRadius = profile.chrome.composerField;
  // The top corners ease between round and square as a header joins the field
  // or leaves it, over the beat the header itself fades in: never a jump.
  // Reduce motion keeps it, since a corner easing is not travel.
  const topRound = useSharedValue(squareTop ? 0 : 1);
  useEffect(() => {
    topRound.set(
      withTiming(squareTop ? 0 : 1, timing('short', { reduceMotion: ReduceMotion.Never }))
    );
  }, [squareTop, topRound]);
  const topRadiusStyle = useAnimatedStyle(() => {
    const radius = cornerRadius * topRound.get();
    return { borderTopLeftRadius: radius, borderTopRightRadius: radius };
  });
  const fieldRadius =
    squareBottom && !squareTop
      ? {
          borderTopLeftRadius: profile.chrome.composerField,
          borderTopRightRadius: profile.chrome.composerField,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: 0,
          borderCurve: 'continuous' as const,
        }
      : [{ borderRadius: cornerRadius, borderCurve: 'continuous' as const }, topRadiusStyle];
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  // The monospace slot is this component's *default*, not its rule, because
  // this component is two fields.
  //
  // Typed into the terminal it is a shell line: a literal, where alignment is
  // part of what it says, and mono is the only right answer. Mounted by the
  // agent composer it is a sentence addressed to a person-shaped thing, with a
  // placeholder that reads "Send a message, type / for commands, $ for
  // skills, @ for files..." -- prose, and the owner's report was precisely
  // that it was not in the face they chose. So the agent composer passes the
  // interface family through `inputProps.style`, which is layered after this
  // and wins.
  //
  // Either way it has to be resolved here and not in `composerStyles` below.
  // A `StyleSheet` is built once at module load, long before the settings
  // store has been hydrated, so the family it baked in was the system face and
  // stayed the system face for the life of the process. A reader who had
  // installed their own mono watched every other mono surface in the app
  // change and this one -- the field they type into -- keep the platform's.
  const mono = useMonoFontFamily();
  const chromeText = theme.colors.text;
  const chromeGlassQuiet = withAlpha(theme.colors.text, appChrome.opacity.chromeControlQuiet);
  // Every other field is <Input>, which reads this token itself. Resolving it
  // here rather than naming a colour is what keeps the two from drifting apart.
  const placeholderText = theme.colors[theme.components.Input.placeholder];
  const fieldFont = { color: chromeText, fontFamily: mono };
  const { fontScale } = useWindowDimensions();
  const [wrapped, setWrapped] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const hasText = Boolean(inputProps.value ?? inputProps.defaultValue);
  // A field set taller than one line is laid out expanded from the start --
  // the text full width, the controls in the row beneath -- so a draft that
  // wraps changes nothing.
  const expanded = (minLines ?? 1) > 1 || (hasText && wrapped);
  useEffect(() => {
    if (!hasText) setWrapped(false);
  }, [hasText]);
  const inputStyle = flattenStyle<TextStyle>([composerStyles.input, inputProps.style]) ?? {};
  const lineHeight = inputStyle.lineHeight ?? 19;
  const topPadding = inputStyle.paddingTop ?? inputStyle.paddingVertical;
  const bottomPadding = inputStyle.paddingBottom ?? inputStyle.paddingVertical;
  const verticalPadding =
    (typeof topPadding === 'number' ? topPadding : 10) +
    (typeof bottomPadding === 'number' ? bottomPadding : 10);
  const textInset =
    (minLines ?? 1) > 1
      ? Math.max(
          0,
          Math.min(fieldTextTopInset, typeof bottomPadding === 'number' ? bottomPadding : 10)
        )
      : 0;
  // The native field can retain its single-line intrinsic size when the
  // action row moves below it. Size it from content events in both layouts.
  const minimumInputHeight = Math.max(
    40,
    (minLines ?? 1) * lineHeight * fontScale + verticalPadding
  );
  const maximumInputHeight = Math.max(126, minimumInputHeight);
  const measuredInputHeight = Math.min(
    maximumInputHeight,
    Math.max(minimumInputHeight, hasText ? contentHeight : 0)
  );
  const outsideBackground = !voiceActive && fieldBackground && fieldBackgroundOutset;
  const backgroundColor = fieldBackgroundColor ?? surfaceBackground(chromeGlassQuiet);
  const controls = (
    <>
      <ComposerSendButton
        accessibilityLabel={send.accessibilityLabel}
        armed={send.armed}
        sending={send.sending}
        disabled={send.disabled}
        onPress={send.onPress}
        testID={send.testID}
        onLongPress={voice.open}
        longPressLabel={t`Voice to text`}
        restText={theme.colors.textMuted}
        activeText={theme.colors.primary}
      />
    </>
  );

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      layout={layout}
      // A joined bar and the field are one plate: the field is drawn one
      // physical pixel over the bar's bottom edge, so a fractional boundary
      // (layout rounding, a layout animation mid-flight) cannot open a
      // hairline gap that shows the art behind the dock.
      style={[composerStyles.fieldOuter, squareTop && composerStyles.joinedTop]}>
      {fieldShadow ? (
        <Animated.View
          testID="composer-field-shadow"
          pointerEvents="none"
          accessible={false}
          style={[StyleSheet.absoluteFill, fieldRadius, { boxShadow: fieldShadow }]}
        />
      ) : null}
      {outsideBackground ? (
        <>
          <Animated.View
            pointerEvents="none"
            accessible={false}
            style={[StyleSheet.absoluteFill, { backgroundColor }, fieldRadius]}
          />
          <View
            testID="composer-field-background-outset"
            pointerEvents="none"
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              position: 'absolute',
              top: 0,
              left: -outsideBackground.left,
              right: -outsideBackground.right,
              bottom: -outsideBackground.bottom,
              overflow: 'hidden',
            }}>
            {fieldBackground}
          </View>
        </>
      ) : null}
      <Animated.View
        testID="composer-field-shell"
        style={[
          composerStyles.fieldShell,
          fieldRadius,
          { backgroundColor: outsideBackground ? 'transparent' : backgroundColor },
          voiceActive && { minHeight: clampVoiceHeight(voiceHeight) },
        ]}>
        {!voiceActive && !outsideBackground ? fieldBackground : null}
        {fieldHeader}
        {/* Keep the draft mounted so recording inherits this exact field height. */}
        <Animated.View
          pointerEvents={voiceActive ? 'none' : 'auto'}
          accessibilityElementsHidden={voiceActive}
          importantForAccessibility={voiceActive ? 'no-hide-descendants' : 'auto'}
          style={[
            composerStyles.composer,
            contentRevealStyle,
            compact && composerStyles.compactComposer,
            expanded && composerStyles.expandedComposer,
          ]}>
          <>
            {!expanded && leading}
            <ComposerTextInput
              inputRef={inputRef}
              multiline
              autoCorrect={false}
              placeholderTextColor={placeholderText}
              selectionColor={theme.colors.primary}
              {...inputProps}
              textBreakStrategy={inputProps.textBreakStrategy ?? 'simple'}
              onContentSizeChange={(event) => {
                setContentHeight(Math.ceil(event.nativeEvent.contentSize.height));
                // Keep the expanded layout until the draft clears. Collapsing as soon
                // as wider text fits would oscillate between the two widths.
                if (
                  hasText &&
                  event.nativeEvent.contentSize.height >
                    lineHeight * fontScale * 1.5 + verticalPadding
                )
                  setWrapped(true);
                inputProps.onContentSizeChange?.(event);
              }}
              // The family sits ahead of `inputProps.style` so a caller may still
              // override it -- the agent composer does, with the interface face.
              style={[
                composerStyles.input,
                !leading && composerStyles.inputWithoutLeading,
                fieldFont,
                inputProps.style,
                textInset > 0 && {
                  paddingTop: (typeof topPadding === 'number' ? topPadding : 10) + textInset,
                  paddingBottom:
                    (typeof bottomPadding === 'number' ? bottomPadding : 10) - textInset,
                },
                expanded && composerStyles.expandedInput,
                {
                  // Android measures multiline text natively. A fixed height fed
                  // back from content-size events can lag behind native wrapping.
                  height: process.env.EXPO_OS === 'android' ? undefined : measuredInputHeight,
                  minHeight: minimumInputHeight,
                  maxHeight: maximumInputHeight,
                },
              ]}>
              {spans}
            </ComposerTextInput>
            <View
              testID={expanded ? 'composer-expanded-actions' : undefined}
              style={expanded ? composerStyles.expandedActions : composerStyles.compactActions}>
              {expanded && <View style={composerStyles.expandedLeading}>{leading}</View>}
              {controls}
            </View>
          </>
        </Animated.View>
        {voice.panel && (
          <View collapsable={false} style={StyleSheet.absoluteFill}>
            {voice.panel}
          </View>
        )}
      </Animated.View>
      {!voiceActive && fieldDecoration ? (
        <View
          testID="composer-field-decoration"
          pointerEvents="none"
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}>
          {fieldDecoration}
        </View>
      ) : null}
    </Animated.View>
  );
}

/**
 * Send stays transparent like the other composer actions; the theme's primary
 * ink carries its armed state. Generic primary-button artwork belongs to filled
 * buttons, not this glyph control. The glyph and the spinner
 * cross-fade rather than swap, because a spinner appearing exactly where an
 * arrow was, on the same frame, reads as the arrow having broken.
 */
export function ComposerSendButton({
  accessibilityLabel,
  armed,
  sending,
  disabled,
  onPress,
  onLongPress,
  longPressLabel,
  restText,
  activeText,
  testID = 'composer-send',
}: {
  accessibilityLabel: string;
  /** There is something to send, and somewhere to send it. */
  armed: boolean;
  sending: boolean;
  disabled: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  longPressLabel?: string;
  restText: string;
  activeText: string;
  testID?: string;
}) {
  const profile = useAppearanceProfile();
  const armedValue = useSharedValue(armed ? 1 : 0);
  const sendingValue = useSharedValue(sending ? 1 : 0);
  const voiceHold = useSharedValue(0);
  const readLongPress = useLatestReader(onLongPress);
  const [handleLongPress] = useState(() => composerLongPress(readLongPress));
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!onLongPress) voiceHold.set(0);
  }, [onLongPress, voiceHold]);
  useEffect(() => {
    armedValue.set(withTiming(armed ? 1 : 0, timing('button')));
  }, [armed, armedValue]);
  // The spinner exists only while a send is in flight and while it fades out.
  // An indeterminate spinner left mounted at opacity 0 still animates on the
  // render thread every vsync, which was most of what an idle Home cost.
  const [spinnerMounted, setSpinnerMounted] = useState(sending);
  if (sending && !spinnerMounted) setSpinnerMounted(true);
  useEffect(() => {
    sendingValue.set(
      withTiming(sending ? 1 : 0, timing('button'), (finished) => {
        if (finished && !sending) scheduleOnRN(setSpinnerMounted, false);
      })
    );
  }, [sending, sendingValue]);

  const restGlyphStyle = useAnimatedStyle(() => ({
    opacity: (1 - armedValue.get()) * (1 - sendingValue.get()) * (1 - voiceHold.get()),
  }));
  const armedGlyphStyle = useAnimatedStyle(() => ({
    opacity: armedValue.get() * (1 - sendingValue.get()) * (1 - voiceHold.get()),
  }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: sendingValue.get() }));
  const micStyle = useAnimatedStyle(() => ({
    opacity: voiceHold.get(),
    transform: [{ scale: 0.85 + voiceHold.get() * 0.15 }],
  }));

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled && !onLongPress, busy: sending }}
      testID={testID}
      accessibilityActions={
        onLongPress ? [{ name: 'longpress', label: longPressLabel }] : undefined
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress?.();
      }}
      disabled={disabled && !onLongPress}
      onPress={disabled ? undefined : onPress}
      onLongPress={handleLongPress}
      delayLongPress={VOICE_HOLD_MS}
      onPressIn={() => {
        if (!onLongPress) return;
        voiceHold.set(
          reduced
            ? 1
            : withDelay(
                100,
                withTiming(1, { duration: VOICE_HOLD_MS - 100, easing: Easing.linear })
              )
        );
      }}
      onPressOut={() => {
        voiceHold.set(reduced ? 0 : withTiming(0, timing('micro')));
      }}
      style={[
        composerStyles.button,
        { borderRadius: profile.chrome.roundControl },
        disabled && !onLongPress && !sending && composerStyles.disabledButton,
      ]}>
      <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, restGlyphStyle]}>
        <ThemeIcon name="chrome.send" fallback={MessageSendIcon} size={18} color={restText} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, armedGlyphStyle]}>
        <ThemeIcon name="chrome.send" fallback={MessageSendIcon} size={18} color={activeText} />
      </Animated.View>
      {onLongPress && (
        <>
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, micStyle]}>
            <MicrophoneIcon size={18} color={activeText} />
          </Animated.View>
          <Canvas pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Group
              origin={{ x: voiceHoldCenter, y: voiceHoldCenter }}
              transform={[{ rotate: -Math.PI / 2 }]}>
              <Path
                path={voiceHoldRing}
                color={activeText}
                style="stroke"
                strokeWidth={1.5}
                strokeCap="round"
                end={voiceHold}
              />
            </Group>
          </Canvas>
        </>
      )}
      {spinnerMounted && (
        <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, spinnerStyle]}>
          <Spinner size="sm" color={activeText} />
        </Animated.View>
      )}
    </PressableScale>
  );
}

/** The field box at one line: its input's own one-line height, and Send's. */
const ONE_LINE_FIELD = COMPOSER_ACTION_SIZE;

/** Shared with the gateway's paperclip, which sits in the same row at the same size. */
export const composerStyles = StyleSheet.create({
  fieldOuter: { overflow: 'visible' },
  joinedTop: { marginTop: -StyleSheet.hairlineWidth },
  fieldShell: { borderCurve: 'continuous', overflow: 'hidden' },
  composer: {
    minHeight: 50,
    borderCurve: 'continuous',
    overflow: 'hidden',
    paddingHorizontal: 0,
    paddingVertical: 5,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    // The faint fill is supplied at render time from the active pack.
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 126,
    paddingHorizontal: 4,
    paddingVertical: 10,
    // No `fontFamily` here on purpose -- see `TerminalComposer`, which merges
    // the reader's monospace slot in at render time.
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: 'top',
  },
  compactComposer: { minHeight: ONE_LINE_FIELD, paddingVertical: 0 },
  inputWithoutLeading: {
    paddingLeft: 12,
  },
  expandedComposer: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  expandedInput: {
    flex: 0,
    width: '100%',
    paddingHorizontal: 12,
  },
  compactActions: { flexDirection: 'row', alignItems: 'center' },
  expandedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  expandedLeading: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  button: {
    width: COMPOSER_ACTION_SIZE,
    height: COMPOSER_ACTION_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: { opacity: 0.5 },
  buttonGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
