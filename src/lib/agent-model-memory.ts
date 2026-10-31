import { createMMKV } from 'react-native-mmkv';

import { agentIdQueryValue } from './agent-discovery';
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
 * fallback is `shortcut-usage.ts`'s, for the same reason: the memory
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
 * Where one server's memory lives, per agent.
 *
 * A model picked for DeepSeek is not a model OpenCode can run, so each agent
 * remembers on its own. The default agent keeps the key it always had, so a
 * device upgraded under a reader loses none of what it remembered.
 */
function memoryKey(serverId: string, agentId: string | undefined): string {
  const scope = agentIdQueryValue(agentId);
  return scope ? `${KEY_PREFIX}${serverId}#${scope}` : KEY_PREFIX + serverId;
}

/** Picks made since this moment were made in this launch (`thisLaunch`). */
const LAUNCHED_AT_MS = Date.now();

/**
 * Bumped on every write, so a screen that shows the memory (Home's pills)
 * follows a pick made on another screen (a session's model sheet).
 */
let revision = 0;
const listeners = new Set<() => void>();

export function subscribeAgentChoiceMemory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function agentChoiceMemoryRevision(): number {
  return revision;
}

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
  recent?: ModelRef[];
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
  // `mode` is the word now; `agent` is how every pick before the rename was
  // written, and a reader's memory is not something to lose over a word.
  const stored = typeof rec.mode === 'string' && rec.mode ? rec.mode : rec.agent;
  const mode = typeof stored === 'string' && stored ? stored : undefined;
  if (!model && !mode) return undefined;
  const at = typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : 0;
  return { ...(model ? { model } : {}), ...(mode ? { mode } : {}), at };
}

function readServerMemory(serverId: string, agentId?: string): StoredServerMemory {
  try {
    const raw = store().getString(memoryKey(serverId, agentId));
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
    const recent = Array.isArray(rec.recent)
      ? rec.recent
          .map(parseModelRef)
          .filter((ref): ref is ModelRef => Boolean(ref))
          .slice(0, 12)
      : last?.model
        ? [last.model]
        : [];
    return { ...(last ? { last } : {}), workspaces, recent };
  } catch {
    // Unreadable is the same as unwritten: the reader loses the memory, not the
    // screen. Nothing here is worth telling them about.
    return EMPTY_MEMORY;
  }
}

function writeServerMemory(serverId: string, memory: StoredServerMemory, agentId?: string): void {
  try {
    store().set(memoryKey(serverId, agentId), JSON.stringify(memory));
  } catch {
    // See above.
  }
  revision += 1;
  for (const listener of listeners) listener();
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
  const mode = choice.mode ?? previous?.mode;
  return { ...(model ? { model } : {}), ...(mode ? { mode } : {}), at };
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
  atMs: number = Date.now(),
  /** The agent the pick was made on; the default when the screen has none. */
  agentId?: string
): void {
  if (!serverId) return;
  if (!choice.model && !choice.mode) return;
  const memory = readServerMemory(serverId, agentId);
  const workspaces = { ...memory.workspaces };
  if (directory) {
    workspaces[directory] = mergeChoice(workspaces[directory], choice, atMs);
  }
  writeServerMemory(
    serverId,
    {
      recent: choice.model
        ? [
            choice.model,
            ...(memory.recent ?? []).filter(
              (ref) =>
                ref.provider_id !== choice.model!.provider_id ||
                ref.model_id !== choice.model!.model_id
            ),
          ].slice(0, 12)
        : memory.recent,
      last: mergeChoice(memory.last, choice, atMs),
      workspaces: prune(workspaces),
    },
    agentId
  );
}

/** Remembers the model, leaving whatever agent was remembered beside it. */
export function rememberAgentModel(
  serverId: string,
  directory: string | undefined,
  model: ModelRef,
  agentId?: string
): void {
  rememberAgentChoice(serverId, directory, { model }, Date.now(), agentId);
}

/** Remembers the mode, leaving whatever model was remembered beside it. */
export function rememberAgentMode(
  serverId: string,
  directory: string | undefined,
  mode: string,
  agentId?: string
): void {
  rememberAgentChoice(serverId, directory, { mode }, Date.now(), agentId);
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
  directory?: string,
  agentId?: string,
  /**
   * Where this caller wrote before the memory was keyed by computer: the
   * session screen keyed it by its terminal session id (`herdr`, the same on
   * every computer). Read per field where the computer has nothing yet, never
   * copied forward, so a pick made on one computer does not become another
   * computer's memory.
   */
  legacyScope?: string
): RememberedAgentDefaults {
  if (!serverId) return {};
  const memory = readServerMemory(serverId, agentId);
  const legacy =
    legacyScope && legacyScope !== serverId ? readServerMemory(legacyScope, agentId) : undefined;
  const workspace = directory
    ? (memory.workspaces[directory] ?? legacy?.workspaces[directory])
    : undefined;
  const last = memory.last ?? legacy?.last;
  // The pick for this very place, when it was made in this launch: it outranks
  // a host that also remembers (`resolveNewSessionDefaults`), whose record of
  // it only lands once a session is created.
  const here = directory ? memory.workspaces[directory] : memory.last;
  return {
    ...(workspace ? { workspace: choiceOf(workspace) } : {}),
    ...(last ? { server: choiceOf(last) } : {}),
    ...(here && here.at >= LAUNCHED_AT_MS ? { thisLaunch: choiceOf(here) } : {}),
  };
}

/** The pick without the bookkeeping the caller has no use for. */
function choiceOf(stored: StoredChoice): RememberedAgentChoice {
  return {
    ...(stored.model ? { model: stored.model } : {}),
    ...(stored.mode ? { mode: stored.mode } : {}),
  };
}

/** References only: names, prices and capabilities always come from the live catalog. */
export function loadRecentAgentModels(
  serverId: string,
  agentId?: string,
  /** As `loadRememberedAgentDefaults`: read only while the computer has none. */
  legacyScope?: string
): ModelRef[] {
  if (!serverId) return [];
  const recent = readServerMemory(serverId, agentId).recent ?? [];
  if (recent.length || !legacyScope || legacyScope === serverId) return recent;
  return readServerMemory(legacyScope, agentId).recent ?? [];
}
