import { withAlpha } from '@/lib/color';
import type { TerminalStyle } from '@/terminal/types';

/** Legacy packs and malformed runtime values stay opaque. No contrast-based override. */
export function terminalBackgroundOpacity(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : 1;
}

export function terminalBackgroundFill(theme: { background: string; backgroundOpacity?: number }) {
  return withAlpha(theme.background, terminalBackgroundOpacity(theme.backgroundOpacity));
}

/** An explicitly painted ANSI cell stays opaque, even if its color equals the default. */
export function paintsCellBackground(style: TerminalStyle, resolved: string, fallback: string) {
  return style.background != null || Boolean(style.inverse) || resolved !== fallback;
}
