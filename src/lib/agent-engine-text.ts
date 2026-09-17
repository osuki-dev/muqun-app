/**
 * Engine prose the app restates in its own words.
 *
 * OpenCode writes for its own terminal UI, and two of the sentences it sends
 * are wire vocabulary wearing a sentence's clothes: a permission prompt that
 * leads with the rule key that produced it (`external_directory: /etc/*`), and
 * a failed tool whose message is "The user declined this tool call" -- a third
 * word for an act this app already calls "Deny" on the button and "Denied" in
 * the tray.
 *
 * Pure, so the matching is stated once and tested once; the wording that
 * replaces it belongs to `@/i18n/labels`, because a pure module cannot hold a
 * Lingui macro.
 */

/**
 * The one line a permission is about, with the rule key taken off the front.
 *
 * The card already says what the rule *means* -- "Read outside the workspace"
 * -- so a prompt of `external_directory: /etc/*` repeats the key and buries
 * the path. Only the request's own action is stripped: a prompt that happens
 * to contain a colon keeps every character of itself.
 */
export function permissionSubject(request: {
  action: string;
  prompt: string;
  resources: readonly string[];
}): string {
  const prompt = request.prompt.trim();
  const subject = prompt || request.resources[0] || '';
  const action = request.action.trim();
  if (!action || !subject) return subject;
  const prefix = `${action}:`;
  if (subject.toLowerCase().startsWith(prefix.toLowerCase())) {
    const rest = subject.slice(prefix.length).trim();
    // A prompt that is nothing but the key is still worth one line; the
    // resource says it better, and failing that the key is all there is.
    if (rest) return rest;
    return request.resources[0] || subject;
  }
  return subject;
}

/**
 * Whether a failed tool failed because the reader said no.
 *
 * The engine phrases it at least three ways -- declined, denied, rejected --
 * and all three are the same act, which this app names once. Deliberately
 * narrow: "permission denied" from a filesystem is a real error and not this.
 */
export function isDeclinedByUser(message: string): boolean {
  const text = message.trim().toLowerCase();
  if (!text) return false;
  return (
    /^(the\s+)?user\s+(declined|denied|rejected)\b/.test(text) ||
    /\b(declined|denied|rejected)\s+by\s+(the\s+)?user\b/.test(text)
  );
}
