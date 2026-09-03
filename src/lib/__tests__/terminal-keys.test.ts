// Which pane is a full-screen program, and what the key row offers when it is.
//
// The two rules here are the ones a screenshot cannot check. "Is this an
// editor?" has three answers depending on whether the gateway has spoken yet,
// and getting it wrong the safe way -- assuming a shell -- is what leaves an
// nvim pane with its first line behind the header. And the editor's commands
// are merged onto an answer the gateway produced, not into a table the app
// owns, so the merge has to survive a gateway that already sent some of them.
import { describe, expect, test } from 'bun:test';

import {
  EDITOR_ACTIONS,
  INSERT_MODE_KEYS,
  isFullScreenTuiPane,
  keyCap,
  parseNvimMode,
  terminalKeysForPane,
  withEditorActions,
} from '@/lib/terminal-keys';

describe('isFullScreenTuiPane', () => {
  test('takes the gateway at its word', () => {
    expect(isFullScreenTuiPane('editor', null)).toBe(true);
    expect(isFullScreenTuiPane('shell', null)).toBe(false);
    expect(isFullScreenTuiPane('claude', null)).toBe(false);
  });

  test('the gateway outranks the title', () => {
    // A pane whose title still says nvim but which the gateway has resolved as
    // a shell has left the editor. The title is the stale half of the pair.
    expect(isFullScreenTuiPane('shell', 'nvim src/theme.ts')).toBe(false);
  });

  test('falls back to the title until the gateway answers', () => {
    // The window between opening a pane and the shortcuts request returning,
    // and every gateway too old to resolve a profile at all.
    expect(isFullScreenTuiPane(undefined, 'nvim src/theme.ts')).toBe(true);
    expect(isFullScreenTuiPane(null, 'hx .')).toBe(true);
    expect(isFullScreenTuiPane(undefined, 'you@mac:~/code/muqun')).toBe(false);
    expect(isFullScreenTuiPane(undefined, null)).toBe(false);
  });

  test('agrees with the key row about what an editor is', () => {
    // One list of editors in the app, not two: a pane that gets the editor key
    // set must be the same pane that gets the inset.
    const title = 'nvim README.md';
    const keys = terminalKeysForPane(null, title).map((item) => item.key);
    expect(keys).toContain('ctrl+w');
    expect(isFullScreenTuiPane(undefined, title)).toBe(true);
  });

  // Card #795, defect 1: a shell running under tmux never rewrites its OSC
  // pane title when a foreground program takes over, so a real nvim pane's
  // title is still the shell's -- `ryu@osk:~/.osuki/draw`, measured on the
  // reporting device -- and the gateway resolves the same stale title into a
  // `shell` profile (`muqun-gateway/src/shortcuts.rs`, title-based itself).
  // Both signals agree and both are wrong. `foreground_command`
  // (`#{pane_current_command}`) is the one signal tmux keeps live, and it is
  // already on the wire (`muqun-gateway/src/backend/compat.rs`'s `pane()`) --
  // nothing new needs fetching, only reading.
  test('a foreground command overrules a stale shell profile or title', () => {
    expect(isFullScreenTuiPane('shell', 'ryu@osk:~/.osuki/draw', 'nvim')).toBe(true);
    expect(isFullScreenTuiPane('shell', null, 'nvim')).toBe(true);
    expect(isFullScreenTuiPane(undefined, null, 'nvim')).toBe(true);
    expect(isFullScreenTuiPane(undefined, 'you@mac:~/code/muqun', 'vim')).toBe(true);
  });

  test('an explicit editor profile still wins even if the foreground command disagrees', () => {
    // A `:terminal` split briefly runs a shell inside an editor pane the
    // gateway has already resolved; the profile is the stronger claim.
    expect(isFullScreenTuiPane('editor', null, 'bash')).toBe(true);
  });

  // The governing rule (card #795): behaviour must not change for a pane that
  // works today. Agent panes (claude, codex) share `alternate_on = 1` with an
  // editor, but neither name matches an editor pattern, so widening this
  // predicate with `foreground_command` must not flip them.
  test('agent panes are unaffected by the foreground-command signal', () => {
    expect(isFullScreenTuiPane('claude', null, 'claude')).toBe(false);
    expect(isFullScreenTuiPane('claude', null, 'node')).toBe(false);
    expect(isFullScreenTuiPane(undefined, 'ryu@osk:~/Work', 'codex')).toBe(false);
  });
});

