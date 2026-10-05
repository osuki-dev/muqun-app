import type { KeyboardVocabulary } from '@/lib/key-vocabulary';
import {
  resolveKeyboardInput,
  type KeyboardInput,
  type KeyboardModifiers,
} from '@/lib/virtual-keyboard-input';

/**
 * The wide on-screen keyboard: a whole keyboard for a tablet, as a model.
 *
 * The phone layout in `virtual-keyboard.tsx` is ten units wide and pages its
 * symbols, because a phone has room for ten keys and no more. A tablet has
 * room for a real keyboard, and a terminal wants one: a number row that does
 * not hide behind `123`, `[`/`]`/`\` where a hand expects them, function keys,
 * and Home/End/PgUp/PgDn over an inverted-T of arrows.
 *
 * The geometry is the same unit model as the phone's -- one unit `u` is a
 * letter key -- at ANSI proportions. Every row is two blocks:
 *
 * - the main block, `MAIN_UNITS` (15u) wide, and
 * - the navigation column, `NAV_UNITS` (3u) wide, to its right,
 *
 * so the navigation keys line up from row to row whatever the main block
 * holds. The component draws the two blocks as two flex boxes in that ratio;
 * nothing here knows about points.
 *
 * Pure: no React, no native module. The table-driven test beside it is the
 * contract for the row widths, the shifted characters, and which keys a
 * vocabulary disables.
 */

export type WideKeyKind =
  /** A printable character: sent as text, or as a chord with ctrl/alt armed. */
  | 'char'
  /** A named key (`enter`, `f5`, `left`): always sent as a key name. */
  | 'key'
  /** A sticky modifier: `ctrl`, `alt` or `shift`. */
  | 'modifier'
  /** Not a key: `hide` closes the keyboard, `fn` shows or hides the function strip. */
  | 'control'
  /** Empty space with a width, so a row keeps its shape. */
  | 'spacer';

export interface WideKey {
  /** Unique in the layout; the component's React key and test id. */
  id: string;
  kind: WideKeyKind;
  /** Width in key units. */
  units: number;
  /** The character, key name, modifier name or control name. */
  value: string;
  /** The cap at rest. */
  label: string;
  /** The cap with shift armed, for a key that types something else then. */
  shiftLabel?: string;
}

export interface WideRow {
  id: string;
  main: WideKey[];
  nav: WideKey[];
}

/** The main block of every row, in key units: ANSI's fifteen. */
export const MAIN_UNITS = 15;
/** The navigation column beside it. */
export const NAV_UNITS = 3;

/**
 * What shift makes of each non-letter on a US keyboard. A table rather than
 * `toUpperCase()`, which leaves every one of these alone.
 */
export const SHIFTED_CHARACTERS: Readonly<Record<string, string>> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?',
};

/** The character a key types with shift armed. */
export function shiftedCharacter(char: string): string {
  return SHIFTED_CHARACTERS[char] ?? char.toUpperCase();
}

function char(value: string): WideKey {
  const shifted = shiftedCharacter(value);
  return {
    id: `char-${value}`,
    kind: 'char',
    units: 1,
    value,
    label: value,
    ...(shifted !== value ? { shiftLabel: shifted } : {}),
  };
}

function chars(values: string): WideKey[] {
  return Array.from(values, char);
}

function key(value: string, units: number, label = value, id = `key-${value}`): WideKey {
  return { id, kind: 'key', units, value, label };
}

function modifier(value: 'ctrl' | 'alt' | 'shift', units: number, side: string): WideKey {
  return { id: `mod-${value}-${side}`, kind: 'modifier', units, value, label: value };
}

function control(value: 'hide' | 'fn', units: number): WideKey {
  return { id: `control-${value}`, kind: 'control', units, value, label: value };
}

function spacer(id: string, units: number): WideKey {
  return { id: `spacer-${id}`, kind: 'spacer', units, value: '', label: '' };
}

const F_KEYS = (from: number) => [from, from + 1, from + 2, from + 3].map((n) => key(`f${n}`, 1));

/**
 * esc and F1-F12 in groups of four, as on a real keyboard, and Insert/Delete
 * in the navigation column. The strip the `fn` control shows and hides.
 */
const FUNCTION_ROW: WideRow = {
  id: 'function',
  main: [
    key('esc', 1),
    spacer('esc', 1),
    ...F_KEYS(1),
    spacer('f4', 0.5),
    ...F_KEYS(5),
    spacer('f8', 0.5),
    ...F_KEYS(9),
  ],
  nav: [key('insert', 1.5, 'ins'), key('delete', 1.5, 'del')],
};

