export const DEMO_TERMINAL_TOTAL_ROWS = 600;
export const DEMO_TERMINAL_VIEWPORT_ROWS = 60;

const HISTORY_EVENTS = [
  '\u001b[36mread\u001b[0m src/theme.ts',
  '\u001b[35msearch\u001b[0m ThemeProvider tokens',
  '\u001b[33mcheck\u001b[0m terminal colour mapping',
  '\u001b[34mrun\u001b[0m bun test src/theme',
  '\u001b[32mpass\u001b[0m type checks',
  '\u001b[36mreview\u001b[0m light and dark modes',
] as const;

/**
 * A deterministic pane-sized history for the offline gateway.
 *
 * Every generated row carries a unique sequence number. Besides looking like
 * a real agent log, that makes the fixture exercise the same overlap and
 * anchoring paths as a live pane instead of accidentally collapsing repeated
 * placeholder lines.
 */
export function buildDemoTerminalRows(liveRows: readonly string[]): string[] {
  const visibleRows = liveRows.slice(-DEMO_TERMINAL_TOTAL_ROWS);
  const historyLength = DEMO_TERMINAL_TOTAL_ROWS - visibleRows.length;
  const historyRows = Array.from({ length: historyLength }, (_, index) => {
    const sequence = String(index + 1).padStart(3, '0');
    const event = HISTORY_EVENTS[index % HISTORY_EVENTS.length];
    return `\u001b[2m[earlier ${sequence}]\u001b[0m ${event}`;
  });
  return [...historyRows, ...visibleRows];
}

export function demoTerminalScroll(): Record<string, number> {
  return {
    max_offset_from_bottom: DEMO_TERMINAL_TOTAL_ROWS - DEMO_TERMINAL_VIEWPORT_ROWS,
    viewport_rows: DEMO_TERMINAL_VIEWPORT_ROWS,
  };
}

export function demoTerminalTail(rows: readonly string[], requestedRows: number): string {
  const count = clampInteger(requestedRows, 1, rows.length);
  return rows.slice(-count).join('\n');
}

export function demoTerminalRange(
  rows: readonly string[],
  start: number,
  end: number
): {
  output: string;
  read: { range: { start: number; end: number; total: number } };
} {
  const safeStart = clampInteger(start, 0, rows.length);
  const safeEnd = clampInteger(end, safeStart, rows.length);
  return {
    output: rows.slice(safeStart, safeEnd).join('\n'),
    read: { range: { start: safeStart, end: safeEnd, total: rows.length } },
  };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}
