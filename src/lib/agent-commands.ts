import type { CommandInfo } from './agent-protocol';

/**
 * What a slash command is, and who runs it.
 *
 * Every entry in the composer's menu used to be a literal that was inserted
 * into the draft and then sent to the model as text -- `/init`, `/review`,
 * `/mode`, `/model`, `/help`, `/compact` -- and whatever the model made of the
 * prose was the result. Half of them are the app's own navigation and cannot
 * be anything a model does; the rest are the *host's*, listed by
 * `GET /api/agent-catalog` and run by `POST …/command {name, arguments}`.
 *
 * Pure, so the routing can be tested: which of the two a typed line is, what
 * its arguments are, and what happens to a line that is neither.
 */

/** The commands this app answers itself. */
export type AgentClientCommandId =
  | 'new'
  | 'sessions'
  | 'models'
  | 'agents'
  | 'undo'
  | 'redo'
  | 'compact'
  | 'clear'
  | 'export';

export interface AgentClientCommand {
  id: AgentClientCommandId;
  /** The literal the reader types, leading slash included. */
  name: string;
}

export const AGENT_CLIENT_COMMANDS: readonly AgentClientCommand[] = Object.freeze([
  Object.freeze({ id: 'new' as const, name: '/new' }),
  Object.freeze({ id: 'sessions' as const, name: '/sessions' }),
  Object.freeze({ id: 'models' as const, name: '/models' }),
  Object.freeze({ id: 'agents' as const, name: '/agents' }),
  Object.freeze({ id: 'undo' as const, name: '/undo' }),
  Object.freeze({ id: 'redo' as const, name: '/redo' }),
  Object.freeze({ id: 'compact' as const, name: '/compact' }),
  Object.freeze({ id: 'export' as const, name: '/export' }),
]);

/** The bare name, without the slash and without its arguments. */
export function commandKey(name: string): string {
  return name.trim().replace(/^\//, '').split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

export type SlashCommand =
  | { kind: 'client'; name: AgentClientCommandId; args: string }
  | { kind: 'server'; name: string; args: string };

/**
 * What a typed line is, or `null` when it is an ordinary prompt.
 *
 * The host's catalog wins over the app's list, because a host that ships its
 * own `/review` means that one; the app's entries are the fallback for the
 * names no catalog claims. A line that starts with a slash and matches nothing
 * is a prompt: a model is perfectly able to be asked about `/etc/hosts`.
 */
export function readSlashCommand(
  text: string,
  serverCommands: readonly CommandInfo[]
): SlashCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  // Split on the first run of whitespace rather than searching for the key:
  // the key is lower-cased and the typed line is not, so `indexOf` on it finds
  // the wrong offset for `/EXPORT` and hands back "RT" as the arguments.
  const body = trimmed.slice(1);
  const space = body.search(/\s/);
  const key = (space < 0 ? body : body.slice(0, space)).toLowerCase();
  if (!key) return null;
  const args = space < 0 ? '' : body.slice(space).trim();

  const server = serverCommands.find((command) => commandKey(command.name) === key);
  if (server) return { kind: 'server', name: server.name, args };

  const client = AGENT_CLIENT_COMMANDS.find((command) => commandKey(command.name) === key);
  if (client) return { kind: 'client', name: client.id, args };

  return null;
}

/** Whether a name is one the app answers itself. */
export function isClientCommand(name: string): name is AgentClientCommandId {
  return AGENT_CLIENT_COMMANDS.some((command) => command.id === name);
}
