/**
 * What the app knows about an SSH host, and the rules for keeping that tidy.
 *
 * A host record is everything a reader can see on the list and edit on the
 * form: a name, where the host is, who to log in as, *how* to authenticate and
 * -- once one has been accepted -- the host key that proved the server was the
 * one it claimed to be last time. What is deliberately *not* here is the
 * secret half of the authentication: the password, the private key and its
 * passphrase live in their own sealed blob (`ssh-host-storage.ts`), keyed from
 * this record, so the list can be read and rendered without ever decrypting a
 * credential, and so wiping a host's secrets is one delete rather than a scrub
 * through the list.
 *
 * Pure on purpose. Nothing here touches the keychain or the native SSH module,
 * so the normaliser and the validator run under `bun test` exactly as they run
 * on a phone. The storage layer and the form both import this and nothing
 * imports them back.
 */

export const SSH_DEFAULT_PORT = 22;

/** Longest a label may be before the list stops being a list. */
export const SSH_LABEL_MAX_LENGTH = 48;

export type SshHostAuth =
  /** The password is stored under the record's own id. */
  | { type: 'password' }
  /** The private key (and its passphrase, if any) is stored under `keyId`. */
  | { type: 'privateKey'; keyId: string }
  /**
   * Keyboard-interactive: the server asks its own questions at connect time
   * -- a password, a one-time code -- and the reader answers them in a
   * dialog. Nothing is stored for this method.
   */
  | { type: 'keyboardInteractive' };

export type SshHostAuthType = SshHostAuth['type'];

/**
 * The host key a reader accepted, as the library reports it: the algorithm
 * name, the OpenSSH-style `SHA256:…` fingerprint, and the raw key blob so a
 * future version can do better than a fingerprint compare.
 */
export interface SshTrustedHostKey {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
}

export interface SshHostRecord {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  auth: SshHostAuth;
  trustedHostKey?: SshTrustedHostKey;
  createdAt: number;
  lastConnectedAt?: number;
}

/**
 * The secret half of every record, in one sealed blob.
 *
 * Passwords are keyed by the host record's id; keys are keyed by the record's
 * `auth.keyId`. Two maps rather than one so a host that switches from a
 * password to a key does not leave its old password behind under a key that
 * no longer names it.
 */
export interface SshSecrets {
  passwords: Record<string, string>;
  keys: Record<string, { privateKey: string; passphrase?: string }>;
}

export const EMPTY_SSH_SECRETS: SshSecrets = { passwords: {}, keys: {} };

/** A record's secret half, resolved and ready to hand to the SSH library. */
export type SshCredential =
  | { type: 'password'; password: string }
  | { type: 'privateKey'; privateKey: string; passphrase?: string }
  /** No secret: the library drives the server's prompts through the screen. */
  | { type: 'keyboardInteractive' };

/** The credential a record names, read out of the secrets blob, or `null` if it is gone. */
export function sshCredentialFor(record: SshHostRecord, secrets: SshSecrets): SshCredential | null {
  if (record.auth.type === 'keyboardInteractive') return { type: 'keyboardInteractive' };
  if (record.auth.type === 'password') {
    const password = secrets.passwords[record.id];
    return typeof password === 'string' ? { type: 'password', password } : null;
  }
  const key = secrets.keys[record.auth.keyId];
  if (!key) return null;
  return key.passphrase
    ? { type: 'privateKey', privateKey: key.privateKey, passphrase: key.passphrase }
    : { type: 'privateKey', privateKey: key.privateKey };
}

/**
 * The secrets blob with one record's secrets removed -- both maps, so a
 * record that changed its mind about how to log in leaves nothing behind.
 */
export function withoutSshSecrets(
  secrets: SshSecrets,
  record: Pick<SshHostRecord, 'id' | 'auth'>
): SshSecrets {
  const { [record.id]: _password, ...passwords } = secrets.passwords;
  const keys = { ...secrets.keys };
  if (record.auth.type === 'privateKey') delete keys[record.auth.keyId];
  return { passwords, keys };
}

