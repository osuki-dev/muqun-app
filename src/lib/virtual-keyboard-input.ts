import { allowChord, type KeyboardVocabulary } from '@/lib/key-vocabulary';

export type KeyboardModifiers = { shift: boolean; ctrl: boolean; alt: boolean };
export type KeyboardInput = { text: string } | { key: string };

/**
 * Resolve one gesture before dispatch; unsupported chords must not become text.
 *
 * `vocabulary` is what the pane's backend says it can deliver (see
 * `@/lib/key-vocabulary`). An SSH pane, or a gateway older than the field,
 * passes nothing, and the SSH byte encoder decides as it always has.
 */
export function resolveKeyboardInput(
  value: string,
  kind: 'character' | 'key',
  modifiers: KeyboardModifiers,
  vocabulary?: KeyboardVocabulary
): KeyboardInput | null {
  if (kind === 'character' && !modifiers.ctrl && !modifiers.alt) {
    return { text: modifiers.shift ? value.toUpperCase() : value };
  }
  // Escape always cancels a terminal mode, even with an armed modifier.
  if (kind === 'key' && value === 'esc') return { key: 'esc' };
  const key = keyboardChordName(value, modifiers);
  return allowChord(key, vocabulary) ? { key } : null;
}

/** The chord name a modified gesture spells, whether or not the pane can take it. */
export function keyboardChordName(value: string, modifiers: KeyboardModifiers): string {
  return [
    modifiers.ctrl ? 'ctrl' : '',
    modifiers.alt ? 'alt' : '',
    modifiers.shift ? 'shift' : '',
    value === ' ' ? 'space' : value.toLowerCase(),
  ]
    .filter(Boolean)
    .join('+');
}

export type KeyboardLayout = { symbols: boolean; moreSymbols: boolean; shift: boolean };

/** Page selection is independent of the modifier sent to the terminal. */
export function changeKeyboardLayout(
  layout: KeyboardLayout,
  action: 'shift' | 'symbols' | 'consume'
): KeyboardLayout {
  if (action === 'symbols') return { symbols: !layout.symbols, moreSymbols: false, shift: false };
  if (action === 'consume') return { ...layout, shift: false };
  return layout.symbols
    ? { ...layout, moreSymbols: !layout.moreSymbols }
    : { ...layout, shift: !layout.shift };
}
