import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
// Two hooks of the same name and they are not interchangeable: the macro one
// expands `t` at build time, and only the runtime one hands back the `_` that
// turns a `msg` descriptor into a sentence in the active locale.
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { ArrowBigUp, Delete, Keyboard as KeyboardIcon } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  type GestureResponderEvent,
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { appChrome } from '@/constants/appearance';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { withAlpha } from '@/lib/color';
import { feedback } from '@/lib/feedback';
import { timing } from '@/lib/motion';
import {
  chordGlyph,
  heldBackModifiers,
  type KeyboardVocabulary,
  type KeyOutcome,
} from '@/lib/key-vocabulary';
import {
  changeKeyboardLayout,
  keyboardChordName,
  resolveKeyboardInput,
  type KeyboardInput,
} from '@/lib/virtual-keyboard-input';
import {
  MAIN_UNITS,
  NAV_UNITS,
  consumeModifier,
  resolveWideKey,
  tapModifier,
  wideKeyEnabled,
  wideKeyboardRows,
  type ModifierState,
  type WideKey,
} from '@/lib/virtual-keyboard-layout';

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
 *
 * ## The wide layout
 *
 * In the Pad layout (`wide`, which the workspace sets from
 * `workspaceLayout.mode === 'pad'` -- one signal, the same one that picks the
 * rest of the Pad shell, rather than a width this component would have to
 * measure) the phone's ten-unit pages give way to a whole keyboard: function
 * strip, number row, ANSI letter rows and a navigation column. Its geometry is
 * a model in `@/lib/virtual-keyboard-layout`, in the same key units, and the
 * same rule holds: flex weights, no layout pass. `WIDE_KEYBOARD_MAX_WIDTH`
 * caps a key at about 52pt and the keyboard is centred, so a 1280pt tablet
 * does not draw giant keys.
 *
 * ## Keys a pane cannot take
 *
 * What a pane can receive is its backend's question: `vocabulary` is what the
 * gateway advertised for it (`@/lib/key-vocabulary`), and without one the SSH
 * encoder decides as it always has. A key that cannot be delivered in the
 * current modifier state is drawn muted, never hidden, so nothing moves under
 * a hand; pressing it says so for two seconds instead of doing nothing.
 *
 * One case is known before any press: a pane that is not taking extended keys
 * (`vocabulary.extended === false`, the backend's and the pane's answer
 * combined) cannot receive a modifier on a special key. While a modifier is
 * armed there, the keys it would spoil are disabled outright -- a shown key
 * that fails is not offered -- and the hint stays up for as long as the
 * modifier does, saying why.
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
  /** A pane may answer how the key went; `{ unsupported }` is the gateway refusing the chord. */
  onKey: (key: string) => void | Promise<KeyOutcome>;
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
  /** What the pane's backend can deliver; absent keeps the SSH encoder's answer. */
  vocabulary?: KeyboardVocabulary;
  /** Draw the whole tablet keyboard instead of the phone's pages. */
  wide?: boolean;
};

/**
 * Whether the wide layout's function strip is showing. Remembered for the
 * launch rather than per mount: the keyboard remounts with every pane switch,
 * and a strip that comes back each time is a strip hidden over and over.
 */
const functionStripMemory = { shown: true };

/** How long the "can't send" hint stays. */
const REFUSED_HINT_MS = 2000;

