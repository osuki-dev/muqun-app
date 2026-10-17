/** The envelope version is independent of the persistent transport key family. */
export type TransportVersion = 1 | 2;

export interface TransportNegotiationIO {
  readPin: (identity: string) => Promise<string | null>;
  writePin: (identity: string) => Promise<void>;
  /** Authenticated, nonce-bound, read-only /health; never an application write. */
  probe: (version: TransportVersion) => Promise<unknown>;
  requiresV2: (error: unknown) => boolean;
}

/**
 * One flight per credential identity. Only a successfully authenticated v2
 * health response authorizes a durable pin. Persist it before returning a
 * version to the caller, so application operations wait for durable state.
 *
 * A legacy answer is cached briefly, so an upgraded gateway is discovered on
 * the same launch. Public discovery and plaintext errors never permit a lower
 * version. The token and transport material are not stored in this class.
 */
export class TransportNegotiation {
  private readonly pending = new Map<string, Promise<TransportVersion>>();
  private readonly known = new Map<string, { version: TransportVersion; checkedAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  version(identity: string, io: TransportNegotiationIO): Promise<TransportVersion> {
    const running = this.pending.get(identity);
    if (running) return running;
    const cached = this.known.get(identity);
    if (cached && (cached.version === 2 || this.now() - cached.checkedAt < 60_000)) {
      return Promise.resolve(cached.version);
    }
    const work = this.negotiate(identity, io);
    this.pending.set(identity, work);
    void work.finally(() => this.pending.delete(identity)).catch(() => {});
    return work;
  }

  private async negotiate(identity: string, io: TransportNegotiationIO): Promise<TransportVersion> {
    const stored = await io.readPin(identity);
    if (stored !== null && stored !== '2')
      throw new Error('Invalid saved Gateway transport version.');
    if (stored === '2') {
      this.known.set(identity, { version: 2, checkedAt: this.now() });
      return 2;
    }
    let health: unknown;
    try {
      health = await io.probe(1);
    } catch (error) {
      if (!io.requiresV2(error)) throw error;
      // An unauthenticated refusal can only suggest trying stronger crypto.
      // No application operation has been sent and this never permits v1.
      return this.confirmAndPin(identity, io);
    }
    const versions =
      health && typeof health === 'object' && 'transport_versions' in health
        ? health.transport_versions
        : undefined;
    if (versions !== undefined && (!Array.isArray(versions) || !versions.includes(1))) {
      throw new Error('Gateway returned invalid transport capabilities.');
    }
    if (Array.isArray(versions) && versions.includes(2)) {
      return this.confirmAndPin(identity, io);
    }
    this.known.set(identity, { version: 1, checkedAt: this.now() });
    return 1;
  }

  private async confirmAndPin(
    identity: string,
    io: TransportNegotiationIO
  ): Promise<TransportVersion> {
    // A plaintext 426 is only a hint, never proof that the peer supports v2.
    // If this read's response is lost, the next negotiation can recover from
    // the Gateway's 426 by proving v2 again. No application write was sent.
    await io.probe(2);
    await io.writePin(identity);
    this.known.set(identity, { version: 2, checkedAt: this.now() });
    return 2;
  }
}
