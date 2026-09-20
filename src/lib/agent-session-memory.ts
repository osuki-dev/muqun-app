import { createMMKV } from 'react-native-mmkv';

/**
 * The session the reader last opened, per gateway server and workspace.
 *
 * Which session is on screen was decided by `updated_ms` alone, so the reader
 * picking one settled nothing: an agent finishing a turn in another session
 * made that one the newest, and the next time the workbench was entered it
 * opened there instead. "I picked a session, went back to Home, came back, and
 * it opened a different one."
 *
 * A choice is not something the host can answer -- it knows what changed, not
 * what the reader wanted -- so it is written here when it is made and read back
 * on entry. Per workspace as well as per server, because opening a session in
 * one workspace says nothing about which session another should open on, and
 * because the strip is scoped to a workspace in the first place.
 *
 * The same store and the same fallbacks as `agent-model-memory.ts`: MMKV is a
 * native module, an over-the-air update can reach a binary built before it was
 * added, and a memory that stops surviving a launch is a feature degrading
 * rather than a crash.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.agent-ui';
const KEY_PREFIX = 'muqun.agent-session.v1:';

/**
 * How many workspaces one server remembers.
 *
 * Mirrors `agent-model-memory.ts`: a directory is a key, and the oldest row is
 * the one nobody is coming back for. Dropping it costs that workspace its
 * remembered session and nothing else -- it opens on newest activity again,
 * which is where it started.
 */
const MAX_WORKSPACES = 24;

/** One opening, with the moment it happened so the oldest can be dropped. */
interface StoredOpen {
  asid: string;
  at: number;
}

interface StoredServerSessions {
  /** The last session opened on this server, whichever workspace it was in. */
  last?: StoredOpen;
  /** The last session opened in each workspace directory. */
  workspaces: Record<string, StoredOpen>;
}

const EMPTY_MEMORY: StoredServerSessions = { workspaces: {} };

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

function parseOpen(value: unknown): StoredOpen | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const rec = value as Record<string, unknown>;
  const asid = typeof rec.asid === 'string' && rec.asid ? rec.asid : undefined;
  if (!asid) return undefined;
  const at = typeof rec.at === 'number' && Number.isFinite(rec.at) ? rec.at : 0;
  return { asid, at };
}

function readServerSessions(serverId: string): StoredServerSessions {
  try {
    const raw = store().getString(KEY_PREFIX + serverId);
    if (!raw) return EMPTY_MEMORY;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_MEMORY;
    const rec = parsed as Record<string, unknown>;
    const workspaces: Record<string, StoredOpen> = {};
    const stored = rec.workspaces;
    if (stored && typeof stored === 'object') {
      for (const [directory, entry] of Object.entries(stored as Record<string, unknown>)) {
        const open = parseOpen(entry);
        if (open) workspaces[directory] = open;
      }
    }
    const last = parseOpen(rec.last);
    return { ...(last ? { last } : {}), workspaces };
  } catch {
    // Unreadable is the same as unwritten: the reader loses the memory, not
    // the screen, and the workbench opens on newest activity as it always did.
    return EMPTY_MEMORY;
  }
}

/** Newest first, capped, so one server's memory cannot grow without bound. */
function prune(workspaces: Record<string, StoredOpen>): Record<string, StoredOpen> {
  const entries = Object.entries(workspaces);
  if (entries.length <= MAX_WORKSPACES) return workspaces;
  entries.sort((a, b) => b[1].at - a[1].at);
  return Object.fromEntries(entries.slice(0, MAX_WORKSPACES));
}

/**
 * Records the session that is open now.
 *
 * Every way in counts, because every one of them is the reader deciding where
 * to be: a chip in the strip, a row in the sessions sheet, a swipe across the
 * title, a workspace switch, a session they just created. What is written is
 * where the reader ended up, not how they got there.
 */
export function rememberOpenedAgentSession(
  serverId: string,
  directory: string | undefined,
  asid: string,
  atMs: number = Date.now()
): void {
  if (!serverId || !asid) return;
  const memory = readServerSessions(serverId);
  const workspaces = { ...memory.workspaces };
  const open: StoredOpen = { asid, at: atMs };
  if (directory) workspaces[directory] = open;
  try {
    store().set(
      KEY_PREFIX + serverId,
      JSON.stringify({ last: open, workspaces: prune(workspaces) })
    );
  } catch {
    // See `readServerSessions`.
  }
}

/**
 * The session this workspace was last opened on, if any.
 *
 * The server-wide last opening answers a workspace that has none of its own.
 * It is a guess about a place the reader has not chosen yet, and a wrong one
 * costs nothing: `pickSessionToOpen` only honours an asid the listing still
 * holds, and a session from another workspace is not in this one's listing.
 */
export function loadRememberedAgentSession(
  serverId: string,
  directory?: string
): string | undefined {
  if (!serverId) return undefined;
  const memory = readServerSessions(serverId);
  const workspace = directory ? memory.workspaces[directory] : undefined;
  return (workspace ?? memory.last)?.asid;
}
