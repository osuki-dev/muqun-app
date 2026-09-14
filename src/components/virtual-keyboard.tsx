import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ArrowBigUp, Delete, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { feedback } from '@/lib/feedback';
import { timing } from '@/lib/motion';
import { changeKeyboardLayout, resolveKeyboardInput } from '@/lib/virtual-keyboard-input';

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
  ['<', '>', '`', '^', '*', '/', '-'],
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
  /**
   * The terminal keys, drawn inside this panel instead of on their own row.
   *
   * Passed in rather than built here because which keys a pane gets is the
   * screen's question -- it depends on the agent, the pane title and the usage
   * ordering -- while this component only owns where they sit.
   */
  shortcuts?: ReactNode;
};

export function VirtualKeyboard({
  disabled,
  onText,
  onKey,
  onClose,
  shortcuts,
}: VirtualKeyboardProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [layout, setLayout] = useState({ symbols: false, moreSymbols: false, shift: false });
  const { symbols, moreSymbols, shift } = layout;
  /**
   * Ctrl is held for one key, the way Shift is.
   *
   * It exists because the six chords an editor is driven by -- `⌃W` to change
   * window, `⌃D`/`⌃U` to scroll, `⌃O` to jump back, `⌃R` to redo, `⌃V` for
   * visual block -- lived only on the terminal key row, and opening this
   * keyboard used to hide that row. A modifier reaches all of them and every
   * other chord besides, rather than the app choosing six on the reader's
   * behalf.
   */
  const [ctrl, setCtrl] = useState(false);
  const [alt, setAlt] = useState(false);

  useEffect(() => {
    if (disabled) {
      setCtrl(false);
      setAlt(false);
      setLayout((value) => changeKeyboardLayout(value, 'consume'));
    }
  }, [disabled]);

  const keyText = theme.colors.text;
  const keyFill = surfaceBackground(withAlpha(theme.colors.text, appChrome.opacity.chromeControl));
  const fnFill = surfaceBackground(
    withAlpha(theme.colors.text, appChrome.opacity.chromeControlQuiet)
  );
  const activeFill = surfaceBackground(theme.colors.primary);
  const activeText = theme.colors.onPrimary;

  const rows = symbols ? (moreSymbols ? SHIFTED_SYMBOL_ROWS : SYMBOL_ROWS) : LETTER_ROWS;

  function inputFor(value: string, kind: 'character' | 'key') {
    return resolveKeyboardInput(value, kind, { ctrl, alt, shift });
  }

  function pressInput(value: string, kind: 'character' | 'key') {
    if (disabled) return;
    const input = inputFor(value, kind);
    if (!input) return;
    if ('text' in input) onText(input.text);
    else onKey(input.key);
    setCtrl(false);
    setAlt(false);
    setLayout((value) => changeKeyboardLayout(value, 'consume'));
  }

  return (
    <View style={styles.keyboard}>
      {/* The terminal keys, when the dock hands them over rather than drawing
          a row of its own. They sit above the function row because that is
          where the row they came from was: at the top of the dock, nearest the
          pane they act on. */}
      {shortcuts}
      {/* esc and tab at real-keyboard size, and the way out in the corner.
          esc at this width is the difference between leaving insert mode and
          missing. */}
      <View style={styles.functionRow}>
        <FunctionKey
          label="esc"
          color={keyText}
          fill={fnFill}
          disabled={disabled}
          onPress={() => pressInput('esc', 'key')}
        />
        <FunctionKey
          label="tab"
          color={keyText}
          fill={fnFill}
          disabled={disabled}
          onPress={() => pressInput('tab', 'key')}
        />
        {/* Spelled, not `⌃`. Its two neighbours are words, and the glyph is a
            thin chevron that reads as the `^` character sitting one page away
            on the symbol layout -- a modifier and a character that look alike
            is the wrong pair to make a reader tell apart mid-edit. */}
        <FunctionKey
          label="ctrl"
          color={ctrl ? activeText : keyText}
          fill={ctrl ? activeFill : fnFill}
          disabled={disabled}
          accessibilityLabel={t`Control`}
          selected={ctrl}
          onPress={() => setCtrl((value) => !value)}
        />
        <FunctionKey
          label="alt"
          color={alt ? activeText : keyText}
          fill={alt ? activeFill : fnFill}
          disabled={disabled}
          accessibilityLabel={t`Alt`}
          selected={alt}
          onPress={() => setAlt((value) => !value)}
        />
        <VirtualKey
          accessibilityLabel={t`Hide keyboard`}
          commit="up"
          onPress={onClose}
          style={[styles.key, styles.closeKey, { backgroundColor: fnFill }]}>
          {({ pressed }) => <KeyboardIcon size={16} color={pressed ? activeText : keyText} />}
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
                shift={symbols ? moreSymbols : shift}
                keyFill={keyFill}
                keyText={keyText}
                activeFill={activeFill}
                activeText={activeText}
                onPress={() => setLayout((value) => changeKeyboardLayout(value, 'shift'))}
              />
            ) : null}

            {row.map((char) => (
              <VirtualKey
                key={char}
                testID={`virtual-key-${char}`}
                accessibilityLabel={!symbols && shift ? char.toUpperCase() : char}
                disabled={disabled || inputFor(char, 'character') === null}
                onPress={() => pressInput(char, 'character')}
                style={[styles.key, styles.unitKey, { backgroundColor: keyFill }]}>
                {({ pressed }) => (
                  <Text
                    variant="bodySmall"
                    color={pressed ? activeText : keyText}
                    style={styles.keyText}>
                    {!symbols && shift ? char.toUpperCase() : char}
                  </Text>
                )}
              </VirtualKey>
            ))}

            {last ? (
              <VirtualKey
                accessibilityLabel={t`Backspace`}
                disabled={disabled}
                onPress={() => pressInput('backspace', 'key')}
                style={[styles.key, styles.shiftKey, { backgroundColor: keyFill }]}>
                {({ pressed }) => <Delete size={18} color={pressed ? activeText : keyText} />}
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
          onPress={() => setLayout((value) => changeKeyboardLayout(value, 'symbols'))}
          style={[styles.key, styles.pageKey, { backgroundColor: keyFill }]}>
          {({ pressed }) => (
            <Text variant="caption" color={pressed ? activeText : keyText} style={styles.keyText}>
              {symbols ? 'abc' : '123'}
            </Text>
          )}
        </VirtualKey>
        <VirtualKey
          accessibilityLabel={t`Space`}
          disabled={disabled}
          onPress={() => pressInput(' ', 'character')}
          style={[styles.key, styles.spaceKey, { backgroundColor: keyFill }]}>
          {({ pressed }) => (
            <Text variant="caption" color={pressed ? activeText : keyText} style={styles.keyText}>
              space
            </Text>
          )}
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
              onPress={() => pressInput(arrow.key, 'key')}
              style={[styles.key, styles.unitKey, { backgroundColor: fnFill }]}>
              {({ pressed }) => (
                <Text
                  variant="caption"
                  color={pressed ? activeText : keyText}
                  style={styles.keyText}>
                  {arrow.label}
                </Text>
              )}
            </VirtualKey>
          ))}
        </View>
        <VirtualKey
          accessibilityLabel={t`Return`}
          disabled={disabled}
          onPress={() => pressInput('enter', 'key')}
          style={[styles.key, styles.returnKey, { backgroundColor: keyFill }]}>
          {({ pressed }) => (
            <Text variant="caption" color={pressed ? activeText : keyText} style={styles.keyText}>
              ↵
            </Text>
          )}
        </VirtualKey>
      </View>
    </View>
  );
}

