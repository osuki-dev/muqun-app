import { agentRequestErrorDetail } from '@/lib/agent-request-error';
import { encodeTerminalKey } from '@/lib/ssh-key-bytes';

/**
 * What one terminal backend says it can deliver to a pane, from
 * `planes.terminal.backends[].keyboard` in `GET /api/discovery`.
 *
 * The SSH byte encoder used to be the judge of every chord the on-screen
 * keyboard offered, gateway pane or not, and it has no bytes for `ctrl+enter`
 * -- a classic terminal has none -- so a gateway pane whose tmux speaks
 * extended keys could never receive it. The backend is the one that knows, so
 * the backend says, and this is what it said.
 *
 * Absent (`undefined` wherever it is passed) means a gateway older than the
 * field, never "this backend delivers nothing": that case keeps the encoder.
 */
export interface KeyboardVocabulary {
  version: number;
  /** Named keys deliverable on their own, in the app's spelling (`esc`, `pageup`, `f1`). */
  bases: string[];
  /** Modifiers that may prefix a key, spelled `ctrl`, `alt`, `shift`. */
  modifiers: string[];
  /** Modifier + special-key chords reach the pane through an extended-key protocol. */
  extended: boolean;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** `keyboard` off the wire, or `undefined` for anything this build cannot read. */
export function parseKeyboardVocabulary(value: unknown): KeyboardVocabulary | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (!isStringArray(rec.bases) || !isStringArray(rec.modifiers)) return undefined;
  return {
    version: typeof rec.version === 'number' ? rec.version : 1,
    bases: rec.bases.map((base) => base.toLowerCase()),
    modifiers: rec.modifiers.map((modifier) => modifier.toLowerCase()),
    extended: rec.extended === true,
  };
}

/** One printable ASCII character used as a key name is that character. */
function isPrintableChar(base: string): boolean {
  if (base.length !== 1) return false;
  const code = base.charCodeAt(0);
  return code >= 0x20 && code < 0x7f;
}

/** The chords every terminal has had bytes for since the VT100. */
const CLASSIC_CTRL_BASES = new Set(['[', ']', '\\', 'space']);

/**
 * Whether `key` can reach a pane whose backend advertises `vocabulary`.
 *
 * The contract's rule, as written in the keys contract shared with the
 * gateway: the classic chords are always deliverable, anything else that is a
 * modifier on a known key needs `extended`, and an unknown modifier or base
 * never is. Without a vocabulary the SSH encoder decides, which is the
 * behaviour every build before this one had.
 */
export function allowChord(key: string, vocabulary: KeyboardVocabulary | undefined): boolean {
  if (vocabulary === undefined) return encodeTerminalKey(key) !== null;
  const name = key.toLowerCase();
  // `ctrl++` is not a chord this keyboard can produce; a trailing `+` is a
  // printable base only when it stands alone.
  const parts = name === '+' ? ['+'] : name.split('+');
  const base = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!base) return false;
  if (mods.some((mod) => !vocabulary.modifiers.includes(mod))) return false;
  const known = vocabulary.bases.includes(base) || isPrintableChar(base);
  if (mods.length === 0) return known;
  const classic =
    (mods.length === 1 &&
      mods[0] === 'ctrl' &&
      ((base.length === 1 && base >= 'a' && base <= 'z') || CLASSIC_CTRL_BASES.has(base))) ||
    name === 'shift+tab';
  if (classic) return true;
  return known && vocabulary.extended;
}

/**
 * The backend's vocabulary narrowed by what one pane says right now.
 *
 * `extended` in discovery is the backend's capability (tmux's `extended-keys`
 * option); whether a given pane can take `ctrl+enter` also depends on the
 * program in it having asked for extended keys, which the pane-shortcuts
 * answer carries as `keyboard.extended`. Both must hold. A pane answer without
 * the field (an older gateway, or none fetched yet) narrows nothing.
 */
export function paneVocabulary(
  vocabulary: KeyboardVocabulary | undefined,
  paneExtended: boolean | undefined
): KeyboardVocabulary | undefined {
  if (!vocabulary || paneExtended !== false || !vocabulary.extended) return vocabulary;
  return { ...vocabulary, extended: false };
}

/**
 * The armed modifiers that the pane cannot combine with special keys right
 * now, spelled for the hint (`Ctrl`, `Ctrl+Alt`), or `null` when nothing armed
 * is held back. Only a vocabulary that says `extended: false` holds anything
 * back this way; without a vocabulary the SSH encoder decides key by key.
 */
export function heldBackModifiers(
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean },
  vocabulary: KeyboardVocabulary | undefined
): string | null {
  if (!vocabulary || vocabulary.extended) return null;
  const names = [
    modifiers.ctrl ? 'Ctrl' : '',
    modifiers.alt ? 'Alt' : '',
    modifiers.shift ? 'Shift' : '',
  ].filter(Boolean);
  return names.length > 0 ? names.join('+') : null;
}

/** The slice of a terminal plane this needs, so a mirror and a live answer both fit. */
type TerminalBackends = {
  activeBackend?: string;
  backends: { sessionId: string; keyboard?: KeyboardVocabulary }[];
};

/**
 * The vocabulary for a pane in `sessionId`: its own backend's, else the active
 * backend's, else none (an older gateway, or a server never asked).
 */
export function vocabularyForSession(
  terminal: TerminalBackends | null | undefined,
  sessionId: string | undefined
): KeyboardVocabulary | undefined {
  if (!terminal) return undefined;
  const own = sessionId
    ? terminal.backends.find((backend) => backend.sessionId === sessionId)
    : undefined;
  const backend =
    own ?? terminal.backends.find((backend) => backend.sessionId === terminal.activeBackend);
  return backend?.keyboard;
}

const MODIFIER_GLYPHS: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧' };
const BASE_GLYPHS: Record<string, string> = {
  enter: '↵',
  tab: '⇥',
  backspace: '⌫',
  space: '␣',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  esc: 'Esc',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  insert: 'Ins',
  delete: 'Del',
};

/** A chord drawn the way a menu writes it: `ctrl+enter` is `⌃↵`, `alt+f5` is `⌥F5`. */
export function chordGlyph(key: string): string {
  const parts = key === '+' ? ['+'] : key.toLowerCase().split('+');
  const base = parts[parts.length - 1] ?? '';
  const mods = parts
    .slice(0, -1)
    .map((mod) => MODIFIER_GLYPHS[mod] ?? mod)
    .join('');
  return `${mods}${BASE_GLYPHS[base] ?? base.toUpperCase()}`;
}

/**
 * The gateway refused a chord its pane cannot take: `400 key_unsupported`.
 * The request helper throws `HTTP <status>: <body>` with the body's
 * `{ error: { code, message } }` left in the text.
 */
export function isKeyUnsupportedError(err: unknown): boolean {
  const { status, code } = agentRequestErrorDetail(err);
  return status === 400 && code === 'key_unsupported';
}
