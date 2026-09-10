/** Invalidating a context never retries or rolls back a request already sent. */
export class DeliveryOwnership {
  private generation = Symbol();

  invalidate(): void {
    this.generation = Symbol();
  }

  capture(isAvailable: () => boolean = () => true): () => boolean {
    const generation = this.generation;
    return () => this.generation === generation && isAvailable();
  }
}

/** Resolve selection changes once, synchronously, outside React's replayable updater. */
export class DeliverySelection<T> {
  constructor(
    private current: T,
    private readonly same: (a: T, b: T) => boolean,
    private readonly ownership: DeliveryOwnership
  ) {}

  update(value: T | ((previous: T) => T)): T {
    const next = typeof value === 'function' ? (value as (previous: T) => T)(this.current) : value;
    if (!this.same(this.current, next)) this.ownership.invalidate();
    this.current = next;
    return next;
  }
}

export function assertDeliveryCurrent(isCurrent: () => boolean): void {
  if (!isCurrent()) throw new Error('The delivery destination is no longer active.');
}

/** Keep paste and Enter ordered, with no second transmission after context loss. */
export async function deliverPasteAndEnter(
  paste: () => Promise<void>,
  enter: (() => Promise<void>) | null,
  isCurrent: () => boolean
): Promise<void> {
  assertDeliveryCurrent(isCurrent);
  await paste();
  if (enter) {
    assertDeliveryCurrent(isCurrent);
    await enter();
  }
}
