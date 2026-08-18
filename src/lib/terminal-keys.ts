import type { ShortcutKey } from '@/lib/gateway-client';

export type TerminalKey = {
  label: string;
  key: string;
  accessibilityLabel: string;
  /**
   * What to draw on the cap. Absent means `keyCap(key)` works it out from the
   * key name, which it can only do for keys the terminal has names for.
   */
  cap?: string;
  /**
   * Literal characters to type, for an action that is a sequence of keystrokes
   * rather than a key: `dd` is two presses of `d`, not a key called "dd". Sent
   * through the text endpoint, which is the same one the composer uses.
   */
  text?: string;
  /** Press Enter after `text`, because a `:` command line has to be run. */
  submit?: boolean;
  /**
   * Drawn larger and bordered instead of blending into the row. Insert mode's
   * Esc is the only key that carries this: it is the one thing a thumb needs
   * to find without reading the row while text is still being typed.
   */
  emphasis?: boolean;
};

/**
 * Keys every pane needs: answering a prompt, getting out of one, and moving
 * around. `shift+enter` inserts a newline without sending, which is the only
 * way to write a multi-line message from a phone.
 */
const BASE: TerminalKey[] = [
  { label: '↵', key: 'enter', accessibilityLabel: 'Enter' },
  { label: '⇧↵', key: 'shift+enter', accessibilityLabel: 'Shift Enter, newline without sending' },
  { label: 'ESC', key: 'esc', accessibilityLabel: 'Escape' },
  { label: 'TAB', key: 'tab', accessibilityLabel: 'Tab' },
  { label: '⌃C', key: 'ctrl+c', accessibilityLabel: 'Control C' },
  { label: '⌫', key: 'backspace', accessibilityLabel: 'Backspace' },
];

/** Line editing and history, which only mean something at a shell prompt. */
const SHELL: TerminalKey[] = [
  { label: '⌃D', key: 'ctrl+d', accessibilityLabel: 'Control D' },
  { label: '⌃A', key: 'ctrl+a', accessibilityLabel: 'Control A, start of line' },
  { label: '⌃E', key: 'ctrl+e', accessibilityLabel: 'Control E, end of line' },
  { label: '⌃K', key: 'ctrl+k', accessibilityLabel: 'Control K, clear to end of line' },
  { label: '⌃U', key: 'ctrl+u', accessibilityLabel: 'Control U, clear line' },
  { label: '⌃W', key: 'ctrl+w', accessibilityLabel: 'Control W, delete word' },
  { label: '⌃Y', key: 'ctrl+y', accessibilityLabel: 'Control Y, paste' },
  { label: '⌃P', key: 'ctrl+p', accessibilityLabel: 'Control P, previous' },
  { label: '⌃N', key: 'ctrl+n', accessibilityLabel: 'Control N, next' },
  { label: '⌃R', key: 'ctrl+r', accessibilityLabel: 'Control R, reverse search' },
  { label: '⌃Z', key: 'ctrl+z', accessibilityLabel: 'Control Z, suspend' },
  { label: '⌃L', key: 'ctrl+l', accessibilityLabel: 'Control L, clear screen' },
];

/**
 * Herdr rejects `home`, `end`, `pageup` and `pagedown` with `invalid_key`,
 * verified by sending every key here to a real pane. Word motions are the
 * accepted equivalents.
 */
const NAVIGATION: TerminalKey[] = [
  { label: '←', key: 'left', accessibilityLabel: 'Left arrow' },
  { label: '↓', key: 'down', accessibilityLabel: 'Down arrow' },
  { label: '↑', key: 'up', accessibilityLabel: 'Up arrow' },
  { label: '→', key: 'right', accessibilityLabel: 'Right arrow' },
  { label: '⌥←', key: 'alt+left', accessibilityLabel: 'Back one word' },
  { label: '⌥→', key: 'alt+right', accessibilityLabel: 'Forward one word' },
];

