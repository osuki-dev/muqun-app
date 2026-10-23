import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text } from '@osuki-dev/ui';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { KEY_ROW_HEIGHT } from '@/constants/key-row';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { editorActionDescription, terminalKeyDescription } from '@/i18n/labels';
import { PRESS, timing } from '@/lib/motion';
import { keyCap, terminalShortcutTestId, type TerminalKey } from '@/lib/terminal-keys';

/**
 * The terminal keys, as a row.
 *
 * Drawn by the terminal screen in its dock, its editor panel and its
 * on-screen keyboard, and by Home's reply drawer above its field: one row,
 * so a key looks and sends the same wherever it is pressed.
 *
 * Only the first few caps are mounted until the row is scrolled. A phone
 * shows six or seven; the rest were twelve to fifteen memoised buttons with
 * their own press animations, mounted to be scrolled past -- the heaviest
 * single commit of opening a pane, and on the way back the heaviest part of
 * unmounting one (each animated style is a worklet to cancel on the UI
 * runtime). The first drag mounts the rest, a frame before it could reach
 * them.
 */
const INITIAL_KEYS = 8;

export function TerminalKeyRow({
  keys,
  sendingKey,
  disabled,
  onPressKey,
  textColor,
  background,
  activeBackground,
  activeText,
  leading,
  trailing,
  style,
  contentContainerStyle,
}: {
  keys: TerminalKey[];
  /** The key whose send is out, drawn pressed until it resolves. */
  sendingKey: string | null;
  disabled: boolean;
  onPressKey: (item: TerminalKey) => void;
  textColor: string;
  background: string;
  activeBackground: string;
  activeText: string;
  /** Controls that scroll with the keys, ahead of them. */
  leading?: ReactNode;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const [scrolled, setScrolled] = useState(false);
  const shown = scrolled ? keys : keys.slice(0, INITIAL_KEYS);
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      onScrollBeginDrag={scrolled ? undefined : () => setScrolled(true)}
      style={style}
      contentContainerStyle={[styles.row, contentContainerStyle]}>
      {leading}
      {shown.map((item) => (
        <TerminalKeyButton
          key={item.key}
          item={item}
          sending={sendingKey === item.key}
          disabled={disabled}
          onPressKey={onPressKey}
          textColor={textColor}
          background={background}
          activeBackground={activeBackground}
          activeText={activeText}
        />
      ))}
      {trailing}
    </ScrollView>
  );
}

/**
 * Memoised: its props are a key, two flags, a stable handler and colours, so
 * a render of the screen that changed none of them -- which is most of them --
 * leaves the whole row alone.
 */
