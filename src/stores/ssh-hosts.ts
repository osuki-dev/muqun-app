import { create } from 'zustand';

import {
  loadSshHosts,
  loadSshSecrets,
  saveSshHosts,
  saveSshSecrets,
} from '@/lib/ssh-host-storage';
import {
  newSshId,
  sortSshHosts,
  sshCredentialFor,
  withoutSshSecrets,
  type SshCredential,
  type SshHostRecord,
  type SshSecrets,
  type SshTrustedHostKey,
} from '@/lib/ssh-hosts';

/** What a validated form hands the store: the record's facts and its secret. */
export interface SshHostInput {
  label: string;
  host: string;
  port: number;
  username: string;
  credential: SshCredential;
}

interface SshHostsState {
  hosts: SshHostRecord[];
  loading: boolean;
  hydrate: () => Promise<void>;
  addHost: (input: SshHostInput) => Promise<SshHostRecord>;
  /**
   * Edit a record. The credential is optional: the form never echoes a secret
   * back, so a save with the secret fields left blank keeps what was stored.
   */
  updateHost: (id: string, input: Omit<SshHostInput, 'credential'> & { credential?: SshCredential }) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  /** Trust-on-first-use, or a deliberate replacement; `null` forgets the key. */
  setTrustedHostKey: (id: string, key: SshTrustedHostKey | null) => Promise<void>;
  markConnected: (id: string) => Promise<void>;
  /** The record's secret, read at connect time and never held in state. */
  credentialFor: (record: SshHostRecord) => Promise<SshCredential | null>;
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * Every read-modify-write on the two blobs goes through one chain, for the
 * same reason `gateway-connection.ts` has one: the helpers load, mutate and
 * save the same keychain entries, and two overlapping edits would otherwise
 * lose one of them. A failed task must not wedge the chain, so the tail
 * settles either way.
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** The secrets blob with a record's new credential written in. */
function withCredential(
  secrets: SshSecrets,
  record: SshHostRecord,
  credential: SshCredential
): SshSecrets {
  const cleared = withoutSshSecrets(secrets, record);
  if (credential.type === 'keyboardInteractive') return cleared;
  if (credential.type === 'password') {
    return { ...cleared, passwords: { ...cleared.passwords, [record.id]: credential.password } };
  }
  if (record.auth.type !== 'privateKey') {
    throw new Error('a key credential needs a key id on the record');
  }
  return {
    ...cleared,
    keys: {
      ...cleared.keys,
      [record.auth.keyId]: credential.passphrase
        ? { privateKey: credential.privateKey, passphrase: credential.passphrase }
        : { privateKey: credential.privateKey },
    },
  };
}

export const useSshHostsStore = create<SshHostsState>((set) => ({
  hosts: [],
  loading: true,

  async hydrate() {
    const hosts = await enqueue(loadSshHosts);
    set({ hosts: sortSshHosts(hosts), loading: false });
  },

  async addHost(input) {
    return enqueue(async () => {
      const record: SshHostRecord = {
        id: newSshId('host'),
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
        auth:
          input.credential.type === 'password'
            ? { type: 'password' }
            : input.credential.type === 'keyboardInteractive'
              ? { type: 'keyboardInteractive' }
              : { type: 'privateKey', keyId: newSshId('key') },
        createdAt: Date.now(),
      };
      const [hosts, secrets] = await Promise.all([loadSshHosts(), loadSshSecrets()]);
      // The secret first: a record whose secret never landed would connect to
      // nothing, while a secret whose record never landed is merely orphaned
      // and cleaned up by the next remove.
      await saveSshSecrets(withCredential(secrets, record, input.credential));
      const next = [record, ...hosts.filter((item) => item.id !== record.id)];
      await saveSshHosts(next);
      set({ hosts: sortSshHosts(next), loading: false });
      return record;
    });
  },

  async updateHost(id, input) {
    await enqueue(async () => {
      const [hosts, secrets] = await Promise.all([loadSshHosts(), loadSshSecrets()]);
      const current = hosts.find((item) => item.id === id);
      if (!current) return;
      let record: SshHostRecord = {
        ...current,
        label: input.label,
        host: input.host,
        port: input.port,
        username: input.username,
      };
      // A different address is a different machine as far as the host key is
      // concerned: the key that proved 10.0.0.5 says nothing about 10.0.0.6.
      if (current.host !== record.host || current.port !== record.port) {
        delete record.trustedHostKey;
      }
      if (input.credential) {
        if (input.credential.type === 'privateKey') {
          record = {
            ...record,
            auth:
              current.auth.type === 'privateKey' ? current.auth : { type: 'privateKey', keyId: newSshId('key') },
          };
        } else if (input.credential.type === 'keyboardInteractive') {
          record = { ...record, auth: { type: 'keyboardInteractive' } };
        } else {
          record = { ...record, auth: { type: 'password' } };
        }
        // Clear under the *old* identity, write under the new one.
        await saveSshSecrets(withCredential(withoutSshSecrets(secrets, current), record, input.credential));
      }
      const next = hosts.map((item) => (item.id === id ? record : item));
      await saveSshHosts(next);
      set({ hosts: sortSshHosts(next), loading: false });
    });
  },

  async removeHost(id) {
    await enqueue(async () => {
      const [hosts, secrets] = await Promise.all([loadSshHosts(), loadSshSecrets()]);
      const current = hosts.find((item) => item.id === id);
      const next = hosts.filter((item) => item.id !== id);
      if (current) await saveSshSecrets(withoutSshSecrets(secrets, current));
      await saveSshHosts(next);
      set({ hosts: sortSshHosts(next), loading: false });
    });
  },

  async setTrustedHostKey(id, key) {
    await enqueue(async () => {
      const hosts = await loadSshHosts();
      const next = hosts.map((item) => {
        if (item.id !== id) return item;
        const { trustedHostKey: _dropped, ...rest } = item;
        return key ? { ...rest, trustedHostKey: key } : rest;
      });
      await saveSshHosts(next);
      set({ hosts: sortSshHosts(next), loading: false });
    });
  },

  async markConnected(id) {
    await enqueue(async () => {
      const hosts = await loadSshHosts();
      const next = hosts.map((item) => (item.id === id ? { ...item, lastConnectedAt: Date.now() } : item));
      await saveSshHosts(next);
      set({ hosts: sortSshHosts(next), loading: false });
    });
  },

  async credentialFor(record) {
    const secrets = await enqueue(loadSshSecrets);
    return sshCredentialFor(record, secrets);
  },
}));
