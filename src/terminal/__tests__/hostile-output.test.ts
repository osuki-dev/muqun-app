// What the emulator does with a stream that means it harm. On the SSH screen
// every byte comes from a host the reader chose to trust with a login, not
// with the phone: a compromised or malicious server controls all of it. The
// policy at the top of `terminal-core.ts` says what such a stream can and
// cannot do; this file pins each point of it.
import { describe, expect, test } from 'bun:test';

import {
  TERMINAL_LINK_LIMIT,
  TERMINAL_TITLE_LIMIT,
  TerminalEmulator,
  terminalFrameLinks,
  terminalFrameText,
} from '@/terminal/terminal-core';

import { CSI, ESC, emulator, textOf } from './helpers';

const BEL = '\x07';
const ST = `${ESC}\\`;
const OSC = `${ESC}]`;
const DCS = `${ESC}P`;

/** The cursor is an integer cell inside the grid; nothing else counts as "in". */
function inGrid(term: TerminalEmulator): void {
  const { cursor } = term.frame();
  expect(Number.isInteger(cursor.column)).toBe(true);
  expect(Number.isInteger(cursor.row)).toBe(true);
  expect(cursor.column).toBeGreaterThanOrEqual(0);
  expect(cursor.column).toBeLessThan(term.columns);
  expect(cursor.row).toBeGreaterThanOrEqual(0);
  expect(cursor.row).toBeLessThan(term.frame().lines.length + 1);
}

describe('OSC commands the emulator does not support are swallowed', () => {
  const ignored: [string, string][] = [
    ['OSC 52 clipboard write', `${OSC}52;c;aGVsbG8=${BEL}`],
    ['OSC 52 clipboard query', `${OSC}52;c;?${BEL}`],
    ['OSC 7 working directory', `${OSC}7;file://host/etc${BEL}`],
    ['OSC 9 notification', `${OSC}9;You have mail${BEL}`],
    ['OSC 777 notification', `${OSC}777;notify;title;body${BEL}`],
    ['OSC 1 icon name', `${OSC}1;icon${BEL}`],
    ['OSC 4 palette query', `${OSC}4;1;?${BEL}`],
    ['OSC 10 foreground query', `${OSC}10;?${BEL}`],
    ['OSC 11 background query', `${OSC}11;?${ST}`],
    ['OSC 133 semantic prompt', `${OSC}133;A${BEL}`],
    ['OSC 1337 (iTerm2) file', `${OSC}1337;File=inline=1:AAAA${BEL}`],
    ['OSC with no payload', `${OSC}52${BEL}`],
    ['OSC with a huge unknown number', `${OSC}99999999999999;x${BEL}`],
  ];

  test.each(ignored)('%s leaves no trace', (_name, sequence) => {
    const term = emulator(20, 3);
    term.write(`a${sequence}b`);
    const frame = term.frame();
    expect(textOf(term)).toBe('ab');
    expect(frame.title).toBeNull();
    expect(terminalFrameLinks(frame)).toEqual([]);
  });

  test('a DCS, APC or PM string is consumed and ignored', () => {
    const term = emulator(20, 3);
    term.write(`a${DCS}$qm${ST}b${ESC}_payload${ST}c${ESC}^payload${BEL}d`);
    expect(textOf(term)).toBe('abcd');
  });
});

describe('the title is plain text', () => {
  test('control characters are stripped', () => {
    const term = emulator(20, 3);
    term.write(`${OSC}0;a\x01b\x1fc\x7fd\x9ee\x0af${BEL}x`);
    expect(term.frame().title).toBe('abcdef');
    expect(textOf(term)).toBe('x');
  });

  test('it is cut at the limit', () => {
    const term = emulator(20, 3);
    term.write(`${OSC}2;${'t'.repeat(TERMINAL_TITLE_LIMIT + 100)}${BEL}`);
    expect(term.frame().title).toHaveLength(TERMINAL_TITLE_LIMIT);
  });
});

