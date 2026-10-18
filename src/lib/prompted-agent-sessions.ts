/**
 * Sessions Home's dock has just created and sent a prompt to.
 *
 * The dock opens such a session as an existing one, and its first snapshot can
 * come back before the engine has mirrored the prompt: an empty timeline, which
 * the workbench would otherwise draw as the new-session welcome card. A mark
 * here tells it to keep its loading state instead for a short while. In memory
 * only, keyed by computer and session; the goal text never travels.
 */

/** Long enough for the engine to mirror a prompt; short enough never to stick. */
export const PROMPTED_SESSION_WAIT_MS = 15_000;

const marks = new Map<string, number>();

function key(serverId: string, asid: string): string {
  return `${serverId}\u0000${asid}`;
}

export function markPromptedSession(serverId: string, asid: string, nowMs = Date.now()): void {
  marks.set(key(serverId, asid), nowMs);
}

/** How much longer the workbench should wait for the first row; 0 when it should not. */
export function promptedSessionWaitMs(
  serverId: string,
  asid: string | undefined,
  nowMs = Date.now()
): number {
  if (!asid) return 0;
  const at = marks.get(key(serverId, asid));
  if (at === undefined) return 0;
  const left = at + PROMPTED_SESSION_WAIT_MS - nowMs;
  if (left <= 0) marks.delete(key(serverId, asid));
  return Math.max(0, left);
}
