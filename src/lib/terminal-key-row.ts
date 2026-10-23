import type { PaneShortcuts } from '@/lib/gateway-client';
import { allowChord, type KeyboardVocabulary } from '@/lib/key-vocabulary';
import { isSendableAsKeystrokes, paneKeystrokes } from '@/lib/pane-input';
import { loadUsage, orderByUsage, usageScope } from '@/lib/shortcut-usage';
import {
  terminalKeysFromGateway,
  withCommonTerminalCombinations,
  withEditorActions,
  type TerminalKey,
} from '@/lib/terminal-keys';

/**
 * The key row's contents and how a press travels, shared by the terminal
 * screen and Home's reply drawer so that a key sends the same thing from
 * either. The screen adds what only it knows (an editor's mode); the drawer
 * passes the defaults.
 */

/** Whether this pane can take a key, by the vocabulary its backend advertised. */
export function keyDeliverable(
  item: TerminalKey,
  vocabulary: KeyboardVocabulary | undefined
): boolean {
  return (
    !vocabulary ||
    item.text !== undefined ||
    (item.keys ?? [item.key]).every((key) => allowChord(key, vocabulary))
  );
}

/**
 * The row for a pane: the gateway's resolved keys and actions, an editor's own
 * commands on an older gateway, filtered to what the backend can deliver and
 * ordered by how often each has been pressed on this server for this kind of
 * pane. See the terminal screen for the reasoning behind each rule; this is
 * that code, moved so the drawer draws the same row.
 */
export function resolveTerminalKeys({
  serverId,
  shortcuts,
  vocabulary,
  fullScreenPane = false,
  lazygitPane = false,
  nvimMode = null,
}: {
  serverId: string;
  shortcuts: PaneShortcuts | null;
  vocabulary: KeyboardVocabulary | undefined;
  fullScreenPane?: boolean;
  lazygitPane?: boolean;
  nvimMode?: 'insert' | 'normal' | null;
}): TerminalKey[] {
  const deliverable = (item: TerminalKey) => keyDeliverable(item, vocabulary);
  // Every nvim verb on the row -- `dd`, `u`, even bare `:` -- is a normal-mode
  // command. While nvim is typing every keystroke into the buffer, pressing
  // any of them types its literal characters instead of doing what its label
  // says. The usage-ordered row is deliberately not used here either, so Esc
  // stays first no matter how often the other keys have been pressed.
  if (fullScreenPane && nvimMode === 'insert') {
    return (shortcuts ? terminalKeysFromGateway(shortcuts.keys) : [])
      .filter(deliverable)
      .filter((item) => ['esc', 'enter', 'tab', 'ctrl+c', 'backspace'].includes(item.key))
      .map((item) => (item.key === 'esc' ? { ...item, emphasis: true } : item));
  }
  const resolved = shortcuts
    ? terminalKeysFromGateway([...shortcuts.keys, ...(shortcuts.keyActions ?? [])])
    : [];
  // Older Gateways have no keyActions field. Keep their editor shortcuts
  // usable until the installed Gateway is updated; a current Gateway is
  // authoritative for both the dock and the virtual keyboard.
  const base =
    shortcuts?.keyActions === undefined
      ? fullScreenPane && !lazygitPane
        ? withEditorActions(withCommonTerminalCombinations(resolved))
        : withCommonTerminalCombinations(resolved)
      : resolved;
  const scope = shortcuts ? usageScope(serverId, shortcuts.profile, 'keys') : null;
  return orderByUsage(
    base.filter(deliverable),
    scope ? loadUsage()[scope] : undefined,
    (item) => item.key
  );
}

export type TerminalKeyDelivery =
  | { kind: 'keys'; keys: string[] }
  /** Characters the gateway cannot take as keys: a paste, submitted or not. */
  | { kind: 'text'; text: string; submit: boolean };

/**
 * What one press of a key sends. A cap made of characters is still a key the
 * reader pressed, so it goes as keys: `:` has to open nvim's command line
 * rather than arrive in the buffer, and `dd` has to delete a line rather than
 * type two. The submit rides in the same request, so an Enter cannot land
 * between two halves of a command line. Only characters the gateway rejects
 * as key names fall back to a paste (`lib/pane-input`).
 */
export function terminalKeyDelivery(item: TerminalKey): TerminalKeyDelivery {
  if (item.text === undefined) return { kind: 'keys', keys: item.keys ?? [item.key] };
  if (isSendableAsKeystrokes(item.text)) {
    return { kind: 'keys', keys: paneKeystrokes(item.text, { submit: item.submit === true }) };
  }
  return { kind: 'text', text: item.text, submit: item.submit === true };
}