describe('hyperlinks', () => {
  const rejected: [string, string][] = [
    ['javascript', 'javascript:alert(1)'],
    ['file', 'file:///etc/passwd'],
    ['ssh', 'ssh://root@evil.example'],
    ['custom scheme', 'muqun://pair?token=x'],
    ['no scheme', 'example.com/path'],
    ['a control character inside', 'https://example.com/\x01a'],
    ['a C1 control inside', 'https://example.com/\x9ba'],
    ['whitespace inside', 'https://example.com/a b'],
    ['over the limit', `https://example.com/${'a'.repeat(TERMINAL_LINK_LIMIT)}`],
  ];

  test.each(rejected)('a link with %s is not a link', (_name, uri) => {
    const term = emulator(40, 3);
    term.write(`${OSC}8;;${uri}${BEL}click${OSC}8;;${BEL}`);
    expect(textOf(term)).toBe('click');
    expect(terminalFrameLinks(term.frame())).toEqual([]);
  });

  test('an http(s) link at the limit is kept, and is only a tap target', () => {
    const term = emulator(40, 3);
    const uri = `https://example.com/${'a'.repeat(TERMINAL_LINK_LIMIT - 'https://example.com/'.length)}`;
    term.write(`${OSC}8;;${uri}${BEL}click${OSC}8;;${BEL}`);
    const links = terminalFrameLinks(term.frame());
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ uri, kind: 'url', row: 0, startColumn: 0, endColumn: 5 });
  });
});

describe('sequences that ask for a reply get none', () => {
  // The emulator has no channel to reply on -- nothing in `TerminalEmulator`
  // takes or returns bytes for the far side -- so the most a query can do is
  // to be swallowed. `ssh-terminal-session.test.ts` pins the same for the
  // session that owns one. Each of these must also cost the text around it
  // nothing.
  const queries: [string, string][] = [
    ['primary DA', `${CSI}c`],
    ['primary DA with parameter', `${CSI}0c`],
    ['secondary DA', `${CSI}>c`],
    ['tertiary DA', `${CSI}=c`],
    ['DECID', `${ESC}Z`],
    ['DSR status', `${CSI}5n`],
    ['DSR cursor position', `${CSI}6n`],
    ['DECXCPR', `${CSI}?6n`],
    ['DECRQSS', `${DCS}$qm${ST}`],
    ['XTGETTCAP', `${DCS}+q544e${ST}`],
    ['window size in pixels', `${CSI}14t`],
    ['window size in cells', `${CSI}18t`],
    ['window title report', `${CSI}21t`],
    ['screen size', `${CSI}19t`],
    ['kitty keyboard query', `${CSI}?u`],
    ['DECRQM', `${CSI}?2004$p`],
    ['OSC 52 query', `${OSC}52;c;?${BEL}`],
    ['XTVERSION', `${CSI}>0q`],
  ];

  test.each(queries)('%s is swallowed', (_name, sequence) => {
    const term = emulator(20, 3);
    term.write(`go${sequence}od`);
    expect(textOf(term)).toBe('good');
    inGrid(term);
  });

  test('the emulator exposes nothing that could carry a reply', () => {
    // Every method is either input (`write`, `flush`, `resize`, `reset`,
    // `setTheme`) or a read of the grid; nothing takes a callback or a handle
    // the far side could be reached through. Adding one is a policy change,
    // and it has to change this test too.
    const names = Object.getOwnPropertyNames(TerminalEmulator.prototype);
    expect(names.filter((name) => /reply|respond|answer|send|output|shell|writer/iu.test(name))).toEqual([]);
    const term = emulator(20, 3);
    expect(Object.keys(term).filter((key) => /reply|respond|answer|send|output|shell|writer/iu.test(key))).toEqual([]);
  });
});