/** What the form collects. Strings throughout, since that is what inputs hold. */
export interface SshHostDraft {
  label: string;
  host: string;
  port: string;
  username: string;
  authType: SshHostAuthType;
  password: string;
  privateKey: string;
  passphrase: string;
}

export const EMPTY_SSH_HOST_DRAFT: SshHostDraft = {
  label: '',
  host: '',
  port: String(SSH_DEFAULT_PORT),
  username: '',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
};

/** A field the form got wrong, named so the screen can say why in its own language. */
export type SshHostDraftError = 'required' | 'invalid';

export type SshHostDraftField = 'label' | 'host' | 'port' | 'username' | 'password' | 'privateKey';

export type SshHostDraftValidation =
  | {
      ok: true;
      value: {
        label: string;
        host: string;
        port: number;
        username: string;
        authType: SshHostAuthType;
        password: string;
        privateKey: string;
        passphrase: string;
      };
    }
  | { ok: false; errors: Partial<Record<SshHostDraftField, SshHostDraftError>> };

/**
 * A host name or address the SSH library can dial. Loose on purpose: a
 * hostname, an IPv4, a bare IPv6 or a bracketed one all go through; what is
 * refused is whitespace and the `user@host:port` forms that belong in three
 * separate fields.
 */
const HOST_PATTERN = /^[A-Za-z0-9._\-[\]:%]+$/;

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * Checks a draft the way the save button has to: every field the record needs,
 * with one error per field so the form can mark them all at once instead of
 * making the reader fix them one save at a time.
 *
 * The private key is only checked for presence here. Whether it *parses* is
 * the native library's question (`inspectPrivateKey`), and the form asks it
 * after this passes.
 */
export function validateSshHostDraft(
  draft: SshHostDraft,
  options: {
    /**
     * Whether a blank secret is an error. `false` while editing a saved host:
     * the form never echoes the stored secret back, so blank means "keep it".
     */
    requireSecret?: boolean;
  } = {}
): SshHostDraftValidation {
  const requireSecret = options.requireSecret ?? true;
  const errors: Partial<Record<SshHostDraftField, SshHostDraftError>> = {};
  const host = draft.host.trim();
  const username = draft.username.trim();
  const label = draft.label.trim().slice(0, SSH_LABEL_MAX_LENGTH);
  const portText = draft.port.trim();
  const port = portText === '' ? SSH_DEFAULT_PORT : Number(portText);

  if (!host) errors.host = 'required';
  else if (!HOST_PATTERN.test(host)) errors.host = 'invalid';
  if (!username) errors.username = 'required';
  else if (/\s/.test(username)) errors.username = 'invalid';
  if (!/^\d*$/.test(portText) || !isValidPort(port)) errors.port = 'invalid';

  // Keyboard-interactive has no secret to require: the server asks at connect time.
  if (requireSecret) {
    if (draft.authType === 'password') {
      if (!draft.password) errors.password = 'required';
    } else if (draft.authType === 'privateKey' && !draft.privateKey.trim()) {
      errors.privateKey = 'required';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      // A host with no name is called by its address, which is what a reader
      // typed and what they will recognise.
      label: label || host,
      host,
      port,
      username,
      authType: draft.authType,
      password: draft.authType === 'password' ? draft.password : '',
      privateKey: draft.authType === 'privateKey' ? draft.privateKey.trim() : '',
      passphrase: draft.authType === 'privateKey' ? draft.passphrase : '',
    },
  };
}

