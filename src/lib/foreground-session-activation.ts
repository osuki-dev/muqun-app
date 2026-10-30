export type ForegroundSessionBindings = {
  source: string;
  agents: Readonly<Record<string, string | null>>;
};

/** Remember only identities actually supplied by this route or source's session reads. */
export function bindForegroundSessionAgents(
  previous: ForegroundSessionBindings | null,
  source: string | null,
  sessions: readonly { asid: string; agent_id?: string; deleted?: boolean }[]
): ForegroundSessionBindings | null {
  if (!source) return previous;
  const agents: Record<string, string | null> = Object.assign(
    Object.create(null),
    previous?.source === source ? previous.agents : {}
  );
  for (const session of sessions) {
    if (!session.asid || (!session.agent_id && !session.deleted)) continue;
    const known = Object.hasOwn(agents, session.asid) ? agents[session.asid] : undefined;
    // Conflicting providers or a deleted session must never select a write target.
    agents[session.asid] =
      session.deleted || known === null || (known !== undefined && known !== session.agent_id)
        ? null
        : (session.agent_id ?? null);
  }
  return { source, agents };
}

export function foregroundSessionAgent(
  bindings: ForegroundSessionBindings | null,
  source: string | null,
  asid: string | undefined
): string | undefined {
  return source && asid && bindings?.source === source && Object.hasOwn(bindings.agents, asid)
    ? (bindings.agents[asid] ?? undefined)
    : undefined;
}

/** Only an explicit foreground reader may start a resumable native session. */
export class ForegroundSessionActivation {
  private generation = 0;

  start(options: {
    foreground: boolean;
    capabilities: readonly string[] | undefined;
    current: () => boolean;
    prepare: () => Promise<void>;
    prepared: () => void;
    failed: (error: unknown) => void;
  }): () => void {
    const generation = ++this.generation;
    const current = () => generation === this.generation && options.current();
    const cancel = () => {
      if (generation === this.generation) this.generation++;
    };
    if (
      !options.foreground ||
      !options.capabilities?.includes('agent_session_resume_v1') ||
      !current()
    )
      return cancel;
    try {
      void options.prepare().then(
        () => {
          if (current()) options.prepared();
        },
        (error) => {
          if (current()) options.failed(error);
        }
      );
    } catch (error) {
      if (current()) options.failed(error);
    }
    return cancel;
  }
}

/** In-flight only: a later open or explicit retry always reaches the Gateway. */
export class SessionPreparationFlights {
  private flights = new Map<
    string,
    {
      promise: Promise<void>;
      owners: Set<() => boolean>;
    }
  >();

  run(
    key: string,
    send: (current: () => boolean) => Promise<void>,
    owner: () => boolean = () => true
  ): Promise<void> {
    const pending = this.flights.get(key);
    if (pending) {
      pending.owners.add(owner);
      return pending.promise;
    }
    let accept!: () => void;
    let refuse!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      accept = resolve;
      refuse = reject;
    });
    const owners = new Set([owner]);
    this.flights.set(key, { promise, owners });
    void promise.then(
      () => this.flights.delete(key),
      () => this.flights.delete(key)
    );
    // A newer foreground reader can join while the captured SSH lease opens.
    const current = () => [...owners].some((isCurrent) => isCurrent());
    try {
      void send(current).then(accept, refuse);
    } catch (error) {
      refuse(error);
    }
    return promise;
  }
}