describe('resource limits', () => {
  test('an OSC longer than the cap is abandoned, not acted on, and the rest is input', () => {
    const term = emulator(20, 4);
    term.write(`${OSC}0;${'t'.repeat(64 * 1024)}tail${BEL}after`);
    const frame = term.frame();
    expect(frame.title).toBeNull();
    // 'tail', the BEL and 'after' are ordinary input once the cap is passed.
    expect(textOf(term).endsWith('tailafter')).toBe(true);
  });

  test('the cap is on the string, wherever the chunks are cut', () => {
    const whole = `${OSC}8;;${'u'.repeat(70 * 1024)}${BEL}link${OSC}8;;${BEL}`;
    const single = emulator(20, 4);
    single.write(whole);
    const chunked = emulator(20, 4);
    for (let index = 0; index < whole.length; index += 1000) chunked.write(whole.slice(index, index + 1000));
    expect(chunked.frame()).toEqual(single.frame());
    expect(terminalFrameLinks(single.frame())).toEqual([]);
  });

  test('a DCS that never terminates does not hold the screen for ever', () => {
    const term = emulator(20, 4);
    term.write(`${DCS}`);
    term.write('q'.repeat(70 * 1024));
    term.write('back');
    expect(textOf(term).endsWith('back')).toBe(true);
  });

  test('a CSI whose final byte never comes is dropped past the limit', () => {
    const term = emulator(20, 4);
    term.write(`${CSI}`);
    term.write('1;'.repeat(40 * 1024));
    term.write('mvisible');
    expect(textOf(term)).toContain('visible');
  });

  test('scrollback stays within the configured rows', () => {
    const term = emulator(10, 4, { scrollback: 50 });
    for (let line = 0; line < 5000; line += 1) term.write(`line${line}\n`);
    expect(term.frame().lines.length).toBeLessThanOrEqual(54);
    expect(textOf(term)).toContain('line4999');
  });

  test('a flood of combining marks fills one cell only so far', () => {
    const term = emulator(10, 4);
    term.write(`a${'́'.repeat(100_000)}b`);
    const cells = term.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(cells.map((cell) => cell.text.length)).toEqual([32, 1]);
    expect(cells[1].text).toBe('b');
    // The same flood as separate writes, so the marks arrive as their own
    // zero-width graphemes and go through the append path instead.
    const split = emulator(10, 4);
    split.write('a');
    for (let index = 0; index < 1000; index += 1) split.write('\u0301');
    split.write('b');
    const again = split.frame().lines[0].cells.filter((cell) => cell.width > 0);
    expect(again.map((cell) => cell.text.length)).toEqual([32, 1]);
  });

  test.each([
    ['ICH', '@'],
    ['ECH', 'X'],
    ['DCH', 'P'],
    ['IL', 'L'],
    ['DL', 'M'],
    ['SU', 'S'],
    ['SD', 'T'],
    ['REP-like unknown', 'b'],
  ])('a giant %s count is clamped to the grid', (_name, final) => {
    const term = emulator(10, 4);
    term.write(`abc${CSI}99999999999999999999${final}d`);
    inGrid(term);
    expect(term.frame().lines.length).toBeLessThanOrEqual(4);
  });

  test.each([
    ['negative up', `${CSI}-5A`],
    ['negative down', `${CSI}-5B`],
    ['negative right', `${CSI}-5C`],
    ['negative left', `${CSI}-5D`],
    ['negative position', `${CSI}-3;-9H`],
    ['fractional', `${CSI}1.5B`],
    ['exponent', `${CSI}1e9B`],
    ['huge position', `${CSI}99999;99999H`],
    ['huge column', `${CSI}4294967296G`],
    ['huge row', `${CSI}4294967296d`],
    ['negative region', `${CSI}2;-9r`],
    ['inverted region', `${CSI}4;1r`],
    ['sub-parameters', `${CSI}1:2:3;4:5B`],
  ])('%s parameters leave the cursor in the grid', (_name, sequence) => {
    const term = emulator(10, 4);
    term.write(`${sequence}X`);
    inGrid(term);
    const frame = term.frame();
    expect(frame.lines.length).toBeLessThanOrEqual(4);
    expect(terminalFrameText(frame)).toContain('X');
  });
});
