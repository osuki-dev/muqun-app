import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { ArrowBigUp, Delete, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { feedback } from '@/lib/feedback';
import { timing } from '@/lib/motion';

/**
 * A full on-screen keyboard that types straight into the pane.
 *
 * The system keyboard fills the composer and needs Enter to send, which is
 * wrong for a TUI: nvim, less, a REPL -- they act on each keystroke. This sends
 * every key the moment it is pressed, so the pane behaves as if a real keyboard
 * were attached.
 *
 * ## The layout is measured in key widths, not in row widths
 *
 * One unit `u` is the width of a letter, and every row is `10u` wide. That is
 * the whole rule, and it is what makes this read as a keyboard rather than as
 * three rows of buttons: the nine keys of `asdfghjkl` are the same size as the
 * ten above them and sit half a key in, and the seven of `zxcvbnm` are flanked
 * by the standard one-and-a-half-unit shift and backspace. It used to be the
 * other way round -- every key `flex: 1` and the middle row indented by a
 * hard-coded 18pt -- so each row had its own key size and its own stagger, and
 * the letters did not line up with the letters above them.
 *
 * The weights are flex, not measured points: this component has no layout pass
 * of its own and must not grow one. The cost is that a row's gaps are shared out
 * with its keys, so a row with fewer children has keys wider by `KEY_GAP / 10`
 * -- half a point, against the 15% the old layout was out by.
 *
 * ## Where the non-letters live
 *
 * Beside the space bar, not above the letters. The arrows are the keys a reader
 * moving through a file presses most, and the top strip is the farthest point on
 * the keyboard from the thumb holding the phone. `esc` and `tab` stay above --
 * top-left is where they are on a real keyboard -- and the hide toggle sits at
 * the top strip's right end: dismissal lives in corners, and its old seat on
 * the bottom row put five controls where four fit (Ellen, on device).
 */
const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

/**
 * The symbol pages hold the same geometry: ten, ten, seven. The third row is
 * seven rather than eight so shift and backspace keep their 1.5u caps and no
 * page has a key width another page does not. `\` is on the `#+=` page, which
 * is where it was already; `•` is what the seventh slot cost, and a bullet has
 * no meaning at a terminal.
 */
const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '~', '|'],
];

const SHIFTED_SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['_', '\\', '=', '+', '[', ']', '{', '}', '#', '%'],
  ['<', '>', '`', '^', '*', '“', '”'],
];

/** Every row is this many key widths across. */
const ROW_UNITS = 10;
/** The standard cap of the keys that flank the bottom letter row. */
const SHIFT_UNITS = 1.5;

/**
 * Apple's compact arrow strip, which is also the order `NAVIGATION` in
 * `@/lib/terminal-keys` uses -- the key row and the keyboard must not disagree
 * about which arrow is where.
 */
const ARROWS: { label: string; key: string; accessibilityLabel: MessageDescriptor }[] = [
  { label: '←', key: 'left', accessibilityLabel: msg`Left arrow` },
  { label: '↓', key: 'down', accessibilityLabel: msg`Down arrow` },
  { label: '↑', key: 'up', accessibilityLabel: msg`Up arrow` },
  { label: '→', key: 'right', accessibilityLabel: msg`Right arrow` },
];

type VirtualKeyboardProps = {
  disabled: boolean;
  /** A printable character, sent as text. */
  onText: (text: string) => void;
  /** A named key -- enter, backspace, esc, tab, an arrow -- sent as keys. */
  onKey: (key: string) => void;
  /** Return to the compact key row. */
  onClose: () => void;
};

