// Shared, test-only helpers for the terminal conformance suite. Everything here
// goes through the public terminal API (TerminalEmulator / TerminalFrame); no
// test-only hooks are added to production code.
import { TerminalEmulator, terminalFrameText } from '@/terminal/terminal-core';
import type { TerminalFrame, TerminalStyle } from '@/terminal/types';

export const ESC = '\x1b';
export const CSI = '\x1b[';

type EmulatorOptions = {
  scrollback?: number;
  convertEol?: boolean;
};

// convertEol defaults on so a bare "\n" both feeds and returns, which is how the
// gateway feeds us line-oriented output and keeps the fixtures readable.
export function emulator(
  columns: number,
  rows: number,
  options: EmulatorOptions = {}
): TerminalEmulator {
  return new TerminalEmulator({
    columns,
    rows,
    convertEol: options.convertEol ?? true,
    scrollback: options.scrollback ?? 0,
  });
}

export function textOf(terminal: TerminalEmulator): string {
  return terminalFrameText(terminal.frame());
}

/** Visible text of one row, empty string when the row was trimmed off the frame. */
export function lineText(frame: TerminalFrame, row: number): string {
  const line = frame.lines[row];
  if (!line) return '';
  return line.cells
    .filter((cell) => cell.width > 0)
    .map((cell) => cell.text)
    .join('');
}

export function styleAt(
  frame: TerminalFrame,
  row: number,
  column: number
): TerminalStyle | undefined {
  return frame.lines[row]?.cells[column]?.style;
}

export function cursorOf(frame: TerminalFrame): { column: number; row: number; visible: boolean } {
  return frame.cursor;
}
