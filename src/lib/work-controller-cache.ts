import type { GatewayRecord } from './gateway-storage';

/** Only the digest is retained as an index; display names do not define pairing ownership. */
export function workPairingFingerprint(record: GatewayRecord, digest: (text: string) => string) {
  return digest(
    JSON.stringify([
      record.serverId,
      record.url,
      record.pairedAt,
      record.token,
      record.deviceId ?? null,
      record.transport ?? null,
      record.transportKey ?? null,
      record.sshTunnel
        ? [record.sshTunnel.hostId, record.sshTunnel.remoteHost, record.sshTunnel.remotePort]
        : null,
    ])
  );
}

export class WorkControllerCache<T extends { deactivate(): void; clearPresentation?(): void }> {
  private readonly entries = new Map<
    string,
    { fingerprint: string; record: GatewayRecord; value: T }
  >();
  constructor(private readonly digest: (text: string) => string) {}
  retain(records: readonly GatewayRecord[]) {
    for (const [key, entry] of this.entries) {
      const current = records.find((record) => record.serverId === entry.record.serverId);
      if (!current || workPairingFingerprint(current, this.digest) !== entry.fingerprint) {
        entry.value.deactivate();
        entry.value.clearPresentation?.();
        this.entries.delete(key);
      } else entry.record.label = current.label;
    }
  }
  remove(serverId: string) {
    for (const [key, entry] of this.entries) {
      if (entry.record.serverId !== serverId) continue;
      entry.value.deactivate();
      entry.value.clearPresentation?.();
      this.entries.delete(key);
    }
  }
  get(record: GatewayRecord, sessionId: string, create: (captured: GatewayRecord) => T): T {
    const key = JSON.stringify([record.serverId, sessionId]);
    const fingerprint = workPairingFingerprint(record, this.digest);
    for (const [oldKey, entry] of this.entries) {
      if (entry.record.serverId === record.serverId && entry.fingerprint !== fingerprint) {
        entry.value.deactivate();
        entry.value.clearPresentation?.();
        this.entries.delete(oldKey);
      }
    }
    const existing = this.entries.get(key);
    if (existing?.fingerprint === fingerprint) {
      existing.record.label = record.label;
      return existing.value;
    }
    existing?.value.deactivate();
    const captured = {
      ...record,
      sshTunnel: record.sshTunnel ? { ...record.sshTunnel } : undefined,
    };
    const value = create(captured);
    this.entries.set(key, { fingerprint, record: captured, value });
    return value;
  }
}