/**
 * The rows under the strip. The navigation column carries, top to bottom:
 * the two controls (in the top-right corner whenever the strip is hidden,
 * which is where dismissal lives on the phone layout too), Home/End,
 * PgUp/PgDn, and the inverted-T.
 */
const MAIN_ROWS: WideRow[] = [
  {
    id: 'number',
    main: [...chars('`1234567890-='), key('backspace', 2, '⌫')],
    nav: [control('fn', 1.5), control('hide', 1.5)],
  },
  {
    id: 'top',
    main: [key('tab', 1.5), ...chars('qwertyuiop[]'), { ...char('\\'), units: 1.5 }],
    nav: [key('home', 1.5), key('end', 1.5)],
  },
  {
    id: 'home',
    main: [modifier('ctrl', 1.75, 'left'), ...chars("asdfghjkl;'"), key('enter', 2.25, '↵')],
    nav: [key('pageup', 1.5, 'pgup'), key('pagedown', 1.5, 'pgdn')],
  },
  {
    id: 'bottom',
    main: [
      modifier('shift', 2.25, 'left'),
      ...chars('zxcvbnm,./'),
      modifier('shift', 2.75, 'right'),
    ],
    nav: [spacer('up-left', 1), key('up', 1, '↑'), spacer('up-right', 1)],
  },
  {
    id: 'space',
    main: [
      modifier('alt', 2, 'left'),
      { ...char(' '), id: 'char-space', units: 11, label: 'space' },
      modifier('alt', 2, 'right'),
    ],
    nav: [key('left', 1, '←'), key('down', 1, '↓'), key('right', 1, '→')],
  },
];

/** The wide layout, with or without its function strip. */
export function wideKeyboardRows(functionStrip: boolean): WideRow[] {
  return functionStrip ? [FUNCTION_ROW, ...MAIN_ROWS] : MAIN_ROWS;
}

/** The width of a run of keys, in key units. */
export function rowUnits(keys: readonly WideKey[]): number {
  return keys.reduce((sum, item) => sum + item.units, 0);
}

/**
 * What pressing `item` sends with `modifiers` armed, or `null` when the pane
 * cannot take it (and for anything that is not a key).
 *
 * A character with only shift armed is typed as its shifted character from the
 * table. With ctrl or alt armed it becomes a chord on its unshifted base, the
 * way a terminal names it (`ctrl+shift+a`, `alt+1`), and the vocabulary
 * decides whether it can be delivered.
 */
export function resolveWideKey(
  item: WideKey,
  modifiers: KeyboardModifiers,
  vocabulary?: KeyboardVocabulary
): KeyboardInput | null {
  if (item.kind === 'char') {
    if (!modifiers.ctrl && !modifiers.alt) {
      return { text: modifiers.shift ? shiftedCharacter(item.value) : item.value };
    }
    return resolveKeyboardInput(item.value, 'character', modifiers, vocabulary);
  }
  if (item.kind === 'key') return resolveKeyboardInput(item.value, 'key', modifiers, vocabulary);
  return null;
}

/**
 * Whether `item` is drawn as live in this modifier state. A key the pane
 * cannot take is drawn muted rather than hidden, so the layout never moves
 * under a hand; modifiers, controls and spacers are always as they are.
 */
export function wideKeyEnabled(
  item: WideKey,
  modifiers: KeyboardModifiers,
  vocabulary?: KeyboardVocabulary
): boolean {
  if (item.kind !== 'char' && item.kind !== 'key') return true;
  return resolveWideKey(item, modifiers, vocabulary) !== null;
}

/**
 * A sticky modifier: held for the next key (`once`), or until tapped again
 * (`locked`).
 */
export type ModifierState = 'off' | 'once' | 'locked';

/** Two taps within this many milliseconds lock a modifier. */
export const DOUBLE_TAP_MS = 350;

/** A tap on a modifier key, `sinceLastTapMs` after the previous tap on it. */
export function tapModifier(state: ModifierState, sinceLastTapMs: number): ModifierState {
  if (state === 'off') return 'once';
  if (state === 'once') return sinceLastTapMs <= DOUBLE_TAP_MS ? 'locked' : 'off';
  return 'off';
}

/**
 * A key was pressed: a one-shot modifier is spent, a locked one stays.
 *
 * Sent or refused alike. A chord the pane cannot take (muted, or refused by
 * the gateway as `key_unsupported`) used to leave ctrl armed, so the reader who
 * saw nothing happen and typed on sent a control character instead of the
 * letter (iOS pass, finding 2: ⌃↵ refused, then `a` arrived as `^A`). Only a
 * double-tap lock outlives a press.
 */
export function consumeModifier(state: ModifierState): ModifierState {
  return state === 'once' ? 'off' : state;
}
