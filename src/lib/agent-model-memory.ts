import { createMMKV } from 'react-native-mmkv';

import { parseModelRef, type ModelRef } from './agent-protocol';
import type { RememberedAgentChoice, RememberedAgentDefaults } from './agent-session-defaults';

/**
 * The model and agent the reader last chose, per gateway server and workspace.
 *
 * A new session should open on the model the reader was last using, and "last"
 * has to outlive the process: the picker is opened once and then not again for
 * days. So the pick is written here when it is made, and read back when a
 * session is created -- see `agent-session-defaults.ts` for what outranks what.
 *
 * Per workspace, because a workspace is where the choice was made: the model
 * that suits a large TypeScript app is not the one a notes directory wants. A
 * workspace opened for the first time has nothing of its own, so the server
 * keeps a single "last pick anywhere" as well, which is a better first guess
 * than the engine default and is what the fallback exists for.
 *
 * MMKV is a native module, and an over-the-air update can reach a binary built
 * before it was added, so creating the store there throws. The in-memory
 * fallback is `theme-tab-preference.ts`'s, for the same reason: the memory
 * stops surviving a launch until the native binary catches up, which is a
 * feature degrading rather than a crash.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.agent-ui';
const KEY_PREFIX = 'muqun.agent-model.v1:';

/**
 * How many workspaces one server remembers.
 *
 * A directory is a key, and a reader who visits a hundred of them should not
 * carry a hundred rows forever. The oldest pick is the one nobody is coming
 * back for, and dropping it costs that workspace the server-wide fallback
 * rather than nothing at all.
 */
const MAX_WORKSPACES = 24;

/** A stored pick, with the moment it was made so the oldest can be dropped. */
interface StoredChoice extends RememberedAgentChoice {
  at: number;
}

interface StoredServerMemory {
  /** The last pick on this server, whichever workspace it was made in. */
  last?: StoredChoice;
  /** The last pick in each workspace directory. */
  workspaces: Record<string, StoredChoice>;
}

const EMPTY_MEMORY: StoredServerMemory = { workspaces: {} };

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

let storageInstance: KeyValueStore | null = null;
function store(): KeyValueStore {
  if (!storageInstance) storageInstance = openStore();
  return storageInstance;
}

function parseChoice(value: unknown): StoredChoice | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const model = parseModelRef(rec.model) ?? undefined;
  const agent = typeof rec.agent === 'string' && rec.agent ? rec.agent : undefined;
  if (!model && !agent) return undefined;
  const at = typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : 0;
  return { ...(model ? { model } : {}), ...(agent ? { agent } : {}), at };
}

function readServerMemory(serverId: string): StoredServerMemory {
  try {
    const raw = store().getString(KEY_PREFIX + serverId);
    if (!raw) return EMPTY_MEMORY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_MEMORY;
    const rec = parsed as Record<string, unknown>;
    const workspaces: Record<string, StoredChoice> = {};
    const stored = rec.workspaces;
    if (stored && typeof stored === 'object') {
      for (const [directory, entry] of Object.entries(stored as Record<string, unknown>)) {
        const choice = parseChoice(entry);
        if (choice) workspaces[directory] = choice;
      }
    }
    const last = parseChoice(rec.last);
    return { ...(last ? { last } : {}), workspaces };
  } catch {
    // Unreadable is the same as unwritten: the reader loses the memory, not the
    // screen. Nothing here is worth telling them about.
    return EMPTY_MEMORY;
  }
}

function writeServerMemory(serverId: string, memory: StoredServerMemory): void {
  try {
    store().set(KEY_PREFIX + serverId, JSON.stringify(memory));
  } catch {
    // See above.
  }
}

/** Newest first, capped, so one server's memory cannot grow without bound. */
function prune(workspaces: Record<string, StoredChoice>): Record<string, StoredChoice> {
  const entries = Object.entries(workspaces);
  if (entries.length <= MAX_WORKSPACES) return workspaces;
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_WORKSPACES));
}

/**
 * Both halves of one pick, so remembering a model does not forget the agent
 * that was remembered beside it.
 */
function mergeChoice(
  previous: StoredChoice | undefined,
  choice: RememberedAgentChoice,
  at: number
): StoredChoice {
  const model = choice.model ?? previous?.model;
  const agent = choice.agent ?? previous?.agent;
  return { ...(model ? { model } : {}), ...(agent ? { agent } : {}), at };
}

/**
 * Records a pick the *reader* made -- in the model sheet or the mode sheet.
 *
 * Not called for a default the app merely observed: the catalog's `defaults`
 * and the model a session came back carrying are the host's answer, and
 * writing those down would make this app's memory a copy of the host's
 * configuration rather than a record of what the reader wanted.
 */
export function rememberAgentChoice(
  serverId: string,
  directory: string | undefined,
  choice: RememberedAgentChoice,
  atMs: number = Date.now()
): void {
  if (!serverId) return;
  if (!choice.model && !choice.agent) return;
  const memory = readServerMemory(serverId);
  const workspaces = { ...memory.workspaces };
  if (directory) {
    workspaces[directory] = mergeChoice(workspaces[directory], choice, atMs);
  }
  writeServerMemory(serverId, {
    last: mergeChoice(memory.last, choice, atMs),
    workspaces: prune(workspaces),
  });
}

/** Remembers the model, leaving whatever agent was remembered beside it. */
export function rememberAgentModel(
  serverId: string,
  directory: string | undefined,
  model: ModelRef
): void {
  rememberAgentChoice(serverId, directory, { model });
}

/** Remembers the agent, leaving whatever model was remembered beside it. */
export function rememberAgentMode(
  serverId: string,
  directory: string | undefined,
  agent: string
): void {
  rememberAgentChoice(serverId, directory, { agent });
}

/**
 * What this server remembers, for the workspace on screen and in general.
 *
 * Both are handed back rather than one resolved answer: which of them wins is
 * `resolveNewSessionDefaults`'s decision, and it is made per field and against
 * the catalog the screen currently holds.
 */
export function loadRememberedAgentDefaults(
  serverId: string,
  directory?: string
): RememberedAgentDefaults {
  if (!serverId) return {};
  const memory = readServerMemory(serverId);
  const workspace = directory ? memory.workspaces[directory] : undefined;
  return {
    ...(workspace ? { workspace: choiceOf(workspace) } : {}),
    ...(memory.last ? { server: choiceOf(memory.last) } : {}),
  };
}

/** The pick without the bookkeeping the caller has no use for. */
function choiceOf(stored: StoredChoice): RememberedAgentChoice {
  return {
    ...(stored.model ? { model: stored.model } : {}),
    ...(stored.agent ? { agent: stored.agent } : {}),
  };
}