/**
 * What each agent's own footer advertises, taken from live output rather than
 * guessed. Claude Code shows "esc to interrupt · ctrl+t to hide tasks · ctrl+b
 * to run in background" and marks collapsed blocks "(ctrl+o to expand)"; Codex
 * shows "Esc to cancel · Tab to amend · ctrl+e to explain".
 *
 * An agent that is not listed falls back to the shell set, which is a superset
 * of what any prompt needs, so a new agent is usable before it is added here.
 */
const AGENT_KEYS: Record<string, TerminalKey[]> = {
  // "esc to interrupt · ctrl+t to hide tasks · ctrl+b to run in background",
  // and collapsed blocks marked "(ctrl+o to expand)".
  claude: [
    { label: '⇧TAB', key: 'shift+tab', accessibilityLabel: 'Shift Tab, cycle mode' },
    { label: '⌃O', key: 'ctrl+o', accessibilityLabel: 'Control O, expand' },
    { label: '⌃T', key: 'ctrl+t', accessibilityLabel: 'Control T, toggle tasks' },
    { label: '⌃B', key: 'ctrl+b', accessibilityLabel: 'Control B, run in background' },
    { label: '⌃R', key: 'ctrl+r', accessibilityLabel: 'Control R, transcript' },
    { label: '⌃L', key: 'ctrl+l', accessibilityLabel: 'Control L, clear screen' },
  ],
  // "Esc to cancel · Tab to amend · ctrl+e to explain".
  codex: [
    { label: '⇧TAB', key: 'shift+tab', accessibilityLabel: 'Shift Tab' },
    { label: '⌃E', key: 'ctrl+e', accessibilityLabel: 'Control E, explain' },
    { label: '⌃R', key: 'ctrl+r', accessibilityLabel: 'Control R' },
    { label: '⌃L', key: 'ctrl+l', accessibilityLabel: 'Control L, clear screen' },
  ],
  // Collapsed rows marked "… +24 rows (Ctrl+O)".
  qodercli: [
    { label: '⇧TAB', key: 'shift+tab', accessibilityLabel: 'Shift Tab' },
    { label: '⌃O', key: 'ctrl+o', accessibilityLabel: 'Control O, expand rows' },
    { label: '⌃R', key: 'ctrl+r', accessibilityLabel: 'Control R' },
    { label: '⌃L', key: 'ctrl+l', accessibilityLabel: 'Control L, clear screen' },
  ],
};

/**
 * A modal editor wants none of the shell's line editing. Esc leaves insert
 * mode; the rest are the window and scroll motions that are awkward to type.
 * Detected from the pane title rather than the agent field, since an editor is
 * not an agent.
 */
const EDITOR: TerminalKey[] = [
  { label: '⌃W', key: 'ctrl+w', accessibilityLabel: 'Control W, window prefix' },
  { label: '⌃D', key: 'ctrl+d', accessibilityLabel: 'Control D, half page down' },
  { label: '⌃U', key: 'ctrl+u', accessibilityLabel: 'Control U, half page up' },
  { label: '⌃O', key: 'ctrl+o', accessibilityLabel: 'Control O, jump back' },
  { label: '⌃R', key: 'ctrl+r', accessibilityLabel: 'Control R, redo' },
  { label: '⌃V', key: 'ctrl+v', accessibilityLabel: 'Control V, visual block' },
];

const EDITOR_TITLES = /^(?:n?vim|nvi|helix|hx|emacs|nano)\b/i;

/**
 * The leader glyph, drawn instead of the word "space".
 *
 * U+2423 OPEN BOX, the conventional printed stand-in for a space, so that `␣gg`
 * reads as one combo rather than as a cap with a hole punched in it. Checked
 * against the fonts the row actually draws in rather than assumed: Menlo (iOS)
 * and JetBrains Mono Nerd Font both carry U+2423 and neither carries U+23B5
 * BOTTOM SQUARE BRACKET, which is why the obvious-looking `⎵` is not the one.
 */