describe('EDITOR_ACTIONS', () => {
  test('are characters to type, never key names to send', () => {
    // The gateway validates key names and `:` is not one, so an action without
    // `text` would be sent down the wrong endpoint and rejected.
    for (const action of EDITOR_ACTIONS) {
      expect(typeof action.text).toBe('string');
      expect(action.text).not.toBe('');
      expect(typeof action.cap).toBe('string');
      expect(action.key.startsWith('nvim:')).toBe(true);
    }
  });

  test('only the complete command lines are submitted', () => {
    // A bare `:` is not a command -- it opens the command line and leaves it
    // for the composer to fill in, the same way a keyboard would, so Enter
    // right after it must wait for a human. `:w`/`:wq`/`:q` are already whole
    // commands, so they submit immediately.
    for (const action of EDITOR_ACTIONS) {
      const isCompleteCommand = (action.text?.length ?? 0) > 1 && action.text?.startsWith(':');
      expect(Boolean(action.submit)).toBe(Boolean(isCompleteCommand));
    }
  });

  test('a bare `:` or `/` types the character and stops there', () => {
    const search = EDITOR_ACTIONS.find((item) => item.key === 'nvim:search');
    const cmd = EDITOR_ACTIONS.find((item) => item.key === 'nvim:cmd');
    expect(search?.text).toBe('/');
    expect(cmd?.text).toBe(':');
    expect(search?.submit).toBeUndefined();
    expect(cmd?.submit).toBeUndefined();
  });

  test('every identity is distinct', () => {
    const keys = EDITOR_ACTIONS.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('raw vim stays closest to esc, the leader combos follow', () => {
    // The order of this table is the order of the row, and what is nearest the
    // way out of a mode should be the vocabulary that works in any editor. A
    // leader combo only means something under a config that binds it.
    const leaderAt = EDITOR_ACTIONS.map((item) => item.key.startsWith('nvim:leader:'));
    expect(leaderAt.indexOf(true)).toBe(leaderAt.lastIndexOf(false) + 1);
    expect(leaderAt.filter(Boolean)).toHaveLength(5);
  });

  test('a leader combo types one space and then the sequence', () => {
    // The leading space *is* the leader. Losing it -- a trim somewhere, a cap
    // copied into `text` -- turns `␣gg` into `gg`, which silently jumps to the
    // top of the file instead of opening Lazygit.
    const leader = EDITOR_ACTIONS.filter((item) => item.key.startsWith('nvim:leader:'));
    expect(leader.map((item) => item.text)).toEqual([' e', ' ff', ' gg', ' sg', ' ,']);
    for (const action of leader) {
      expect(action.text?.startsWith(' ')).toBe(true);
      expect(action.text?.startsWith('  ')).toBe(false);
      // Never submitted: an Enter after the combo runs whatever it opened.
      expect(action.submit).toBeUndefined();
    }
  });

  test('the leader is a glyph, not the word', () => {
    // U+2423 OPEN BOX, which is in Menlo and in the terminal's own JetBrains
    // Mono; U+23B5 is in neither, and "space gg" does not fit a key cap.
    const leader = EDITOR_ACTIONS.filter((item) => item.key.startsWith('nvim:leader:'));
    for (const action of leader) {
      expect(action.cap?.startsWith('␣')).toBe(true);
      expect(action.cap).toBe(action.label);
      expect(action.cap).not.toContain(' ');
    }
  });

  test('a leader combo does not collide with the bare command it ends in', () => {
    // `gg` is on the row twice over -- top of file, and Lazygit -- and they are
    // the same two characters after the leader. Distinct identities, or the
    // dedup in `withEditorActions` drops one of them.
    const keys = EDITOR_ACTIONS.map((item) => item.key);
    expect(keys).toContain('nvim:gg');
    expect(keys).toContain('nvim:leader:gg');
  });
});

describe('withEditorActions', () => {
  const base = terminalKeysForPane(null, 'nvim src/theme.ts');

  test('lands the editor commands directly after esc', () => {
    const merged = withEditorActions(base);
    const keys = merged.map((item) => item.key);
    expect(keys[keys.indexOf(EDITOR_ACTIONS[0].key) - 1]).toBe('esc');
    // Nothing the row already carried is lost or reordered around them.
    expect(keys.filter((key) => !key.startsWith('nvim:'))).toEqual(base.map((item) => item.key));
  });

  test('goes to the front when there is no esc to follow', () => {
    const rowless = base.filter((item) => item.key !== 'esc');
    expect(withEditorActions(rowless)[0].key).toBe(EDITOR_ACTIONS[0].key);
  });

  test('a gateway that grew its own :w does not produce two', () => {
    const gateway = [{ label: ':w', key: 'nvim:w', accessibilityLabel: 'Write' }, ...base];
    const keys = withEditorActions(gateway).map((item) => item.key);
    expect(keys.filter((key) => key === 'nvim:w')).toHaveLength(1);
    expect(keys.filter((key) => key.startsWith('nvim:'))).toHaveLength(EDITOR_ACTIONS.length);
  });

  test('returns the row untouched when it already holds every action', () => {
    const merged = withEditorActions(base);
    expect(withEditorActions(merged)).toBe(merged);
  });
});

describe('keyCap', () => {
  test('an action that types characters draws its own cap', () => {
    // Without this `nvim:dd` renders as "NVIM:DD": there is nothing in a key
    // name to derive `dd` from, because it is not a key.
    expect(keyCap('nvim:dd', 'dd')).toBe('dd');
    expect(keyCap('nvim:w', ':w')).toBe(':w');
  });

  test('a real key is still spelled out from its name', () => {
    expect(keyCap('ctrl+c')).toBe('Ctrl C');
    expect(keyCap('shift+enter')).toBe('Shift ↵');
    expect(keyCap('left')).toBe('←');
  });
});

describe('parseNvimMode', () => {
  test('reads a lualine-shaped statusline, captured live', () => {
    // ` NORMAL   main  <glyph>  docs/workshop-reporting-maintainability.md ...`,
    // captured with `tmux capture-pane` against a real nvim pane on this
    // machine (see the card-795 report).
    const normal =
      ' NORMAL   main    docs/workshop-reporting-maintainability.md    gj   1  90% 347:1';
    expect(parseNvimMode(normal)).toBe('normal');

    const insert =
      ' INSERT  d  tmp  a  mode-test.txt                          i  Top   1:1    23:13';
    expect(parseNvimMode(insert)).toBe('insert');
  });

  test("reads stock nvim's ruler line, captured live with `nvim -u NONE`", () => {
    expect(parseNvimMode('-- INSERT --')).toBe('insert');
    expect(parseNvimMode('-- VISUAL BLOCK --')).toBe('normal');
    // Stock nvim's Normal mode leaves the ruler line blank -- there is nothing
    // positive to read, and blank is exactly what "cannot tell" looks like.
    expect(
      parseNvimMode('/tmp/mode-test.txt                                0,0-1          All')
    ).toBeNull();
  });

  test('an unrecognised statusline or plain prose is "cannot tell", not "normal"', () => {
    expect(parseNvimMode('')).toBeNull();
    expect(parseNvimMode('This is a normal sentence about files.')).toBeNull();
    expect(parseNvimMode(' READY   some-plugin-word  ...')).toBeNull();
  });

  test('only looks near the bottom of the screen', () => {
    // The word "NORMAL" sitting in a file's own prose, far from the
    // statusline rows, must not decide the mode.
    const lines = [
      ' NORMAL   this is actually the statusline',
      ...Array(20).fill('some file content'),
    ];
    const farFromBottom = ['NORMAL is a word this file discusses.', ...Array(20).fill('x')];
    expect(parseNvimMode(lines.join('\n'))).toBeNull();
    expect(parseNvimMode(farFromBottom.join('\n'))).toBeNull();
  });
});

describe('INSERT_MODE_KEYS', () => {
  test('is exactly the base set, not the editor verb pad', () => {
    // No `nvim:` action belongs here: every one of them is a normal-mode
    // command, and while nvim is typing every keystroke into the buffer each
    // would type its literal characters instead of doing what it says.
    const keys = INSERT_MODE_KEYS.map((item) => item.key);
    expect(keys.some((key) => key.startsWith('nvim:'))).toBe(false);
    expect(keys.sort()).toEqual(
      ['enter', 'shift+enter', 'esc', 'tab', 'ctrl+c', 'backspace'].sort()
    );
  });

  test('esc is first and is the only emphasised key', () => {
    expect(INSERT_MODE_KEYS[0].key).toBe('esc');
    expect(INSERT_MODE_KEYS[0].emphasis).toBe(true);
    expect(INSERT_MODE_KEYS.slice(1).every((item) => !item.emphasis)).toBe(true);
  });
});