export function VirtualKeyboard({
  disabled,
  onText,
  onKey,
  onClose,
  shortcuts,
  vocabulary,
  wide = false,
}: VirtualKeyboardProps) {
  const { t } = useLingui();
  const { _ } = useLinguiRuntime();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const mono = useMonoFontFamily();
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
  const [ctrlState, setCtrlState] = useState<ModifierState>('off');
  const [altState, setAltState] = useState<ModifierState>('off');
  /** The wide layout's shift, sticky like ctrl and alt; the phone's lives in `layout`. */
  const [wideShift, setWideShift] = useState<ModifierState>('off');
  const lastModifierTap = useRef<{ modifier: string; at: number } | null>(null);
  const [functionStrip, setFunctionStrip] = useState(functionStripMemory.shown);
  /** The chord last refused, shown until the hint times out; `count` restarts it on a repeat. */
  const [refused, setRefused] = useState<{
    chord: string;
    count: number;
    /** The gateway's own explanation, shown verbatim as a second line. */
    detail: string | null;
  } | null>(null);
  const ctrl = ctrlState !== 'off';
  const alt = altState !== 'off';

  useEffect(() => {
    if (disabled) {
      setCtrlState('off');
      setAltState('off');
      setWideShift('off');
      setLayout((value) => changeKeyboardLayout(value, 'consume'));
    }
  }, [disabled]);

  useEffect(() => {
    if (!refused) return;
    const timer = setTimeout(() => setRefused(null), REFUSED_HINT_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  useEffect(() => {
    functionStripMemory.shown = functionStrip;
  }, [functionStrip]);

  const keyText = theme.colors.text;
  const keyFill = surfaceBackground(withAlpha(theme.colors.text, appChrome.opacity.chromeControl));
  const fnFill = surfaceBackground(
    withAlpha(theme.colors.text, appChrome.opacity.chromeControlQuiet)
  );
  const activeFill = surfaceBackground(theme.colors.primary);
  const activeText = theme.colors.onPrimary;

  const rows = symbols ? (moreSymbols ? SHIFTED_SYMBOL_ROWS : SYMBOL_ROWS) : LETTER_ROWS;

  const modifiers = { ctrl, alt, shift: wide ? wideShift !== 'off' : shift };

  function inputFor(value: string, kind: 'character' | 'key') {
    return resolveKeyboardInput(value, kind, modifiers, vocabulary);
  }

  function flagRefused(chord: string, detail: string | null = null) {
    setRefused((previous) => ({ chord, count: (previous?.count ?? 0) + 1, detail }));
  }

  function send(input: KeyboardInput | null, chord: string) {
    if (disabled) return;
    if (!input) {
      // Muted, not inert: the press is the moment to say why nothing happened.
      // It still spends a one-shot modifier below -- see `consumeModifier`.
      flagRefused(chord);
    } else if ('text' in input) onText(input.text);
    else {
      const sent = onKey(input.key);
      if (sent) {
        void sent.then((outcome) => {
          if (typeof outcome === 'object') flagRefused(chord, outcome.unsupported);
        });
      }
    }
    setCtrlState(consumeModifier);
    setAltState(consumeModifier);
    setWideShift(consumeModifier);
    setLayout((value) => changeKeyboardLayout(value, 'consume'));
  }

  function pressInput(value: string, kind: 'character' | 'key') {
    send(inputFor(value, kind), keyboardChordName(value, modifiers));
  }

  /** The phone's modifiers toggle; the wide layout's lock on a double tap. */
  function tap(modifier: string, at: number) {
    const set =
      modifier === 'ctrl' ? setCtrlState : modifier === 'alt' ? setAltState : setWideShift;
    if (!wide) {
      set((state) => (state === 'off' ? 'once' : 'off'));
      return;
    }
    const last = lastModifierTap.current;
    const since = last && last.modifier === modifier ? at - last.at : Number.POSITIVE_INFINITY;
    lastModifierTap.current = { modifier, at };
    set((state) => tapModifier(state, since));
  }

  /** `at` is the touch's own timestamp, which is what a double tap is measured in. */
  function pressWideKey(item: WideKey, at: number) {
    if (item.kind === 'modifier') tap(item.value, at);
    else if (item.kind === 'control') {
      if (item.value === 'hide') onClose();
      else {
        setFunctionStrip((shown) => !shown);
      }
    } else {
      send(resolveWideKey(item, modifiers, vocabulary), keyboardChordName(item.value, modifiers));
    }
  }

  const modifierStates: Record<string, ModifierState> = {
    ctrl: ctrlState,
    alt: altState,
    shift: wideShift,
  };

  // Laid over a row rather than added as one: a row that appeared and went
  // would move every key under the finger that caused it. Over the shortcut
  // row when there is one -- the held-back hint stays up while a modifier is
  // armed, and over the foot of a phone keyboard it would hide the whole
  // bottom row, the dimmed key it explains included. (Not above the keyboard:
  // the dock clips its children.)
  const chord = refused ? chordGlyph(refused.chord) : '';
  // The armed modifiers this pane holds back, while they are armed: those keys
  // are drawn muted, and this is the line that says why.
  const modifierKeys = heldBackModifiers(modifiers, vocabulary);
  const hintText = refused
    ? t`This terminal can't send ${chord}`
    : modifierKeys
      ? t`${modifierKeys} combinations need the program in this terminal to enable extended keys`
      : null;
  const refusedHint = hintText ? (
    <View
      pointerEvents="none"
      style={[styles.hintWrap, shortcuts ? styles.hintOverShortcuts : styles.hintAtFoot]}>
      <View style={[styles.hint, { backgroundColor: surfaceBackground(theme.colors.background) }]}>
        <Text variant="caption" color={keyText} style={styles.hintText}>
          {hintText}
        </Text>
        {refused?.detail ? (
          <Text variant="caption" color={keyText} style={styles.hintText}>
            {refused.detail}
          </Text>
        ) : null}
      </View>
    </View>
  ) : null;
  // A muted key stays pressable, even while a held-back modifier is armed:
  // the press is a refusal that says why and spends the one-shot modifier.
  // Disabling it swallowed the tap and left ctrl armed for the next letter.
  const refusedInput = (value: string, kind: 'character' | 'key') => inputFor(value, kind) === null;

  if (wide) {
    return (
      <View style={[styles.keyboard, styles.wideKeyboard]}>
        {shortcuts}
        {wideKeyboardRows(functionStrip).map((row) => (
          <View key={row.id} style={styles.wideRow}>
            {(['main', 'nav'] as const).map((block) => (
              <View
                key={block}
                style={[styles.row, { flex: block === 'main' ? MAIN_UNITS : NAV_UNITS }]}>
                {row[block].map((item) => (
                  <WideKeyCap
                    key={item.id}
                    item={item}
                    disabled={disabled}
                    muted={!wideKeyEnabled(item, modifiers, vocabulary)}
                    held={item.kind === 'modifier' ? modifierStates[item.value] : undefined}
                    shift={modifiers.shift}
                    functionStrip={functionStrip}
                    keyFill={keyFill}
                    fnFill={fnFill}
                    keyText={keyText}
                    activeFill={activeFill}
                    activeText={activeText}
                    onPress={(event) => pressWideKey(item, event.nativeEvent.timestamp)}
                  />
                ))}
              </View>
            ))}
          </View>
        ))}
        {refusedHint}
      </View>
    );
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
          muted={refusedInput('tab', 'key')}
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
          onPress={() => tap('ctrl', 0)}
        />
        <FunctionKey
          label="alt"
          color={alt ? activeText : keyText}
          fill={alt ? activeFill : fnFill}
          disabled={disabled}
          accessibilityLabel={t`Alt`}
          selected={alt}
          onPress={() => tap('alt', 0)}
        />
        <VirtualKey
          accessibilityLabel={t`Hide keyboard`}
          commit="up"
          onPress={onClose}
          style={[styles.key, styles.closeKey, { backgroundColor: fnFill }]}>
          {({ pressed }) => <KeyboardIcon size={16} color={pressed ? activeText : keyText} />}
        </VirtualKey>
      </View>

      {rows.map((row, rowIndex) => {
        const last = rowIndex === rows.length - 1;
        const rowId = row.slice(0, 3).join('') || `row-${rowIndex}`;
        // A middle row is centred under the row above it: half a key on each
        // side for the letters, none at all for the symbol pages, which are ten
        // wide. Stated as what the stagger *is* rather than as a padding that
        // happens to look right on one screen.
        const lead = last ? 0 : (ROW_UNITS - row.length) / 2;
        return (
          <View key={`row-${rowId}`} style={styles.row}>
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
                disabled={disabled}
                onPress={() => pressInput(char, 'character')}
                style={[
                  styles.key,
                  styles.unitKey,
                  { backgroundColor: keyFill },
                  refusedInput(char, 'character') && styles.muted,
                ]}>
                {({ pressed }) => (
                  <Text
                    variant="bodySmall"
                    color={pressed ? activeText : keyText}
                    style={[styles.keyText, { fontFamily: mono }]}>
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
                style={[
                  styles.key,
                  styles.shiftKey,
                  { backgroundColor: keyFill },
                  refusedInput('backspace', 'key') && styles.muted,
                ]}>
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
            <Text
              variant="caption"
              color={pressed ? activeText : keyText}
              style={[styles.keyText, { fontFamily: mono }]}>
              {symbols ? 'abc' : '123'}
            </Text>
          )}
        </VirtualKey>
        <VirtualKey
          accessibilityLabel={t`Space`}
          disabled={disabled}
          onPress={() => pressInput(' ', 'character')}
          style={[
            styles.key,
            styles.spaceKey,
            { backgroundColor: keyFill },
            refusedInput(' ', 'character') && styles.muted,
          ]}>
          {({ pressed }) => (
            <Text
              variant="caption"
              color={pressed ? activeText : keyText}
              style={[styles.keyText, { fontFamily: mono }]}>
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
              style={[
                styles.key,
                styles.unitKey,
                { backgroundColor: fnFill },
                refusedInput(arrow.key, 'key') && styles.muted,
              ]}>
              {({ pressed }) => (
                <Text
                  variant="caption"
                  color={pressed ? activeText : keyText}
                  style={styles.keyGlyph}>
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
          style={[
            styles.key,
            styles.returnKey,
            { backgroundColor: keyFill },
            refusedInput('enter', 'key') && styles.muted,
          ]}>
          {({ pressed }) => (
            <Text variant="caption" color={pressed ? activeText : keyText} style={styles.keyGlyph}>
              ↵
            </Text>
          )}
        </VirtualKey>
      </View>
      {refusedHint}
    </View>
  );
}

/**
 * One key of the wide layout. Plain `VirtualKey` underneath, for the same
 * mount-cost reason as every other key (see `VirtualKey`).
 */
function WideKeyCap({
  item,
  disabled,
  muted,
  held,
  shift,
  functionStrip,
  keyFill,
  fnFill,
  keyText,
  activeFill,
  activeText,
  onPress,
}: {
  item: WideKey;
  disabled: boolean;
  /** The pane cannot take this key in the current modifier state. */
  muted: boolean;
  /** A modifier's state; undefined for every other key. */
  held?: ModifierState;
  shift: boolean;
  functionStrip: boolean;
  keyFill: string;
  fnFill: string;
  keyText: string;
  activeFill: string;
  activeText: string;
  onPress: (event: GestureResponderEvent) => void;
}) {
  const { t } = useLingui();
  const mono = useMonoFontFamily();
  if (item.kind === 'spacer') return <View style={{ flex: item.units }} />;

  const flex = { flex: item.units };
  if (item.kind === 'control') {
    const hide = item.value === 'hide';
    return (
      <VirtualKey
        testID={`virtual-key-${item.value}`}
        accessibilityLabel={hide ? t`Hide keyboard` : t`Function keys`}
        accessibilityRole={hide ? 'button' : 'togglebutton'}
        accessibilityState={hide ? undefined : { selected: functionStrip, checked: functionStrip }}
        commit="up"
        onPress={onPress}
        style={[
          styles.key,
          flex,
          { backgroundColor: !hide && functionStrip ? activeFill : fnFill },
        ]}>
        {({ pressed }) =>
          hide ? (
            <KeyboardIcon size={16} color={pressed ? activeText : keyText} />
          ) : (
            <Text
              variant="caption"
              color={pressed || functionStrip ? activeText : keyText}
              style={[styles.keyText, { fontFamily: mono }]}>
              fn
            </Text>
          )
        }
      </VirtualKey>
    );
  }

  if (item.kind === 'modifier') {
    const on = held !== undefined && held !== 'off';
    const locked = held === 'locked';
    return (
      <VirtualKey
        testID={`virtual-key-${item.id}`}
        accessibilityLabel={`${item.value === 'ctrl' ? t`Control` : item.value === 'alt' ? t`Alt` : t`Shift`}${locked ? ' ⇪' : on ? ' ✓' : ''}`}
        accessibilityRole="togglebutton"
        accessibilityState={{ selected: on, checked: locked ? 'mixed' : on }}
        disabled={disabled}
        onPress={onPress}
        style={[
          styles.key,
          flex,
          { backgroundColor: on ? activeFill : fnFill },
          // Locked reads differently from held-once: the same fill, ringed.
          locked && [styles.lockedKey, { borderColor: activeText }],
        ]}>
        {({ pressed }) => (
          <Text
            variant="caption"
            color={pressed || on ? activeText : keyText}
            style={[
              styles.keyText,
              { fontFamily: mono, textDecorationLine: locked ? 'underline' : 'none' },
            ]}>
            {item.label}
          </Text>
        )}
      </VirtualKey>
    );
  }

  const glyph = item.label.length === 1 && item.kind === 'key';
  const cap = item.kind === 'char' && shift ? (item.shiftLabel ?? item.label) : item.label;
  const named = item.kind === 'key' && !glyph;
  return (
    <VirtualKey
      testID={`virtual-key-${item.id}`}
      accessibilityLabel={item.value === ' ' ? t`Space` : cap}
      disabled={disabled}
      hitSlop={item.kind === 'key' && glyph ? { top: 2, bottom: 2 } : undefined}
      onPress={onPress}
      style={[
        styles.key,
        flex,
        { backgroundColor: named ? fnFill : keyFill },
        muted && styles.muted,
      ]}>
      {({ pressed }) =>
        item.value === 'backspace' ? (
          <Delete size={18} color={pressed ? activeText : keyText} />
        ) : (
          <Text
            variant={item.kind === 'char' && item.value !== ' ' ? 'bodySmall' : 'caption'}
            color={pressed ? activeText : keyText}
            style={glyph ? styles.keyGlyph : [styles.keyText, { fontFamily: mono }]}>
            {cap}
          </Text>
        )
      }
    </VirtualKey>
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
  const mono = useMonoFontFamily();
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
              <Text
                variant="caption"
                color={pressed ? activeText : keyText}
                style={[styles.keyText, { fontFamily: mono }]}>
                #+=
              </Text>
            ) : (
              <ArrowBigUp size={18} color={pressed ? activeText : keyText} fill="transparent" />
            )}
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, styles.keyFace, heldStyle]}>
            {symbols ? (
              <Text
                variant="caption"
                color={activeText}
                style={[styles.keyText, { fontFamily: mono }]}>
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
  muted = false,
  onPress,
  accessibilityLabel,
  selected,
}: {
  label: string;
  color: string;
  fill: string;
  disabled: boolean;
  /** The pane cannot take this key in the current modifier state. */
  muted?: boolean;
  onPress: () => void;
  /**
   * Spoken instead of the cap, for a key whose cap is a glyph. `esc` and `tab`
   * read correctly as themselves; `⌃` does not read as anything.
   */
  accessibilityLabel?: string;
  selected?: boolean;
}) {
  const theme = useThemeTokens();
  const mono = useMonoFontFamily();
  return (
    <VirtualKey
      testID={`virtual-key-${label}`}
      accessibilityLabel={`${accessibilityLabel ?? label}${selected ? ' ✓' : ''}`}
      accessibilityRole={selected === undefined ? 'button' : 'togglebutton'}
      accessibilityState={selected === undefined ? undefined : { selected, checked: selected }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.key, styles.functionWide, { backgroundColor: fill }, muted && styles.muted]}>
      {({ pressed }) => (
        <Text
          variant="caption"
          color={pressed ? theme.colors.onPrimary : color}
          style={[styles.keyText, { fontFamily: mono }]}>
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
/** Between the wide layout's main block and its navigation column: half a key's breathing room. */
const NAV_GAP = 14;
/**
 * The wide layout's cap: 18 units across plus gaps, which puts a key at about
 * 52pt -- the size of a laptop key -- however wide the Pad pane is.
 */
const WIDE_KEYBOARD_MAX_WIDTH = 1020;
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
  wideKeyboard: {
    maxWidth: WIDE_KEYBOARD_MAX_WIDTH,
  },
  wideRow: {
    flexDirection: 'row',
    gap: NAV_GAP,
  },
  /**
   * A key the pane cannot take right now: still there, quieter. Pressable, to
   * say why on the press and to spend a one-shot modifier.
   */
  muted: {
    opacity: appChrome.opacity.disabled,
  },
  lockedKey: {
    borderWidth: 2,
  },
  hintWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  /** Over the shortcut row, when there is one: no typing key is hidden. */
  hintOverShortcuts: {
    top: 0,
  },
  /** Over the keyboard's foot, when the top row is the keyboard's own. */
  hintAtFoot: {
    bottom: 0,
  },
  hintText: {
    textAlign: 'center',
  },
  hint: {
    maxWidth: '92%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderCurve: 'continuous',
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
  /**
   * A key cap, in the reader's monospace face.
   *
   * These are keys. `q`, `#+=`, `esc`, `ctrl`, `space` -- what a cap says is
   * the character or the key name that pressing it sends, so by the rule the
   * font slots are split on (`use-user-fonts.ts`) they follow the mono slot
   * rather than the interface one. The family is merged in from
   * `useMonoFontFamily()` at each render site; what was here was `'System'`,
   * which is neither slot and which no setting could reach.
   *
   * The `✓` a held modifier appends is the one glyph in this group that a
   * reader-supplied mono file may not carry, and on Android a `Typeface`
   * created from a single file has no system fallback chain behind it, so a
   * missing glyph is a tofu box rather than a substituted tick. It is accepted
   * here: a held ctrl or alt is already saying so with a filled key and an
   * inverted colour, and the tick is the third and smallest of three signals.
   * The glyph-only caps below are a different matter.
   */
  keyText: {
    includeFontPadding: false,
  },
  /**
   * The caps that are pictures rather than characters: `←↓↑→` and `↵`.
   *
   * These stay on the platform UI face on purpose, and it is the same Android
   * fallback rule that decides it. What these keys send is `left`, `down`,
   * `up`, `right` and `enter` -- the glyph is a picture of the key, not a
   * character the reader is typing -- so the rule that sends a literal to the
   * mono slot does not reach them. And the downside is not symmetric: U+2190
   * through U+2193 and U+21B5 sit well outside the Latin range a mono file is
   * guaranteed to cover, a font with no glyph for one of them draws a box, and
   * a boxed arrow key is a key whose meaning is gone rather than a key in the
   * wrong font. The system face carries all five on both platforms.
   */
  keyGlyph: {
    fontFamily: 'System',
    includeFontPadding: false,
  },
});
