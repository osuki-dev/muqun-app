/**
 * Whether what the reader just did is a keystroke or a paste, and how the two
 * reach a gateway pane.
 *
 * The gateway offers two ways to put characters into a pane and they are not
 * interchangeable:
 *
 * - `send-keys` is a keystroke. tmux delivers each key to the pane's tty as
 *   the program would have received it from a real keyboard.
 * - `send-text` is a **paste**. tmux loads the text into a buffer and pastes
 *   it with `-p`, which wraps it in the bracketed-paste markers for any
 *   program that asked for them.
 *
 * A full-screen program asks for them. nvim, on receiving a bracketed paste,
 * runs its paste handler rather than its keymap: the payload is *content*, and
 * content is inserted into the buffer rather than obeyed. So `i` sent as text
 * does not enter insert mode -- it puts the letter `i` in the file. On a buffer
 * that cannot be written -- nvim's dashboard, a file tree, `:help` -- the paste
 * is refused with `E21: Cannot make changes, 'modifiable' is off` and nothing
 * happens at all, which is what the reader sees when they press the app's
 * keyboard on an editor pane and the file does not move.
 *
 * This is the one place the gateway path had drifted from the SSH path, where
 * the same keypress is written to the PTY as bytes and has always been a
 * keystroke. Both screens now agree: what the reader produced one key at a
 * time is keys, and only a line they composed and submitted is a paste.
 *
 * The paste is not a mistake in its own place. It is what lets a multi-line
 * message arrive as one message rather than as one Enter per line, and it is
 * the only channel by which an agent can recognise an attachment path as an
 * image. So the rule is about the *source* of the text, not about its length.
 *
 * Kept pure and free of React so the rule is one table in one test rather than
 * a decision repeated at every call site.
 */

/** How the characters reach the pane. */
export type PaneInputDelivery = 'keystrokes' | 'paste';

/** What the reader did to produce them. */
export type PaneInputSource =
  /** One press of the app's on-screen keyboard. */
  | 'virtual-key'
  /** One press of a terminal key-row chip whose cap is characters (`:w`, `gg`). */
  | 'terminal-key'
  /** A line typed into the composer and submitted. */
  | 'composer';

/**
 * The rule, in one table.
 *
 * The two keystroke sources are the two surfaces that are a keyboard: a key
 * press produced each of them, and a key press is what the program is waiting
 * for. The composer is the one where the reader assembled something first and
 * then said "send it". (The quick-actions sheet sends a saved command the same
 * way, from `app/commands.tsx`, and for the same reason.)
 */
export function paneInputDelivery(source: PaneInputSource): PaneInputDelivery {
  switch (source) {
    case 'virtual-key':
    case 'terminal-key':
      return 'keystrokes';
    case 'composer':
      return 'paste';
  }
}

/** C0 and C1, which is what Rust's `char::is_control` covers. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Whether every character of this text can be sent as a key.
 *
 * The gateway's key names are either one of its own words (`enter`, `escape`,
 * `ctrl+c`) or exactly one non-control character, and it rejects the *whole*
 * request if any one key fails that -- so a payload that cannot go as keys has
 * to fall back to a paste rather than turn one keypress into a 400.
 *
 * Only one thing fails it, and it is the one that would do damage: a control
 * character. The newline is why this function exists -- sent as a key it is
 * Enter, so a two-line payload split into keys would submit halfway through.
 *
 * Everything else passes, astral characters included. The unit on both sides
 * is the Unicode scalar value: Rust's `char` is one, `chars().count() == 1` is
 * the gateway's own test, and `Array.from` splits on the same boundary -- so an
 * emoji is one key here and one key there.
 */
export function isSendableAsKeystrokes(text: string): boolean {
  if (text.length === 0) return false;
  return !CONTROL.test(text);
}

/**
 * The keys one press of a character-capped control is worth.
 *
 * Split by code point, because that is the unit the gateway accepts, and with
 * the submit -- the Enter that runs a `:w` -- in the same list, so the whole
 * chord is one request and cannot interleave with the next press.
 */
export function paneKeystrokes(text: string, options: { submit?: boolean } = {}): string[] {
  const keys = Array.from(text);
  return options.submit ? [...keys, 'enter'] : keys;
}
