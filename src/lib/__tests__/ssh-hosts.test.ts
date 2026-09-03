/**
 * The host record's rules: what the form must supply, what storage may hand
 * back, and how a presented host key is judged against a remembered one.
 */
import { describe, expect, test } from 'bun:test';

import {
  EMPTY_SSH_HOST_DRAFT,
  SSH_DEFAULT_PORT,
  SSH_LABEL_MAX_LENGTH,
  compareSshHostKey,
  newSshId,
  normalizeSshHostRecord,
  normalizeSshHostRecords,
  normalizeSshSecrets,
  sortSshHosts,
  sshHostAddress,
  sshHostDraftFrom,
  validateSshHostDraft,
  type SshHostRecord,
} from '@/lib/ssh-hosts';

const KEY = { algorithm: 'ssh-ed25519', fingerprint: 'SHA256:abc', publicKey: 'AAAA' };

const RECORD: SshHostRecord = {
  id: 'host-1',
  label: 'Build box',
  host: '10.0.0.5',
  port: 2222,
  username: 'ci',
  auth: { type: 'password' },
  createdAt: 100,
};

describe('validateSshHostDraft', () => {
  test('a complete password draft passes with trimmed fields', () => {
    const result = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      label: '  Build box ',
      host: ' 10.0.0.5 ',
      port: '2222',
      username: ' ci ',
      password: 'hunter2',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      label: 'Build box',
      host: '10.0.0.5',
      port: 2222,
      username: 'ci',
      authType: 'password',
      password: 'hunter2',
      privateKey: '',
      passphrase: '',
    });
  });

  test('an empty port is the default, and a missing label is the host', () => {
    const result = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      host: 'example.com',
      port: '',
      username: 'me',
      password: 'x',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(SSH_DEFAULT_PORT);
    expect(result.value.label).toBe('example.com');
  });

  test('every missing field is reported at once', () => {
    const result = validateSshHostDraft({ ...EMPTY_SSH_HOST_DRAFT, port: '' });
    expect(result).toEqual({
      ok: false,
      errors: { host: 'required', username: 'required', password: 'required' },
    });
  });

  test('a port outside 1-65535, or not a number, is invalid', () => {
    for (const port of ['0', '65536', 'abc', '22a', '-1']) {
      const result = validateSshHostDraft({
        ...EMPTY_SSH_HOST_DRAFT,
        host: 'h',
        username: 'u',
        password: 'p',
        port,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors.port).toBe('invalid');
    }
  });

  test('a host with spaces or a user@host form is invalid', () => {
    for (const host of ['my host', 'me@example.com', 'http://x']) {
      const result = validateSshHostDraft({
        ...EMPTY_SSH_HOST_DRAFT,
        host,
        username: 'u',
        password: 'p',
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors.host).toBe('invalid');
    }
  });

  test('a bracketed IPv6 address is a host', () => {
    const result = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      host: '[fe80::1%en0]',
      username: 'u',
      password: 'p',
    });
    expect(result.ok).toBe(true);
  });

  test('a key draft needs a key and ignores the password field', () => {
    const missing = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      host: 'h',
      username: 'u',
      authType: 'privateKey',
      password: 'stale',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.privateKey).toBe('required');

    const present = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      host: 'h',
      username: 'u',
      authType: 'privateKey',
      password: 'stale',
      privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n',
      passphrase: 'pp',
    });
    expect(present.ok).toBe(true);
    if (!present.ok) return;
    expect(present.value.password).toBe('');
    expect(present.value.privateKey.startsWith('-----BEGIN')).toBe(true);
    expect(present.value.passphrase).toBe('pp');
  });

  test('a keyboard-interactive draft needs no secret and carries none', () => {
    const result = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      host: 'h',
      username: 'u',
      authType: 'keyboardInteractive',
      password: 'stale',
      privateKey: 'stale',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.authType).toBe('keyboardInteractive');
    expect(result.value.password).toBe('');
    expect(result.value.privateKey).toBe('');
  });

  test('editing a saved host may leave the secret blank', () => {
    const result = validateSshHostDraft(
      { ...EMPTY_SSH_HOST_DRAFT, host: 'h', username: 'u' },
      { requireSecret: false }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.password).toBe('');
  });

  test('a label is capped', () => {
    const result = validateSshHostDraft({
      ...EMPTY_SSH_HOST_DRAFT,
      label: 'x'.repeat(SSH_LABEL_MAX_LENGTH + 10),
      host: 'h',
      username: 'u',
      password: 'p',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.label.length).toBe(SSH_LABEL_MAX_LENGTH);
  });
});

describe('sshHostDraftFrom', () => {
  test('pre-fills the visible fields and never a secret', () => {
    const draft = sshHostDraftFrom({ ...RECORD, auth: { type: 'privateKey', keyId: 'key-1' } });
    expect(draft).toEqual({
      ...EMPTY_SSH_HOST_DRAFT,
      label: 'Build box',
      host: '10.0.0.5',
      port: '2222',
      username: 'ci',
      authType: 'privateKey',
    });
  });
});

