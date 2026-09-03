export type TerminalStyle = {
  foreground: string | null;
  background: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  hidden: boolean;
  link: string | null;
};

export type TerminalCell = {
  text: string;
  width: 0 | 1 | 2;
  style: TerminalStyle;
};

export type TerminalRun = {
  text: string;
  startColumn: number;
  endColumn: number;
  style: TerminalStyle;
};

export type TerminalLine = {
  cells: TerminalCell[];
  runs: TerminalRun[];
  /**
   * u32 hash of everything in the row that the renderer draws, so two rows with
   * the same signature paint the same pixels at the same y.
   *
   * Derived from the packed cells rather than from write tracking, which is what
   * makes it usable across emulator instances: a snapshot refresh parses into a
   * brand-new emulator, so the grid's dirty-row set says "all rows" every time
   * while the signatures of untouched rows are unchanged.
   */
  signature: number;
};

export type TerminalCursor = {
  column: number;
  row: number;
  visible: boolean;
};

export type TerminalFrame = {
  columns: number;
  rows: number;
  lines: TerminalLine[];
  cursor: TerminalCursor;
  title: string | null;
};

/**
 * `url` is handed to the OS; `file` is a path the agent printed, which the app
 * resolves against the session's assets rather than opening externally.
 */
export type TerminalLinkKind = 'url' | 'file';

export type TerminalLink = {
  uri: string;
  kind: TerminalLinkKind;
  row: number;
  startColumn: number;
  endColumn: number;
};

export const DEFAULT_TERMINAL_STYLE: TerminalStyle = {
  foreground: null,
  background: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  strikethrough: false,
  inverse: false,
  hidden: false,
  link: null,
};

export function cloneTerminalStyle(style: TerminalStyle): TerminalStyle {
  return { ...style };
}

export function sameTerminalStyle(left: TerminalStyle, right: TerminalStyle): boolean {
  return (
    left.foreground === right.foreground &&
    left.background === right.background &&
    left.bold === right.bold &&
    left.dim === right.dim &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.strikethrough === right.strikethrough &&
    left.inverse === right.inverse &&
    left.hidden === right.hidden &&
    left.link === right.link
  );
}
