/**
 * The SSH screen's editor verdict: what the emulator can say about the far
 * side, and what it latches once said.
 */
import { describe, expect, test } from 'bun:test';

import { sshEditorPane, sshNvimMode } from '@/lib/ssh-editor';
import { TerminalEmulator } from '@/terminal/terminal-core';

const CSI = '\x1b[';

function frameOf(text: string, alternate = true) {
  const term = new TerminalEmulator({ columns: 40, rows: 6, scrollback: 50 });
  if (alternate) term.write(`${CSI}?1049h`);
  term.write(text);
  return term.frame();
}

describe('sshNvimMode', () => {
  test('reads the stock mode line off the bottom of an alternate-screen frame', () => {
    const frame = frameOf(`file.txt\r\n\r\n\r\n\r\n\r\n-- INSERT --`);
    expect(sshNvimMode(frame, true)).toBe('insert');
  });

  test('says nothing off the main screen, or with no frame', () => {
    expect(sshNvimMode(frameOf('-- INSERT --', false), false)).toBeNull();
    expect(sshNvimMode(undefined, true)).toBeNull();
  });

  test('a mode word in a file\'s own prose, above the bottom rows, does not count', () => {
    const frame = frameOf(`-- INSERT --\r\n\r\n\r\n\r\n\r\n$ `);
    expect(sshNvimMode(frame, true)).toBeNull();
  });
});

describe('sshEditorPane', () => {
  test('nothing off the alternate screen is an editor, whatever it says', () => {
    expect(sshEditorPane(true, { alternateScreen: false, title: 'nvim', nvimMode: 'insert' })).toBe(false);
  });

  test('a parsed nvim mode makes an editor', () => {
    expect(sshEditorPane(false, { alternateScreen: true, title: null, nvimMode: 'insert' })).toBe(true);
    expect(sshEditorPane(false, { alternateScreen: true, title: null, nvimMode: 'normal' })).toBe(true);
  });

  test('an editor title makes an editor, by the gateway\'s own list', () => {
    expect(sshEditorPane(false, { alternateScreen: true, title: 'nvim notes.md', nvimMode: null })).toBe(true);
    expect(sshEditorPane(false, { alternateScreen: true, title: 'helix', nvimMode: null })).toBe(true);
    expect(sshEditorPane(false, { alternateScreen: true, title: 'htop', nvimMode: null })).toBe(false);
  });

  test('a full-screen program that says nothing is not an editor', () => {
    expect(sshEditorPane(false, { alternateScreen: true, title: null, nvimMode: null })).toBe(false);
  });

  test('the verdict latches for as long as the alternate screen is held', () => {
    // Insert mode seen, then Esc: stock nvim shows nothing in Normal mode.
    expect(sshEditorPane(true, { alternateScreen: true, title: null, nvimMode: null })).toBe(true);
    // `:q`: the alternate screen goes, and so does the verdict.
    expect(sshEditorPane(true, { alternateScreen: false, title: null, nvimMode: null })).toBe(false);
  });
});