export const TerminalKeyButton = memo(function TerminalKeyButton({
  item,
  sending,
  disabled,
  onPressKey,
  textColor,
  background,
  activeBackground,
  activeText,
}: {
  item: TerminalKey;
  sending: boolean;
  disabled: boolean;
  onPressKey: (item: TerminalKey) => void;
  textColor: string;
  background: string;
  activeBackground: string;
  activeText: string;
}) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const surfaceBackground = useSurfaceBackground();
  // A cap is a key, not a word: `Ctrl C`, `:wq`, `␣ff`, `⌫`. The mono slot is
  // what makes the row line up and what puts the glyphs the reader picked their
  // font for -- U+2423 for the leader, the arrows -- on the caps. The family
  // used to be a `Menlo`/`monospace` literal in the stylesheet at the foot of
  // this file, and a `StyleSheet` is built the moment the module is imported:
  // it never had a chance to learn that the reader had installed a mono, so the
  // key row stayed in the platform's face while the pane above it changed.
  const mono = useMonoFontFamily();
  const { _ } = useLinguiRuntime();
  // vim's vocabulary is the same in every language, so the cap is left alone;
  // what a screen reader says about it is not.
  //
  // Two tables, in this order. `editorActionDescription` is keyed by the action
  // identity and wins, because `nvim:w` has a real sentence behind it that the
  // terse `accessibilityLabel` does not. Everything else -- `esc`, `⌃C`, the
  // arrows, the shell set, whatever each agent advertises -- is keyed by its
  // English label, which is the only thing that tells the three different
  // `ctrl+r` rows apart. Anything neither table knows is the gateway's own
  // description, which the gateway has already localised from the locale header
  // we send it.
  const described =
    editorActionDescription[item.key] ?? terminalKeyDescription[item.accessibilityLabel];
  const spoken = described ? _(described) : item.accessibilityLabel;
  const cap = keyCap(item.key, item.cap);

  // `sending` is true from the instant the key is tapped until the send
  // resolves, so it doubles as the "you tapped this" highlight. The label stays
  // put -- swapping it for a spinner changed the button's width and made the
  // whole row jump.
  //
  // A key send against a healthy gateway resolves in a few tens of milliseconds,
  // and the highlight used to be applied and removed on whichever frames those
  // happened to land on: a flash, or on a fast enough send nothing at all. So
  // the release is a sequence rather than a ramp -- it reaches the highlight
  // first and only then leaves it -- which makes the beat the same length
  // whether the gateway took 20 ms or 200.
  const held = useSharedValue(0);
  const pressed = useSharedValue(0);
  useEffect(() => {
    if (disabled) pressed.set(0);
  }, [disabled, pressed]);
  // Only a key that was actually sending has a release to play. The effect
  // also runs on mount with `sending` false, and playing the sequence there
  // pulsed every key in the row -- the whole row flashed on every remount,
  // which is every pane switch and every keyboard close.
  const wasSending = useRef(false);
  useEffect(() => {
    if (sending) {
      wasSending.current = true;
      held.set(withTiming(1, timing('micro')));
    } else if (wasSending.current) {
      wasSending.current = false;
      held.set(withSequence(withTiming(1, timing(PRESS.in)), withTiming(0, timing('micro'))));
    }
  }, [held, sending]);

  const activeFillStyle = useAnimatedStyle(() => ({
    opacity: Math.max(held.value, pressed.value),
  }));
  const restLabelStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.max(held.value, pressed.value),
  }));
  const activeLabelStyle = useAnimatedStyle(() => ({
    opacity: Math.max(held.value, pressed.value),
  }));

  return (
    <PressableScale
      // Spelled out: a chip with only a label never reached the accessibility
      // tree on the Pad, so neither a screen reader nor automation could press it.
      accessible
      accessibilityRole="button"
      accessibilityLabel={t`Send ${spoken}`}
      testID={terminalShortcutTestId(item.key)}
      disabled={disabled}
      pressedScale={0.94}
      hitSlop={{ top: 8, bottom: 8, left: 2, right: 2 }}
      onPress={() => onPressKey(item)}
      onPressIn={() => {
        if (!disabled) pressed.set(1);
      }}
      onPressOut={() => {
        pressed.set(0);
      }}
      style={[
        styles.terminalKey,
        { borderRadius: profile.chrome.control },
        { backgroundColor: surfaceBackground(background) },
        // Insert mode's Esc: bigger, and bordered in the same colour the
        // press animation below already uses for "sent", so it reads as the
        // row's one deliberate action rather than another glass chip.
        item.emphasis ? [styles.terminalKeyEmphasis, { borderColor: activeBackground }] : null,
      ]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.terminalKeyFill,
          { borderRadius: profile.chrome.control },
          { backgroundColor: surfaceBackground(activeBackground) },
          activeFillStyle,
        ]}
      />
      {/* Spelled-out combos ("Ctrl C") rather than tiny modifier glyphs, sized
          to the text since the row scrolls. The resting copy is what gives the
          key its width; the sending copy is drawn over it. */}
      <Animated.View style={restLabelStyle}>
        <Text
          variant="caption"
          color={textColor}
          // Insert mode's Esc used to carry `fontWeight: '700'`, and 700 is the
          // weight at which a reader's font silently leaves the screen on
          // Android: `expo-font` registers a loaded face under
          // `Typeface.NORMAL` only, `ReactFontManager` rounds anything from 700
          // up to BOLD, finds no entry, and falls through to
          // `Typeface.create(family, style)` -- a lookup against the *system*
          // font list, which does not know the reader's family by name. The one
          // key meant to stand out was the one key in a different font from the
          // rest of the row. `weight="semibold"` resolves to 600, under the
          // threshold, so the registered face is still found.
          weight={item.emphasis ? 'semibold' : undefined}
          style={[styles.terminalKeyText, { fontFamily: mono }]}>
          {cap}
        </Text>
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, styles.terminalKeyGlyph, activeLabelStyle]}>
        <Text
          variant="caption"
          color={activeText}
          // The sending copy is drawn exactly over the resting one, so anything
          // that changes its metrics moves the label. Same weight, same family.
          weight={item.emphasis ? 'semibold' : undefined}
          style={[styles.terminalKeyText, { fontFamily: mono }]}>
          {cap}
        </Text>
      </Animated.View>
    </PressableScale>
  );
});

const styles = StyleSheet.create({
  // `alignItems` keeps circles and key caps on one baseline when they differ
  // in height; the trailing pad stops the last key sitting flush against the
  // edge when the row is longer than the screen.
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 6 },
  terminalKey: {
    height: KEY_ROW_HEIGHT,
    minWidth: 40,
    paddingHorizontal: 12,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalKeyFill: {
    borderCurve: 'continuous',
  },
  terminalKeyGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // No `fontFamily`: the reader's monospace slot is merged in by
  // `TerminalKeyButton`, which can ask for it. See the comment there.
  terminalKeyText: {
    fontVariant: ['tabular-nums'],
  },
  // Insert mode's Esc. Wider and bordered rather than a louder fill, so it
  // stays legible against both theme packs without needing a colour of its
  // own -- the border already reuses `activeBackground`, which is themed. Its
  // extra weight is the kit's `weight` prop on the label, not a style here;
  // see `TerminalKeyButton`.
  terminalKeyEmphasis: {
    minWidth: 64,
    paddingHorizontal: 18,
    borderWidth: 2,
  },
});
