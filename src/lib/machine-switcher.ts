import type { SessionChoice } from './session-switcher';

/** A machine with multiple sessions needs an explicit pick; IDs are server-scoped. */
export function machineSessionTarget(
  choices: readonly SessionChoice[],
  requested?: string
): string | null {
  if (requested) return choices.find((choice) => choice.id === requested)?.id ?? null;
  return choices.length === 1 ? choices[0].id : null;
}

/** Never change the active machine until its own session request succeeds. */
export async function inspectMachine({
  load,
  current,
  choose,
  requested,
}: {
  load: () => Promise<SessionChoice[]>;
  current: () => boolean;
  choose: (sessionId: string) => Promise<void>;
  requested?: string;
}): Promise<SessionChoice[] | null> {
  const choices = await load();
  if (!current()) return null;
  if (!choices.length) throw new Error('No sessions');
  const target = machineSessionTarget(choices, requested);
  if (target) await choose(target);
  return current() ? choices : null;
}
