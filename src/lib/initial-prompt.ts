/**
 * The first prompt of a session Home's composer asked for, sent exactly once.
 *
 * The prompt travels to the workbench on the route (`/agent` or the Pad's
 * `/servers/[serverId]`), and a route's params outlive any one mount of the
 * screen under them: the workbench is remounted when its tunnel reconnects or
 * the Pad detail waits for a selection, and each of those mounts reads the same
 * params. A ref inside the workbench only guards one mount. This ledger guards
 * the request: the Home command offers the prompt as it navigates, and the
 * workbench claims it when it is ready to send. A second mount finds nothing
 * to claim; so does a deep link that merely carries a `prompt` param, which is
 * never offered and therefore never sent on its own.
 *
 * Counted rather than a set, so the same goal sent twice from Home is two
 * offers and two sends.
 */

const offered = new Map<string, number>();

function promptKey(serverId: string, prompt: string): string {
  return JSON.stringify([serverId, prompt]);
}

/** The Home command is navigating to a new session that should start with `prompt`. */
export function offerInitialPrompt(serverId: string, prompt: string): void {
  const key = promptKey(serverId, prompt);
  offered.set(key, (offered.get(key) ?? 0) + 1);
}

/** The navigation that offered `prompt` did not happen. */
export function withdrawInitialPrompt(serverId: string, prompt: string): void {
  claimInitialPrompt(serverId, prompt);
}

/** True once per offer: the caller is the one that sends `prompt`. */
export function claimInitialPrompt(serverId: string, prompt: string): boolean {
  const key = promptKey(serverId, prompt);
  const count = offered.get(key) ?? 0;
  if (count <= 0) return false;
  if (count === 1) offered.delete(key);
  else offered.set(key, count - 1);
  return true;
}
