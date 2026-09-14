import { encodeTerminalKey } from '@/lib/ssh-key-bytes';

export type KeyboardModifiers = { shift: boolean; ctrl: boolean; alt: boolean };
export type KeyboardInput = { text: string } | { key: string };

/** Resolve one gesture before dispatch; unsupported chords must not become text. */
export function resolveKeyboardInput(
  value: string,
  kind: 'character' | 'key',
  modifiers: KeyboardModifiers
): KeyboardInput | null {
  if (kind === 'character' && !modifiers.ctrl && !modifiers.alt) {
    return { text: modifiers.shift ? value.toUpperCase() : value };
  }
  // Escape always cancels a terminal mode, even with an armed modifier.
  if (kind === 'key' && value === 'esc') return { key: 'esc' };
  const parts = [
    modifiers.ctrl ? 'ctrl' : '',
    modifiers.alt ? 'alt' : '',
    modifiers.shift ? 'shift' : '',
    value === ' ' ? 'space' : value.toLowerCase(),
  ].filter(Boolean);
  const key = parts.join('+');
  return encodeTerminalKey(key) === null ? null : { key };
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
