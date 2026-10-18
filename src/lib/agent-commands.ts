import type { ComposerTrigger } from './composer-popup';
import { isSlashSkill, type CommandInfo, type SkillInfo } from './agent-protocol';

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
  | 'keep'
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
  Object.freeze({ id: 'keep' as const, name: '/keep' }),
  Object.freeze({ id: 'compact' as const, name: '/compact' }),
  Object.freeze({ id: 'clear' as const, name: '/clear' }),
  Object.freeze({ id: 'export' as const, name: '/export' }),
]);

/** The bare name, without the slash and without its arguments. */
export function commandKey(name: string): string {
  return name.trim().replace(/^\//, '').split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

export type SlashCommand =
  | { kind: 'client'; name: AgentClientCommandId; args: string }
  | { kind: 'server'; name: string; args: string }
  /** A catalog skill, run by `POST …/skill {skill}`. `name` is its id. */
  | { kind: 'skill'; name: string; args: string };

/**
 * What a typed line is, or `null` when it is an ordinary prompt.
 *
 * The host's catalog wins over the app's list, because a host that ships its
 * own `/review` means that one; the app's entries are the fallback for the
 * names no catalog claims. A line that starts with a slash and matches nothing
 * is a prompt: a model is perfectly able to be asked about `/etc/hosts`.
 *
 * Skills sit between the two, and for the same reason commands sit above them:
 * both come from the host, and a skill the host offers as a slash line is
 * something the reader chose to install. Only the ones marked `slash` count --
 * the rest are the agent's own to reach for, and a `/`-line naming one of them
 * used to go out as prose, which is the whole of what this routing is for.
 */
export function readSlashCommand(
  text: string,
  serverCommands: readonly CommandInfo[],
  skills: readonly SkillInfo[] = []
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

  const skill = skills.find((entry) => isSlashSkill(entry) && entry.id.toLowerCase() === key);
  if (skill) return { kind: 'skill', name: skill.id, args };

  const client = AGENT_CLIENT_COMMANDS.find((command) => commandKey(command.name) === key);
  if (client) return { kind: 'client', name: client.id, args };

  return null;
}

/** Whether a name is one the app answers itself. */
export function isClientCommand(name: string): name is AgentClientCommandId {
  return AGENT_CLIENT_COMMANDS.some((command) => command.id === name);
}

/**
 * A `$` line the reader typed to run a catalog skill.
 *
 * Same split as a slash command: the first word is the skill id, the rest are
 * arguments. Every skill the screen was given counts, including the ones the
 * slash menu hides. A `$` that names nothing is a prompt, the way an unknown
 * slash is. `#` can grow a reader of its own beside this one; it is not parsed
 * here.
 */
export function readSkillInvocation(
  text: string,
  skills: readonly SkillInfo[]
): { name: string; args: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('$')) return null;
  const body = trimmed.slice(1);
  const space = body.search(/\s/);
  const key = (space < 0 ? body : body.slice(0, space)).toLowerCase();
  if (!key) return null;
  const args = space < 0 ? '' : body.slice(space).trim();
  const skill = skills.find((entry) => entry.id.toLowerCase() === key);
  if (!skill) return null;
  return { name: skill.id, args };
}

function skillRowDescription(skill: SkillInfo): string {
  if (skill.name && skill.description && skill.name.toLowerCase() !== skill.id.toLowerCase()) {
    return `${skill.name} · ${skill.description}`;
  }
  return skill.description || skill.name;
}

/**
 * `$` at the start of the draft, over every skill the screen was given.
 *
 * An empty list is not a popup: `readComposerPopup` treats that as a plain
 * character. The row inserts `$<id>` and the shared pick adds one trailing
 * space, because a skill can take arguments after its name.
 */
export function skillPopupTrigger(skills: readonly SkillInfo[]): ComposerTrigger<SkillInfo> {
  return {
    char: '$',
    anchor: 'start',
    items: skills,
    present: (skill) => ({
      id: skill.id,
      label: `$${skill.id}`,
      description: skillRowDescription(skill),
      hint: '',
      badge: '',
      insert: `$${skill.id}`,
    }),
    searchText: (skill) => [skill.id, skill.name, skill.description],
  };
}