export function VirtualKeyboard({ disabled, onText, onKey, onClose }: VirtualKeyboardProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);

  const keyText = theme.colors.text;
  const keyFill = withAlpha(theme.colors.text, appChrome.opacity.chromeControl);
  const fnFill = withAlpha(theme.colors.text, appChrome.opacity.chromeControlQuiet);
  const activeFill = theme.colors.primary;
  const activeText = theme.colors.onPrimary;

  const rows = symbols ? (shift ? SHIFTED_SYMBOL_ROWS : SYMBOL_ROWS) : LETTER_ROWS;

  function pressChar(char: string) {
    const value = !symbols && shift ? char.toUpperCase() : char;
    onText(value);
    // Shift is one-shot for letters, the way a phone keyboard behaves.
    if (shift && !symbols) setShift(false);
  }

  return (
    <View style={styles.keyboard}>
      {/* esc and tab at real-keyboard size, and the way out in the corner.
          esc at this width is the difference between leaving insert mode and
          missing. */}
      <View style={styles.functionRow}>
        <FunctionKey label="esc" color={keyText} fill={fnFill} disabled={disabled} onPress={() => onKey('esc')} />
        <FunctionKey label="tab" color={keyText} fill={fnFill} disabled={disabled} onPress={() => onKey('tab')} />
        <VirtualKey
          accessibilityLabel={t`Hide keyboard`}
          commit="up"
          onPress={onClose}
          style={[styles.key, styles.closeKey, { backgroundColor: fnFill }]}>
          <KeyboardIcon size={16} color={keyText} />
        </VirtualKey>
      </View>

      {rows.map((row, index) => {
        const last = index === rows.length - 1;
        // A middle row is centred under the row above it: half a key on each
        // side for the letters, none at all for the symbol pages, which are ten
        // wide. Stated as what the stagger *is* rather than as a padding that
        // happens to look right on one screen.
        const lead = last ? 0 : (ROW_UNITS - row.length) / 2;
        return (
          <View key={`row-${index}`} style={styles.row}>
            {lead > 0 ? <View style={{ flex: lead }} /> : null}
            {last ? (
              <ShiftKey
                symbols={symbols}
                shift={shift}
                keyFill={keyFill}
                keyText={keyText}
                activeFill={activeFill}
                activeText={activeText}
                onPress={() => setShift((value) => !value)}
              />
            ) : null}

            {row.map((char) => (
              <VirtualKey
                key={char}
                accessibilityLabel={char}
                disabled={disabled}
                onPress={() => pressChar(char)}
                style={[styles.key, styles.unitKey, { backgroundColor: keyFill }]}>
                <Text variant="bodySmall" color={keyText} style={styles.keyText}>
                  {!symbols && shift ? char.toUpperCase() : char}
                </Text>
              </VirtualKey>
            ))}

            {last ? (
              <VirtualKey
                accessibilityLabel={t`Backspace`}
                disabled={disabled}
                onPress={() => onKey('backspace')}
                style={[styles.key, styles.shiftKey, { backgroundColor: keyFill }]}>
                <Delete size={18} color={keyText} />
              </VirtualKey>
            ) : null}
            {lead > 0 ? <View style={{ flex: lead }} /> : null}
          </View>
        );
      })}

      {/* Leave, switch, type, move, send -- and 10u across like every row above
          it, so the bottom of the keyboard is not a different keyboard. */}
      <View style={styles.row}>
        <VirtualKey
          accessibilityLabel={symbols ? t`Letters` : t`Symbols`}
          commit="up"
          onPress={() => {
            setSymbols((value) => !value);
            setShift(false);
          }}
          style={[styles.key, styles.pageKey, { backgroundColor: keyFill }]}>
          <Text variant="caption" color={keyText} style={styles.keyText}>
            {symbols ? 'abc' : '123'}
          </Text>
        </VirtualKey>
        <VirtualKey
          accessibilityLabel={t`Space`}
          disabled={disabled}
          onPress={() => onText(' ')}
          style={[styles.key, styles.spaceKey, { backgroundColor: keyFill }]}>
          <Text variant="caption" color={keyText} style={styles.keyText}>
            space
          </Text>
        </VirtualKey>
        {/* One control, not four strays: the gap inside the cluster is tighter
            than the row's, and each arrow takes back in hit slop what it gives
            up in width. */}
        <View style={styles.arrowCluster}>
          {ARROWS.map((arrow) => (
            <VirtualKey
              key={arrow.key}
              accessibilityLabel={_(arrow.accessibilityLabel)}
              disabled={disabled}
              hitSlop={{ top: 6, bottom: 6 }}
              onPress={() => onKey(arrow.key)}
              style={[styles.key, styles.unitKey, { backgroundColor: fnFill }]}>
              <Text variant="caption" color={keyText} style={styles.keyText}>
                {arrow.label}
              </Text>
            </VirtualKey>
          ))}
        </View>
        <VirtualKey
          accessibilityLabel={t`Return`}
          disabled={disabled}
          onPress={() => onKey('enter')}
          style={[styles.key, styles.returnKey, { backgroundColor: keyFill }]}>
          <Text variant="caption" color={keyText} style={styles.keyText}>
            ↵
          </Text>
        </VirtualKey>
      </View>
    </View>
  );
}

