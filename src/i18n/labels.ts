// Display strings for values the domain layer models as enums.
//
// Two constraints shaped this file, and neither is obvious from the outside.
//
// **Why the wording is not beside the logic it describes.** `bun test`
// transpiles with Bun, not Babel, so it never expands Lingui's macros: any
// module a test imports cannot contain `t` or `<Trans>`. The modules concerned
// -- `pane-view-mode`, `server-reachability`, `pane-approval` -- are pure rules
// with real test suites, and they should stay that way. So the domain layer
// decides *which* state something is in, and this file says what that state is
// called.
//
// **Why these are descriptors and not strings.** React Compiler is enabled, and
// it will happily memoize a `t\`...\`` call whose arguments have not changed --
// it cannot see that the result also depends on the active locale. The symptom
// is a screen that half-translates: `<Trans>` elements switch language and
// everything built from a `t` call keeps the old one. A `msg` descriptor is
// inert, so there is nothing to over-cache; the translation happens at the call
// site through `_` from `useLingui()`, which the compiler *can* see change.
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

import type { NamedApprovalDecision } from '@/lib/pane-approval';
import type { PaneViewMode } from '@/lib/pane-view-mode';
import type { ServerReachability } from '@/lib/server-reachability';

/**
 * What the card says out loud next to the dot.
 *
 * Upper case is baked into the English rather than applied with a transform,
 * because case is a language's business: `text-transform: uppercase` on Traditional Chinese
 * does nothing, and on some scripts it does something wrong.
 */
export const reachabilityLabel: Record<ServerReachability, MessageDescriptor> = {
  live: msg`ONLINE`,
  offline: msg`OFFLINE`,
  unknown: msg`NOT CONNECTED`,
};

/** The same fact, said in full for a screen reader. */
export const reachabilityDescription: Record<ServerReachability, MessageDescriptor> = {
  live: msg`Online`,
  offline: msg`Offline, not answering`,
  unknown: msg`Not connected`,
};

export const paneViewModeLabel: Record<PaneViewMode, MessageDescriptor> = {
  chat: msg`Chat`,
  text: msg`Text`,
  terminal: msg`Terminal`,
};

export const paneViewModeDetail: Record<PaneViewMode, MessageDescriptor> = {
  chat: msg`The transcript as a conversation, with tool steps folded away.`,
  text: msg`Agent output reflowed for reading. Colour is lost.`,
  terminal: msg`The raw pane, on its grid and in its own colours.`,
};

/**
 * "Switch to the chat view", said in full for each mode.
 *
 * It used to be `Switch to the ${label.toLowerCase()} view`, which quietly
 * assumed two things English happens to allow: that a word has a lower-case
 * form, and that a sentence can be built by dropping a noun into a slot. Traditional Chinese
 * has no case at all, so `toLowerCase()` is a no-op there -- and the sentence a
 * translator wants to write is not a template with a hole in it.
 */
export const switchToViewLabel: Record<PaneViewMode, MessageDescriptor> = {
  chat: msg`Switch to the chat view`,
  text: msg`Switch to the text view`,
  terminal: msg`Switch to the terminal view`,
};

/**
 * The three conflicts an approval can lose to.
 *
 * `pane-approval.ts` maps the gateway's error `code` onto one of these keys;
 * the codes are wire vocabulary and stay English, the sentences do not.
 */
export const approvalConflictMessage: Record<string, MessageDescriptor> = {
  approval_changed: msg`The agent is asking something else now.`,
  approval_not_pending: msg`The agent is no longer waiting.`,
  decision_unavailable: msg`This agent did not offer that answer.`,
};

/**
 * Names for the built-in quick commands, keyed by the ids in
 * `quick-commands.ts`. A custom command keeps the name its owner typed; the
 * command and prompt *values* stay English everywhere, because they are input
 * for the terminal or the agent, not copy about them.
 */
export const quickCommandName: Record<string, MessageDescriptor> = {
  'terminal-status': msg`Git status`,
  'terminal-diff': msg`Diff summary`,
  'terminal-pull': msg`Pull`,
  'terminal-log': msg`Recent commits`,
  'terminal-path': msg`Current path`,
  'terminal-clear': msg`Clear terminal`,
  'terminal-ctrl-c': msg`Interrupt`,
  'terminal-ctrl-z': msg`Suspend`,
  'terminal-escape': msg`Escape`,
  'terminal-clear-line': msg`Clear line`,
  'agent-summary': msg`Summarize progress`,
  'agent-tests': msg`Run relevant tests`,
  'agent-continue': msg`Continue task`,
  'agent-commit': msg`Commit`,
  'agent-commit-push': msg`Commit & push`,
};

/**
 * The status word beside an agent's dot. The domain hands over the wire
 * status; anything this map does not recognise reads as unknown rather than
 * echoing wire vocabulary at the user.
 */
export const agentStatusWord: Record<string, MessageDescriptor> = {
  working: msg`Working`,
  blocked: msg`Blocked`,
  done: msg`Done`,
  idle: msg`Idle`,
  unknown: msg`Unknown`,
};

/**
 * The buttons on an approval push notification, by the decision each answers
 * with. `approval-notifications` registers these against the OS category at
 * startup and again whenever push registration re-runs, which is also what
 * refreshes them after a language switch.
 */
export const approvalActionTitle: Record<NamedApprovalDecision, MessageDescriptor> = {
  allow: msg`Approve`,
  allow_always: msg`Approve and don't ask again`,
  deny: msg`Deny`,
};

/** Day headings for grouped files. `artifact-groups` picks the bucket; this names it. */
export const artifactGroupLabel: Record<'today' | 'yesterday' | 'unknown', MessageDescriptor> = {
  today: msg`Today`,
  yesterday: msg`Yesterday`,
  unknown: msg`Unknown date`,
};

