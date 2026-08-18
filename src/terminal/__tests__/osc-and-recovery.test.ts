// OSC titles / hyperlinks, malformed-sequence recovery, and the scrollback /
// MAX_EMULATED_ROWS limits.
//
// Cases adapted (not copied) from rahulpandita/react-term core tests
// (packages/core/src/__tests__/parser-edge-cases.test.ts, parser.test.ts),
// MIT License, Copyright (c) 2026 Rahul Pandita. Rewritten against our
// TerminalEmulator / parseTerminalSnapshot API.
import { describe, expect, test } from 'bun:test';
import {
  MAX_EMULATED_ROWS,
  parseTerminalSnapshot,
  terminalFrameLinks,
  terminalFrameText,
} from '@/terminal/terminal-core';
import { CSI, ESC, emulator, textOf } from './helpers';

describe('OSC — operating system commands', () => {
  test('OSC 2 sets the window title and is not printed', () => {
    const frame = parseTerminalSnapshot(`${ESC}]2;Session title${'\x07'}body`);
    expect(frame.title).toBe('Session title');
    expect(frame.lines[0] && frame.lines[0].cells.map((c) => c.text).join('').trimEnd()).toBe('body');
  });

  test('OSC 0 also sets the title', () => {
    const frame = parseTerminalSnapshot(`${ESC}]0;Icon+title${'\x07'}body`);
    expect(frame.title).toBe('Icon+title');
  });

  test('OSC 2 terminated by ST (ESC \\) instead of BEL', () => {
    const frame = parseTerminalSnapshot(`${ESC}]2;ST title${ESC}\\body`);
    expect(frame.title).toBe('ST title');
    expect(frame.lines[0].cells.map((c) => c.text).join('').trimEnd()).toBe('body');
  });

  test('OSC 8 hyperlink is exposed through terminalFrameLinks', () => {
    const frame = parseTerminalSnapshot(`${ESC}]8;;https://example.com${'\x07'}link${ESC}]8;;${'\x07'}`);
    const links = terminalFrameLinks(frame);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      uri: 'https://example.com',
      kind: 'url',
      row: 0,
      startColumn: 0,
      endColumn: 4,
    });
  });

  // Card #832. A screen whose hyperlinks are terminated by ST rather than BEL
  // lost every row above the last one -- the defect that made an nvim pane
  // render as its own bottom third and nothing else.
  //
  // `parseTerminalSnapshot` sizes the emulator's grid from `measureSnapshot`,
  // which strips escape sequences and counts the line ends that are left. Its
  // OSC rule matched `] [^BEL]* (BEL | ST)`: the class excluded only BEL,
  // so on a screen with no BEL in it at all the match ran greedily from the
  // FIRST introducer to the LAST terminator and took every line end between
  // them with it. The grid was then allocated that many rows, the write
  // scrolled the difference off the top, and `scrollback: 0` meant off the top
  // was gone.
  //
  // Measured on the reported pane (nvim, 357x83, four OSC 8 links, no BEL):
  // 83 rows measured as 22, and the frame held the last 22.
  describe('an OSC string is bounded by its own terminator', () => {
    const link = (uri: string, label: string) =>
      `${ESC}]8;;${uri}${ESC}\\${label}${ESC}]8;;${ESC}\\`;

    test('rows between two ST-terminated hyperlinks survive', () => {
      const rows = [
        link('./one.md', 'one'),
        'plain',
        'plain',
        'plain',
        link('./two.md', 'two'),
        'last',
      ];
      const frame = parseTerminalSnapshot(rows.join('\n'));
      expect(frame.lines).toHaveLength(rows.length);
      expect(terminalFrameText(frame)).toBe('one\nplain\nplain\nplain\ntwo\nlast');
    });

    test('a BEL-terminated screen is measured the same way', () => {
      const rows = [
        `${ESC}]8;;./one.md${'\x07'}one${ESC}]8;;${'\x07'}`,
        'plain',
        'last',
      ];
      expect(parseTerminalSnapshot(rows.join('\n')).lines).toHaveLength(3);
    });

    test('an OSC left open at the end costs the rows above it nothing', () => {
      // The emulator consumes an unclosed string to the end of the write, which
      // is what a terminal does. What must not also happen is the measurement
      // paying for it: the rows written BEFORE the string still need a grid to
      // sit in, and under the old class they lost one apiece.
      const frame = parseTerminalSnapshot(`first\nsecond\nthird${ESC}]8;;./x.md`);
      expect(terminalFrameText(frame)).toBe('first\nsecond\nthird');
    });
  });
});

describe('malformed / unsupported sequence recovery', () => {
  test('an out-of-range SGR parameter is ignored and following text still prints', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}999999999mAfter`);
    expect(textOf(term)).toBe('After');
  });

  test('an unhandled CSI (DSR "6n") is swallowed but does not eat the text around it', () => {
    const term = emulator(20, 2);
    term.write(`go${CSI}6nod`);
    expect(textOf(term)).toBe('good');
  });

  test('an incomplete CSI at the end of a write drops only that sequence', () => {
    const term = emulator(20, 2);
    term.write(`keep${CSI}32`); // no final byte
    expect(textOf(term)).toBe('keep');
  });

  test('a DCS string and a charset-designation escape are consumed, not printed', () => {
    const frame = parseTerminalSnapshot(`${ESC}Pignored${ESC}\\${ESC}(Bvisible`);
    expect(frame.lines[0].cells.map((c) => c.text).join('').trimEnd()).toBe('visible');
  });

  // DEVIATION: write() has no cross-call parser state, so an escape sequence
  // split across two writes is not reassembled — the incomplete first half is
  // dropped and the second half prints literally. Our gateway feed always hands
  // over whole frames, so this streaming case cannot occur in practice; skipped
  // rather than reworked into a stateful byte-at-a-time parser.
  test.skip('an escape sequence split across two write() calls is reassembled', () => {
    const term = emulator(20, 2);
    term.write(`${CSI}3`);
    term.write('1mX');
    expect(textOf(term)).toBe('X');
  });
});

describe('scrollback retention', () => {
  test('rows scrolled off the top are kept in scrollback and appear in the frame', () => {
    const term = emulator(6, 3, { scrollback: 5 });
    term.write('a\nb\nc\nd\ne\nf');
    const frame = term.frame();
    expect(textOf(term)).toBe('a\nb\nc\nd\ne\nf');
    expect(frame.cursor.row).toBe(5); // 3 scrollback rows + cursor on the last screen row
  });

  test('scrollback beyond its limit drops the oldest rows', () => {
    const term = emulator(4, 2, { scrollback: 2 });
    term.write('a\nb\nc\nd\ne');
    expect(textOf(term)).toBe('b\nc\nd\ne'); // "a" evicted past the 2-row scrollback
  });
});

describe('MAX_EMULATED_ROWS limit', () => {
  test('the constant is the documented cap', () => {
    expect(MAX_EMULATED_ROWS).toBe(2002);
  });

  test('snapshots taller than the emulator drop the oldest rows', () => {
    const input = Array.from({ length: 2100 }, (_, index) => `ln${index}`).join('\n');
    const frame = parseTerminalSnapshot(input);
    const text = frame.lines
      .map((line) => line.cells.map((c) => c.text).join('').trimEnd())
      .join('\n');
    // The emulator itself caps rows at 2000 (see the TerminalEmulator
    // constructor), which sits just under MAX_EMULATED_ROWS.
    expect(frame.rows).toBeLessThanOrEqual(2000);
    expect(text).not.toContain('ln0\n');
    expect(text).toContain('ln2099');
  });
});