/**
 * Shift animates its one-shot state without adding worklets to every letter.
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
      accessibilityRole="togglebutton"
      accessibilityState={{ selected: shift, checked: shift }}
      onPress={onPress}
      style={[styles.key, styles.shiftKey, { backgroundColor: keyFill }]}>
      {({ pressed }) => (
        <>
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
              <Text variant="caption" color={pressed ? activeText : keyText} style={styles.keyText}>
                #+=
              </Text>
            ) : (
              <ArrowBigUp size={18} color={pressed ? activeText : keyText} fill="transparent" />
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
        </>
      )}
    </VirtualKey>
  );
}

function FunctionKey({
  label,
  color,
  fill,
  disabled,
  onPress,
  accessibilityLabel,
  selected,
}: {
  label: string;
  color: string;
  fill: string;
  disabled: boolean;
  onPress: () => void;
  /**
   * Spoken instead of the cap, for a key whose cap is a glyph. `esc` and `tab`
   * read correctly as themselves; `⌃` does not read as anything.
   */
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  const theme = useThemeTokens();
  return (
    <VirtualKey
      testID={`virtual-key-${label}`}
      accessibilityLabel={`${accessibilityLabel ?? label}${selected ? ' ✓' : ''}`}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityState={selected === undefined ? undefined : { selected, checked: selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.key, styles.functionWide, { backgroundColor: fill }]}>
      {({ pressed }) => (
        <Text
          variant="caption"
          color={pressed ? theme.colors.onPrimary : color}
          style={styles.keyText}>
          {`${label}${selected ? ' ✓' : ''}`}
        </Text>
      )}
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
  children,
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
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  // The ref keeps a screen reader working through the 'down' path: an
  // accessibility activation arrives as a bare `onPress` with no touch-down
  // before it, so it still fires; a real touch marks the ref on the way down
  // and the release is a no-op.
  const firedOnTouchDown = useRef(false);
  return (
    <Pressable
      {...props}
      accessibilityRole={props.accessibilityRole ?? 'button'}
      accessibilityState={{ ...props.accessibilityState, disabled: Boolean(disabled) }}
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
      style={({ pressed }) => [
        style,
        pressed && !disabled
          ? [styles.keyPressed, { backgroundColor: surfaceBackground(theme.colors.primary) }]
          : null,
      ]}>
      {/* Pass the state through rather than rebuilding it: Expo's web types
          augment this callback with a `hovered` field, so a hand-built object
          stops compiling as soon as anyone runs `expo start` and the generated
          `expo-env.d.ts` pulls those declarations in. Only `pressed` is
          overridden, which is the one thing a disabled key must not report. */}
      {(state) =>
        typeof children === 'function'
          ? children({ ...state, pressed: state.pressed && !disabled })
          : children
      }
    </Pressable>
  );
}

const KEY_GAP = 5;
/** Tighter than the row's, so the four arrows read as one control. */
const ARROW_GAP = 3;
/** Keeps ten-unit rows comfortably key-sized instead of stretching across a Pad pane. */
const VIRTUAL_KEYBOARD_MAX_WIDTH = 640;
/** A real 44-point hit target; gaps between keys are not touch targets. */
const KEY_HEIGHT = 44;

// Every row totals ten units: four 2.125u utility keys and a 1.5u hide key;
// or 1.5u symbols, 3.2u space, 3.8u arrows and 1.5u Return.
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
    height: KEY_HEIGHT,
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
  /** Four utility keys plus the hide key fill one ten-unit row. */
  functionWide: {
    flex: 2.125,
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
