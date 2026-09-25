import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { Send } from 'lucide-react-native';
import { useEffect, type ComponentProps, type ReactNode, type Ref } from 'react';
import { StyleSheet, TextInput, type TextInputProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { ThemedSurfaceArtwork } from '@/components/themed-surface';
import { ThemeIcon } from '@/components/theme-icon';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { timing } from '@/lib/motion';
import { FontedTextInput } from '@/components/fonted-text-input';

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

export interface TerminalComposerSend {
  accessibilityLabel: string;
  /** There is something to send, and somewhere to send it. */
  armed: boolean;
  sending: boolean;
  disabled: boolean;
  onPress: () => void;
}

export interface TerminalComposerProps {
  /** A control in front of the field: the gateway's paperclip. */
  leading?: ReactNode;
  inputRef?: Ref<TextInput>;
  /** The field's own props: value, placeholder, editability, test id. */
  inputProps: TextInputProps;
  send: TerminalComposerSend;
  entering?: AnimatedViewProps['entering'];
  exiting?: AnimatedViewProps['exiting'];
  layout?: AnimatedViewProps['layout'];
}

export function TerminalComposer({
  leading,
  inputRef,
  inputProps,
  send,
  entering,
  exiting,
  layout,
}: TerminalComposerProps) {
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const theme = useThemeTokens();
  // The monospace slot is this component's *default*, not its rule, because
  // this component is two fields.
  //
  // Typed into the terminal it is a shell line: a literal, where alignment is
  // part of what it says, and mono is the only right answer. Mounted by the
  // agent composer it is a sentence addressed to a person-shaped thing, with a
  // placeholder that reads "Send a message, type / for commands, @ for
  // files..." -- prose, and the owner's report was precisely that it was not
  // in the face they chose. So the agent composer passes the interface family
  // through `inputProps.style`, which is layered after this and wins.
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

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      layout={layout}
      style={[
        composerStyles.composer,
        { borderRadius: profile.chrome.composerField },
        { backgroundColor: surfaceBackground(chromeGlassQuiet) },
      ]}>
      {leading}
      <FontedTextInput
        ref={inputRef}
        multiline
        autoCorrect={false}
        placeholderTextColor={placeholderText}
        selectionColor={theme.colors.primary}
        {...inputProps}
        // The family sits ahead of `inputProps.style` so a caller may still
        // override it -- the agent composer does, with the interface face.
        style={[
          composerStyles.input,
          !leading && composerStyles.inputWithoutLeading,
          fieldFont,
          inputProps.style,
        ]}
      />
      <ComposerSendButton
        accessibilityLabel={send.accessibilityLabel}
        armed={send.armed}
        sending={send.sending}
        disabled={send.disabled}
        onPress={send.onPress}
        armedFill={theme.colors.primary}
        restText={theme.colors.textMuted}
        activeText={theme.colors.onPrimary}
      />
    </Animated.View>
  );
}

/**
 * Send, which has three things to say and used to say all of them in one frame:
 * whether there is anything to send, whether a send is in flight, and -- by the
 * fill -- how much attention it wants.
 *
 * The fill rides the button token. The glyph and the spinner cross-fade rather
 * than swap, because a spinner appearing exactly where an arrow was, on the
 * same frame, reads as the arrow having broken.
 */
export function ComposerSendButton({
  accessibilityLabel,
  armed,
  sending,
  disabled,
  onPress,
  armedFill,
  restText,
  activeText,
}: {
  accessibilityLabel: string;
  /** There is something to send, and somewhere to send it. */
  armed: boolean;
  sending: boolean;
  disabled: boolean;
  onPress: () => void;
  armedFill: string;
  restText: string;
  activeText: string;
}) {
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const armedValue = useSharedValue(armed ? 1 : 0);
  const sendingValue = useSharedValue(sending ? 1 : 0);
  useEffect(() => {
    armedValue.value = withTiming(armed ? 1 : 0, timing('button'));
  }, [armed, armedValue]);
  useEffect(() => {
    sendingValue.value = withTiming(sending ? 1 : 0, timing('button'));
  }, [sending, sendingValue]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: Math.max(armedValue.value, sendingValue.value),
  }));
  const restGlyphStyle = useAnimatedStyle(() => ({
    opacity: (1 - armedValue.value) * (1 - sendingValue.value),
  }));
  const armedGlyphStyle = useAnimatedStyle(() => ({
    opacity: armedValue.value * (1 - sendingValue.value),
  }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: sendingValue.value }));

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      style={[composerStyles.button, { borderRadius: profile.chrome.roundControl }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: profile.chrome.roundControl },
          { backgroundColor: surfaceBackground(armedFill) },
          fillStyle,
        ]}>
        {/* Rides the armed fill rather than the rest state: the artwork is what
            the primary colour becomes, so it appears and fades with it instead
            of sitting under a disarmed button. `ThemedSurfaceArtwork` clamps its
            own opacity against the glyph colours, so a busy image cannot take
            the arrow with it. */}
        <ThemedSurfaceArtwork slot="buttons.primary.background" baseColor={armedFill} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, restGlyphStyle]}>
        <ThemeIcon name="chrome.send" fallback={Send} size={18} color={restText} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, armedGlyphStyle]}>
        <ThemeIcon name="chrome.send" fallback={Send} size={18} color={activeText} />
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, composerStyles.buttonGlyph, spinnerStyle]}>
        <Spinner size="sm" color={activeText} />
      </Animated.View>
    </PressableScale>
  );
}

/** Shared with the gateway's paperclip, which sits in the same row at the same size. */
export const composerStyles = StyleSheet.create({
  composer: {
    minHeight: 50,
    maxHeight: 150,
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
  inputWithoutLeading: {
    paddingLeft: 12,
  },
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