/**
 * Shift, which is the one key on this keyboard that holds a state.
 *
 * Every other key is momentary: it is pressed, it sends, and there is nothing
 * to remember. Shift is sticky, so it is the only key whose look is a *fact*
 * rather than a touch -- and it used to change that look between two frames,
 * which on a keyboard reads as a repaint rather than as a mode.
 *
 * The documented reason the other keys stay on plain `Pressable` -- forty-odd
 * shared values blocking frames on mount, see `VirtualKey` below -- does not
 * apply here, because this is one key and one shared value.
 */
function ShiftKey({
  symbols,
  shift,
  keyFill,
  keyText,
  activeFill,
  activeText,
  onPress,
}: {
  /** The symbol layout is showing, so this key means "more symbols". */
  symbols: boolean;
  shift: boolean;
  keyFill: string;
  keyText: string;
  activeFill: string;
  activeText: string;
  onPress: () => void;
}) {
  const { t } = useLingui();
  const held = useSharedValue(shift ? 1 : 0);
  useEffect(() => {
    held.value = withTiming(shift ? 1 : 0, timing('toggle'));
  }, [held, shift]);

  const restingStyle = useAnimatedStyle(() => ({ opacity: 1 - held.value }));
  const heldStyle = useAnimatedStyle(() => ({ opacity: held.value }));

  return (
    <VirtualKey
      accessibilityLabel={symbols ? t`More symbols` : t`Shift`}
      onPress={onPress}
      style={[styles.key, styles.shiftKey, { backgroundColor: keyFill }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.keyFill,
          { backgroundColor: activeFill },
          heldStyle,
        ]}
      />
      {/* Both faces of the key, cross-faded: a Lucide icon's colour and fill are
          props rather than styles, and the design system's `Text` resolves its
          own colour, so neither leaves the UI thread anything to drive. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.keyFace, restingStyle]}>
        {symbols ? (
          <Text variant="caption" color={keyText} style={styles.keyText}>
            #+=
          </Text>
        ) : (
          <ArrowBigUp size={18} color={keyText} fill="transparent" />
        )}
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, styles.keyFace, heldStyle]}>
        {symbols ? (
          <Text variant="caption" color={activeText} style={styles.keyText}>
            123
          </Text>
        ) : (
          <ArrowBigUp size={18} color={activeText} fill={activeText} />
        )}
      </Animated.View>
    </VirtualKey>
  );
}

function FunctionKey({
  label,
  color,
  fill,
  disabled,
  onPress,
}: {
  label: string;
  color: string;
  fill: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <VirtualKey
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[styles.key, styles.functionWide, { backgroundColor: fill }]}>
      <Text variant="caption" color={color} style={styles.keyText}>
        {label}
      </Text>
    </VirtualKey>
  );
}

/**
 * Keyboard keys deliberately avoid PressableScale. A full QWERTY layout mounts
 * more than forty keys at once; giving every key its own Reanimated shared
 * value and worklet made opening the keyboard block several frames. Native
 * Pressable state keeps the tactile response without that mount cost.
 */
function VirtualKey({
  disabled,
  onPress,
  onPressIn,
  commit = 'down',
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /**
   * When the key acts. Typing keys commit on touch-down ('down'): `onPress`
   * waits for the release and cancels if the finger has drifted off the key --
   * which a fast thumb does on every other stroke, so keystrokes were dropped
   * mid-word. Mode keys -- hide, 123/abc -- commit on release ('up'): firing
   * them on the way down swaps the layout underneath a finger that is still
   * there, and whatever mounts in that spot lights up under the touch's tail.
   */
  commit?: 'down' | 'up';
}) {
  // The ref keeps a screen reader working through the 'down' path: an
  // accessibility activation arrives as a bare `onPress` with no touch-down
  // before it, so it still fires; a real touch marks the ref on the way down
  // and the release is a no-op.
  const firedOnTouchDown = useRef(false);
  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => {
        if (!disabled) {
          void feedback('selection');
          if (commit === 'down') {
            firedOnTouchDown.current = true;
            onPress?.(event);
          }
        }
        onPressIn?.(event);
      }}
      onPress={(event) => {
        if (firedOnTouchDown.current) {
          firedOnTouchDown.current = false;
          return;
        }
        if (!disabled) onPress?.(event);
      }}
      style={({ pressed }) => [style, pressed && !disabled ? styles.keyPressed : null]}
    />
  );
}

const KEY_GAP = 5;
/** Tighter than the row's, so the four arrows read as one control. */
const ARROW_GAP = 3;
/** Keeps ten-unit rows comfortably key-sized instead of stretching across a Pad pane. */
const VIRTUAL_KEYBOARD_MAX_WIDTH = 640;
/** The platform-neutral minimum touch target shared by letter and function keys. */
const MINIMUM_KEY_HEIGHT = 44;

// Every weight below is in key widths, and every row adds up to ROW_UNITS
// exactly -- 1.5 + 3.2 + 3.8 + 1.5 on the bottom row, 4.25 + 4.25 + 1.5 on the
// function row. That sum is the whole layout, and it is asserted in
// `virtual-keyboard-layout.test.ts` because a row that quietly adds up to 10.05
// still renders: flex normalises it, and every key on the row comes out half a
// percent narrow instead.
const styles = StyleSheet.create({
  keyboard: {
    width: '100%',
    maxWidth: VIRTUAL_KEYBOARD_MAX_WIDTH,
    alignSelf: 'center',
    gap: KEY_GAP,
    paddingBottom: 6,
  },
  functionRow: {
    flexDirection: 'row',
    gap: KEY_GAP,
  },
  row: {
    flexDirection: 'row',
    gap: KEY_GAP,
    alignItems: 'center',
  },
  key: {
    height: MINIMUM_KEY_HEIGHT,
    borderRadius: 8,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** One key width. The unit everything else on the keyboard is stated in. */
  unitKey: {
    flex: 1,
  },
  keyPressed: {
    opacity: appChrome.opacity.pressed,
    transform: [{ scale: 0.97 }],
  },
  keyFill: {
    borderRadius: 8,
    borderCurve: 'continuous',
  },
  keyFace: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** esc and tab, in key widths: two of these and the toggle make the row. */
  functionWide: {
    flex: 4.25,
  },
  shiftKey: {
    flex: SHIFT_UNITS,
  },
  pageKey: {
    flex: 1.5,
  },
  closeKey: {
    flex: 1.5,
  },
  spaceKey: {
    flex: 3.2,
  },
  arrowCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ARROW_GAP,
    flex: 3.8,
  },
  returnKey: {
    flex: 1.5,
  },
  keyText: {
    fontFamily: 'System',
    includeFontPadding: false,
  },
});