/** The form, pre-filled from a record. Secrets are never echoed back into it. */
export function sshHostDraftFrom(record: SshHostRecord): SshHostDraft {
  return {
    ...EMPTY_SSH_HOST_DRAFT,
    label: record.label,
    host: record.host,
    port: String(record.port),
    username: record.username,
    authType: record.auth.type,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTrustedHostKey(value: unknown): SshTrustedHostKey | undefined {
  if (!isRecord(value)) return undefined;
  const { algorithm, fingerprint, publicKey } = value;
  if (
    typeof algorithm !== 'string' ||
    typeof fingerprint !== 'string' ||
    typeof publicKey !== 'string'
  ) {
    return undefined;
  }
  if (!algorithm || !fingerprint) return undefined;
  return { algorithm, fingerprint, publicKey };
}

/**
 * One stored record, checked field by field, or `null` if it cannot be trusted.
 *
 * Storage is sealed, so what comes back is what this app wrote -- but "this
 * app" includes every earlier build, and a record whose shape has drifted is
 * dropped rather than rendered as a card that cannot connect. A dropped record
 * is a host the reader adds again; a half-record is a bug report.
 */
export function normalizeSshHostRecord(value: unknown): SshHostRecord | null {
  if (!isRecord(value)) return null;
  const { id, label, host, username, port, auth, createdAt, lastConnectedAt } = value;
  if (typeof id !== 'string' || !id) return null;
  if (typeof host !== 'string' || !host.trim()) return null;
  if (typeof username !== 'string' || !username.trim()) return null;
  const normalizedPort = typeof port === 'number' && isValidPort(port) ? port : SSH_DEFAULT_PORT;

  let normalizedAuth: SshHostAuth;
  if (
    isRecord(auth) &&
    auth.type === 'privateKey' &&
    typeof auth.keyId === 'string' &&
    auth.keyId
  ) {
    normalizedAuth = { type: 'privateKey', keyId: auth.keyId };
  } else if (isRecord(auth) && auth.type === 'password') {
    normalizedAuth = { type: 'password' };
  } else if (isRecord(auth) && auth.type === 'keyboardInteractive') {
    normalizedAuth = { type: 'keyboardInteractive' };
  } else {
    return null;
  }

  const record: SshHostRecord = {
    id,
    label:
      typeof label === 'string' && label.trim()
        ? label.trim().slice(0, SSH_LABEL_MAX_LENGTH)
        : host.trim(),
    host: host.trim(),
    port: normalizedPort,
    username: username.trim(),
    auth: normalizedAuth,
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
  const trusted = normalizeTrustedHostKey(value.trustedHostKey);
  if (trusted) record.trustedHostKey = trusted;
  if (typeof lastConnectedAt === 'number' && Number.isFinite(lastConnectedAt)) {
    record.lastConnectedAt = lastConnectedAt;
  }
  return record;
}

/** A stored list, with anything unreadable dropped rather than rendered. */
export function normalizeSshHostRecords(value: unknown): SshHostRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const records: SshHostRecord[] = [];
  for (const entry of value) {
    const record = normalizeSshHostRecord(entry);
    if (!record || seen.has(record.id)) continue;
    seen.add(record.id);
    records.push(record);
  }
  return records;
}

/** A stored secrets blob, or the empty one if it cannot be read. */
export function normalizeSshSecrets(value: unknown): SshSecrets {
  if (!isRecord(value)) return { passwords: {}, keys: {} };
  const passwords: Record<string, string> = {};
  if (isRecord(value.passwords)) {
    for (const [id, password] of Object.entries(value.passwords)) {
      if (typeof password === 'string') passwords[id] = password;
    }
  }
  const keys: SshSecrets['keys'] = {};
  if (isRecord(value.keys)) {
    for (const [id, entry] of Object.entries(value.keys)) {
      if (!isRecord(entry) || typeof entry.privateKey !== 'string') continue;
      keys[id] =
        typeof entry.passphrase === 'string' && entry.passphrase
          ? { privateKey: entry.privateKey, passphrase: entry.passphrase }
          : { privateKey: entry.privateKey };
    }
  }
  return { passwords, keys };
}

/**
 * Most recently used first, then most recently added: the host a reader
 * connected to yesterday is the one they want today.
 */
export function sortSshHosts(records: readonly SshHostRecord[]): SshHostRecord[] {
  return [...records].sort(
    (a, b) => (b.lastConnectedAt ?? 0) - (a.lastConnectedAt ?? 0) || b.createdAt - a.createdAt
  );
}

/**
 * What `/ssh` draws under its header: the rows, and which invitation (if any)
 * belongs beneath them.
 *
 * Split out of the screen because the screen got it wrong. The demo host is
 * pinned above the saved ones -- see `demo-ssh.ts` for when it is offered --
 * and the empty state was gated on `hosts.length === 0`, counting only the
 * saved half. So the one arrangement where the demo host appears at all is
 * exactly the arrangement where the empty state appeared *with* it: a
 * tappable "Demo shell" card, and directly underneath it the sentence "No SSH
 * hosts yet." That is not a layout slip, it is the screen contradicting
 * itself -- the row is a real host that really opens a real (bundled) shell.
 *
 * The reader still needs the invitation, though: a list holding nothing but
 * the demo is a list with no host of *theirs* on it, and the `+` in the header
 * is not an explanation. So there are three answers rather than two, and the
 * prompt says which one is true rather than assuming the list is empty:
 *
 *  - `'none'`     at least one saved host; the rows speak for themselves.
 *  - `'demoOnly'` the bundled demo and nothing else. Invite, but do not claim
 *                 there is nothing here.
 *  - `'empty'`    nothing at all, not even the demo.
 *
 * `hosts` arrives in the store's own order (`sortSshHosts`) and is not
 * re-sorted here; only the demo host is placed, and it goes first.
 */
export type SshHostListPrompt = 'none' | 'demoOnly' | 'empty';

export interface SshHostListView {
  rows: SshHostRecord[];
  prompt: SshHostListPrompt;
}

export function sshHostListView(
  hosts: readonly SshHostRecord[],
  demoHost: SshHostRecord | null
): SshHostListView {
  const rows = demoHost ? [demoHost, ...hosts] : [...hosts];
  const prompt: SshHostListPrompt = hosts.length > 0 ? 'none' : demoHost ? 'demoOnly' : 'empty';
  return { rows, prompt };
}

/** `user@host`, with the port only when it is not the default. */
export function sshHostAddress(record: Pick<SshHostRecord, 'host' | 'port' | 'username'>): string {
  const port = record.port === SSH_DEFAULT_PORT ? '' : `:${record.port}`;
  return `${record.username}@${record.host}${port}`;
}

export type SshHostKeyVerdict = 'unknown' | 'match' | 'mismatch';

/**
 * Trust-on-first-use, decided in one place.
 *
 * `unknown` is a host this app has never seen: the reader is shown the
 * fingerprint and asked. `match` connects without a word. `mismatch` is the
 * one that matters: the server at this address is not presenting the key it
 * presented before, which is either a reinstall or an interception, and the
 * app cannot tell which -- so it refuses, and only an explicit "replace" lets
 * the new key in.
 *
 * Compared on fingerprint *and* algorithm. A server that offers several key
 * types can legitimately present a different one than last time (an ed25519
 * key after an RSA one) -- that still reads as a mismatch here, deliberately:
 * the reader is told which algorithm changed and decides.
 */
export function compareSshHostKey(
  trusted: SshTrustedHostKey | undefined,
  presented: SshTrustedHostKey
): SshHostKeyVerdict {
  if (!trusted) return 'unknown';
  if (trusted.fingerprint !== presented.fingerprint || trusted.algorithm !== presented.algorithm) {
    return 'mismatch';
  }
  // Belt and braces: when both sides carry the key itself, it has to be the
  // same key, not merely one with the same digest. A record saved before the
  // key was stored has an empty `publicKey` and is judged on the fingerprint
  // alone, as it always was.
  if (
    trusted.publicKey !== '' &&
    presented.publicKey !== '' &&
    trusted.publicKey !== presented.publicKey
  ) {
    return 'mismatch';
  }
  return 'match';
}

/**
 * An id no other record on this device has. Time first so the ids sort in the
 * order they were made, then enough randomness that two hosts added in the
 * same millisecond cannot collide.
 */
export function newSshId(prefix: 'host' | 'key', now = Date.now(), random = Math.random): string {
  const entropy = Math.floor(random() * 0xffffffff)
    .toString(36)
    .padStart(7, '0');
  // Nine base-36 digits hold the millisecond clock until well past the year
  // 5000, so the ids stay fixed-width and their lexical order is time order.
  return `${prefix}-${now.toString(36).padStart(9, '0')}-${entropy}`;
}
