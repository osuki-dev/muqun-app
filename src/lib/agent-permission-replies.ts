import type { PermissionRequest } from './agent-protocol';

/** The selected pairing is opaque; credentials never become part of a loggable key. */
export interface PermissionReplyOwner {
  scope: string;
  connection: object | null;
}

export function samePermissionReplyOwner(
  a: PermissionReplyOwner | null,
  b: PermissionReplyOwner
): boolean {
  return a?.scope === b.scope && a.connection === b.connection;
}

interface ReplyTicket {
  key: string;
  token: symbol;
}

const requestKey = (request: Pick<PermissionRequest, 'asid' | 'id'>) =>
  JSON.stringify([request.asid, request.id]);

/** Only current pending requests may be answered. Automatic failures require a human retry. */
export class PermissionReplyGate {
  private owner: PermissionReplyOwner | null = null;
  private pending = new Set<string>();
  private attempted = new Set<string>();
  private resolved = new Set<string>();
  private inFlight = new Map<string, symbol>();

  enter(owner: PermissionReplyOwner): void {
    if (samePermissionReplyOwner(this.owner, owner)) return;
    this.owner = owner;
    this.pending.clear();
    this.attempted.clear();
    this.resolved.clear();
    this.inFlight.clear();
  }

  replace(
    owner: PermissionReplyOwner,
    requests: readonly PermissionRequest[]
  ): PermissionRequest[] {
    this.enter(owner);
    const pending = requests.filter((request) => !this.resolved.has(requestKey(request)));
    this.pending = new Set(pending.map(requestKey));
    return pending;
  }

  add(owner: PermissionReplyOwner, request: PermissionRequest): boolean {
    this.enter(owner);
    const key = requestKey(request);
    if (this.resolved.has(key)) return false;
    this.pending.add(key);
    return true;
  }

  resolve(owner: PermissionReplyOwner, request: Pick<PermissionRequest, 'asid' | 'id'>): void {
    if (samePermissionReplyOwner(this.owner, owner)) {
      const key = requestKey(request);
      this.pending.delete(key);
      this.resolved.add(key);
    }
  }

  begin(
    owner: PermissionReplyOwner,
    request: PermissionRequest,
    automatic: boolean
  ): ReplyTicket | null {
    const key = requestKey(request);
    if (
      !samePermissionReplyOwner(this.owner, owner) ||
      !this.pending.has(key) ||
      this.inFlight.has(key) ||
      (automatic && this.attempted.has(key))
    )
      return null;
    if (automatic) this.attempted.add(key);
    const token = Symbol('permission-reply');
    this.inFlight.set(key, token);
    return { key, token };
  }

  finish(ticket: ReplyTicket, accepted: boolean): void {
    if (this.inFlight.get(ticket.key) !== ticket.token) return;
    this.inFlight.delete(ticket.key);
    if (accepted) {
      this.pending.delete(ticket.key);
      this.resolved.add(ticket.key);
    }
  }
}

/** Cross-surface delivery guard. Entries live only until the actual reply settles. */
export class PermissionReplyFlights {
  private flights = new Map<string, { payload: string; promise: Promise<void> }>();

  run(
    source: string,
    asid: string,
    requestId: string,
    payload: string,
    send: () => Promise<void>
  ): Promise<void> {
    const key = JSON.stringify([source, asid, requestId]);
    const existing = this.flights.get(key);
    if (existing)
      return existing.payload === payload
        ? existing.promise
        : Promise.reject(new Error('A different permission reply is already in progress.'));
    let accept!: () => void;
    let refuse!: (failure: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      accept = resolve;
      refuse = reject;
    });
    this.flights.set(key, { payload, promise });
    void promise.then(
      () => this.flights.delete(key),
      () => this.flights.delete(key)
    );
    // Start synchronously: the caller captured this exact configured transport.
    // Deferring send to a microtask could borrow another computer's credentials.
    try {
      void send().then(accept, refuse);
    } catch (failure) {
      refuse(failure);
    }
    return promise;
  }
}
