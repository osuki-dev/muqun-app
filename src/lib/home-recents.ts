/**
 * The small, persistent index used by Home to reopen targets the user chose.
 *
 * This module contains only domain data and serialization. It deliberately
 * does not know about SecureStore, Gateway clients, transcript streams, or
 * route components. A target is an address, not a copy of the task it points
 * at, so no output, credentials, endpoint, or pending request belongs here.
 */

export const HOME_RECENTS_STORAGE_KEY = 'muqun.home-recents.v1';
export const HOME_RECENTS_STORAGE_VERSION = 1;
export const MAX_HOME_RECENTS = 24;
export const MAX_HOME_RECENT_TITLE_LENGTH = 160;

const MAX_HOME_TARGET_FIELD_LENGTH = 1024;

/** A stable, routeable Home destination. */
export type HomeTarget =
  | {
      kind: 'opencode-session';
      serverId: string;
      /** Gateway/Herdr routing session, not the OpenCode agent session id. */
      sessionId: string;
      directory: string;
      /** OpenCode agent session identity. */
      asid: string;
    }
  | {
      kind: 'gateway-terminal';
      serverId: string;
      /** Gateway/Herdr routing session. */
      sessionId: string;
      paneId: string;
    }
  | {
      kind: 'ssh-host';
      hostId: string;
    };

/** One row in the bounded recent index, newest explicit visit first. */
export type HomeRecentEntry = {
  /** Stable across title and visit-time changes. */
  key: string;
  target: HomeTarget;
  /** A user-facing label only; never task output or connection metadata. */
  title: string;
  /** Unix milliseconds at which the user explicitly opened the target. */
  atMs: number;
};

type PersistedHomeRecentEntry = {
  target: HomeTarget;
  title: string;
  atMs: number;
};

type PersistedHomeRecents = {
  version: typeof HOME_RECENTS_STORAGE_VERSION;
  entries: PersistedHomeRecentEntry[];
};

export type HomeRecentsParseResult =
  | { kind: 'empty'; entries: HomeRecentEntry[] }
  | { kind: 'invalid'; entries: HomeRecentEntry[] }
  | { kind: 'future'; version: number; entries: HomeRecentEntry[] }
  | { kind: 'valid'; entries: HomeRecentEntry[] };

/**
 * Build an unambiguous key from the discriminant and every opaque identity
 * field. JSON arrays avoid delimiter collisions when ids contain `:` or `/`.
 */
export function homeTargetKey(target: HomeTarget): string {
  switch (target.kind) {
    case 'opencode-session':
      return JSON.stringify([
        target.kind,
        target.serverId,
        target.sessionId,
        target.directory,
        target.asid,
      ]);
    case 'gateway-terminal':
      return JSON.stringify([target.kind, target.serverId, target.sessionId, target.paneId]);
    case 'ssh-host':
      return JSON.stringify([target.kind, target.hostId]);
  }
}

/** Validate and copy an untrusted target from a persisted or external value. */
export function normalizeHomeTarget(value: unknown): HomeTarget | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;

  switch (value.kind) {
    case 'opencode-session': {
      const serverId = targetField(value.serverId);
      const sessionId = targetField(value.sessionId);
      const directory = targetField(value.directory, true);
      const asid = targetField(value.asid);
      if (!serverId || !sessionId || directory === null || !asid) return null;
      return { kind: value.kind, serverId, sessionId, directory, asid };
    }
    case 'gateway-terminal': {
      const serverId = targetField(value.serverId);
      const sessionId = targetField(value.sessionId);
      const paneId = targetField(value.paneId);
      if (!serverId || !sessionId || !paneId) return null;
      return { kind: value.kind, serverId, sessionId, paneId };
    }
    case 'ssh-host': {
      const hostId = targetField(value.hostId);
      if (!hostId) return null;
      return { kind: value.kind, hostId };
    }
    default:
      return null;
  }
}

/** Keep labels bounded and free of control characters before persistence. */
export function normalizeHomeRecentTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .trim()
    .slice(0, MAX_HOME_RECENT_TITLE_LENGTH);
}

/** Build an immutable row from the public visit arguments. */
export function createHomeRecentEntry(
  target: unknown,
  title: unknown,
  atMs: unknown = Date.now()
): HomeRecentEntry | null {
  const normalizedTarget = normalizeHomeTarget(target);
  if (!normalizedTarget || !isTimestamp(atMs)) return null;
  return {
    key: homeTargetKey(normalizedTarget),
    target: normalizedTarget,
    title: normalizeHomeRecentTitle(title),
    atMs,
  };
}

/** Normalize, deduplicate, and cap entries in their existing explicit order. */
export function normalizeHomeRecentEntries(value: unknown): HomeRecentEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: HomeRecentEntry[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const entry = createHomeRecentEntry(raw.target, raw.title, raw.atMs);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    entries.push(entry);
    if (entries.length === MAX_HOME_RECENTS) break;
  }
  return entries;
}

/**
 * Parse the versioned storage envelope. Invalid and future values are empty in
 * memory, but retain their result kind so the state layer does not overwrite
 * data owned by a newer app version merely because this version cannot read it.
 */
export function parseHomeRecentsDocument(value: string | null | undefined): HomeRecentsParseResult {
  if (!value) return { kind: 'empty', entries: [] };

  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    return { kind: 'invalid', entries: [] };
  }
  if (!isRecord(decoded) || typeof decoded.version !== 'number') {
    return { kind: 'invalid', entries: [] };
  }
  if (decoded.version !== HOME_RECENTS_STORAGE_VERSION) {
    return { kind: 'future', version: decoded.version, entries: [] };
  }
  return { kind: 'valid', entries: normalizeHomeRecentEntries(decoded.entries) };
}

/** Parse a persisted value, returning the safe in-memory fallback. */
export function parseHomeRecents(value: string | null | undefined): HomeRecentEntry[] {
  return parseHomeRecentsDocument(value).entries;
}

/** Serialize only the allowlisted target and display metadata fields. */
export function serializeHomeRecents(entries: readonly HomeRecentEntry[]): string {
  const normalized = normalizeHomeRecentEntries(entries);
  const document: PersistedHomeRecents = {
    version: HOME_RECENTS_STORAGE_VERSION,
    entries: normalized.map(({ target, title, atMs }) => ({ target, title, atMs })),
  };
  return JSON.stringify(document);
}

/** Apply the authoritative paired-server/known-host allowlist. */
export function filterHomeRecentEntries(
  entries: readonly HomeRecentEntry[],
  allowlist: HomeRecentsAllowlist
): HomeRecentEntry[] {
  const serverIds = new Set(allowlist.serverIds);
  const hostIds = new Set(allowlist.hostIds);
  return entries.filter((entry) => {
    if (entry.target.kind === 'ssh-host') return hostIds.has(entry.target.hostId);
    return serverIds.has(entry.target.serverId);
  });
}

export type HomeRecentsAllowlist = {
  readonly serverIds: readonly string[];
  readonly hostIds: readonly string[];
};

export function isHomeRecentEntryAllowed(
  entry: HomeRecentEntry,
  allowlist: HomeRecentsAllowlist
): boolean {
  if (entry.target.kind === 'ssh-host') return allowlist.hostIds.includes(entry.target.hostId);
  return allowlist.serverIds.includes(entry.target.serverId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function targetField(value: unknown, allowEmpty = false): string | null {
  if (typeof value !== 'string') return null;
  if (!allowEmpty && value.length === 0) return null;
  if (value.length > MAX_HOME_TARGET_FIELD_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/u.test(value)) return null;
  return value;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
