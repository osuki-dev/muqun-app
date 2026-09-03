/**
 * What the composer sends when a line is submitted to an SSH shell.
 *
 * The gateway's composer hands its text to a server that knows how to type
 * it into a pane. An SSH shell has no such server, so the bytes are spelled
 * here: the text as typed, then the carriage return that runs it -- a PTY
 * reads Enter as `\r`, and readline runs the line on it.
 *
 * A draft with more than one line is a paste, and the far side may have said
 * how it wants pastes (`DECSET 2004`, tracked by the emulator as
 * `bracketedPaste`). When it has, the text goes out between the paste
 * markers so a shell or an editor can take it as one block instead of
 * running every line as it lands; when it has not, the line ends become
 * `\r`, which is what a terminal types for a pasted newline. The submitting
 * `\r` follows the closing marker, outside the paste.
 *
 * Pure, so the rule is a table in a test and not a conclusion drawn from a
 * screen.
 */
import { encodeTerminalText } from '@/lib/ssh-key-bytes';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface ComposerSubmitOptions {
  /** The program on the far side asked for bracketed paste. */
  bracketedPaste: boolean;
  /**
   * Press Enter after the text. A shell needs it to run what was typed; an
   * editor does not -- Enter there is a newline in the buffer, so it stays on
   * the key row where it can be pressed deliberately (the gateway's rule for
   * an editor pane, kept here).
   *
   * @default true
   */
  enter?: boolean;
}

/** The text a submitted draft becomes, before UTF-8 encoding. */
export function composerSubmitText(
  draft: string,
  { bracketedPaste, enter = true }: ComposerSubmitOptions
): string {
  // A field on either platform can hand over `\r\n` from a paste; one spelling
  // of a line end before the rule is applied to it.
  const text = draft.replace(/\r\n?/g, '\n');
  const submit = enter ? '\r' : '';
  if (!text.includes('\n')) return `${text}${submit}`;
  const typed = text.replace(/\n/g, '\r');
  return bracketedPaste ? `${PASTE_START}${typed}${PASTE_END}${submit}` : `${typed}${submit}`;
}

/** The bytes for `composerSubmitText`, as `shell.write` takes them. */
export function composerSubmitBytes(draft: string, options: ComposerSubmitOptions): Uint8Array {
  return encodeTerminalText(composerSubmitText(draft, options));
}
