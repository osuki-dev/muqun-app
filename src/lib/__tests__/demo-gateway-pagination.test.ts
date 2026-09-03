import { describe, expect, test } from 'bun:test';

import {
  buildDemoTerminalRows,
  DEMO_TERMINAL_TOTAL_ROWS,
  demoTerminalRange,
  demoTerminalScroll,
  demoTerminalTail,
} from '../demo-terminal-history';
import {
  foldPaneRead,
  hasEarlierAfterPage,
  nextPageRange,
  paneReadRange,
  seedPageRange,
  terminalOutputLineCount,
  terminalScrollbackRows,
} from '../../terminal/history';

const PAGE_ROWS = 240;
const MAXIMUM_ROWS = 2_000;

describe('the offline demo pages terminal history like a real gateway', () => {
  test('two disjoint range reads prepend the complete history and retire the pull', () => {
    const rows = buildDemoTerminalRows(['live output', '∗ Working…']);
    const scroll = demoTerminalScroll();
    const initial = demoTerminalTail(rows, PAGE_ROWS);

    expect(terminalScrollbackRows(scroll)).toBe(DEMO_TERMINAL_TOTAL_ROWS);
    expect(terminalOutputLineCount(initial)).toBe(PAGE_ROWS);

    const firstRange = nextPageRange(seedPageRange(scroll, PAGE_ROWS)!, PAGE_ROWS)!;
    expect(firstRange).toEqual({ start: 120, end: 360 });
    const firstPage = demoTerminalRange(rows, firstRange.start, firstRange.end);
    expect(paneReadRange(firstPage.read)).toEqual({
      start: 120,
      end: 360,
      total: DEMO_TERMINAL_TOTAL_ROWS,
    });

    let held = foldPaneRead(initial, firstPage.output, 'rangePage', MAXIMUM_ROWS);
    expect(terminalOutputLineCount(held)).toBe(PAGE_ROWS * 2);
    expect(
      hasEarlierAfterPage(
        firstPage.output,
        PAGE_ROWS * 2,
        MAXIMUM_ROWS,
        scroll,
        PAGE_ROWS,
        firstPage.read
      )
    ).toBe(true);

    const finalRange = nextPageRange(seedPageRange(scroll, PAGE_ROWS * 2)!, PAGE_ROWS)!;
    expect(finalRange).toEqual({ start: 0, end: 120 });
    const finalPage = demoTerminalRange(rows, finalRange.start, finalRange.end);
    held = foldPaneRead(held, finalPage.output, 'rangePage', MAXIMUM_ROWS);

    expect(terminalOutputLineCount(held)).toBe(DEMO_TERMINAL_TOTAL_ROWS);
    expect(
      hasEarlierAfterPage(
        finalPage.output,
        DEMO_TERMINAL_TOTAL_ROWS,
        MAXIMUM_ROWS,
        scroll,
        PAGE_ROWS,
        finalPage.read
      )
    ).toBe(false);
  });

  test('reads are clamped to the history the pane actually owns', () => {
    const liveRows = Array.from({ length: 700 }, (_, index) => `live ${index + 1}`);
    const rows = buildDemoTerminalRows(liveRows);

    expect(rows).toHaveLength(DEMO_TERMINAL_TOTAL_ROWS);
    expect(rows[0]).toBe('live 101');
    expect(terminalOutputLineCount(demoTerminalTail(rows, 999))).toBe(DEMO_TERMINAL_TOTAL_ROWS);

    const read = demoTerminalRange(rows, -40, 999);
    expect(paneReadRange(read.read)).toEqual({
      start: 0,
      end: DEMO_TERMINAL_TOTAL_ROWS,
      total: DEMO_TERMINAL_TOTAL_ROWS,
    });
  });
});