const LEADER = '␣';

/**
 * LazyVim's leader combos, the five a hand reaches for.
 *
 * Space is the leader in LazyVim's defaults, and none of these is typeable from
 * the key row as it stood: reaching the file explorer meant opening the on-screen
 * keyboard to press two keys, one of which was a space the composer would have
 * swallowed. Five and no more -- the row is horizontal and every addition costs
 * every other key a scroll.
 *
 * They sit after the raw vim commands so that what is closest to `esc` is still
 * the vocabulary that works in any editor; these only mean something under a
 * config that binds them.
 *
 * Sent as text with the leading space intact and never submitted: a leader combo
 * is a normal-mode sequence, so an Enter after it would run whatever the combo
 * opened.
 */
const LEADER_ACTIONS: TerminalKey[] = [
  { label: `${LEADER}e`, key: 'nvim:leader:e', accessibilityLabel: 'Explorer', cap: `${LEADER}e`, text: ' e' },
  { label: `${LEADER}ff`, key: 'nvim:leader:ff', accessibilityLabel: 'Find files', cap: `${LEADER}ff`, text: ' ff' },
  { label: `${LEADER}gg`, key: 'nvim:leader:gg', accessibilityLabel: 'Lazygit', cap: `${LEADER}gg`, text: ' gg' },
  { label: `${LEADER}sg`, key: 'nvim:leader:sg', accessibilityLabel: 'Grep', cap: `${LEADER}sg`, text: ' sg' },
  { label: `${LEADER},`, key: 'nvim:leader:,', accessibilityLabel: 'Buffers', cap: `${LEADER},`, text: ' ,' },
];

/**
 * The commands a modal editor is actually driven by, which until now were
 * nowhere on the key row: the `EDITOR` set above is six control chords, and
 * `:w` was a slash command the terminal row never shows. Writing a file from a
 * phone meant opening the on-screen keyboard to type three characters.
 *
 * Ten, chosen for how often a hand reaches for them rather than for coverage.
 * Redo is left out because `⌃R` is already on the row, and `G` because `⌃D` is
 * there and is how you move toward the end of a file a screen at a time. The
 * five `LEADER_ACTIONS` follow them.
 *
 * These are characters, not key names -- the gateway validates key names and
 * `:` is not one -- so each carries `text` and travels through the text
 * endpoint. The `key` field is an identity, for React and for the usage
 * ordering; it is never sent. What each one *means* is in `@/i18n/labels`,
 * keyed by that identity: this module is pure and under test, so it cannot
 * contain a Lingui macro.
 */
export const EDITOR_ACTIONS: TerminalKey[] = [
  // `/` and `:` open search and the command line the same way a keyboard
  // would, but type nothing after them: the composer becomes that line, and
  // Enter -- already on the row -- runs whatever was typed into it. Neither
  // carries `submit`, unlike the compound commands below it: sending Enter
  // right after a bare `:` would run an empty command instead of leaving the
  // line open to type into.
  { label: '/', key: 'nvim:search', accessibilityLabel: 'Search', cap: '/', text: '/' },
  { label: ':', key: 'nvim:cmd', accessibilityLabel: 'Command mode', cap: ':', text: ':' },
  { label: ':w', key: 'nvim:w', accessibilityLabel: 'Write', cap: ':w', text: ':w', submit: true },
  { label: ':wq', key: 'nvim:wq', accessibilityLabel: 'Write and quit', cap: ':wq', text: ':wq', submit: true },
  { label: ':q', key: 'nvim:q', accessibilityLabel: 'Quit', cap: ':q', text: ':q', submit: true },
  { label: 'i', key: 'nvim:i', accessibilityLabel: 'Insert mode', cap: 'i', text: 'i' },
  { label: 'v', key: 'nvim:v', accessibilityLabel: 'Visual mode', cap: 'v', text: 'v' },
  { label: 'dd', key: 'nvim:dd', accessibilityLabel: 'Delete line', cap: 'dd', text: 'dd' },
  { label: 'yy', key: 'nvim:yy', accessibilityLabel: 'Yank line', cap: 'yy', text: 'yy' },
  { label: 'p', key: 'nvim:p', accessibilityLabel: 'Paste', cap: 'p', text: 'p' },
  { label: 'u', key: 'nvim:u', accessibilityLabel: 'Undo', cap: 'u', text: 'u' },
  { label: 'gg', key: 'nvim:gg', accessibilityLabel: 'Top of file', cap: 'gg', text: 'gg' },
  ...LEADER_ACTIONS,
];

