/**
 * What a pane's composer can offer, as the gateway describes it: the slash
 * commands the agent understands, and whether an `@` file mention makes sense
 * there.
 *
 * The descriptor rides on the parts envelope (`data.pane.composer`, schema
 * 1.3.0 and up) rather than on an endpoint of its own, so a client that already
 * reads a pane's transcript learns what its composer can do for free -- no
 * second request, and no request at all against a gateway that predates it.
 *
 * Two rules, both inherited from `pane-parts.ts` and both load-bearing:
 *
 * 1. **Absent means absent.** An agent with no table, or a gateway too old to
 *    have one, simply carries no `composer` object. That is a supported answer,
 *    not a failure: the app falls back to typing, and `/` is a plain character.
 * 2. **Nothing here names an agent.** Which commands Claude has and which
 *    Codex has is the gateway's business; this module only reads the shape.
 */
import type { ComposerTrigger } from './composer-popup';

/** One entry in the pane's catalog. */
export interface PaneSlashCommand {
  /**
   * The literal text to send, leading slash included, exactly as the gateway
   * writes it. Never re-derived here: a table that one day names a command
   * something other than `/name` must still round-trip.
   */
  name: string;
  description: string;
  /**
   * What may follow the command, in the agent's own words. Empty when the
   * command runs exactly as typed.
   */
  argsHint: string;
  /**
   * `workspace` is a command this repository added -- a skill or a command
   * file -- rather than one the agent ships with. Worth marking: it is the one
   * distinction a user cannot infer from the name.
   */
  source: 'builtin' | 'workspace';
}

export interface PaneComposer {
  /** Bumped by the gateway whenever a table changes, so a cache can be dropped. */
  version: number;
  /** Which table answered, e.g. `claude`. */
  table: string;
  /** The program version the table was read off, e.g. `claude 2.1.220`. */
  capturedFrom: string;
  slashCommands: PaneSlashCommand[];
  /** Whether `@` file mentions mean anything to this agent. Drives #614. */
  fileMentions: boolean;
}

/**
 * Read the descriptor off a parts envelope, or `null` when there is none.
 *
 * `understood` is the caller's schema-major check: a major version this build
 * has never seen may have moved the descriptor or changed what its fields mean,
 * so it is not guessed at -- exactly the treatment an unknown part gets.
 */
export function paneComposerFromResponse(value: unknown, understood = true): PaneComposer | null {
  if (!understood || !value || typeof value !== 'object') return null;
  const envelope = value as Record<string, unknown>;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;
  const pane = data.pane;
  if (!pane || typeof pane !== 'object') return null;
  const raw = (pane as Record<string, unknown>).composer;
  if (!raw || typeof raw !== 'object') return null;
  const composer = raw as Record<string, unknown>;

  const slashCommands = normalizeSlashCommands(composer.slash_commands);
  const fileMentions = composer.file_mentions === true;
  // A descriptor with neither half offers nothing a composer could draw, and
  // reporting it as present would light up chrome with an empty list behind it.
  if (slashCommands.length === 0 && !fileMentions) return null;

  return {
    version: typeof composer.version === 'number' ? composer.version : 0,
    table: typeof composer.table === 'string' ? composer.table : '',
    capturedFrom: typeof composer.captured_from === 'string' ? composer.captured_from : '',
    slashCommands,
    fileMentions,
  };
}

/**
 * The catalog as the composer's popup machine wants it: `/` at offset 0 only,
 * because a slash command is the whole message rather than a word inside one.
 *
 * The row inserts `name` verbatim -- rule 1 of `composer-popup.ts` -- and shows
 * `argsHint` as a placeholder rather than inserting it, since `[instructions]`
 * is a prompt to the user and would be nonsense in the agent's inbox.
 */
export function slashCommandTrigger(
  commands: readonly PaneSlashCommand[]
): ComposerTrigger<PaneSlashCommand> {
  return {
    char: '/',
    anchor: 'start',
    // Not every catalog is a slash catalog: an editor pane's table is `:w`,
    // `:q`, `:wq`, and offering those under a typed "/" would be the app
    // inventing a command surface the pane does not have. A `:` picker is its
    // own trigger, and until there is one those entries simply do not appear.
    items: commands.filter((command) => command.name.startsWith('/')),
    present: (command) => ({
      id: command.name,
      label: command.name,
      description: command.description,
      hint: command.argsHint,
      badge: command.source === 'workspace' ? 'workspace' : '',
      insert: command.name,
    }),
    // The description is searched too, but only after every name has had its
    // turn: a user who remembers what a command does and not what it is called
    // ("context" for "free up context") still finds it, without a description
    // hit ever outranking the command actually named that.
    searchText: (command) => [command.name, command.description],
  };
}

function normalizeSlashCommands(value: unknown): PaneSlashCommand[] {
  if (!Array.isArray(value)) return [];
  const commands: PaneSlashCommand[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    commands.push({
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      argsHint: typeof raw.args_hint === 'string' ? raw.args_hint : '',
      source: raw.source === 'workspace' ? 'workspace' : 'builtin',
    });
  }
  return commands;
}