/**
 * What each of the editor's own key-row commands does, said in full.
 *
 * Keyed by the identity in `EDITOR_ACTIONS` (`@/lib/terminal-keys`), which is a
 * pure module with a test suite and therefore cannot hold a macro. The cap on
 * the key -- `:w`, `dd` -- is vim's vocabulary and stays as it is in every
 * language; this is the sentence a screen reader says and the tooltip a reader
 * who does not know vim needs.
 */
export const editorActionDescription: Record<string, MessageDescriptor> = {
  'nvim:search': msg`Search`,
  'nvim:cmd': msg`Command mode`,
  'nvim:w': msg`Write the file`,
  'nvim:wq': msg`Write the file and quit`,
  'nvim:q': msg`Quit`,
  'nvim:i': msg`Insert mode`,
  'nvim:v': msg`Visual mode`,
  'nvim:dd': msg`Delete this line`,
  'nvim:yy': msg`Yank this line`,
  'nvim:p': msg`Paste`,
  'nvim:u': msg`Undo`,
  'nvim:gg': msg`Go to the top of the file`,
  // The leader combos. The cap shows `␣gg`; this says what it opens, because
  // nothing about the keys does.
  'nvim:leader:e': msg`Open the file explorer`,
  'nvim:leader:ff': msg`Find a file by name`,
  'nvim:leader:gg': msg`Open Lazygit`,
  'nvim:leader:sg': msg`Search the whole project`,
  'nvim:leader:,': msg`Switch between open files`,
};

/**
 * What a screen reader says about every other key on the terminal row.
 *
 * `editorActionDescription` above covers the fifteen `nvim:` actions, and until
 * now it was the only table the row consulted: every key that was not one of
 * those -- `esc`, `⌃C`, the arrows, the whole shell editing set, everything each
 * agent advertises -- fell through to the English `accessibilityLabel` baked
 * into `@/lib/terminal-keys`. That module is pure and under test, so it cannot
 * hold a macro; the strings had nowhere to be translated and were spoken in
 * English on a Traditional Chinese phone.
 *
 * **Keyed by the English label, not by the key name.** The same key means
 * different things in different rows -- `ctrl+r` is reverse search at a shell,
 * the transcript in Claude Code, and redo in an editor -- so a table keyed by
 * `ctrl+r` would have to pick one of the three and be wrong twice. The English
 * string is what actually distinguishes them, and it is also what makes this
 * work for the gateway-resolved rows: `terminalKeysFromGateway` puts the
 * gateway's own `description` in the same field, so a description that matches
 * one of ours is translated here and anything else keeps the gateway's text,
 * which the gateway has already localised from `X-Muqun-Locale`.
 *
 * The cap stays as it is. `⌃C` and `⇧TAB` are the terminal's vocabulary in
 * every language; this is only what is said about them out loud.
 */
export const terminalKeyDescription: Record<string, MessageDescriptor> = {
  // Answering a prompt and getting out of one.
  Enter: msg`Enter`,
  'Shift Enter, newline without sending': msg`Shift Enter, newline without sending`,
  Escape: msg`Escape`,
  Tab: msg`Tab`,
  'Control C': msg`Control C`,
  Backspace: msg`Backspace`,
  // Line editing and history at a shell prompt.
  'Control D': msg`Control D`,
  'Control A, start of line': msg`Control A, start of line`,
  'Control E, end of line': msg`Control E, end of line`,
  'Control K, clear to end of line': msg`Control K, clear to end of line`,
  'Control U, clear line': msg`Control U, clear line`,
  'Control W, delete word': msg`Control W, delete word`,
  'Control Y, paste': msg`Control Y, paste`,
  'Control P, previous': msg`Control P, previous`,
  'Control N, next': msg`Control N, next`,
  'Control R, reverse search': msg`Control R, reverse search`,
  'Control Z, suspend': msg`Control Z, suspend`,
  'Control L, clear screen': msg`Control L, clear screen`,
  // Moving around.
  'Left arrow': msg`Left arrow`,
  'Down arrow': msg`Down arrow`,
  'Up arrow': msg`Up arrow`,
  'Right arrow': msg`Right arrow`,
  'Back one word': msg`Back one word`,
  'Forward one word': msg`Forward one word`,
  // What each agent's own footer advertises.
  'Shift Tab, cycle mode': msg`Shift Tab, cycle mode`,
  'Shift Tab': msg`Shift Tab`,
  'Control O, expand': msg`Control O, expand`,
  'Control O, expand rows': msg`Control O, expand rows`,
  'Control T, toggle tasks': msg`Control T, toggle tasks`,
  'Control B, run in background': msg`Control B, run in background`,
  'Control R, transcript': msg`Control R, transcript`,
  'Control R': msg`Control R`,
  'Control E, explain': msg`Control E, explain`,
  // A modal editor's window and scroll motions.
  'Control W, window prefix': msg`Control W, window prefix`,
  'Control D, half page down': msg`Control D, half page down`,
  'Control U, half page up': msg`Control U, half page up`,
  'Control O, jump back': msg`Control O, jump back`,
  'Control R, redo': msg`Control R, redo`,
  'Control V, visual block': msg`Control V, visual block`,
};

/**
 * A mode outside the union resolves to `terminal` rather than to `undefined`.
 *
 * The settings row reads a detail straight into a `<Text>`, so a mode added to
 * the type without an entry here would hand it `undefined` -- which is a crash,
 * not a missing sentence. `terminal` is the mode with no interpretation in it,
 * which makes it the right answer of last resort.
 */
export function paneViewModeFallback(mode: PaneViewMode): PaneViewMode {
  return mode in paneViewModeLabel ? mode : 'terminal';
}