/**
 * Is this pane a program that paints a screen rather than printing lines?
 *
 * Four different surfaces ask this, and they are not one question, even
 * though today they share one answer:
 *
 *  - **Does this pane own the screen** -- it repaints in place, keeps no
 *    scrollback, and must not slide under the floating header. The true
 *    answer is tmux's `alternate_on`, and agent panes (claude, codex) are
 *    `alternate_on = 1` too, exactly like an editor.
 *  - **Is this an editor** -- it gets `:`, `/`, `i`, `u` on the key row, gets
 *    nvim mode parsed off its own screen, and a composer send does not get an
 *    implicit Enter. This is `foreground_command`/profile/title against a
 *    list of editor names, and an agent is never one.
 *
 * This function only answers the second question. It is safe to reuse for the
 * first *only because*, today, every screen-owning pane this app treats
 * specially is an editor -- agent panes are deliberately left alone here, so
 * nothing about them changes. `alternate_on` is not forwarded to the app at
 * all (checked end to end through `muqun-gateway`'s pane serialisation,
 * `src/backend/tmux.rs`/`compat.rs`): widening this to the real screen-owning
 * question would need `#{alternate_on}` added to the gateway's `list-panes`
 * format string, and a separate proof that agent panes are unaffected by
 * whatever reads it -- the governing rule is that behaviour must not change
 * for a pane that works today, and an agent pane works today specifically
 * because it answers `false` here. Deferred; not attempted in this card.
 *
 * The gateway's `profile` field wins when it says `editor` -- an explicit
 * claim outranks every inference below it, including a `foreground_command`
 * that happens to disagree (a `:terminal` split briefly runs a shell inside
 * a pane the gateway has already resolved as an editor). Otherwise
 * `foreground_command` (`#{pane_current_command}`) is checked next: it is
 * tmux's own live account of what the pane is running, already on the wire
 * (`muqun-gateway`'s `pane()` in `compat.rs`) and current in a way neither
 * `profile` nor the title is. Both of those are resolved from the pane's OSC
 * title, and a shell does not rewrite its tmux pane title when a foreground
 * program takes over -- measured on a real machine, every nvim pane's title
 * and gateway-resolved profile still said the shell that exec'd it. Only once
 * neither says anything does the title pattern get asked directly, which
 * covers the window before the shortcuts request answers and a gateway too
 * old to resolve a profile at all -- the same pattern `terminalKeysForPane`
 * falls back to, so there is one list of editors in the app rather than two.
 */
export function isFullScreenTuiPane(
  profile: string | null | undefined,
  paneTitle?: string | null,
  foregroundCommand?: string | null
): boolean {
  if (profile === 'editor') return true;
  if (foregroundCommand && EDITOR_TITLES.test(foregroundCommand.trim())) return true;
  if (profile) return false;
  return Boolean(paneTitle && EDITOR_TITLES.test(paneTitle.trim()));
}

/**
 * The editor's commands folded into whatever the row already holds.
 *
 * Applied on top of the gateway's answer as well as the offline fallback: the
 * gateway resolves the row and its answer wins, so adding these to the table
 * below would have left them invisible against every real gateway. Deduplicated
 * by key so a gateway that grows its own `:w` does not produce two.
 *
 * They go in directly after `esc`, which is the way out of any mode and so
 * belongs ahead of them; if the row has no esc they go to the front. The usage
 * ordering the screen applies afterwards is free to move them.
 */