describe('normalizeSshHostRecord', () => {
  test('a well-formed record round-trips', () => {
    const full = { ...RECORD, trustedHostKey: KEY, lastConnectedAt: 200 };
    expect(normalizeSshHostRecord(full)).toEqual(full);
  });

  test('a record with a key auth keeps its keyId', () => {
    const record = { ...RECORD, auth: { type: 'privateKey', keyId: 'key-9' } };
    expect(normalizeSshHostRecord(record)?.auth).toEqual({ type: 'privateKey', keyId: 'key-9' });
  });

  test('a keyboard-interactive record has no secret to point at', () => {
    const record = { ...RECORD, auth: { type: 'keyboardInteractive' } };
    expect(normalizeSshHostRecord(record)?.auth).toEqual({ type: 'keyboardInteractive' });
  });

  test('a record missing what it needs is dropped', () => {
    expect(normalizeSshHostRecord(null)).toBeNull();
    expect(normalizeSshHostRecord({ ...RECORD, id: '' })).toBeNull();
    expect(normalizeSshHostRecord({ ...RECORD, host: '  ' })).toBeNull();
    expect(normalizeSshHostRecord({ ...RECORD, username: undefined })).toBeNull();
    expect(normalizeSshHostRecord({ ...RECORD, auth: { type: 'privateKey' } })).toBeNull();
    expect(normalizeSshHostRecord({ ...RECORD, auth: { type: 'agent' } })).toBeNull();
  });

  test('a damaged optional field falls back instead of taking the record down', () => {
    const record = normalizeSshHostRecord({
      ...RECORD,
      port: 'x',
      label: '',
      createdAt: 'yesterday',
      trustedHostKey: { fingerprint: 'SHA256:abc' },
      lastConnectedAt: null,
    });
    expect(record).toEqual({
      id: 'host-1',
      label: '10.0.0.5',
      host: '10.0.0.5',
      port: SSH_DEFAULT_PORT,
      username: 'ci',
      auth: { type: 'password' },
      createdAt: 0,
    });
  });

  test('a list drops what it cannot read and de-duplicates ids', () => {
    const records = normalizeSshHostRecords([RECORD, { junk: true }, { ...RECORD, label: 'dup' }, null]);
    expect(records.map((record) => record.label)).toEqual(['Build box']);
    expect(normalizeSshHostRecords('nope')).toEqual([]);
  });
});

describe('normalizeSshSecrets', () => {
  test('keeps strings and drops anything else', () => {
    expect(
      normalizeSshSecrets({
        passwords: { 'host-1': 'pw', 'host-2': 7 },
        keys: {
          'key-1': { privateKey: 'PEM', passphrase: 'pp' },
          'key-2': { privateKey: 'PEM2', passphrase: '' },
          'key-3': { passphrase: 'orphan' },
        },
      })
    ).toEqual({
      passwords: { 'host-1': 'pw' },
      keys: { 'key-1': { privateKey: 'PEM', passphrase: 'pp' }, 'key-2': { privateKey: 'PEM2' } },
    });
  });

  test('anything unreadable is the empty blob', () => {
    expect(normalizeSshSecrets(undefined)).toEqual({ passwords: {}, keys: {} });
    expect(normalizeSshSecrets([])).toEqual({ passwords: {}, keys: {} });
  });
});

describe('sortSshHosts', () => {
  test('most recently connected first, then most recently added', () => {
    const a = { ...RECORD, id: 'a', createdAt: 1 };
    const b = { ...RECORD, id: 'b', createdAt: 2 };
    const c = { ...RECORD, id: 'c', createdAt: 0, lastConnectedAt: 50 };
    expect(sortSshHosts([a, b, c]).map((record) => record.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('sshHostAddress', () => {
  test('omits the default port and shows any other', () => {
    expect(sshHostAddress({ ...RECORD, port: 22 })).toBe('ci@10.0.0.5');
    expect(sshHostAddress(RECORD)).toBe('ci@10.0.0.5:2222');
  });
});

describe('compareSshHostKey', () => {
  test('unknown, match, mismatch', () => {
    expect(compareSshHostKey(undefined, KEY)).toBe('unknown');
    expect(compareSshHostKey(KEY, { ...KEY })).toBe('match');
    expect(compareSshHostKey(KEY, { ...KEY, fingerprint: 'SHA256:zzz' })).toBe('mismatch');
    expect(compareSshHostKey(KEY, { ...KEY, algorithm: 'ssh-rsa' })).toBe('mismatch');
  });

  test('the same fingerprint over a different key is a mismatch when both keys are known', () => {
    expect(compareSshHostKey(KEY, { ...KEY, publicKey: 'BBBB' })).toBe('mismatch');
  });

  test('a record saved without the key is judged on the fingerprint alone', () => {
    // Stored before `publicKey` existed: the presented key cannot be held
    // against an empty string, or every such host would look tampered with.
    expect(compareSshHostKey({ ...KEY, publicKey: '' }, KEY)).toBe('match');
    // And the other way round, should a presenter ever omit it.
    expect(compareSshHostKey(KEY, { ...KEY, publicKey: '' })).toBe('match');
    // The fingerprint still decides.
    expect(compareSshHostKey({ ...KEY, publicKey: '' }, { ...KEY, fingerprint: 'SHA256:zzz' })).toBe('mismatch');
  });
});

describe('newSshId', () => {
  test('is prefixed, time-ordered and never the same twice', () => {
    const first = newSshId('host', 1000, () => 0.5);
    const second = newSshId('host', 2000, () => 0.5);
    expect(first.startsWith('host-')).toBe(true);
    expect(first < second).toBe(true);
    expect(newSshId('key', 1000, () => 0.1)).not.toBe(newSshId('key', 1000, () => 0.9));
  });
});