export function withEditorActions(keys: TerminalKey[]): TerminalKey[] {
  const taken = new Set(keys.map((item) => item.key));
  const additions = EDITOR_ACTIONS.filter((item) => !taken.has(item.key));
  if (additions.length === 0) return keys;
  const afterEsc = keys.findIndex((item) => item.key === 'esc') + 1;
  return [...keys.slice(0, afterEsc), ...additions, ...keys.slice(afterEsc)];
}

/** Normalises names like "Claude Code" or "claude-code" to a lookup key. */
function agentKey(agent: string | null | undefined): string | null {
  if (!agent) return null;
  const normalized = agent.trim().toLowerCase();
  if (!normalized) return null;
  for (const known of Object.keys(AGENT_KEYS)) {
    if (normalized.includes(known)) return known;
  }
  return null;
}

/**
 * The gateway resolves the key row from what the pane is actually running, so
 * its answer wins when there is one. The tables below stay as the offline
 * fallback: a pane must still be usable while the gateway is unreachable.
 */
export function terminalKeysFromGateway(keys: ShortcutKey[]): TerminalKey[] {
  return keys.map((entry) => ({
    label: entry.label,
    key: entry.key,
    accessibilityLabel: entry.description || entry.label,
  }));
}

/**
 * The key row for a pane. Agent panes get the actions that agent advertises;
 * anything else gets the shell editing set.
 */
export function terminalKeysForPane(
  agent: string | null | undefined,
  paneTitle?: string | null
): TerminalKey[] {
  const known = agentKey(agent);
  if (known) return [...BASE, ...AGENT_KEYS[known], ...NAVIGATION];
  if (paneTitle && EDITOR_TITLES.test(paneTitle.trim())) {
    return [...BASE, ...EDITOR, ...NAVIGATION];
  }
  return [...BASE, ...SHELL, ...NAVIGATION];
}

/**
 * A readable cap for a key on the row. The single-glyph modifier symbols
 * (⌃ � ⌥) are hard to tell apart at a phone's key-row size, so combos are spelled
 * out -- "Ctrl C", "Shift Tab" -- and the row scrolls, so the extra width is
 * free. Bare keys keep a compact glyph where it is unambiguous.
 */
const BARE_CAPS: Record<string, string> = {
  enter: 'Enter',
  'shift+enter': 'Shift ↵',
  esc: 'Esc',
  tab: 'Tab',
  backspace: '⌫',
  space: 'Space',
  left: '←',
  down: '↓',
  up: '↑',
  right: '→',
  'alt+left': 'Alt ←',
  'alt+right': 'Alt →',
};

const MODIFIER_WORDS: Record<string, string> = {
  ctrl: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  cmd: 'Cmd',
  meta: 'Cmd',
};

export function keyCap(key: string, cap?: string): string {
  // An action that types characters already knows what it looks like: `:w` is
  // not a key name and there is nothing to derive it from.
  if (cap) return cap;
  const direct = BARE_CAPS[key];
  if (direct) return direct;
  const parts = key.split('+');
  if (parts.length === 1) return parts[0].toUpperCase();
  const base = parts[parts.length - 1];
  const mods = parts.slice(0, -1).map((mod) => MODIFIER_WORDS[mod] ?? mod);
  const baseLabel = BARE_CAPS[base] ?? base.toUpperCase();
  return `${mods.join(' ')} ${baseLabel}`;
}

/**
 * nvim's mode, the way its own screen writes it down.
 *
 * tmux's formats do not carry it -- `#{pane_mode}` is empty for an nvim pane,
 * checked against a live one -- so the only place the mode is written is the
 * screen nvim itself painted. Two shapes, because a statusline is config, not
 * a protocol:
 *
 *  - a plugin (lualine and the like) prints the mode word first on its own
 *    line, e.g. ` NORMAL   main  docs/report.md  ...`, confirmed against four
 *    live panes and both modes on a fifth;
 *  - stock nvim carries no such line in Normal mode and instead prints
 *    `-- INSERT --` (`-- VISUAL --`, `-- REPLACE --`, ...) on the last line
 *    only while that mode is active, confirmed the same way with `nvim -u
 *    NONE`.
 *
 * Each recognised word is mapped to whether the mode types literal characters
 * on every keystroke (`insert`, `replace`, `vreplace` -- where a nvim verb
 * pressed on the row would land in the buffer instead of doing what it is
 * labelled) or not (`normal` and everything else that moves or selects
 * without typing).
 */
const MODE_WORDS: Record<string, 'insert' | 'normal'> = {
  NORMAL: 'normal',
  VISUAL: 'normal',
  'V-LINE': 'normal',
  'V-BLOCK': 'normal',
  SELECT: 'normal',
  'S-LINE': 'normal',
  'S-BLOCK': 'normal',
  COMMAND: 'normal',
  CONFIRM: 'normal',
  INSERT: 'insert',
  REPLACE: 'insert',
  VREPLACE: 'insert',
  // `:terminal` mode forwards every keystroke to the embedded shell, the same
  // way Insert forwards every keystroke to the buffer.
  TERMINAL: 'insert',
};

/** A lualine-shaped line: the mode word, then more statusline, on one line. */
const LUALINE_MODE_LINE = /^\s*([A-Z][A-Z-]{2,9})\s+\S/;

/** Stock nvim's ruler line, e.g. `-- INSERT --` or `-- VISUAL BLOCK --`. */
const STOCK_MODE_LINE = /--\s*([A-Z][A-Z -]{2,14}?)\s*--/;

/**
 * Scans the last few rows of a rendered pane, bottom-up, for whichever shape
 * above is present, and returns the mode -- or `null` when neither is, which
 * covers a statusline plugin this table does not know, a screen with no
 * statusline row visible at all, and a pane that simply is not nvim.
 *
 * `null` must be read as "cannot tell", never as "normal": every caller of
 * this function falls back to whatever it already showed before this existed
 * when the answer is `null`, because a wrong guess here is worse than a
 * static row.
 *
 * `lookback` bounds the scan to the rows nearest the bottom, where a
 * statusline lives whether or not a separate command line is reserved below
 * it; scanning the whole screen would let the word "normal" in a file's own
 * prose decide the row.
 */
export function parseNvimMode(frameText: string, lookback = 4): 'insert' | 'normal' | null {
  if (!frameText) return null;
  const lines = frameText.split('\n');
  const start = Math.max(0, lines.length - lookback);
  for (let index = lines.length - 1; index >= start; index -= 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const stock = STOCK_MODE_LINE.exec(line);
    if (stock) {
      const word = stock[1].trim().split(/\s+/)[0];
      const mode = MODE_WORDS[word];
      if (mode) return mode;
    }
    const lualine = LUALINE_MODE_LINE.exec(line);
    if (lualine) {
      const mode = MODE_WORDS[lualine[1]];
      if (mode) return mode;
    }
  }
  return null;
}

/**
 * The row while nvim is typing every keystroke into the buffer: a prominent
 * way out, and nothing shaped like a command, because every one of them --
 * `dd`, `u`, `:w` -- would be typed as literal characters instead of doing
 * what its label says. Derived from `BASE` rather than restated, so a change
 * there cannot drift out of sync with what Insert mode shows; only the
 * order and the one added flag differ.
 */
export const INSERT_MODE_KEYS: TerminalKey[] = [
  ...BASE.filter((item) => item.key === 'esc').map((item) => ({ ...item, emphasis: true })),
  ...BASE.filter((item) => item.key !== 'esc'),
];
